import type { Workflow } from "./domain";
import { CompatibleWorkflowSchema, WorkflowSchema } from "./schema";

export const MAX_WORKFLOW_FILE_BYTES = 1_048_576;

function issueMessage(path: PropertyKey[], message: string): string {
  const location = path.length ? path.map(String).join(".") : "workflow";
  return `${location}: ${message}`;
}

export function parseWorkflowJson(
  text: string,
  sizeBytes = new TextEncoder().encode(text).byteLength,
): Workflow {
  if (sizeBytes > MAX_WORKFLOW_FILE_BYTES) {
    throw new Error("Workflow files must be 1 MiB or smaller.");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  const parsed = CompatibleWorkflowSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue ? issueMessage(issue.path, issue.message) : "The workflow is invalid.");
  }

  const ids = new Set<string>();
  for (const step of parsed.data.steps) {
    if (ids.has(step.id)) throw new Error(`steps.${step.order}.id: Step IDs must be unique.`);
    ids.add(step.id);
  }

  return {
    ...parsed.data,
    steps: parsed.data.steps.map((step, order) => ({ ...step, order })),
  };
}

export function serializeWorkflow(workflow: Workflow): string {
  return `${JSON.stringify(WorkflowSchema.parse(workflow), null, 2)}\n`;
}
