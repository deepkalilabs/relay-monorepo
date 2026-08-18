import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame, Locator, Page, Request } from "playwright-core";
import {
  createReplayActivityTracker,
  waitForAutomaticSettle,
  waitForCondition,
} from "../src/index.js";

afterEach(() => vi.useRealTimers());

function waitPage() {
  const locator = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
  } as unknown as Locator;
  const frame = {
    getByTestId: vi.fn(() => locator),
    url: vi.fn(() => "https://example.com/form"),
  } as unknown as Frame;
  const page = {
    frames: vi.fn(() => [frame]),
    mainFrame: vi.fn(() => frame),
  } as unknown as Page;
  return { locator, page };
}

describe("shared waits", () => {
  it("requires a condition to remain satisfied for the stable interval", async () => {
    vi.useFakeTimers();
    const { page } = waitPage();
    const running = waitForCondition(
      page,
      { candidates: [{ kind: "testId", value: "ready", exact: true }] },
      "visible",
      "https://example.com/form",
      { timeoutMs: 1_000, stableMs: 300 },
    );

    await vi.advanceTimersByTimeAsync(299);
    let completed = false;
    void running.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(51);
    await running;
  });

  it("uses the supplied condition timeout and does not expose target values", async () => {
    vi.useFakeTimers();
    const { locator, page } = waitPage();
    vi.mocked(locator.isVisible).mockResolvedValue(false);
    const running = waitForCondition(
      page,
      { candidates: [{ kind: "testId", value: "private-target", exact: true }] },
      "visible",
      "https://example.com/form",
      { timeoutMs: 500 },
    ).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(500);
    const error = await running;

    expect(error).toMatchObject({ code: "wait_failed", phase: "waiting" });
    expect(JSON.stringify(error)).not.toContain("private-target");
  });

  it("tracks network quietness and detaches listeners on disposal", async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, Set<(request: Request) => void>>();
    const request = { resourceType: () => "xhr" } as unknown as Request;
    const page = {
      evaluate: vi.fn(async (_callback: unknown, quietMs?: number) => quietMs === 200),
      off: vi.fn((event: string, listener: (request: Request) => void) => listeners.get(event)?.delete(listener)),
      on: vi.fn((event: string, listener: (request: Request) => void) => {
        const entries = listeners.get(event) ?? new Set();
        entries.add(listener);
        listeners.set(event, entries);
      }),
      waitForLoadState: vi.fn(async () => undefined),
    } as unknown as Page;
    const tracker = createReplayActivityTracker(page);
    listeners.get("request")?.forEach((listener) => listener(request));
    setTimeout(() => listeners.get("requestfinished")?.forEach((listener) => listener(request)), 100);

    const running = waitForAutomaticSettle(page, tracker);
    await vi.advanceTimersByTimeAsync(299);
    let completed = false;
    void running.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await running;
    tracker.dispose();
    expect(page.off).toHaveBeenCalledTimes(3);
  });

  it("cancels condition polling and automatic settling", async () => {
    vi.useFakeTimers();
    const { locator, page } = waitPage();
    vi.mocked(locator.isVisible).mockResolvedValue(false);
    Object.assign(page, {
      evaluate: vi.fn(async (_callback: unknown, quietMs?: number) =>
        quietMs === undefined ? undefined : false,
      ),
      waitForLoadState: vi.fn(async () => undefined),
    });
    const conditionController = new AbortController();
    const condition = waitForCondition(
      page,
      { candidates: [{ kind: "testId", value: "ready", exact: true }] },
      "visible",
      "https://example.com/form",
      { signal: conditionController.signal },
    );
    const conditionCancelled = expect(condition).rejects.toMatchObject({
      code: "cancelled",
      phase: "waiting",
    });
    await vi.advanceTimersByTimeAsync(100);
    conditionController.abort();
    await vi.advanceTimersByTimeAsync(50);
    await conditionCancelled;

    const settleController = new AbortController();
    const tracker = createReplayActivityTracker(page);
    const settling = waitForAutomaticSettle(page, tracker, { signal: settleController.signal });
    const settleCancelled = expect(settling).rejects.toMatchObject({
      code: "cancelled",
      phase: "settling",
    });
    await vi.advanceTimersByTimeAsync(100);
    settleController.abort();
    await vi.advanceTimersByTimeAsync(50);
    await settleCancelled;
    tracker.dispose();
  });
});
