import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { WorkflowSchema } from "@/shared/contracts/workflow/schema";
import {
  WorkspaceSelectionError,
  type WorkflowRepositoryResolver,
} from "@/server/infrastructure/storage/repository-factory";
import {
  WorkflowConflictError,
  WorkflowNotFoundError,
  WorkflowUnavailableError,
  WorkflowValidationError,
} from "./repository";

const MAX_REQUEST_BYTES = 1_048_576;
const SaveRequestSchema = z.object({
  workflow: WorkflowSchema,
  expectedRevision: z.number().int().positive(),
});

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new WorkflowValidationError("The request is too large.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkflowValidationError("The request body must be valid JSON.");
  }
}

function errorMessage(error: unknown): { status: number; message: string } {
  if (error instanceof WorkflowValidationError || error instanceof z.ZodError) {
    return { status: 400, message: error instanceof z.ZodError
      ? (error.issues[0]?.message ?? "The workflow request is invalid.")
      : error.message };
  }
  if (error instanceof WorkspaceSelectionError) return { status: 400, message: error.message };
  if (error instanceof WorkflowNotFoundError) return { status: 404, message: error.message };
  if (error instanceof WorkflowConflictError) return { status: 409, message: error.message };
  if (error instanceof WorkflowUnavailableError) return { status: 503, message: error.message };
  return { status: 500, message: "The workflow storage operation failed." };
}

export async function handleWorkflowApi(
  request: IncomingMessage,
  response: ServerResponse,
  resolver: WorkflowRepositoryResolver,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments[1] !== "workflows") return false;

  try {
    const workspaceKey = request.headers["x-workspace-key"];
    const repository = await resolver.resolve(
      typeof workspaceKey === "string" ? workspaceKey : undefined,
    );
    if (segments.length === 2 && request.method === "GET") {
      const result = await repository.list();
      sendJson(response, 200, {
        workflows: result.workflows,
        invalidFileCount: result.skippedRecordCount,
      });
      return true;
    }
    if (segments.length === 2 && request.method === "POST") {
      sendJson(response, 201, await repository.create());
      return true;
    }

    const id = segments[2] ?? "";
    if (segments.length === 3 && request.method === "GET") {
      sendJson(response, 200, await repository.get(id));
      return true;
    }
    if (segments.length === 3 && request.method === "PUT") {
      const input = SaveRequestSchema.parse(await readJson(request));
      sendJson(response, 200, await repository.save(id, input.workflow, input.expectedRevision));
      return true;
    }
    if (segments.length === 4 && segments[3] === "finish" && request.method === "POST") {
      const input = SaveRequestSchema.parse(await readJson(request));
      sendJson(response, 200, await repository.finish(id, input.workflow, input.expectedRevision));
      return true;
    }

    sendJson(response, 405, { error: "Method not allowed." });
    return true;
  } catch (error) {
    const mapped = errorMessage(error);
    sendJson(response, mapped.status, { error: mapped.message });
    return true;
  }
}
