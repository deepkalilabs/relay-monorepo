import {
  ExecutableWorkflowSchema,
  type ExecutableWorkflow,
} from "@relay/workflow-contract";
import { ReplayCoreError } from "./errors.js";

export interface ReplayPreflight {
  workflow: ExecutableWorkflow;
  startIndex: number;
  totalSteps: number;
  bootstrapUrl?: string;
}

function validHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function preflightReplay(input: unknown, startStepId?: string): ReplayPreflight {
  const workflow = ExecutableWorkflowSchema.parse(input);
  const duplicate = workflow.steps.find(
    (step, index) => workflow.steps.findIndex((candidate) => candidate.id === step.id) !== index,
  );
  if (duplicate) throw new ReplayCoreError("duplicate_step_id", "preflight");

  const startIndex = startStepId
    ? workflow.steps.findIndex((step) => step.id === startStepId)
    : 0;
  if (startIndex < 0) throw new ReplayCoreError("missing_start_step", "preflight");

  const range = workflow.steps.slice(startIndex);
  const firstEnabled = range.find((step) => step.enabled);
  if (!firstEnabled) throw new ReplayCoreError("empty_range", "preflight");

  const bootstrapUrl = firstEnabled.type === "navigate"
    ? undefined
    : validHttpUrl(workflow.source.startUrl)
      ? workflow.source.startUrl
      : validHttpUrl(firstEnabled.page.url)
        ? firstEnabled.page.url
        : undefined;
  if (firstEnabled.type !== "navigate" && !bootstrapUrl) {
    throw new ReplayCoreError("missing_bootstrap_url", "preflight");
  }

  return { workflow, startIndex, totalSteps: range.length, bootstrapUrl };
}
