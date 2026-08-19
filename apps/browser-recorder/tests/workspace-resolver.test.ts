import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkflowRepositoryResolver,
  WorkspaceSelectionError,
} from "@/server/infrastructure/storage/repository-factory";
import { FileWorkflowRepository } from "@/server/workflows/filesystem-repository";

const servers: Server[] = [];

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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("workflow workspace resolution", () => {
  it("returns Local plus valid Relay namespaces in development and scopes repositories by UUID", async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const requests: Array<{ url: string; authorization?: string }> = [];
    const baseUrl = await listen((request, response) => {
      requests.push({ url: request.url ?? "", authorization: request.headers.authorization });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        namespaces: [
          { id: firstId, name: "gen", createdAt: "2026-08-11T12:00:00.000Z", updatedAt: "2026-08-11T12:00:00.000Z" },
          { id: secondId, name: "QA", createdAt: "2026-08-11T12:00:00.000Z", updatedAt: "2026-08-11T12:00:00.000Z" },
        ],
      }));
    });
    const resolver = createWorkflowRepositoryResolver({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    }, { development: true });

    await expect(resolver.listWorkspaces()).resolves.toEqual({
      workspaces: [
        { key: "local", name: "Local", source: "local" },
        { key: firstId, name: "gen", source: "namespace" },
        { key: secondId, name: "QA", source: "namespace" },
      ],
      defaultKey: "local",
    });
    await expect(resolver.resolve("local")).resolves.toBeInstanceOf(FileWorkflowRepository);
    const firstRepository = await resolver.resolve(firstId);
    const secondRepository = await resolver.resolve(secondId);
    expect(firstRepository).toMatchObject({ namespaceId: firstId });
    expect(secondRepository).toMatchObject({ namespaceId: secondId });
    expect(firstRepository).not.toBe(secondRepository);
    expect(requests).toEqual([{
      url: "/storage/v1/namespaces",
      authorization: "Basic cmVsYXk6c2VjcmV0",
    }]);
  });

  it("returns only namespaces in production and defaults to the first namespace", async () => {
    const namespaceId = crypto.randomUUID();
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        namespaces: [{
          id: namespaceId,
          name: "gen",
          createdAt: "2026-08-11T12:00:00.000Z",
          updatedAt: "2026-08-11T12:00:00.000Z",
        }],
      }));
    });
    const resolver = createWorkflowRepositoryResolver({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    }, { development: false });

    await expect(resolver.listWorkspaces()).resolves.toEqual({
      workspaces: [{ key: namespaceId, name: "gen", source: "namespace" }],
      defaultKey: namespaceId,
    });
  });

  it("keeps Local available on development discovery failure but blocks production", async () => {
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 503;
      response.end();
    });
    const environment = {
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    };

    await expect(createWorkflowRepositoryResolver(environment, { development: true }).listWorkspaces())
      .resolves.toEqual({
        workspaces: [{ key: "local", name: "Local", source: "local" }],
        defaultKey: "local",
        namespaceWarning: "Relay namespaces could not be loaded.",
      });
    await expect(createWorkflowRepositoryResolver(environment, { development: false }).listWorkspaces())
      .rejects.toThrow("Relay namespaces could not be loaded.");
  });

  it("keeps development local-only for an empty Relay list and blocks production", async () => {
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ namespaces: [] }));
    });
    const environment = {
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    };

    await expect(createWorkflowRepositoryResolver(environment, { development: true }).listWorkspaces())
      .resolves.toEqual({
        workspaces: [{ key: "local", name: "Local", source: "local" }],
        defaultKey: "local",
      });
    await expect(createWorkflowRepositoryResolver(environment, { development: false }).listWorkspaces())
      .rejects.toThrow("Relay has no available namespaces.");
  });

  it("rejects stale, malformed, and production-local selections", async () => {
    const namespaceId = crypto.randomUUID();
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ namespaces: [{
        id: namespaceId,
        name: "gen",
        createdAt: "2026-08-11T12:00:00.000Z",
        updatedAt: "2026-08-11T12:00:00.000Z",
      }] }));
    });
    const resolver = createWorkflowRepositoryResolver({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    }, { development: false });
    await resolver.listWorkspaces();

    await expect(resolver.resolve("local")).rejects.toBeInstanceOf(WorkspaceSelectionError);
    await expect(resolver.resolve("not-a-uuid")).rejects.toBeInstanceOf(WorkspaceSelectionError);
    await expect(resolver.resolve(crypto.randomUUID()))
      .rejects.toBeInstanceOf(WorkspaceSelectionError);
  });
});
