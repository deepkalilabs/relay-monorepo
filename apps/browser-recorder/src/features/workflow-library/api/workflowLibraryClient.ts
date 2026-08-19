import type { Workflow } from "@/shared/contracts/workflow/domain";
import type { WorkflowLibraryResponse } from "@/shared/contracts/workflow/library";
import { WorkflowSchema } from "@/shared/contracts/workflow/schema";
import { workspaceFetch } from "@/shared/api/workspaceClient";
import {
  WorkflowListRequestError,
  workflowListClient,
} from "@/shared/api/workflowListClient";

export class WorkflowLibraryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WorkflowLibraryRequestError";
  }
}

export interface WorkflowLibraryClient {
  list(): Promise<WorkflowLibraryResponse>;
  create(): Promise<Workflow>;
  get(id: string): Promise<Workflow>;
  save(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow>;
}

async function readResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const message = typeof body === "object" && body !== null
      && "error" in body && typeof body.error === "string"
      ? body.error
      : "The workflow request failed.";
    throw new WorkflowLibraryRequestError(message, response.status);
  }
  return body;
}

export const workflowLibraryClient: WorkflowLibraryClient = {
  async list() {
    try {
      return await workflowListClient.list() as WorkflowLibraryResponse;
    } catch (error) {
      if (error instanceof WorkflowListRequestError) {
        throw new WorkflowLibraryRequestError(error.message, error.status);
      }
      throw error;
    }
  },
  async create() {
    return WorkflowSchema.parse(await readResponse(await workspaceFetch("/api/workflows", { method: "POST" })));
  },
  async get(id) {
    return WorkflowSchema.parse(await readResponse(
      await workspaceFetch(`/api/workflows/${encodeURIComponent(id)}`),
    ));
  },
  async save(id, workflow, expectedRevision) {
    return WorkflowSchema.parse(await readResponse(await workspaceFetch(
      `/api/workflows/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow, expectedRevision }),
      },
    )));
  },
};
