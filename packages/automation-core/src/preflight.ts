import {
  ReplayCoreError,
  preflightReplay,
  type ReplayPreflight,
} from "@relay/replay-core";

export type AutomationPreflight = ReplayPreflight;

export class AutomationPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationPreflightError";
  }
}

function preflightMessage(error: ReplayCoreError): string {
  switch (error.code) {
    case "duplicate_step_id":
      return "Workflow step IDs must be unique.";
    case "missing_start_step":
      return "The selected automation step is no longer in this workflow.";
    case "empty_range":
      return "The selected automation range has no enabled steps.";
    case "missing_bootstrap_url":
      return "Automation needs a recorded HTTP page URL as its starting point.";
    default:
      return "Automation preflight failed.";
  }
}

export function preflightAutomation(input: unknown, startStepId?: string): AutomationPreflight {
  try {
    return preflightReplay(input, startStepId);
  } catch (error) {
    if (error instanceof ReplayCoreError) {
      throw new AutomationPreflightError(preflightMessage(error));
    }
    throw error;
  }
}
