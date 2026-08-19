"use client";

import type { Workflow } from "@/shared/contracts/workflow/domain";
import { WorkflowSchema } from "@/shared/contracts/workflow/schema";
import { workspaceFetch } from "@/shared/api/workspaceClient";

export class WorkflowRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WorkflowRequestError";
  }
}

export interface WorkflowEditorClient {
  get(id: string): Promise<Workflow>;
  save(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow>;
  finish(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow>;
}

async function readWorkflow(response: Response): Promise<Workflow> {
  const body = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : "The workflow request failed.";
    throw new WorkflowRequestError(message, response.status);
  }
  return WorkflowSchema.parse(body);
}

function saveBody(workflow: Workflow, expectedRevision: number): string {
  return JSON.stringify({ workflow, expectedRevision });
}

export const workflowEditorClient: WorkflowEditorClient = {
  async get(id) {
    return readWorkflow(await workspaceFetch(`/api/workflows/${encodeURIComponent(id)}`));
  },
  async save(id, workflow, expectedRevision) {
    return readWorkflow(await workspaceFetch(`/api/workflows/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: saveBody(workflow, expectedRevision),
    }));
  },
  async finish(id, workflow, expectedRevision) {
    return readWorkflow(await workspaceFetch(`/api/workflows/${encodeURIComponent(id)}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: saveBody(workflow, expectedRevision),
    }));
  },
};
