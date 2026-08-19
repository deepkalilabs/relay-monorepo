import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleWorkspaceApi } from "@/server/workspaces/http-router";
import type { WorkflowRepositoryResolver } from "@/server/infrastructure/storage/repository-factory";

const servers: Server[] = [];

async function api(resolver: WorkflowRepositoryResolver): Promise<string> {
  const server = createServer((request, response) => {
    void handleWorkspaceApi(request, response, resolver).then((handled) => {
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
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("workspace HTTP API", () => {
  it("returns the safe workspace catalog without caching it in the browser", async () => {
    const namespaceId = crypto.randomUUID();
    const resolver: WorkflowRepositoryResolver = {
      listWorkspaces: async () => ({
        workspaces: [
          { key: "local", name: "Local", source: "local" },
          { key: namespaceId, name: "gen", source: "namespace" },
        ],
        defaultKey: "local",
      }),
      resolve: async () => { throw new Error("Not used."); },
    };
    const url = await api(resolver);

    const response = await fetch(`${url}/api/workspaces`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      workspaces: [
        { key: "local", name: "Local", source: "local" },
        { key: namespaceId, name: "gen", source: "namespace" },
      ],
      defaultKey: "local",
    });
  });

  it("returns a safe retryable failure when discovery fails", async () => {
    const resolver: WorkflowRepositoryResolver = {
      listWorkspaces: async () => { throw new Error("private upstream detail"); },
      resolve: async () => { throw new Error("Not used."); },
    };
    const url = await api(resolver);

    const response = await fetch(`${url}/api/workspaces`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Workspaces could not be loaded." });
  });
});
