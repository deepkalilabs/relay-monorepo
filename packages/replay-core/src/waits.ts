import type { Locator, Page } from "playwright-core";
import {
  locatorCandidatesForTarget,
  orderLocatorCandidates,
  type ElementTarget,
} from "@relay/workflow-contract";
import { ReplayCoreError, throwIfCancelled, type ReplayAttempt } from "./errors.js";
import type { ReplayActivityTracker } from "./activity.js";
import { locatorFor, resolveFrame } from "./target-resolution.js";
import {
  cancellableDelay,
  DEFAULT_POLL_MS,
  DEFAULT_SETTLE_QUIET_MS,
  DEFAULT_SETTLE_TIMEOUT_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  DEFAULT_WAIT_STABLE_MS,
  raceWithCancellation,
  type ReplayOperationOptions,
} from "./timing.js";

async function resetDomActivity(page: Page): Promise<boolean> {
  if (typeof (page as unknown as { evaluate?: unknown }).evaluate !== "function") return false;
  try {
    await page.evaluate(() => {
      type MutationState = { lastMutation: number; observer: MutationObserver };
      const host = window as Window & { __relayReplayMutationState?: MutationState };
      const existing = host.__relayReplayMutationState;
      if (existing) {
        existing.lastMutation = performance.now();
        return;
      }
      const state: MutationState = {
        lastMutation: performance.now(),
        observer: new MutationObserver(() => {
          state.lastMutation = performance.now();
        }),
      };
      state.observer.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      host.__relayReplayMutationState = state;
    });
    return true;
  } catch {
    return false;
  }
}

async function domIsQuiet(page: Page, quietMs: number): Promise<boolean | null> {
  try {
    const result = await page.evaluate((duration) => {
      const host = window as Window & { __relayReplayMutationState?: { lastMutation: number } };
      const state = host.__relayReplayMutationState;
      return Boolean(state && performance.now() - state.lastMutation >= duration);
    }, quietMs);
    return typeof result === "boolean" ? result : null;
  } catch {
    return null;
  }
}

export function waitForAutomaticSettle(
  page: Page,
  tracker: ReplayActivityTracker,
  options: ReplayOperationOptions & { quietMs?: number } = {},
): Promise<void> {
  throwIfCancelled(options.signal, "settling");
  return raceWithCancellation(
    waitForAutomaticSettleUncancelled(page, tracker, options),
    options.signal,
    "settling",
  );
}

async function waitForAutomaticSettleUncancelled(
  page: Page,
  tracker: ReplayActivityTracker,
  options: ReplayOperationOptions & { quietMs?: number },
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
  const quietMs = options.quietMs ?? DEFAULT_SETTLE_QUIET_MS;
  const evaluateAvailable = typeof (page as unknown as { evaluate?: unknown }).evaluate === "function";
  if ((!evaluateAvailable && !tracker.networkTracked) || timeoutMs <= 0) {
    throwIfCancelled(options.signal, "settling");
    return;
  }
  const deadline = Date.now() + timeoutMs;
  if (typeof (page as unknown as { waitForLoadState?: unknown }).waitForLoadState === "function") {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
    } catch {
      // Quietness checks remain authoritative when load-state waiting times out.
    }
  }
  throwIfCancelled(options.signal, "settling");
  let domTracked = await resetDomActivity(page);
  tracker.markActivity();
  while (Date.now() < deadline) {
    throwIfCancelled(options.signal, "settling");
    const domState = domTracked ? await domIsQuiet(page, quietMs) : null;
    if (domState === null) domTracked = false;
    const domQuiet = !domTracked || domState === true;
    const networkQuiet = tracker.networkIsQuiet(quietMs);
    if (domQuiet && networkQuiet) return;
    await cancellableDelay(
      Math.min(DEFAULT_POLL_MS, Math.max(0, deadline - Date.now())),
      options.signal,
      "settling",
    );
  }
}

export async function waitForDelay(
  durationMs: number,
  options: Pick<ReplayOperationOptions, "signal"> = {},
): Promise<void> {
  await cancellableDelay(durationMs, options.signal, "waiting");
}

async function locatorHasVisibleMatch(locator: Locator, count: number): Promise<boolean> {
  for (let index = 0; index < count; index += 1) {
    const candidate = count === 1 ? locator : locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return true;
  }
  return false;
}

export function waitForCondition(
  page: Page,
  target: ElementTarget,
  state: "visible" | "hidden",
  recordedPageUrl: string,
  options: ReplayOperationOptions & { stableMs?: number } = {},
): Promise<void> {
  throwIfCancelled(options.signal, "waiting");
  return raceWithCancellation(
    waitForConditionUncancelled(page, target, state, recordedPageUrl, options),
    options.signal,
    "waiting",
  );
}

async function waitForConditionUncancelled(
  page: Page,
  target: ElementTarget,
  state: "visible" | "hidden",
  recordedPageUrl: string,
  options: ReplayOperationOptions & { stableMs?: number },
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const stableMs = options.stableMs ?? DEFAULT_WAIT_STABLE_MS;
  const deadline = Date.now() + timeoutMs;
  let stableSince: number | null = null;
  let attempts: ReplayAttempt[] = [];
  while (Date.now() < deadline) {
    throwIfCancelled(options.signal, "waiting");
    const nextAttempts: ReplayAttempt[] = [];
    let anyVisible = false;
    let frameAvailable = true;
    let candidateEvaluated = false;
    try {
      const frame = resolveFrame(page, target.frameUrl, recordedPageUrl, "waiting");
      for (const candidate of orderLocatorCandidates(locatorCandidatesForTarget(target))) {
        try {
          const locator = locatorFor(frame, candidate);
          const count = await locator.count();
          candidateEvaluated = true;
          const visible = count > 0 && await locatorHasVisibleMatch(locator, count);
          anyVisible ||= visible;
          nextAttempts.push({
            kind: candidate.kind,
            outcome: visible ? "visible" : count ? "hidden" : "no_match",
            ...(count ? { count } : {}),
          });
        } catch {
          nextAttempts.push({ kind: candidate.kind, outcome: "evaluation_failed" });
        }
      }
    } catch (error) {
      frameAvailable = false;
      nextAttempts.push(
        error instanceof ReplayCoreError && error.attempts[0]
          ? error.attempts[0]
          : { kind: "frame", outcome: "frame_missing" },
      );
    }
    attempts = nextAttempts;
    const satisfied = frameAvailable && candidateEvaluated && (state === "visible" ? anyVisible : !anyVisible);
    if (satisfied) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= stableMs) return;
    } else {
      stableSince = null;
    }
    await cancellableDelay(DEFAULT_POLL_MS, options.signal, "waiting");
  }
  throw new ReplayCoreError("wait_failed", "waiting", attempts);
}
