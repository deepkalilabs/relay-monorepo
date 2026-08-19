import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ProfileInputSchema,
} from "@/shared/contracts/profile";
import {
  ProfileConflictError,
  ProfileNotFoundError,
  ProfileUnavailableError,
  ProfileValidationError,
  type ProfileRepository,
} from "./repository";

const MAX_REQUEST_BYTES = 65_536;
const CreateRequestSchema = z.object({ profile: ProfileInputSchema });
const SaveRequestSchema = z.object({
  profile: ProfileInputSchema,
  expectedRevision: z.number().int().positive(),
});
const DeleteRequestSchema = z.object({
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
    if (size > MAX_REQUEST_BYTES) throw new ProfileValidationError("The request is too large.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProfileValidationError("The request body must be valid JSON.");
  }
}

function errorMessage(error: unknown): { status: number; message: string } {
  if (error instanceof ProfileValidationError || error instanceof z.ZodError) {
    return {
      status: 400,
      message: error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "The profile request is invalid.")
        : error.message,
    };
  }
  if (error instanceof ProfileNotFoundError) return { status: 404, message: error.message };
  if (error instanceof ProfileConflictError) return { status: 409, message: error.message };
  if (error instanceof ProfileUnavailableError) return { status: 503, message: error.message };
  return { status: 500, message: "The profile storage operation failed." };
}

export async function handleProfileApi(
  request: IncomingMessage,
  response: ServerResponse,
  repository: ProfileRepository,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments[1] !== "profiles") return false;

  try {
    if (segments.length === 2 && request.method === "GET") {
      const result = await repository.list();
      sendJson(response, 200, {
        profiles: result.profiles,
        invalidFileCount: result.skippedRecordCount,
      });
      return true;
    }
    if (segments.length === 2 && request.method === "POST") {
      const input = CreateRequestSchema.parse(await readJson(request));
      sendJson(response, 201, await repository.create(input.profile));
      return true;
    }

    const id = segments[2] ?? "";
    if (segments.length === 3 && request.method === "GET") {
      sendJson(response, 200, await repository.get(id));
      return true;
    }
    if (segments.length === 3 && request.method === "PUT") {
      const input = SaveRequestSchema.parse(await readJson(request));
      sendJson(response, 200, await repository.save(id, input.profile, input.expectedRevision));
      return true;
    }
    if (segments.length === 3 && request.method === "DELETE") {
      const input = DeleteRequestSchema.parse(await readJson(request));
      await repository.delete(id, input.expectedRevision);
      response.statusCode = 204;
      response.end();
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
