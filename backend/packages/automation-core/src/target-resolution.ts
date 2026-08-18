import type { Page } from "playwright-core";
import type { ElementTarget } from "./workflow.js";
import {
  DEFAULT_STEP_TIMEOUT_MS,
  ReplayCoreError,
  attemptTargetResolution as attemptReplayTargetResolution,
  locatorFor,
  resolveFrame,
  resolveTarget as resolveReplayTarget,
  type ResolvedTarget as ReplayResolvedTarget,
} from "@relay/replay-core";
import {
  automationAttempts,
  automationErrorFromReplay,
  type AutomationAttempt,
} from "./execution-errors.js";

export const AUTOMATION_STEP_TIMEOUT_MS = DEFAULT_STEP_TIMEOUT_MS;
export { locatorFor, resolveFrame };

export interface ResolvedTarget extends Omit<ReplayResolvedTarget, "attempts"> {
  attempts: AutomationAttempt[];
}

export interface TargetResolutionAttempt {
  resolved?: ResolvedTarget;
  attempts: AutomationAttempt[];
}

export async function attemptTargetResolution(
  page: Page,
  target: ElementTarget,
  recordedPageUrl?: string,
  signal?: AbortSignal,
): Promise<TargetResolutionAttempt> {
  try {
    const attempt = await attemptReplayTargetResolution(page, target, recordedPageUrl, { signal });
    const attempts = automationAttempts(attempt.attempts);
    return {
      ...(attempt.resolved
        ? { resolved: { ...attempt.resolved, attempts: automationAttempts(attempt.resolved.attempts) } }
        : {}),
      attempts,
    };
  } catch (error) {
    if (error instanceof ReplayCoreError) throw automationErrorFromReplay(error, "acting");
    throw error;
  }
}

export async function resolveTarget(
  page: Page,
  target: ElementTarget,
  recordedPageUrl?: string,
  signal?: AbortSignal,
  stepTimeoutMs = AUTOMATION_STEP_TIMEOUT_MS,
): Promise<ResolvedTarget> {
  try {
    const resolved = await resolveReplayTarget(page, target, recordedPageUrl, {
      signal,
      timeoutMs: stepTimeoutMs,
    });
    return { ...resolved, attempts: automationAttempts(resolved.attempts) };
  } catch (error) {
    if (error instanceof ReplayCoreError) throw automationErrorFromReplay(error, "acting");
    throw error;
  }
}
