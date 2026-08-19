import type { Workflow } from "@/shared/contracts/workflow/domain";
import type { LibraryWorkflowItem } from "@/shared/contracts/workflow/library";

export interface WorkflowListResult {
  workflows: LibraryWorkflowItem[];
  skippedRecordCount: number;
}

export class WorkflowNotFoundError extends Error {
  constructor() {
    super("The workflow was not found.");
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowConflictError extends Error {
  constructor() {
    super("The workflow changed since it was loaded.");
    this.name = "WorkflowConflictError";
  }
}

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export class WorkflowUnavailableError extends Error {
  constructor() {
    super("Workflow storage is temporarily unavailable.");
    this.name = "WorkflowUnavailableError";
  }
}

export interface WorkflowRepository {
  list(): Promise<WorkflowListResult>;
  create(): Promise<Workflow>;
  get(id: string): Promise<Workflow>;
  save(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow>;
  finish(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow>;
}
