import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame, Locator, Page } from "playwright-core";
import type { WorkflowStep } from "@relay/workflow-contract";
import {
  ReplayCoreError,
  createReplayActivityTracker,
  executeStepAction,
  waitForAutomaticSettle,
  waitForDelay,
} from "../src/index.js";

const recordedAt = "2026-07-31T12:00:00Z";
const target = { candidates: [{ kind: "testId" as const, value: "target", exact: true }] };

function baseStep(order: number) {
  return {
    id: `step-${order}`,
    order,
    name: `Step ${order}`,
    enabled: true,
    page: { id: "page", url: "https://example.com/form" },
    target,
    metadata: { recordedAt, origin: "recorded" as const, sensitive: false },
  };
}

function replayPage() {
  const locator = {
    check: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    count: vi.fn(async () => 1),
    evaluate: vi.fn(async () => true),
    fill: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    innerText: vi.fn(async () => "Ready for review"),
    isVisible: vi.fn(async () => true),
    press: vi.fn(async () => undefined),
    pressSequentially: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => ["value"]),
    uncheck: vi.fn(async () => undefined),
  } as unknown as Locator;
  const frame = {
    evaluate: vi.fn(async () => undefined),
    getByLabel: vi.fn(() => locator),
    getByRole: vi.fn(() => locator),
    getByTestId: vi.fn(() => locator),
    getByText: vi.fn(() => locator),
    locator: vi.fn(() => locator),
    url: vi.fn(() => "https://example.com/form"),
  } as unknown as Frame;
  const page = {
    frames: vi.fn(() => [frame]),
    goto: vi.fn(async () => null),
    mainFrame: vi.fn(() => frame),
  } as unknown as Page;
  return { frame, locator, page };
}

afterEach(() => vi.useRealTimers());

describe("phase-level replay operations", () => {
  it("executes every canonical action independently from settling and waits", async () => {
    const steps: WorkflowStep[] = [
      { ...baseStep(0), type: "navigate", payload: { url: "https://example.com/form" } },
      { ...baseStep(1), type: "click" },
      { ...baseStep(2), type: "fill", payload: { value: "resolved" }, parameterBinding: { source: "runtime" } },
      { ...baseStep(3), type: "set_date", payload: { value: "2026-07-31" } },
      { ...baseStep(4), type: "select", payload: { value: "one", label: "One" } },
      { ...baseStep(5), type: "check" },
      { ...baseStep(6), type: "uncheck" },
      { ...baseStep(7), type: "keypress", payload: { key: "Enter", modifiers: ["Control"] } },
      { ...baseStep(8), type: "submit" },
    ];
    const { locator, page } = replayPage();

    for (const step of steps) await executeStepAction(page, step);

    expect(page.goto).toHaveBeenCalledOnce();
    expect(locator.click).toHaveBeenCalledOnce();
    expect(locator.fill).toHaveBeenCalledTimes(2);
    expect(locator.selectOption).toHaveBeenCalledOnce();
    expect(locator.check).toHaveBeenCalledOnce();
    expect(locator.uncheck).toHaveBeenCalledOnce();
    expect(locator.press).toHaveBeenCalledWith("Control+Enter", expect.anything());
    expect(locator.evaluate).toHaveBeenCalledOnce();
  });

  it("keeps assertion observations in structured detail instead of the error message", async () => {
    const { locator, page } = replayPage();
    vi.mocked(locator.innerText).mockResolvedValue("private observed value");

    const error = await executeStepAction(page, {
      ...baseStep(0),
      type: "assertion",
      expectation: { kind: "text_contains", expected: "private expected value" },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ReplayCoreError);
    expect(error).toMatchObject({
      code: "assertion_failed",
      phase: "asserting",
      message: "assertion_failed",
      detail: {
        kind: "text_mismatch",
        expected: "private expected value",
        observed: "private observed value",
      },
    });
  });

  it("evaluates visible and repeated-group assertions", async () => {
    const { frame, page } = replayPage();
    const visible: WorkflowStep = {
      ...baseStep(0),
      type: "assertion",
      expectation: { kind: "visible" },
    };
    const { target: _target, ...withoutTarget } = baseStep(1);
    const group: WorkflowStep = {
      ...withoutTarget,
      type: "assertion",
      groupTarget: {
        version: 1,
        algorithm: "structural-token-v1",
        root: { tagName: "article", role: "article", sharedClasses: ["card"] },
        structureTokens: ["0:article:article", "1:h2:"],
        capturedMatchCount: 2,
      },
      expectation: { kind: "group_exists" },
    };
    vi.mocked(frame.evaluate).mockResolvedValueOnce({
      excessivelyBroad: false,
      candidateCount: 1,
      candidates: [{
        visible: true,
        root: { tagName: "article", role: "article", sharedClasses: ["card"] },
        structureTokens: ["0:article:article", "1:h2:"],
      }],
    } as never);

    await expect(executeStepAction(page, visible)).resolves.toMatchObject({ locatorKind: "testId" });
    await expect(executeStepAction(page, group)).resolves.toMatchObject({ locatorKind: "structural-group" });
  });

  it("cancels an explicit delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const running = waitForDelay(30_000, { signal: controller.signal });
    const cancelled = expect(running).rejects.toMatchObject({
      code: "cancelled",
      phase: "waiting",
    });

    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);

    await cancelled;
  });

  it("allows settling to be retried without repeating a successful action", async () => {
    const { locator, page } = replayPage();
    const tracker = createReplayActivityTracker(page);
    const step: WorkflowStep = { ...baseStep(0), type: "click" };

    await executeStepAction(page, step);
    await waitForAutomaticSettle(page, tracker, { timeoutMs: 0 });
    await waitForAutomaticSettle(page, tracker, { timeoutMs: 0 });
    tracker.dispose();

    expect(locator.click).toHaveBeenCalledOnce();
  });
});
