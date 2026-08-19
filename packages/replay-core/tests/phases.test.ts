import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame, Locator, Page } from "playwright-core";
import type { WorkflowStep } from "@relay/workflow-contract";
import {
  ReplayCoreError,
  createReplayActivityTracker,
  executeStepAction,
  openInitialPage,
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
    childFrames: vi.fn(() => []),
    evaluate: vi.fn(async () => undefined),
    getByLabel: vi.fn(() => locator),
    getByRole: vi.fn(() => locator),
    getByTestId: vi.fn(() => locator),
    getByText: vi.fn(() => locator),
    locator: vi.fn(() => locator),
    isDetached: vi.fn(() => false),
    url: vi.fn(() => "https://example.com/form"),
  } as unknown as Frame;
  const page = {
    frames: vi.fn(() => [frame]),
    goto: vi.fn(async () => null),
    mainFrame: vi.fn(() => frame),
  } as unknown as Page;
  return { frame, locator, page };
}

function pageTextStep(expected = "John Snow"): WorkflowStep {
  const { target: _target, ...base } = baseStep(0);
  return {
    ...base,
    type: "assertion",
    expectation: { kind: "page_text_contains", expected },
  };
}

function textFrame(text: string, options: { visible?: boolean; fails?: boolean; detached?: boolean; children?: Frame[] } = {}) {
  const frameElement = {
    isVisible: vi.fn(async () => options.visible ?? true),
  };
  return {
    childFrames: vi.fn(() => options.children ?? []),
    evaluate: options.fails
      ? vi.fn(async () => { throw new Error("frame cannot be inspected"); })
      : vi.fn(async (_callback, expected: string) =>
        text.replace(/\s+/gu, " ").trim().toLowerCase().includes(expected)),
    frameElement: vi.fn(async () => frameElement),
    isDetached: vi.fn(() => options.detached ?? false),
  } as unknown as Frame;
}

function pageWithFrameTree(main: Frame): Page {
  return {
    mainFrame: vi.fn(() => main),
  } as unknown as Page;
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

  it("finds normalized page text in the main frame or an attached nested frame", async () => {
    const nested = textFrame("  Welcome,\n JOHN    SNOW  ");
    const main = textFrame("Dashboard", { children: [nested] });
    const page = pageWithFrameTree(main);

    await expect(executeStepAction(page, pageTextStep("john snow"))).resolves.toEqual({
      locatorKind: "page-text",
      attempts: [],
    });
  });

  it("skips hidden frame trees and treats detached or failed frames as not found", async () => {
    const hiddenDescendant = textFrame("John Snow");
    const hidden = textFrame("John Snow", { visible: false, children: [hiddenDescendant] });
    const detached = textFrame("John Snow", { detached: true });
    const failed = textFrame("John Snow", { fails: true });
    const main = textFrame("Dashboard", { children: [hidden, detached, failed] });

    const error = await executeStepAction(pageWithFrameTree(main), pageTextStep()).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "assertion_failed",
      phase: "asserting",
      detail: { kind: "page_text_missing" },
    });
    expect(error).not.toHaveProperty("detail.observed");
    expect(vi.mocked(hidden.evaluate)).not.toHaveBeenCalled();
    expect(vi.mocked(hiddenDescendant.evaluate)).not.toHaveBeenCalled();
    expect(vi.mocked(detached.evaluate)).not.toHaveBeenCalled();
  });

  it("does not combine partial matches across frames", async () => {
    const main = textFrame("John", { children: [textFrame("Snow")] });

    await expect(executeStepAction(pageWithFrameTree(main), pageTextStep())).rejects.toMatchObject({
      detail: { kind: "page_text_missing" },
    });
  });

  it("evaluates a fresh frame snapshot when a page-text assertion is retried", async () => {
    const originalChild = textFrame("No matching person");
    const lateChild = textFrame("John Snow joined");
    const main = textFrame("", { children: [originalChild] });
    vi.mocked(main.evaluate).mockImplementation(async () => {
      vi.mocked(main.childFrames).mockReturnValue([lateChild]);
      return false;
    });
    const page = pageWithFrameTree(main);

    await expect(executeStepAction(page, pageTextStep())).rejects.toMatchObject({
      detail: { kind: "page_text_missing" },
    });
    expect(lateChild.evaluate).not.toHaveBeenCalled();

    await expect(executeStepAction(page, pageTextStep())).resolves.toMatchObject({ locatorKind: "page-text" });
    expect(main.evaluate).toHaveBeenCalledTimes(2);
    expect(lateChild.evaluate).toHaveBeenCalledOnce();
  });

  it("cancels a blocked page-text frame evaluation promptly", async () => {
    const main = textFrame("");
    const blocked = new Promise<never>(() => undefined);
    vi.mocked(main.evaluate).mockReturnValue(blocked);
    const controller = new AbortController();
    const running = executeStepAction(
      pageWithFrameTree(main),
      pageTextStep(),
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(main.evaluate).toHaveBeenCalledOnce());
    controller.abort();

    await expect(running).rejects.toMatchObject({ code: "cancelled", phase: "asserting" });
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

  it.each(["bootstrap", "action", "assertion"] as const)(
    "cancels a blocked %s provider call promptly",
    async (operation) => {
      const { locator, page } = replayPage();
      const blocked = new Promise<never>(() => undefined);
      const controller = new AbortController();
      let providerCall: ReturnType<typeof vi.fn>;
      let running: Promise<unknown>;

      if (operation === "bootstrap") {
        providerCall = vi.mocked(page.goto).mockReturnValue(blocked);
        running = openInitialPage(page, "https://example.com/form", { signal: controller.signal });
      } else if (operation === "assertion") {
        providerCall = vi.mocked(locator.innerText).mockReturnValue(blocked);
        running = executeStepAction(page, {
          ...baseStep(0),
          type: "assertion",
          expectation: { kind: "text_contains", expected: "ready" },
        }, { signal: controller.signal });
      } else {
        providerCall = vi.mocked(locator.click).mockReturnValue(blocked);
        running = executeStepAction(page, { ...baseStep(0), type: "click" }, {
          signal: controller.signal,
        });
      }

      await vi.waitFor(() => expect(providerCall).toHaveBeenCalledOnce());
      controller.abort();
      const result = await Promise.race([
        running.catch((error: unknown) => error),
        new Promise((resolve) => setTimeout(() => resolve("timed out"), 100)),
      ]);

      expect(result).toMatchObject({ code: "cancelled" });
    },
  );

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
