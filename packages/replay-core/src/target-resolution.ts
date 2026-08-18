import type { Frame, Locator, Page } from "playwright-core";
import {
  locatorCandidatesForTarget,
  orderLocatorCandidates,
  type ElementTarget,
  type LocatorCandidate,
} from "@relay/workflow-contract";
import {
  ReplayCoreError,
  throwIfCancelled,
  type ReplayAttempt,
  type ReplayPhase,
} from "./errors.js";
import {
  cancellableDelay,
  DEFAULT_STEP_TIMEOUT_MS,
  type ReplayOperationOptions,
} from "./timing.js";

export interface ResolvedTarget {
  locator: Locator;
  kind: string;
  attempts: ReplayAttempt[];
}

export interface TargetResolutionAttempt {
  resolved?: ResolvedTarget;
  attempts: ReplayAttempt[];
}

export function locatorFor(frame: Frame, candidate: LocatorCandidate): Locator {
  switch (candidate.kind) {
    case "testId":
      return frame.getByTestId(candidate.value);
    case "role":
      return frame.getByRole(candidate.value as Parameters<Frame["getByRole"]>[0], {
        name: candidate.name,
        exact: candidate.exact,
      });
    case "accessibleName":
    case "label":
      return frame.getByLabel(candidate.value, { exact: candidate.exact });
    case "text":
      return frame.getByText(candidate.value, { exact: candidate.exact });
    case "css":
      return frame.locator(candidate.value);
    case "xpath":
      return frame.locator(`xpath=${candidate.value}`);
  }
}

function normalizedFrameUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

export function resolveFrame(
  page: Page,
  frameUrl?: string,
  recordedPageUrl?: string,
  phase: ReplayPhase = "acting",
): Frame {
  const mainFrame = page.mainFrame();
  if (!frameUrl) return mainFrame;

  const recordedFrame = normalizedFrameUrl(frameUrl);
  const recordedPage = recordedPageUrl ? normalizedFrameUrl(recordedPageUrl) : null;
  const currentMain = normalizedFrameUrl(mainFrame.url());
  if (
    (recordedFrame && recordedPage && recordedFrame === recordedPage) ||
    mainFrame.url() === frameUrl ||
    (recordedFrame && currentMain === recordedFrame)
  ) {
    return mainFrame;
  }

  const childFrames = page.frames().filter((candidate) => candidate !== mainFrame);
  const exact = childFrames.filter((candidate) => candidate.url() === frameUrl);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new ReplayCoreError("frame_ambiguous", phase, [
      { kind: "frame", outcome: "frame_ambiguous", count: exact.length },
    ]);
  }
  if (recordedFrame) {
    const normalized = childFrames.filter(
      (candidate) => normalizedFrameUrl(candidate.url()) === recordedFrame,
    );
    if (normalized.length === 1) return normalized[0]!;
    if (normalized.length > 1) {
      throw new ReplayCoreError("frame_ambiguous_normalized", phase, [
        { kind: "frame", outcome: "frame_ambiguous_normalized", count: normalized.length },
      ]);
    }
  }

  throw new ReplayCoreError("frame_unavailable", phase, [
    { kind: "frame", outcome: "frame_missing" },
  ]);
}

type ElementFingerprint = { tagName: string; inputType?: string };

async function fingerprintAttempt(
  locator: Locator,
  target: ElementTarget,
): Promise<ReplayAttempt | null> {
  const expectedTagName = target.tagName?.toLowerCase();
  const expectedInputType = target.inputType?.toLowerCase();
  if (!expectedTagName && !expectedInputType) return null;
  const observed = await locator.evaluate((element): ElementFingerprint => {
    const tagName = element.tagName.toLowerCase();
    return {
      tagName,
      ...(tagName === "input"
        ? { inputType: (element as HTMLInputElement).type.toLowerCase() }
        : {}),
    };
  });
  if (
    (expectedTagName && observed.tagName !== expectedTagName) ||
    (expectedInputType && observed.inputType !== expectedInputType)
  ) {
    return {
      kind: "fingerprint",
      outcome: "fingerprint_mismatch",
      ...(expectedTagName ? { expectedTagName } : {}),
      observedTagName: observed.tagName,
      ...(expectedInputType ? { expectedInputType } : {}),
      ...(observed.inputType ? { observedInputType: observed.inputType } : {}),
    };
  }
  return null;
}

export async function attemptTargetResolution(
  page: Page,
  target: ElementTarget,
  recordedPageUrl?: string,
  options: ReplayOperationOptions & { phase?: ReplayPhase } = {},
): Promise<TargetResolutionAttempt> {
  const phase = options.phase ?? "acting";
  const frame = resolveFrame(page, target.frameUrl, recordedPageUrl, phase);
  const attempts: ReplayAttempt[] = [];
  throwIfCancelled(options.signal, phase);
  for (const candidate of orderLocatorCandidates(locatorCandidatesForTarget(target))) {
    try {
      const locator = locatorFor(frame, candidate);
      const count = await locator.count();
      throwIfCancelled(options.signal, phase);
      if (count !== 1) {
        attempts.push({
          kind: candidate.kind,
          outcome: count ? "multiple_matches" : "no_match",
          ...(count ? { count } : {}),
        });
        continue;
      }
      const visible = await locator.isVisible();
      throwIfCancelled(options.signal, phase);
      if (!visible) {
        attempts.push({ kind: candidate.kind, outcome: "hidden", count: 1 });
        continue;
      }
      const mismatch = await fingerprintAttempt(locator, target);
      throwIfCancelled(options.signal, phase);
      if (mismatch) {
        attempts.push({ ...mismatch, kind: candidate.kind });
        continue;
      }
      return { resolved: { locator, kind: candidate.kind, attempts: [...attempts] }, attempts };
    } catch (error) {
      if (error instanceof ReplayCoreError && error.code === "cancelled") throw error;
      attempts.push({ kind: candidate.kind, outcome: "evaluation_failed" });
    }
  }
  return { attempts };
}

export async function resolveTargetOnce(
  page: Page,
  target: ElementTarget,
  recordedPageUrl?: string,
  options: ReplayOperationOptions & { phase?: ReplayPhase } = {},
): Promise<ResolvedTarget> {
  const phase = options.phase ?? "asserting";
  const attempt = await attemptTargetResolution(page, target, recordedPageUrl, {
    ...options,
    phase,
  });
  if (attempt.resolved) return attempt.resolved;
  throw new ReplayCoreError("target_unresolved", phase, attempt.attempts);
}

export async function resolveTarget(
  page: Page,
  target: ElementTarget,
  recordedPageUrl?: string,
  options: ReplayOperationOptions & { phase?: ReplayPhase } = {},
): Promise<ResolvedTarget> {
  const phase = options.phase ?? "acting";
  const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let attempts: ReplayAttempt[] = [];
  do {
    const attempt = await attemptTargetResolution(page, target, recordedPageUrl, {
      ...options,
      phase,
    });
    attempts = attempt.attempts;
    if (attempt.resolved) return attempt.resolved;
    await cancellableDelay(Math.min(250, Math.max(0, deadline - Date.now())), options.signal, phase);
  } while (Date.now() < deadline);
  throw new ReplayCoreError("target_unresolved", phase, attempts);
}
