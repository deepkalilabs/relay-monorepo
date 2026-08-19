import type { Workflow } from "./domain";

export interface LibraryWorkflowItem {
  id: string;
  name: string;
  status: Workflow["status"];
  updatedAt: string;
  steps: Array<{
    id: string;
    name: string;
    order: number;
  }>;
}

export interface WorkflowLibraryResponse {
  workflows: LibraryWorkflowItem[];
  invalidFileCount: number;
}
