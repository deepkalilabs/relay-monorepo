import type { Workflow } from "@/shared/contracts/workflow/domain";
import { serializeWorkflow } from "@/shared/contracts/workflow/serialization";

export function workflowFilename(date = new Date()): string {
  return `browser-memory-workflow-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

export function downloadWorkflow(workflow: Workflow): void {
  const blob = new Blob([serializeWorkflow(workflow)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = workflowFilename();
  anchor.click();
  URL.revokeObjectURL(url);
}
