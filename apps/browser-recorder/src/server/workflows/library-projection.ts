import type { LibraryWorkflowItem } from "@/shared/contracts/workflow/library";
import type { Workflow } from "@/shared/contracts/workflow/domain";

export function toLibraryWorkflowItem(workflow: Workflow): LibraryWorkflowItem {
  return {
    id: workflow.id,
    name: workflow.name,
    status: workflow.status,
    updatedAt: workflow.updatedAt,
    steps: workflow.steps
      .map(({ id, name, order }) => ({ id, name, order }))
      .sort((left, right) => left.order - right.order),
  };
}
