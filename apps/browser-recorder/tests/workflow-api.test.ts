import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileWorkflowRepository } from "@/server/workflows/filesystem-repository";
import { handleWorkflowApi } from "@/server/workflows/http-router";
import {
  WorkspaceSelectionError,
  type WorkflowRepositoryResolver,
} from "@/server/infrastructure/storage/repository-factory";
import {
  WorkflowUnavailableError,
  type WorkflowRepository,
} from "@/server/workflows/repository";

const servers: Server[] = [];
const directories: string[] = [];

async function api(repositoryOverride?: WorkflowRepository, requireExplicitSelection = false) {
  const rootDir = await mkdtemp(join(tmpdir(), "memory-recorder-api-"));
  directories.push(rootDir);
  const repository = repositoryOverride ?? new FileWorkflowRepository(rootDir);
  const resolver: WorkflowRepositoryResolver = {
    listWorkspaces: async () => ({
      workspaces: [{ key: "local", name: "Local", source: "local" }],
      defaultKey: "local",
    }),
    resolve: async (key) => {
      if (key !== "local") throw new WorkspaceSelectionError();
      return repository;
    },
  };
  const server = createServer((request, response) => {
    if (!requireExplicitSelection) request.headers["x-workspace-key"] = "local";
    void handleWorkflowApi(request, response, resolver).then((handled) => {
      if (!handled) {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return { rootDir, repository, url: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("workflow HTTP API", () => {
  it("creates drafts and returns sanitized Library items", async () => {
    const { rootDir, repository, url } = await api();
    const createdResponse = await fetch(`${url}/api/workflows`, { method: "POST" });
    const created = await createdResponse.json();
    created.name = "Checkout";
    created.steps = [{
      id: crypto.randomUUID(),
      order: 0,
      name: "Enter password",
      enabled: true,
      type: "fill",
      page: { id: "page", url: "https://example.com" },
      target: { candidates: [{ kind: "label", value: "Password", exact: true }] },
      payload: { value: "super-secret" },
      parameterBinding: { source: "recorded" },
      metadata: { recordedAt: new Date().toISOString(), origin: "recorded", sensitive: true },
    }];
    await repository.save(created.id, created, 1);
    await writeFile(join(rootDir, `${crypto.randomUUID()}.json`), "{", "utf8");

    const listResponse = await fetch(`${url}/api/workflows`);
    const list = await listResponse.json();

    expect(createdResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(list.invalidFileCount).toBe(1);
    expect(list.workflows[0]).toMatchObject({
      id: created.id,
      name: "Checkout",
      status: "draft",
      steps: [{ id: created.steps[0].id, name: "Enter password", order: 0 }],
    });
    expect(JSON.stringify(list)).not.toContain("super-secret");
  });

  it("loads, saves, and finishes a workflow with revision protection", async () => {
    const { url } = await api();
    const created = await fetch(`${url}/api/workflows`, { method: "POST" }).then((response) => response.json());
    created.steps = [{
      id: crypto.randomUUID(),
      order: 0,
      name: "Open checkout",
      enabled: true,
      type: "navigate",
      page: { id: "page", url: "https://example.com" },
      payload: { url: "https://example.com" },
      metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
    }];

    const saveResponse = await fetch(`${url}/api/workflows/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflow: created, expectedRevision: 1 }),
    });
    const saved = await saveResponse.json();
    const staleResponse = await fetch(`${url}/api/workflows/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflow: created, expectedRevision: 1 }),
    });
    const finishResponse = await fetch(`${url}/api/workflows/${created.id}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflow: saved, expectedRevision: 2 }),
    });
    const finished = await finishResponse.json();

    expect(saveResponse.status).toBe(200);
    expect(saved.revision).toBe(2);
    expect(staleResponse.status).toBe(409);
    expect(finishResponse.status).toBe(200);
    expect(finished).toMatchObject({ status: "complete", revision: 3 });
    expect(await fetch(`${url}/api/workflows/${created.id}`).then((response) => response.json())).toEqual(finished);
  });

  it("returns useful status codes for invalid, missing, and empty-finish requests", async () => {
    const { url } = await api();
    const invalid = await fetch(`${url}/api/workflows/not-an-id`);
    const missing = await fetch(`${url}/api/workflows/${crypto.randomUUID()}`);
    const created = await fetch(`${url}/api/workflows`, { method: "POST" }).then((response) => response.json());
    const finish = await fetch(`${url}/api/workflows/${created.id}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflow: created, expectedRevision: 1 }),
    });

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(finish.status).toBe(400);
  });

  it("returns a non-sensitive 500 response when storage fails", async () => {
    const failure = async () => {
      throw new Error("/private/workflows/secret-name.json could not be read");
    };
    const repository: WorkflowRepository = {
      list: failure,
      create: failure,
      get: failure,
      save: failure,
      finish: failure,
    };
    const { url } = await api(repository);

    const response = await fetch(`${url}/api/workflows`);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "The workflow storage operation failed." });
    expect(JSON.stringify(body)).not.toContain("secret-name");
  });

  it("returns 503 when workflow storage is temporarily unavailable", async () => {
    const failure = async () => {
      throw new WorkflowUnavailableError();
    };
    const repository: WorkflowRepository = {
      list: failure,
      create: failure,
      get: failure,
      save: failure,
      finish: failure,
    };
    const { url } = await api(repository);

    const response = await fetch(`${url}/api/workflows`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Workflow storage is temporarily unavailable." });
  });

  it("requires a valid workspace selection before accessing workflows", async () => {
    const { url } = await api(undefined, true);

    const missing = await fetch(`${url}/api/workflows`);
    const unknown = await fetch(`${url}/api/workflows`, {
      headers: { "x-workspace-key": crypto.randomUUID() },
    });

    expect(missing.status).toBe(400);
    expect(unknown.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: "Select a valid workspace before using workflows.",
    });
  });
});
