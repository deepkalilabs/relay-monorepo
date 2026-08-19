import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAutomationBatchService,
  handleAutomationBatchApi,
  type AutomationBatchService,
} from "@/server/automation/http-router";
import {
  WorkflowNotFoundError,
  type WorkflowRepository,
} from "@/server/workflows/repository";
import type { WorkflowRepositoryResolver } from "@/server/infrastructure/storage/repository-factory";
import { createWorkflow } from "@/shared/contracts/workflow/schema";
import type { Workflow } from "@/shared/contracts/workflow/domain";

const servers: Server[] = [];

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return `http://127.0.0.1:${address.port}/`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function completeWorkflow(parameterSource?: "profile" | "runtime"): Workflow {
  const workflow = createWorkflow();
  workflow.name = "Checkout";
  workflow.status = "complete";
  workflow.steps = parameterSource ? [{
    id: crypto.randomUUID(),
    order: 0,
    name: "Enter value",
    enabled: true,
    type: "fill",
    page: { id: "page", url: "https://example.com" },
    target: { candidates: [{ kind: "label", value: "Value", exact: true }] },
    payload: { value: "" },
    parameterBinding: parameterSource === "profile"
      ? { source: "profile", field: "identity.email" }
      : { source: "runtime" },
    metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
  }] : [{
    id: crypto.randomUUID(),
    order: 0,
    name: "Open checkout",
    enabled: true,
    type: "navigate",
    page: { id: "page", url: "https://example.com" },
    payload: { url: "https://example.com" },
    metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
  }];
  return workflow;
}

function workflowRepository(workflows: Workflow[]): WorkflowRepository {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  const unsupported = async () => { throw new Error("Not used by this test."); };
  return {
    list: unsupported,
    create: unsupported,
    get: async (id) => {
      const workflow = byId.get(id);
      if (!workflow) throw new WorkflowNotFoundError();
      return workflow;
    },
    save: unsupported,
    finish: unsupported,
  };
}

async function api(
  repository: WorkflowRepository,
  service: AutomationBatchService | null,
  resolverOverride?: WorkflowRepositoryResolver,
) {
  const resolver = resolverOverride ?? {
    listWorkspaces: async () => ({ workspaces: [], defaultKey: "local" }),
    resolve: async () => repository,
  } satisfies WorkflowRepositoryResolver;
  const url = await listen((request, response) => {
    void handleAutomationBatchApi(request, response, resolver, service).then((handled) => {
      if (!handled) {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  return url;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("Relay batch service", () => {
  it("creates and polls an authenticated batch without retrying", async () => {
    const workflow = completeWorkflow();
    const requests: Array<{ method: string; url: string; authorization?: string; body?: unknown }> = [];
    const baseUrl = await listen((request, response) => {
      void readJson(request).catch(() => undefined).then((body) => {
        requests.push({
          method: request.method ?? "",
          url: request.url ?? "",
          authorization: request.headers.authorization,
          body,
        });
        response.statusCode = request.method === "POST" ? 202 : 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(request.method === "POST"
          ? { batchId: crypto.randomUUID(), runCount: 1 }
          : {
            batchId: request.url?.split("/").at(-1),
            runs: [{
              workflowId: workflow.id,
              status: "running",
              currentStep: 1,
              totalSteps: 1,
            }],
          }));
      });
    });
    const client = createAutomationBatchService({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "relay-secret",
    })!;

    const created = await client.create([workflow]);
    const snapshot = await client.get(created.batchId);

    expect(created.runCount).toBe(1);
    expect(snapshot.runs[0]).toMatchObject({ workflowId: workflow.id, status: "running" });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "/v1/batches",
      authorization: `Basic ${Buffer.from("relay-user:relay-secret").toString("base64")}`,
      body: { runs: [{ workflow }] },
    });
    expect(requests[1]).toMatchObject({
      method: "GET",
      url: `/v1/batches/${created.batchId}`,
      authorization: `Basic ${Buffer.from("relay-user:relay-secret").toString("base64")}`,
    });
  });

  it("does not retry batch creation after an ambiguous transport failure", async () => {
    const fetchRelay = vi.fn(async () => {
      throw new TypeError("connection closed after upload");
    });
    const client = createAutomationBatchService({
      RELAY_API_BASE_URL: "https://relay.example.test/",
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "relay-secret",
    }, fetchRelay)!;

    await expect(client.create([completeWorkflow()]))
      .rejects.toMatchObject({ status: 503, message: "The automation service is unavailable." });
    expect(fetchRelay).toHaveBeenCalledOnce();
  });

  it("rejects malformed success responses without exposing their contents", async () => {
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 202;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ batchId: "private-backend-value", workflow: { secret: true } }));
    });

    const client = createAutomationBatchService({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "token",
    })!;
    await expect(client.create([completeWorkflow()]))
      .rejects.toMatchObject({ status: 502, message: "The automation service returned an invalid response." });
  });

  it("distinguishes a missing batch route from an unknown created batch", async () => {
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ detail: "Not Found" }));
    });
    const client = createAutomationBatchService({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "relay-secret",
    })!;

    await expect(client.create([completeWorkflow()]))
      .rejects.toMatchObject({ status: 503, message: "The automation service is unavailable." });
    await expect(client.get(crypto.randomUUID()))
      .rejects.toMatchObject({ status: 404, message: "The background run was not found." });
  });

  it("normalizes Relay-native polling snapshots and strips diagnostics", async () => {
    const first = completeWorkflow();
    const second = completeWorkflow();
    const batchId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        batchId,
        runs: [
          { workflowId: first.id, status: "queued" },
          {
            workflowId: second.id,
            status: "failed",
            currentStep: 2,
            totalSteps: 3,
            passedSteps: 2,
            skippedSteps: 0,
            durationMs: 5_401,
            failedStepId: crypto.randomUUID(),
            failedStepIndex: 2,
            phase: "asserting",
            code: "automation_failed",
            thumbnail: {
              url: `/v1/artifacts/${artifactId}`,
              mediaType: "image/webp",
              width: 480,
              height: 300,
              expiresAt: "2026-08-05T23:00:00.000Z",
            },
          },
        ],
      }));
    });
    const client = createAutomationBatchService({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "relay-secret",
    })!;

    await expect(client.get(batchId)).resolves.toEqual({
      batchId,
      runs: [
        { workflowId: first.id, status: "queued", currentStep: 0, totalSteps: 0 },
        {
          workflowId: second.id,
          status: "failed",
          currentStep: 2,
          totalSteps: 3,
          screenshot: {
            url: `/api/run-artifacts/${artifactId}`,
            width: 480,
            height: 300,
          },
        },
      ],
    });
  });

  it.each([
    {
      name: "a non-WebP response",
      status: 200,
      mediaType: "image/png",
      body: Buffer.from("pixels"),
      expectedStatus: 502,
      expectedMessage: "The automation service returned an invalid screenshot.",
    },
    {
      name: "an empty response",
      status: 200,
      mediaType: "image/webp",
      body: Buffer.alloc(0),
      expectedStatus: 502,
      expectedMessage: "The automation service returned an invalid screenshot.",
    },
    {
      name: "an oversized response",
      status: 200,
      mediaType: "image/webp",
      body: Buffer.alloc(102_401),
      expectedStatus: 502,
      expectedMessage: "The automation service returned an invalid screenshot.",
    },
    {
      name: "an expired artifact",
      status: 404,
      mediaType: "application/json",
      body: Buffer.from("{}"),
      expectedStatus: 404,
      expectedMessage: "The run screenshot was not found.",
    },
  ])("rejects $name without exposing its contents", async ({
    status,
    mediaType,
    body,
    expectedStatus,
    expectedMessage,
  }) => {
    const artifactId = crypto.randomUUID();
    const baseUrl = await listen((_request, response) => {
      response.statusCode = status;
      response.setHeader("content-type", mediaType);
      response.end(body);
    });
    const client = createAutomationBatchService({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "relay-secret",
    })!;

    await expect(client.getArtifact(artifactId))
      .rejects.toMatchObject({ status: expectedStatus, message: expectedMessage });
  });

  it.each([
    {
      name: "an invalid batch ID",
      body: (_batchId: string, workflowId: string) => ({
        batchId: "not-a-uuid",
        runs: [{ workflowId, status: "queued" }],
      }),
    },
    {
      name: "an invalid workflow ID",
      body: (batchId: string) => ({
        batchId,
        runs: [{ workflowId: "not-a-uuid", status: "queued" }],
      }),
    },
    {
      name: "an invalid status",
      body: (batchId: string, workflowId: string) => ({
        batchId,
        runs: [{ workflowId, status: "paused" }],
      }),
    },
    {
      name: "only one progress counter",
      body: (batchId: string, workflowId: string) => ({
        batchId,
        runs: [{ workflowId, status: "running", currentStep: 1 }],
      }),
    },
    {
      name: "progress beyond the total",
      body: (batchId: string, workflowId: string) => ({
        batchId,
        runs: [{ workflowId, status: "running", currentStep: 2, totalSteps: 1 }],
      }),
    },
    {
      name: "a thumbnail on an active run",
      body: (batchId: string, workflowId: string) => ({
        batchId,
        runs: [{
          workflowId,
          status: "running",
          thumbnail: {
            url: `/v1/artifacts/${crypto.randomUUID()}`,
            mediaType: "image/webp",
            width: 480,
            height: 300,
            expiresAt: "2026-08-05T23:00:00.000Z",
          },
        }],
      }),
    },
    {
      name: "malformed thumbnail metadata",
      body: (batchId: string, workflowId: string) => ({
        batchId,
        runs: [{
          workflowId,
          status: "completed",
          thumbnail: {
            url: "/v1/artifacts/not-a-uuid",
            mediaType: "image/webp",
            width: 480,
            height: 300,
            expiresAt: "2026-08-05T23:00:00.000Z",
          },
        }],
      }),
    },
  ])("rejects Relay polling snapshots with $name", async ({ body }) => {
    const batchId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body(batchId, workflowId)));
    });
    const client = createAutomationBatchService({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "relay-secret",
    })!;

    await expect(client.get(batchId))
      .rejects.toMatchObject({ status: 502, message: "The automation service returned an invalid response." });
  });

  it("returns no client for missing configuration and validates configured URLs", () => {
    expect(createAutomationBatchService({})).toBeNull();
    expect(() => createAutomationBatchService({
      RELAY_API_BASE_URL: "https://relay.example.test",
    })).toThrow("RELAY_API_USERNAME");
    expect(() => createAutomationBatchService({
      RELAY_API_BASE_URL: "https://relay.example.test",
      RELAY_API_USERNAME: "relay-user",
    })).toThrow("RELAY_API_PASSWORD");
    expect(() => createAutomationBatchService({
      RELAY_API_BASE_URL: "file:///tmp/relay",
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "secret",
    })).toThrow("RELAY_API_BASE_URL");
  });
});

describe("automation batch HTTP API", () => {
  it("loads complete workflows in request order and returns a safe create response", async () => {
    const first = completeWorkflow();
    const second = completeWorkflow();
    const batchId = crypto.randomUUID();
    const create = vi.fn(async () => ({ batchId, runCount: 2 }));
    const service: AutomationBatchService = { create, get: vi.fn(), getArtifact: vi.fn() };
    const url = await api(workflowRepository([first, second]), service);

    const response = await fetch(`${url}api/run-batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowIds: [second.id, first.id] }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ batchId, runCount: 2 });
    expect(create).toHaveBeenCalledWith([second, first]);
  });

  it("loads initial batch workflows from the selected namespace repository", async () => {
    const workflow = completeWorkflow();
    const namespaceId = crypto.randomUUID();
    const repository = workflowRepository([workflow]);
    const resolve = vi.fn(async (key: string | undefined) => {
      if (key !== namespaceId) throw new Error("Wrong workspace.");
      return repository;
    });
    const create = vi.fn(async () => ({ batchId: crypto.randomUUID(), runCount: 1 }));
    const url = await api(repository, { create, get: vi.fn(), getArtifact: vi.fn() }, {
      listWorkspaces: vi.fn(),
      resolve,
    });

    const response = await fetch(`${url}api/run-batches`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-key": namespaceId,
      },
      body: JSON.stringify({ workflowIds: [workflow.id] }),
    });

    expect(response.status).toBe(202);
    expect(resolve).toHaveBeenCalledWith(namespaceId);
    expect(create).toHaveBeenCalledWith([workflow]);
  });

  it.each([
    { name: "duplicate IDs", body: (id: string) => ({ workflowIds: [id, id] }) },
    { name: "an empty list", body: () => ({ workflowIds: [] }) },
    { name: "an unknown field", body: (id: string) => ({ workflowIds: [id], extra: true }) },
  ])("rejects $name before creating a Relay batch", async ({ body }) => {
    const workflow = completeWorkflow();
    const create = vi.fn();
    const url = await api(workflowRepository([workflow]), {
      create,
      get: vi.fn(),
      getArtifact: vi.fn(),
    });

    const response = await fetch(`${url}api/run-batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body(workflow.id)),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { name: "draft", workflow: () => createWorkflow() },
    { name: "profile parameters", workflow: () => completeWorkflow("profile") },
    { name: "runtime parameters", workflow: () => completeWorkflow("runtime") },
  ])("rejects a $name workflow before creating a Relay batch", async ({ workflow: makeWorkflow }) => {
    const workflow = makeWorkflow();
    const create = vi.fn();
    const url = await api(workflowRepository([workflow]), {
      create,
      get: vi.fn(),
      getArtifact: vi.fn(),
    });

    const response = await fetch(`${url}api/run-batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowIds: [workflow.id] }),
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("proxies a safe polling snapshot and disables routes when unconfigured", async () => {
    const workflow = completeWorkflow();
    const batchId = crypto.randomUUID();
    const snapshot = {
      batchId,
      runs: [{
        workflowId: workflow.id,
        status: "completed" as const,
        currentStep: 1,
        totalSteps: 1,
      }],
    };
    const get = vi.fn(async () => snapshot);
    const repository = workflowRepository([workflow]);
    const configuredUrl = await api(repository, { create: vi.fn(), get, getArtifact: vi.fn() });
    const unavailableUrl = await api(repository, null);

    const response = await fetch(`${configuredUrl}api/run-batches/${batchId}`);
    const unavailable = await fetch(`${unavailableUrl}api/run-batches/${batchId}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(snapshot);
    expect(get).toHaveBeenCalledWith(batchId);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "Background runs are not configured." });
  });

  it("proxies an authenticated bounded WebP with safe browser headers", async () => {
    const artifactId = crypto.randomUUID();
    const screenshot = Buffer.from("private screenshot pixels");
    const requests: Array<{ url?: string; authorization?: string; accept?: string }> = [];
    const baseUrl = await listen((request, response) => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        accept: request.headers.accept,
      });
      response.statusCode = 200;
      response.setHeader("content-type", "image/webp");
      response.end(screenshot);
    });
    const service = createAutomationBatchService({
      RELAY_API_BASE_URL: baseUrl,
      RELAY_API_USERNAME: "relay-user",
      RELAY_API_PASSWORD: "relay-secret",
    })!;
    const url = await api(workflowRepository([]), service);

    const response = await fetch(`${url}api/run-artifacts/${artifactId}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(screenshot);
    expect(requests).toEqual([{
      url: `/v1/artifacts/${artifactId}`,
      authorization: `Basic ${Buffer.from("relay-user:relay-secret").toString("base64")}`,
      accept: "image/webp",
    }]);
  });

  it("rejects invalid artifact IDs before contacting Relay", async () => {
    const getArtifact = vi.fn();
    const service = {
      create: vi.fn(),
      get: vi.fn(),
      getArtifact,
    } as AutomationBatchService;
    const url = await api(workflowRepository([]), service);

    const response = await fetch(`${url}api/run-artifacts/not-a-uuid`);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ error: "The run screenshot request is invalid." });
    expect(getArtifact).not.toHaveBeenCalled();
  });
});
