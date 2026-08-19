import type { Locator, Page } from "playwright-core";
import type { ReplayDiagnostic, ReplayPhase, ReplayStatus, ServerMessage } from "@/shared/contracts/protocol";
import {
  type ElementTarget,
  type GroupExistsAssertionStep,
  type Workflow,
  type WorkflowStep,
  isGroupExistsAssertion,
  isPageTextContainsAssertion,
} from "@/shared/contracts/workflow/domain";
import {
  DEFAULT_SETTLE_QUIET_MS,
  DEFAULT_SETTLE_TIMEOUT_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  DEFAULT_WAIT_STABLE_MS,
  ReplayCoreError,
  applyPositionBefore as applyReplayPosition,
  createReplayActivityTracker,
  executeStepAction,
  isRedundantOptionClickBeforeSelect,
  openInitialPage,
  preflightReplay as replayCorePreflight,
  resolveTarget as resolveReplayTarget,
  resolveTargetOnce as resolveReplayTargetOnce,
  waitForAutomaticSettle,
  waitForCondition,
  waitForDelay,
  type ReplayAttempt,
  type ReplayFailureDetail,
  type ResolvedTarget as CoreResolvedTarget,
} from "@relay/replay-core";

export const REPLAY_STEP_TIMEOUT_MS = DEFAULT_STEP_TIMEOUT_MS;
export const UI_SETTLE_QUIET_MS = DEFAULT_SETTLE_QUIET_MS;
export const UI_SETTLE_MAX_MS = DEFAULT_SETTLE_TIMEOUT_MS;
export const WAIT_CONDITION_STABLE_MS = DEFAULT_WAIT_STABLE_MS;

export interface ReplayPreflight {
  workflow: Workflow;
  startIndex: number;
  totalSteps: number;
  bootstrapUrl?: string;
}

export function preflightReplay(input: Workflow, startStepId?: string): ReplayPreflight {
  try {
    const preflight = replayCorePreflight(input, startStepId);
    return {
      ...preflight,
      // Executable replay keeps schemaVersion open, but this adapter accepts the
      // frontend's canonical Workflow and therefore retains its narrower type.
      workflow: preflight.workflow as Workflow,
    };
  } catch (error) {
    if (!(error instanceof ReplayCoreError)) throw error;
    throw new Error(frontendErrorMessage(error, { startStepId }));
  }
}

interface ResolvedTarget {
  locator: Locator;
  kind: string;
  attempts: ReplayDiagnostic["attemptedLocators"];
}

export async function resolveTarget(page: Page, target: ElementTarget, recordedPageUrl?: string): Promise<ResolvedTarget> {
  try {
    return resolvedTargetAdapter(await resolveReplayTarget(page, target, recordedPageUrl));
  } catch (error) {
    throw frontendError(error, { timedResolution: true });
  }
}

export async function resolveTargetOnce(page: Page, target: ElementTarget, recordedPageUrl?: string): Promise<ResolvedTarget> {
  try {
    return resolvedTargetAdapter(await resolveReplayTargetOnce(page, target, recordedPageUrl));
  } catch (error) {
    throw frontendError(error);
  }
}

export async function applyPositionBefore(page: Page, step: WorkflowStep): Promise<void> {
  try {
    await applyReplayPosition(page, step);
  } catch (error) {
    throw frontendError(error);
  }
}

interface StepExecutionResult {
  locatorKind?: string;
}

function resolvedTargetAdapter(resolved: CoreResolvedTarget): ResolvedTarget {
  return {
    locator: resolved.locator,
    kind: resolved.kind,
    attempts: attemptedLocators(resolved.attempts),
  };
}

interface FrontendErrorContext {
  groupAssertion?: GroupExistsAssertionStep;
  pageTextExpected?: string;
  startStepId?: string;
  timedResolution?: boolean;
  waitingPhase?: "condition" | "delay";
  waitState?: "visible" | "hidden";
}

function fingerprintReason(attempt: ReplayAttempt): string {
  if (attempt.expectedTagName && attempt.observedTagName !== attempt.expectedTagName) {
    return `Expected ${attempt.expectedTagName}, matched ${attempt.observedTagName ?? "an unknown element"}.`;
  }
  const observed = attempt.observedInputType
    ? `input type ${attempt.observedInputType}`
    : attempt.observedTagName ?? "an unknown element";
  return `Expected input type ${attempt.expectedInputType ?? "unknown"}, matched ${observed}.`;
}

function attemptReason(attempt: ReplayAttempt, detail?: ReplayFailureDetail): string {
  switch (attempt.outcome) {
    case "no_match":
      return "No match.";
    case "multiple_matches":
      return `Matched ${attempt.count ?? 0} elements.`;
    case "hidden":
      return attempt.count === 1 ? "The only match is not visible." : "Matches are hidden.";
    case "visible":
      return `Matched ${attempt.count ?? 0} visible element${attempt.count === 1 ? "" : "s"}.`;
    case "fingerprint_mismatch":
      return fingerprintReason(attempt);
    case "evaluation_failed":
      return "The locator could not be evaluated.";
    case "frame_missing":
      return "Recorded frame URL was not found.";
    case "frame_ambiguous":
      return "Recorded frame URL matched multiple frames.";
    case "frame_ambiguous_normalized":
      return "Recorded frame origin and path matched multiple frames.";
    case "candidate_limit_exceeded":
      return detail?.kind === "group_candidate_limit"
        ? `Found ${detail.candidateCount} root candidates; the structural-token-v1 limit is ${detail.maximumCandidates}.`
        : "The structural root candidate set is excessively broad.";
    case "group_not_matched":
      return detail?.kind === "group_mismatch"
        ? `Zero matches. Captured ${detail.capturedMatchCount}; algorithm structural-token-v1 (template v1); highest similarities: ${highestSimilarities(detail)}.`
        : "No visible structural group matched.";
  }
}

function attemptedLocators(
  attempts: ReplayAttempt[] = [],
  detail?: ReplayFailureDetail,
): ReplayDiagnostic["attemptedLocators"] {
  return attempts.map((attempt) => ({ kind: attempt.kind, reason: attemptReason(attempt, detail) }));
}

function highestSimilarities(detail: Extract<ReplayFailureDetail, { kind: "group_mismatch" }>): string {
  return detail.highestSimilarities.map((score) => `${Math.round(score * 100)}%`).join(", ") || "none";
}

function resolutionMessage(attempts: ReplayAttempt[], timed: boolean): string | undefined {
  if (attempts.some((attempt) => attempt.outcome === "frame_ambiguous")) {
    return "Multiple frames match the recorded frame URL.";
  }
  if (attempts.some((attempt) => attempt.outcome === "frame_ambiguous_normalized")) {
    return "Multiple frames match the recorded frame address.";
  }
  if (attempts.some((attempt) => attempt.outcome === "frame_missing")) {
    return "The recorded frame is not available on this page.";
  }
  if (attempts.length > 0) {
    return timed
      ? "No locator resolved to one visible element within 15 seconds."
      : "No locator resolved to one visible element.";
  }
}

function frontendErrorMessage(error: ReplayCoreError, context: FrontendErrorContext = {}): string {
  const resolved = resolutionMessage(error.attempts, context.timedResolution ?? error.phase === "acting");
  switch (error.code) {
    case "duplicate_step_id":
      return "Workflow step IDs must be unique before replay.";
    case "missing_start_step":
      return "The selected replay step is no longer in this workflow.";
    case "empty_range":
      return "The selected replay range has no enabled steps.";
    case "missing_bootstrap_url":
      return context.startStepId
        ? "Run from here needs a recorded HTTP page URL as its starting point."
        : "Replay needs a recorded HTTP page URL as its starting point.";
    case "frame_unavailable":
    case "frame_ambiguous":
    case "frame_ambiguous_normalized":
    case "target_unresolved":
      return resolved ?? "No locator resolved to one visible element.";
    case "position_failed":
      return "The recorded page position could not be restored.";
    case "bootstrap_failed":
      return "The recorded starting page could not be opened.";
    case "settle_failed":
      return "The page could not finish settling.";
    case "wait_failed":
      return context.waitingPhase === "delay"
        ? "The replay delay could not be completed."
        : `Wait condition did not remain ${context.waitState ?? "stable"} within 15 seconds.`;
    case "assertion_failed":
      if (error.detail?.kind === "page_text_missing") {
        return context.pageTextExpected
          ? `Page text did not contain "${context.pageTextExpected}".`
          : "The expected page text was not found.";
      }
      if (error.detail?.kind === "text_mismatch") {
        return `Expected text to contain "${error.detail.expected}", but observed "${error.detail.observed}".`;
      }
      if (error.detail?.kind === "group_candidate_limit") {
        return "Repeated-group assertion inspected zero matches because the root candidate set is excessively broad.";
      }
      if (error.detail?.kind === "group_mismatch") {
        return "Repeated-group assertion failed: no visible structural group matched.";
      }
      if (context.groupAssertion && error.attempts.some((attempt) => attempt.outcome === "frame_missing")) {
        return "Repeated-group assertion failed: zero matches because the recorded frame is unavailable.";
      }
      return resolved ?? "The replay assertion could not be completed.";
    case "action_failed":
      return resolved ?? "The replay action could not be completed.";
    case "cancelled":
      return "Replay stopped.";
  }
}

function frontendError(error: unknown, context: FrontendErrorContext = {}): Error {
  if (!(error instanceof ReplayCoreError)) return new Error("The replay action could not be completed.");
  return Object.assign(new Error(frontendErrorMessage(error, context)), {
    attempts: attemptedLocators(error.attempts, error.detail),
  });
}

function diagnosticFor(
  error: unknown,
  step: WorkflowStep,
  phase: ReplayPhase,
  waitingPhase?: "condition" | "delay",
): ReplayDiagnostic {
  if (error instanceof ReplayCoreError) {
    const groupAssertion = isGroupExistsAssertion(step) ? step : undefined;
    const pageTextExpected = isPageTextContainsAssertion(step)
      ? step.expectation.expected
      : undefined;
    const attempts = groupAssertion && error.attempts.some((attempt) => attempt.outcome === "frame_missing")
      ? [{
          kind: "structural-group",
          reason: `Zero matches. Captured ${groupAssertion.groupTarget.capturedMatchCount}; algorithm structural-token-v1 (template v1); highest similarities: none; frame: The recorded frame is not available on this page.`,
        }]
      : attemptedLocators(error.attempts, error.detail).map((attempt) => (
          error.detail?.kind === "group_candidate_limit"
            ? { ...attempt, reason: `${attempt.reason} Recorded count: ${groupAssertion?.groupTarget.capturedMatchCount ?? 0}.` }
            : attempt
        ));
    return {
      message: frontendErrorMessage(error, {
        groupAssertion,
        pageTextExpected,
        timedResolution: step.type !== "assertion",
        waitingPhase,
        waitState: step.waitAfter?.condition?.state,
      }),
      attemptedLocators: attempts,
    };
  }
  const message = phase === "asserting"
    ? "The replay assertion could not be completed."
    : phase === "settling"
      ? "The page could not finish settling."
      : phase === "waiting"
        ? waitingPhase === "delay"
          ? "The replay delay could not be completed."
          : `Wait condition did not remain ${step.waitAfter?.condition?.state ?? "stable"} within 15 seconds.`
        : "The replay action could not be completed.";
  return { message, attemptedLocators: [] };
}

async function executeStep(
  page: Page,
  step: WorkflowStep,
  signal?: AbortSignal,
): Promise<StepExecutionResult> {
  const result = await executeStepAction(page, step, { signal });
  return { locatorKind: result.locatorKind };
}

type RecoveryDecision = "resume" | "retry" | "skip" | "stop";

export class ReplayEngine {
  private pauseRequested = false;
  private stopped = false;
  private waiting: ((decision: RecoveryDecision) => void) | null = null;
  private failed = false;
  private currentStepId: string | undefined;
  private currentIndex = 0;
  private runController: AbortController | null = null;

  constructor(
    readonly runId: string,
    private readonly page: Page,
    private readonly preflight: ReplayPreflight,
    private readonly emit: (message: ServerMessage) => void,
  ) {}

  private status(status: ReplayStatus): void {
    this.emit({
      type: "replay.status",
      runId: this.runId,
      status,
      currentStepId: this.currentStepId,
      currentIndex: this.currentIndex,
      totalSteps: this.preflight.totalSteps,
    });
  }

  pause(): void {
    if (this.stopped || this.failed || this.waiting) return;
    this.pauseRequested = true;
    this.status("pausing");
  }

  resume(): void {
    this.pauseRequested = false;
    this.waiting?.("resume");
  }

  retry(): void {
    if (this.failed) this.waiting?.("retry");
  }

  skip(): void {
    if (this.failed) this.waiting?.("skip");
  }

  takeControl(): void {
    if (!this.failed) return;
    this.status("manual");
  }

  stop(): void {
    this.stopped = true;
    this.pauseRequested = false;
    this.runController?.abort();
    this.waiting?.("stop");
  }

  private waitForDecision(): Promise<RecoveryDecision> {
    return new Promise((resolve) => {
      this.waiting = (decision) => {
        this.waiting = null;
        resolve(decision);
      };
    });
  }

  async run(): Promise<void> {
    const controller = new AbortController();
    this.runController = controller;
    if (this.stopped) controller.abort();
    const tracker = createReplayActivityTracker(this.page);
    try {
      this.status("running");
      if (this.preflight.bootstrapUrl) {
        await openInitialPage(this.page, this.preflight.bootstrapUrl, { signal: controller.signal });
        await waitForAutomaticSettle(this.page, tracker, { signal: controller.signal });
      }

      const steps = this.preflight.workflow.steps.slice(this.preflight.startIndex);
      for (let index = 0; index < steps.length && !this.stopped; index += 1) {
        const step = steps[index];
        this.currentIndex = index;
        this.currentStepId = step.id;

        if (!step.enabled) {
          this.emit({ type: "replay.step", runId: this.runId, stepId: step.id, status: "skipped" });
          continue;
        }

        if (isRedundantOptionClickBeforeSelect(step, steps[index + 1])) {
          this.emit({ type: "replay.step", runId: this.runId, stepId: step.id, status: "skipped" });
          continue;
        }

        if (this.pauseRequested) {
          this.status("paused");
          const decision = await this.waitForDecision();
          if (decision === "stop" || this.stopped) break;
          this.status("running");
        }

        const startedAt = Date.now();
        let phase: ReplayPhase = step.type === "assertion" ? "asserting" : "acting";
        let executionResult: Awaited<ReturnType<typeof executeStep>> | null = null;
        let stepExecuted = false;
        let settleCompleted = step.type === "assertion";
        let delayCompleted = false;
        let conditionCompleted = !step.waitAfter?.condition;
        let waitingPhase: "condition" | "delay" | undefined;
        let stepFinished = false;
        while (!stepFinished && !this.stopped) {
          this.failed = false;
          this.emit({ type: "replay.step", runId: this.runId, stepId: step.id, status: "running", phase });
          this.status("running");
          try {
            if (!stepExecuted) {
              phase = step.type === "assertion" ? "asserting" : "acting";
              executionResult = await executeStep(this.page, step, controller.signal);
              stepExecuted = true;
            }
            if (!settleCompleted) {
              phase = "settling";
              this.emit({ type: "replay.step", runId: this.runId, stepId: step.id, status: "running", phase });
              await waitForAutomaticSettle(this.page, tracker, { signal: controller.signal });
              settleCompleted = true;
            }
            if (step.type !== "assertion") {
              if (step.waitAfter && !delayCompleted) {
                phase = "waiting";
                waitingPhase = "delay";
                this.emit({ type: "replay.step", runId: this.runId, stepId: step.id, status: "running", phase });
                await waitForDelay(step.waitAfter.delayMs ?? 0, { signal: controller.signal });
                delayCompleted = true;
              }
              if (step.waitAfter?.condition && !conditionCompleted) {
                phase = "waiting";
                waitingPhase = "condition";
                this.emit({ type: "replay.step", runId: this.runId, stepId: step.id, status: "running", phase });
                await waitForCondition(
                  this.page,
                  step.waitAfter.condition.target,
                  step.waitAfter.condition.state,
                  step.page.url,
                  { signal: controller.signal },
                );
                conditionCompleted = true;
              }
            }
            if (this.stopped) break;
            this.emit({
              type: "replay.step",
              runId: this.runId,
              stepId: step.id,
              status: "passed",
              durationMs: Date.now() - startedAt,
              locatorKind: executionResult?.locatorKind,
            });
            stepFinished = true;
          } catch (error) {
            if (this.stopped || (error instanceof ReplayCoreError && error.code === "cancelled")) {
              this.stopped = true;
              break;
            }
            this.failed = true;
            const diagnostic = diagnosticFor(error, step, phase, waitingPhase);
            this.emit({
              type: "replay.step",
              runId: this.runId,
              stepId: step.id,
              status: "failed",
              phase,
              durationMs: Date.now() - startedAt,
              diagnostic,
            });
            this.status("paused");
            const decision = await this.waitForDecision();
            if (decision === "retry" || decision === "resume") continue;
            if (decision === "skip") {
              this.emit({ type: "replay.step", runId: this.runId, stepId: step.id, status: "skipped" });
              stepFinished = true;
            }
            if (decision === "stop") this.stopped = true;
          }
        }
      }

      this.failed = false;
      if (!this.stopped) this.status("completed");
    } catch (error) {
      if (this.stopped || (error instanceof ReplayCoreError && error.code === "cancelled")) {
        this.stopped = true;
      } else {
        throw frontendError(error);
      }
    } finally {
      tracker.dispose();
      if (this.runController === controller) this.runController = null;
    }
  }
}
