import {
  ReplayCoreError,
  type ReplayAttempt,
} from "@relay/replay-core";

export type AutomationPhase = "acting" | "asserting" | "settling" | "waiting";

export interface AutomationAttempt {
  kind: string;
  reason: string;
}

export class AutomationCancelledError extends Error {
  constructor() {
    super("Automation was cancelled.");
    this.name = "AutomationCancelledError";
  }
}

export class AutomationExecutionError extends Error {
  constructor(
    message: string,
    readonly attempts: AutomationAttempt[] = [],
    readonly phase?: AutomationPhase,
  ) {
    super(message);
    this.name = "AutomationExecutionError";
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AutomationCancelledError();
}

function attemptReason(attempt: ReplayAttempt): string {
  switch (attempt.outcome) {
    case "no_match":
      return "No match.";
    case "multiple_matches":
      return `Matched ${attempt.count ?? 0} elements.`;
    case "hidden":
      return "The only match is not visible.";
    case "visible":
      return `Matched ${attempt.count ?? 1} visible element${attempt.count === 1 ? "" : "s"}.`;
    case "fingerprint_mismatch":
      return "The matched element does not match the recorded element fingerprint.";
    case "evaluation_failed":
      return "Locator could not be evaluated.";
    case "frame_missing":
      return "Recorded frame URL was not found.";
    case "frame_ambiguous":
      return "Recorded frame URL matched multiple frames.";
    case "frame_ambiguous_normalized":
      return "Recorded frame origin and path matched multiple frames.";
    case "candidate_limit_exceeded":
      return "The structural candidate limit was exceeded.";
    case "group_not_matched":
      return "No visible structural group matched.";
  }
}

export function automationAttempts(attempts: ReplayAttempt[]): AutomationAttempt[] {
  return attempts.map((attempt) => ({ kind: attempt.kind, reason: attemptReason(attempt) }));
}

function automationMessage(error: ReplayCoreError, phase: AutomationPhase): string {
  switch (error.code) {
    case "frame_unavailable":
      return "The recorded frame is not available on this page.";
    case "frame_ambiguous":
      return "Multiple frames match the recorded frame URL.";
    case "frame_ambiguous_normalized":
      return "Multiple frames match the recorded frame address.";
    case "bootstrap_failed":
      return "The initial automation page could not be opened.";
    default:
      if (phase === "asserting") return "The automation assertion did not pass.";
      if (phase === "acting") return "The automation action could not be completed.";
      if (phase === "settling") return "The page did not settle after the automation action.";
      return "The post-action wait could not be completed.";
  }
}

export function automationErrorFromReplay(
  error: ReplayCoreError,
  fallbackPhase: AutomationPhase,
): AutomationCancelledError | AutomationExecutionError {
  if (error.code === "cancelled") return new AutomationCancelledError();
  const phase: AutomationPhase = error.phase === "preflight" ? fallbackPhase : error.phase;
  return new AutomationExecutionError(
    automationMessage(error, phase),
    automationAttempts(error.attempts),
    phase,
  );
}
