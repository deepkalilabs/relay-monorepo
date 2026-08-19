import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkflowRepositoryResolver } from "@/server/infrastructure/storage/repository-factory";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
}

export async function handleWorkspaceApi(
  request: IncomingMessage,
  response: ServerResponse,
  resolver: WorkflowRepositoryResolver,
): Promise<boolean> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname !== "/api/workspaces") return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return true;
  }
  try {
    sendJson(response, 200, await resolver.listWorkspaces());
  } catch {
    sendJson(response, 503, { error: "Workspaces could not be loaded." });
  }
  return true;
}
