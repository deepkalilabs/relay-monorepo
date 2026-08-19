import type { WorkflowLibraryResponse } from "@/shared/contracts/workflow/library";
import { workspaceFetch } from "@/shared/api/workspaceClient";

export interface WorkflowListClient {
  list(): Promise<WorkflowLibraryResponse>;
}

export class WorkflowListRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WorkflowListRequestError";
  }
}

export const workflowListClient: WorkflowListClient = {
  async list() {
    const response = await workspaceFetch("/api/workflows");
    const body = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) {
      const message = typeof body === "object" && body !== null
        && "error" in body && typeof body.error === "string"
        ? body.error
        : "The workflow request failed.";
      throw new WorkflowListRequestError(message, response.status);
    }
    return body as WorkflowLibraryResponse;
  },
};
