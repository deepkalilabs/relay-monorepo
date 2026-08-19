import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteProfileRepository } from "@/server/profiles/http-repository";
import {
  ProfileConflictError,
  ProfileUnavailableError,
  ProfileValidationError,
} from "@/server/profiles/repository";
import { RemoteWorkflowRepository } from "@/server/workflows/http-repository";
import {
  WorkflowConflictError,
  WorkflowUnavailableError,
  WorkflowValidationError,
} from "@/server/workflows/repository";
import { createWorkflow } from "@/shared/contracts/workflow/schema";
import type { Profile, ProfileInput } from "@/shared/contracts/profile";

const servers: Server[] = [];
const credentials = { username: "relay", password: "secret" };

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return `http://127.0.0.1:${address.port}/storage/`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("RemoteWorkflowRepository", () => {
  it("uses authenticated versioned routes and returns privacy-safe summaries", async () => {
    const workflow = createWorkflow();
    workflow.id = crypto.randomUUID();
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    const baseUrl = await listen((request, response) => {
      requests.push({ url: request.url ?? "", authorization: request.headers.authorization });
      sendJson(response, 200, {
        workflows: [{
          id: workflow.id,
          name: workflow.name,
          status: workflow.status,
          updatedAt: workflow.updatedAt,
          steps: [],
        }],
      });
    });

    const result = await new RemoteWorkflowRepository(baseUrl, {
      username: "relay",
      password: "secret-token",
    }).list();

    expect(result).toEqual({
      workflows: [{
        id: workflow.id,
        name: workflow.name,
        status: workflow.status,
        updatedAt: workflow.updatedAt,
        steps: [],
      }],
      skippedRecordCount: 0,
    });
    expect(requests).toEqual([{
      url: "/storage/v1/workflows",
      authorization: "Basic cmVsYXk6c2VjcmV0LXRva2Vu",
    }]);
    expect(JSON.stringify(result)).not.toContain("sessionId");
  });

  it("retries a transient mutation once with the same idempotency key", async () => {
    const workflow = createWorkflow();
    workflow.id = crypto.randomUUID();
    const idempotencyKeys: Array<string | undefined> = [];
    const bodies: unknown[] = [];
    const baseUrl = await listen((request, response) => {
      idempotencyKeys.push(request.headers["idempotency-key"] as string | undefined);
      bodies.push(undefined);
      if (idempotencyKeys.length === 1) sendJson(response, 503, { error: { code: "unavailable" } });
      else sendJson(response, 201, workflow);
    });

    const created = await new RemoteWorkflowRepository(baseUrl, credentials, { retryDelayMs: 0 }).create();

    expect(created).toEqual(workflow);
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(bodies).toEqual([undefined, undefined]);
  });

  it("normalizes previous frontend workflow documents to the current schema in memory", async () => {
    const workflow = createWorkflow();
    workflow.id = crypto.randomUUID();
    const baseUrl = await listen((_request, response) => {
      sendJson(response, 200, { ...workflow, schemaVersion: "1.4" });
    });

    const loaded = await new RemoteWorkflowRepository(baseUrl, credentials).get(workflow.id);

    expect(loaded).toEqual(workflow);
    expect(loaded.schemaVersion).toBe("1.4");
  });

  it("maps conflicts and malformed successful responses to neutral errors", async () => {
    let mode: "conflict" | "malformed" | "wrong-status" = "conflict";
    const baseUrl = await listen((_request, response) => {
      if (mode === "conflict") sendJson(response, 409, { error: { code: "revision_conflict" } });
      else if (mode === "malformed") sendJson(response, 200, { schemaVersion: "not-a-workflow" });
      else sendJson(response, 200, workflow);
    });
    const repository = new RemoteWorkflowRepository(baseUrl, credentials, { retryDelayMs: 0 });
    const workflow = createWorkflow();
    workflow.id = crypto.randomUUID();

    await expect(repository.save(workflow.id, workflow, 1)).rejects.toBeInstanceOf(WorkflowConflictError);
    mode = "malformed";
    await expect(repository.get(workflow.id)).rejects.toBeInstanceOf(WorkflowUnavailableError);
    mode = "wrong-status";
    await expect(repository.create()).rejects.toBeInstanceOf(WorkflowUnavailableError);
  });

  it("scopes every workflow operation to its namespace UUID", async () => {
    const workflow = createWorkflow();
    workflow.id = crypto.randomUUID();
    workflow.steps = [{
      id: crypto.randomUUID(),
      order: 0,
      name: "Open checkout",
      enabled: true,
      type: "navigate",
      page: { id: "page", url: "https://example.com" },
      payload: { url: "https://example.com" },
      metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
    }];
    const requests: Array<{ method: string; url: string; body?: unknown; idempotencyKey?: string }> = [];
    const baseUrl = await listen((request, response) => {
      void (async () => {
        const body = request.method === "PUT" || request.url?.endsWith("/finish")
          ? await readJson(request)
          : undefined;
        requests.push({
          method: request.method ?? "",
          url: request.url ?? "",
          body,
          idempotencyKey: request.headers["idempotency-key"] as string | undefined,
        });
        if (request.method === "GET" && request.url?.endsWith("/workflows")) {
          sendJson(response, 200, { workflows: [{
            id: workflow.id,
            name: workflow.name,
            status: workflow.status,
            updatedAt: workflow.updatedAt,
            steps: workflow.steps.map(({ id, name, order }) => ({ id, name, order })),
          }] });
          return;
        }
        sendJson(response, request.method === "POST" && request.url?.endsWith("/workflows") ? 201 : 200, {
          ...workflow,
          status: request.url?.endsWith("/finish") ? "complete" : "draft",
          revision: request.url?.endsWith("/finish") ? 3 : 2,
          finishedAt: request.url?.endsWith("/finish") ? new Date().toISOString() : undefined,
        });
      })();
    });
    const namespaceId = crypto.randomUUID();
    const repository = new RemoteWorkflowRepository(baseUrl, credentials, {}, namespaceId);

    await repository.list();
    await repository.create();
    await repository.get(workflow.id);
    const saved = await repository.save(workflow.id, workflow, 1);
    await repository.finish(workflow.id, saved, 2);

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: `/storage/v1/namespaces/${namespaceId}/workflows` },
      { method: "POST", url: `/storage/v1/namespaces/${namespaceId}/workflows` },
      { method: "GET", url: `/storage/v1/namespaces/${namespaceId}/workflows/${workflow.id}` },
      { method: "PUT", url: `/storage/v1/namespaces/${namespaceId}/workflows/${workflow.id}` },
      { method: "POST", url: `/storage/v1/namespaces/${namespaceId}/workflows/${workflow.id}/finish` },
    ]);
    expect(requests[3]?.body).toEqual({ workflow, expectedRevision: 1 });
    expect(requests[4]?.body).toEqual({ workflow: saved, expectedRevision: 2 });
    expect([requests[1], requests[3], requests[4]].every(
      (request) => /^[0-9a-f-]{36}$/.test(request?.idempotencyKey ?? ""),
    )).toBe(true);
  });

  it("rejects invalid workflow snapshots before contacting remote storage", async () => {
    let requestCount = 0;
    const baseUrl = await listen((_request, response) => {
      requestCount += 1;
      sendJson(response, 500, {});
    });
    const workflow = createWorkflow();
    workflow.id = crypto.randomUUID();
    workflow.name = "";

    await expect(new RemoteWorkflowRepository(baseUrl, credentials).save(workflow.id, workflow, 1))
      .rejects.toBeInstanceOf(WorkflowValidationError);
    expect(requestCount).toBe(0);
  });
});

describe("RemoteProfileRepository", () => {
  const input: ProfileInput = {
    name: "Work",
    identity: { fullName: "Alex Johnson", email: "alex@example.com" },
    location: { countryRegion: "United States", postalCode: "94103" },
  };

  it("lists only profile summaries and sends authenticated mutation requests", async () => {
    const now = new Date().toISOString();
    const profile: Profile = {
      schemaVersion: "1.1",
      id: crypto.randomUUID(),
      ...input,
      status: "ready",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const requests: Array<{ method: string; url: string; authorization: string | undefined }> = [];
    const baseUrl = await listen((request, response) => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
      });
      if (request.method === "GET") {
        sendJson(response, 200, {
          profiles: [{ id: profile.id, name: profile.name, status: profile.status, updatedAt: profile.updatedAt }],
        });
      } else {
        void readJson(request).then(() => sendJson(response, 201, profile));
      }
    });
    const repository = new RemoteProfileRepository(baseUrl, "profile-token");

    const listed = await repository.list();
    const created = await repository.create(input);

    expect(listed).toEqual({
      profiles: [{ id: profile.id, name: profile.name, status: profile.status, updatedAt: profile.updatedAt }],
      skippedRecordCount: 0,
    });
    expect(JSON.stringify(listed)).not.toContain("alex@example.com");
    expect(created).toEqual(profile);
    expect(requests).toEqual([
      { method: "GET", url: "/storage/v1/profiles", authorization: "Bearer profile-token" },
      { method: "POST", url: "/storage/v1/profiles", authorization: "Bearer profile-token" },
    ]);
  });

  it("rejects profile list responses that include private fields", async () => {
    const now = new Date().toISOString();
    const baseUrl = await listen((_request, response) => sendJson(response, 200, {
      profiles: [{
        id: crypto.randomUUID(),
        name: "Leaky profile",
        status: "ready",
        updatedAt: now,
        identity: input.identity,
      }],
    }));

    await expect(new RemoteProfileRepository(baseUrl, "token").list())
      .rejects.toBeInstanceOf(ProfileUnavailableError);
  });

  it("maps remote conflicts and exhausted failures without leaking details", async () => {
    let requestCount = 0;
    let status = 409;
    const baseUrl = await listen((_request, response) => {
      requestCount += 1;
      sendJson(response, status, { error: { code: "private/path/alex@example.com" } });
    });
    const repository = new RemoteProfileRepository(baseUrl, "token", { retryDelayMs: 0 });
    const id = crypto.randomUUID();

    await expect(repository.save(id, input, 1)).rejects.toBeInstanceOf(ProfileConflictError);
    status = 503;
    const failure = repository.get(id);
    await expect(failure).rejects.toBeInstanceOf(ProfileUnavailableError);
    await expect(failure).rejects.not.toThrow(/alex@example\.com/);
    expect(requestCount).toBe(3);
  });

  it("normalizes invalid local input to the repository validation error", async () => {
    const baseUrl = await listen((_request, response) => sendJson(response, 500, {}));
    const repository = new RemoteProfileRepository(baseUrl, "token");

    await expect(repository.create({
      ...input,
      name: "x".repeat(101),
    })).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it("revision-protects remote deletion with an idempotent request", async () => {
    const id = crypto.randomUUID();
    const requests: Array<{ url: string; body: unknown; idempotencyKey: string | undefined }> = [];
    const baseUrl = await listen((request, response) => {
      void readJson(request).then((body) => {
        requests.push({
          url: request.url ?? "",
          body,
          idempotencyKey: request.headers["idempotency-key"] as string | undefined,
        });
        response.statusCode = 204;
        response.end();
      });
    });

    await new RemoteProfileRepository(baseUrl, "token").delete(id, 7);

    expect(requests).toEqual([{
      url: `/storage/v1/profiles/${id}`,
      body: { expectedRevision: 7 },
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }]);
  });
});
