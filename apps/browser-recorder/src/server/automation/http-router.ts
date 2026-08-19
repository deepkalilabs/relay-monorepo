import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Workflow } from "@/shared/contracts/workflow/domain";
import {
  WorkspaceSelectionError,
  type WorkflowRepositoryResolver,
} from "@/server/infrastructure/storage/repository-factory";
import {
  WorkflowNotFoundError,
  WorkflowUnavailableError,
  WorkflowValidationError,
} from "@/server/workflows/repository";

const CreateRequest = z.object({
  workflowIds: z.array(z.uuid()).min(1).max(10),
}).strict().refine(
  ({ workflowIds }) => new Set(workflowIds).size === workflowIds.length,
  "Workflow IDs must be unique.",
);
const CreateResponse = z.object({
  batchId: z.uuid(),
  runCount: z.number().int().min(1).max(10),
}).strict();
const RelayArtifactUrl = z.string().regex(/^\/v1\/artifacts\/[0-9a-fA-F-]{36}$/).refine(
  (url) => z.uuid().safeParse(url.slice("/v1/artifacts/".length)).success,
  "Artifact URL must contain a UUID.",
);
const RelayThumbnail = z.object({
  url: RelayArtifactUrl,
  mediaType: z.literal("image/webp"),
  width: z.number().int().min(1).max(480),
  height: z.number().int().min(1).max(300),
  expiresAt: z.iso.datetime(),
}).strict();
const RelayRunSnapshot = z.object({
  workflowId: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  currentStep: z.number().int().nonnegative().optional(),
  totalSteps: z.number().int().nonnegative().optional(),
  passedSteps: z.number().int().nonnegative().optional(),
  skippedSteps: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  failedStepId: z.string().optional(),
  failedStepIndex: z.number().int().nonnegative().optional(),
  phase: z.enum(["acting", "asserting", "settling", "waiting"]).optional(),
  code: z.string().optional(),
  thumbnail: RelayThumbnail.optional(),
}).refine((run) => {
  if (run.currentStep === undefined || run.totalSteps === undefined) {
    return run.currentStep === run.totalSteps;
  }
  return run.currentStep <= run.totalSteps;
}).refine((run) => (
  !run.thumbnail || run.status === "completed" || run.status === "failed"
), "Only terminal runs may include thumbnails.");
const RelayPollResponse = z.object({
  batchId: z.uuid(),
  runs: z.array(RelayRunSnapshot).min(1).max(10),
}).strict().transform(({ batchId, runs }) => ({
  batchId,
  runs: runs.map((run) => ({
    workflowId: run.workflowId,
    status: run.status,
    currentStep: run.currentStep ?? 0,
    totalSteps: run.totalSteps ?? 0,
    ...(run.thumbnail ? {
      screenshot: {
        url: `/api/run-artifacts/${run.thumbnail.url.slice("/v1/artifacts/".length)}`,
        width: run.thumbnail.width,
        height: run.thumbnail.height,
      },
    } : {}),
  })),
}));

type CreateResult = z.infer<typeof CreateResponse>;
type PollResult = z.infer<typeof RelayPollResponse>;
export interface RunArtifact {
  bytes: Buffer;
  mediaType: "image/webp";
}

export interface AutomationBatchService {
  create(workflows: Workflow[]): Promise<CreateResult>;
  get(batchId: string): Promise<PollResult>;
  getArtifact(artifactId: string): Promise<RunArtifact>;
}

class SafeBatchError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RELAY_API_BASE_URL must be a valid HTTP or HTTPS URL.");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol)
    || url.username || url.password || url.search || url.hash) {
    throw new Error("RELAY_API_BASE_URL must be a safe HTTP or HTTPS URL.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function createAutomationBatchService(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchRelay: typeof fetch = globalThis.fetch,
): AutomationBatchService | null {
  const baseUrlValue = environment.RELAY_API_BASE_URL?.trim();
  const username = environment.RELAY_API_USERNAME?.trim();
  const password = environment.RELAY_API_PASSWORD;
  if (!baseUrlValue && !username && !password?.trim()) return null;
  if (!baseUrlValue) throw new Error("RELAY_API_BASE_URL is required for background runs.");
  if (!username) throw new Error("RELAY_API_USERNAME is required for background runs.");
  if (username.includes(":")) throw new Error("RELAY_API_USERNAME must not include a colon.");
  if (!password?.trim()) throw new Error("RELAY_API_PASSWORD is required for background runs.");
  const baseUrl = parseBaseUrl(baseUrlValue);
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
  const maxArtifactBytes = 100 * 1024;

  const request = async <T>(
    pathname: string,
    init: RequestInit,
    status: number,
    schema: z.ZodType<T>,
    notFoundMessage?: string,
  ) => {
    let response: Response;
    try {
      response = await fetchRelay(new URL(pathname, baseUrl), {
        ...init,
        headers: {
          accept: "application/json",
          authorization,
          ...init.headers,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SafeBatchError(503, "The automation service is unavailable.");
    }
    if (response.status === 404 && notFoundMessage) throw new SafeBatchError(404, notFoundMessage);
    if (response.status !== status) throw new SafeBatchError(503, "The automation service is unavailable.");
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new SafeBatchError(502, "The automation service returned an invalid response.");
    return parsed.data;
  };

  const getArtifact = async (artifactId: string): Promise<RunArtifact> => {
    let response: Response;
    try {
      response = await fetchRelay(new URL(`v1/artifacts/${encodeURIComponent(artifactId)}`, baseUrl), {
        method: "GET",
        headers: {
          accept: "image/webp",
          authorization,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SafeBatchError(503, "The run screenshot is temporarily unavailable.");
    }
    if (response.status === 404) throw new SafeBatchError(404, "The run screenshot was not found.");
    if (response.status !== 200) throw new SafeBatchError(503, "The run screenshot is temporarily unavailable.");

    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const declaredSize = Number(response.headers.get("content-length"));
    if (mediaType !== "image/webp"
      || (Number.isFinite(declaredSize) && declaredSize > maxArtifactBytes)
      || !response.body) {
      throw new SafeBatchError(502, "The automation service returned an invalid screenshot.");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxArtifactBytes) {
          await reader.cancel();
          throw new SafeBatchError(502, "The automation service returned an invalid screenshot.");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof SafeBatchError) throw error;
      throw new SafeBatchError(503, "The run screenshot is temporarily unavailable.");
    }
    if (size === 0) throw new SafeBatchError(502, "The automation service returned an invalid screenshot.");
    return { bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), mediaType: "image/webp" };
  };

  return {
    create: (workflows) => request("v1/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runs: workflows.map((workflow) => ({ workflow })) }),
    }, 202, CreateResponse),
    get: (batchId) => request(
      `v1/batches/${encodeURIComponent(batchId)}`,
      { method: "GET" },
      200,
      RelayPollResponse,
      "The background run was not found.",
    ),
    getArtifact,
  };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(value));
}

function sendArtifact(response: ServerResponse, artifact: RunArtifact): void {
  response.statusCode = 200;
  response.setHeader("content-type", artifact.mediaType);
  response.setHeader("content-length", artifact.bytes.length);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(artifact.bytes);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new SafeBatchError(400, "The background run request is invalid.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 4_096) throw new SafeBatchError(400, "The background run request is invalid.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SafeBatchError(400, "The background run request is invalid.");
  }
}

function assertRunnable(workflow: Workflow): void {
  const needsParameters = workflow.steps.some((step) => step.enabled && step.type === "fill"
    && (step.parameterBinding.source === "profile" || step.parameterBinding.source === "runtime"));
  if (workflow.status !== "complete" || needsParameters) {
    throw new SafeBatchError(400, "The background run request is invalid.");
  }
}

function safeError(error: unknown): SafeBatchError {
  if (error instanceof SafeBatchError) return error;
  if (error instanceof WorkspaceSelectionError) return new SafeBatchError(400, error.message);
  if (error instanceof WorkflowNotFoundError || error instanceof WorkflowValidationError || error instanceof z.ZodError) {
    return new SafeBatchError(400, "The background run request is invalid.");
  }
  if (error instanceof WorkflowUnavailableError) {
    return new SafeBatchError(503, "Workflow storage is temporarily unavailable.");
  }
  return new SafeBatchError(500, "The background run request failed.");
}

export async function handleAutomationBatchApi(
  request: IncomingMessage,
  response: ServerResponse,
  resolver: WorkflowRepositoryResolver,
  service: AutomationBatchService | null,
): Promise<boolean> {
  const segments = new URL(request.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean);
  const isBatchRoute = segments[0] === "api" && segments[1] === "run-batches";
  const isArtifactRoute = segments[0] === "api" && segments[1] === "run-artifacts";
  if (!isBatchRoute && !isArtifactRoute) return false;
  if (!service) {
    sendJson(response, 503, { error: "Background runs are not configured." });
    return true;
  }
  try {
    if (isArtifactRoute && segments.length === 3 && request.method === "GET") {
      const artifactId = z.uuid().safeParse(segments[2]);
      if (!artifactId.success) throw new SafeBatchError(400, "The run screenshot request is invalid.");
      sendArtifact(response, await service.getArtifact(artifactId.data));
      return true;
    }
    if (isArtifactRoute) {
      sendJson(response, 405, { error: "Method not allowed." });
      return true;
    }
    if (segments.length === 2 && request.method === "POST") {
      const workspaceKey = request.headers["x-workspace-key"];
      const repository = await resolver.resolve(
        typeof workspaceKey === "string" ? workspaceKey : undefined,
      );
      const { workflowIds } = CreateRequest.parse(await readJson(request));
      const workflows = await Promise.all(workflowIds.map((id) => repository.get(id)));
      workflows.forEach(assertRunnable);
      sendJson(response, 202, await service.create(workflows));
      return true;
    }
    if (segments.length === 3 && request.method === "GET") {
      sendJson(response, 200, await service.get(z.uuid().parse(segments[2])));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    const safe = safeError(error);
    sendJson(response, safe.status, { error: safe.message });
  }
  return true;
}
