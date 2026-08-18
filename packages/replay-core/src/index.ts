export {
  ReplayCoreError,
  throwIfCancelled,
} from "./errors.js";
export type {
  ReplayAttempt,
  ReplayFailureCode,
  ReplayFailureDetail,
  ReplayPhase,
} from "./errors.js";
export { preflightReplay } from "./preflight.js";
export type { ReplayPreflight } from "./preflight.js";
export {
  DEFAULT_POLL_MS,
  DEFAULT_SETTLE_QUIET_MS,
  DEFAULT_SETTLE_TIMEOUT_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  DEFAULT_WAIT_STABLE_MS,
} from "./timing.js";
export type { ReplayOperationOptions } from "./timing.js";
export {
  attemptTargetResolution,
  locatorFor,
  resolveFrame,
  resolveTarget,
  resolveTargetOnce,
} from "./target-resolution.js";
export type {
  ResolvedTarget,
  TargetResolutionAttempt,
} from "./target-resolution.js";
export {
  applyPositionBefore,
  executeStepAction,
  openInitialPage,
} from "./step-actions.js";
export type { ReplayActionResult } from "./step-actions.js";
export {
  createReplayActivityTracker,
} from "./activity.js";
export type { ReplayActivityTracker } from "./activity.js";
export {
  waitForAutomaticSettle,
  waitForCondition,
  waitForDelay,
} from "./waits.js";
export { isRedundantOptionClickBeforeSelect } from "./redundant-option-click.js";
