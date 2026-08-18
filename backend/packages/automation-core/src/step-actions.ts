import type { Page } from "playwright-core";
import type { WorkflowStep } from "./workflow.js";
import {
  DEFAULT_STEP_TIMEOUT_MS,
  ReplayCoreError,
  applyPositionBefore as applyReplayPosition,
  executeStepAction as executeReplayStepAction,
} from "@relay/replay-core";
import {
  automationAttempts,
  automationErrorFromReplay,
  type AutomationAttempt,
} from "./execution-errors.js";

export interface ActionResult {
  locatorKind?: string;
  attempts: AutomationAttempt[];
}

export async function applyPositionBefore(
  page: Page,
  step: WorkflowStep,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await applyReplayPosition(page, step, { signal });
  } catch (error) {
    if (error instanceof ReplayCoreError) throw automationErrorFromReplay(error, "acting");
    throw error;
  }
}

export async function executeStepAction(
  page: Page,
  step: WorkflowStep,
  signal?: AbortSignal,
  stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
): Promise<ActionResult> {
  try {
    const result = await executeReplayStepAction(page, step, {
      signal,
      timeoutMs: stepTimeoutMs,
    });
    return { ...result, attempts: automationAttempts(result.attempts) };
  } catch (error) {
    if (error instanceof ReplayCoreError) {
      throw automationErrorFromReplay(error, step.type === "assertion" ? "asserting" : "acting");
    }
    throw error;
  }
}
