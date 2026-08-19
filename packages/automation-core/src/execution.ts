import type { Page } from "playwright-core";
import type { WorkflowStep } from "./workflow.js";
import {
  DEFAULT_SETTLE_QUIET_MS,
  DEFAULT_SETTLE_TIMEOUT_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  DEFAULT_WAIT_STABLE_MS,
  ReplayCoreError,
  createReplayActivityTracker,
  openInitialPage,
  waitForAutomaticSettle,
  waitForCondition,
  waitForDelay,
  type ReplayActivityTracker,
} from "@relay/replay-core";
import {
  AutomationCancelledError,
  AutomationExecutionError,
  automationErrorFromReplay,
  throwIfCancelled,
  type AutomationAttempt,
  type AutomationPhase,
} from "./execution-errors.js";
import { executeStepAction, type ActionResult } from "./step-actions.js";

export { AutomationCancelledError, AutomationExecutionError } from "./execution-errors.js";
export type { AutomationAttempt, AutomationPhase } from "./execution-errors.js";
export { AUTOMATION_STEP_TIMEOUT_MS, resolveTarget } from "./target-resolution.js";
export type { ResolvedTarget } from "./target-resolution.js";
export { applyPositionBefore, executeStepAction } from "./step-actions.js";
export type { ActionResult } from "./step-actions.js";

export const UI_SETTLE_QUIET_MS = DEFAULT_SETTLE_QUIET_MS;
export const UI_SETTLE_MAX_MS = DEFAULT_SETTLE_TIMEOUT_MS;
export const WAIT_CONDITION_STABLE_MS = DEFAULT_WAIT_STABLE_MS;

export class AutomationExecutor {
  private tracker: ReplayActivityTracker | undefined;

  constructor(
    private readonly page: Page,
    private readonly signal?: AbortSignal,
    private readonly stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  ) {}

  private activityTracker(): ReplayActivityTracker {
    this.tracker ??= createReplayActivityTracker(this.page);
    return this.tracker;
  }

  dispose(): void {
    this.tracker?.dispose();
    this.tracker = undefined;
  }

  async openInitialPage(url: string): Promise<void> {
    const tracker = this.activityTracker();
    tracker.markActivity();
    try {
      await openInitialPage(this.page, url, {
        signal: this.signal,
        timeoutMs: this.stepTimeoutMs,
      });
      await waitForAutomaticSettle(this.page, tracker, {
        signal: this.signal,
        timeoutMs: UI_SETTLE_MAX_MS,
        quietMs: UI_SETTLE_QUIET_MS,
      });
    } catch (error) {
      if (error instanceof ReplayCoreError) throw automationErrorFromReplay(error, "acting");
      throw new AutomationExecutionError("The initial automation page could not be opened.");
    }
  }

  async runStep(
    step: WorkflowStep,
    onPhase?: (phase: AutomationPhase) => void,
  ): Promise<ActionResult> {
    const tracker = this.activityTracker();
    let phase: AutomationPhase = step.type === "assertion" ? "asserting" : "acting";
    const enterPhase = (next: AutomationPhase) => {
      phase = next;
      onPhase?.(next);
    };
    try {
      enterPhase(phase);
      tracker.markActivity();
      const result = await executeStepAction(this.page, step, this.signal, this.stepTimeoutMs);
      if (step.type === "assertion") {
        throwIfCancelled(this.signal);
        return result;
      }
      enterPhase("settling");
      await waitForAutomaticSettle(this.page, tracker, {
        signal: this.signal,
        timeoutMs: UI_SETTLE_MAX_MS,
        quietMs: UI_SETTLE_QUIET_MS,
      });
      if (step.waitAfter?.delayMs) {
        enterPhase("waiting");
        await waitForDelay(step.waitAfter.delayMs, { signal: this.signal });
      }
      if (step.waitAfter?.condition) {
        enterPhase("waiting");
        await waitForCondition(
          this.page,
          step.waitAfter.condition.target,
          step.waitAfter.condition.state,
          step.page.url,
          {
            signal: this.signal,
            timeoutMs: this.stepTimeoutMs,
            stableMs: WAIT_CONDITION_STABLE_MS,
          },
        );
      }
      throwIfCancelled(this.signal);
      return result;
    } catch (error) {
      if (error instanceof AutomationCancelledError) throw error;
      if (error instanceof ReplayCoreError) throw automationErrorFromReplay(error, phase);
      if (error instanceof AutomationExecutionError) {
        throw new AutomationExecutionError(error.message, error.attempts, phase);
      }
      const message = phase === "asserting"
        ? "The automation assertion did not pass."
        : phase === "acting"
          ? "The automation action could not be completed."
          : phase === "settling"
            ? "The page did not settle after the automation action."
            : "The post-action wait could not be completed.";
      throw new AutomationExecutionError(message, [], phase);
    }
  }
}
