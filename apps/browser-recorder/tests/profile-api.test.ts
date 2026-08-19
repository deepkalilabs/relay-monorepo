import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProfileRepository } from "@/server/profiles/filesystem-repository";
import { handleProfileApi } from "@/server/profiles/http-router";
import {
  ProfileUnavailableError,
  type ProfileRepository,
} from "@/server/profiles/repository";
import type { ProfileInput } from "@/shared/contracts/profile";

const servers: Server[] = [];
const directories: string[] = [];

const profileInput: ProfileInput = {
  name: "Work — US",
  identity: { fullName: "Alex Johnson", email: "alex@example.com" },
  location: { countryRegion: "United States", postalCode: "94103" },
};

async function api(repositoryOverride?: ProfileRepository) {
  const rootDir = await mkdtemp(join(tmpdir(), "memory-recorder-profile-api-"));
  directories.push(rootDir);
  const repository = repositoryOverride ?? new FileProfileRepository(rootDir);
  const server = createServer((request, response) => {
    void handleProfileApi(request, response, repository).then((handled) => {
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
  return { rootDir, url: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("profile HTTP API", () => {
  it("creates profiles and lists only non-sensitive summaries", async () => {
    const { rootDir, url } = await api();
    const createdResponse = await fetch(`${url}/api/profiles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: profileInput }),
    });
    const created = await createdResponse.json();
    await writeFile(join(rootDir, `${crypto.randomUUID()}.json`), "{", "utf8");

    const listResponse = await fetch(`${url}/api/profiles`);
    const list = await listResponse.json();

    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({ ...profileInput, status: "ready", revision: 1 });
    expect(list).toEqual({
      profiles: [{
        id: created.id,
        name: profileInput.name,
        status: "ready",
        updatedAt: created.updatedAt,
      }],
      invalidFileCount: 1,
    });
    expect(JSON.stringify(list)).not.toContain("Alex Johnson");
    expect(JSON.stringify(list)).not.toContain("alex@example.com");
  });

  it("loads, updates, and revision-protects deletion", async () => {
    const { url } = await api();
    const created = await fetch(`${url}/api/profiles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: profileInput }),
    }).then((response) => response.json());
    const draftInput = {
      ...profileInput,
      identity: { ...profileInput.identity, email: "invalid@" },
    };

    const saveResponse = await fetch(`${url}/api/profiles/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: draftInput, expectedRevision: 1 }),
    });
    const saved = await saveResponse.json();
    const staleDelete = await fetch(`${url}/api/profiles/${created.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    const loadAfterStaleDelete = await fetch(`${url}/api/profiles/${created.id}`);
    const deleteResponse = await fetch(`${url}/api/profiles/${created.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: saved.revision }),
    });

    expect(saveResponse.status).toBe(200);
    expect(saved).toMatchObject({ status: "draft", revision: 2 });
    expect(loadAfterStaleDelete.status).toBe(200);
    expect(staleDelete.status).toBe(409);
    expect(deleteResponse.status).toBe(204);
    expect(await fetch(`${url}/api/profiles/${created.id}`).then((response) => response.status)).toBe(404);
  });

  it("maps malformed, invalid, missing, and storage failures without leaking details", async () => {
    const { url } = await api();
    const malformed = await fetch(`${url}/api/profiles`, {
      method: "POST",
      body: "{",
    });
    const invalid = await fetch(`${url}/api/profiles/not-an-id`);
    const missing = await fetch(`${url}/api/profiles/${crypto.randomUUID()}`);

    expect(malformed.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);

    const failure = async () => {
      throw new Error("/private/profiles/alex@example.com.json");
    };
    const repository: ProfileRepository = {
      list: failure,
      create: failure,
      get: failure,
      save: failure,
      delete: failure,
    };
    const failingApi = await api(repository);
    const response = await fetch(`${failingApi.url}/api/profiles`);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "The profile storage operation failed." });
    expect(JSON.stringify(body)).not.toContain("alex@example.com");
  });

  it("returns 503 when profile storage is temporarily unavailable", async () => {
    const failure = async () => {
      throw new ProfileUnavailableError();
    };
    const repository: ProfileRepository = {
      list: failure,
      create: failure,
      get: failure,
      save: failure,
      delete: failure,
    };
    const failingApi = await api(repository);

    const response = await fetch(`${failingApi.url}/api/profiles`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Profile storage is temporarily unavailable." });
  });
});
