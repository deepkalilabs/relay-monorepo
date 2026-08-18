import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import { ReplayCoreError } from "@relay/replay-core";
import type { ServerMessage } from "@/shared/contracts/protocol";
import type { WorkflowStep } from "@/shared/contracts/workflow/domain";
import { createWorkflow } from "@/shared/contracts/workflow/schema";
import { preflightReplay, ReplayEngine } from "@/server/replay/engine";

const core = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  condition: vi.fn(),
  delay: vi.fn(),
  dispose: vi.fn(),
  execute: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@relay/replay-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/replay-core")>();
  return {
    ...actual,
    createReplayActivityTracker: vi.fn(() => ({
      networkTracked: false,
      dispose: core.dispose,
      markActivity: vi.fn(),
      networkIsQuiet: vi.fn(() => true),
    })),
    executeStepAction: core.execute,
    openInitialPage: core.bootstrap,
    waitForAutomaticSettle: core.settle,
    waitForCondition: core.condition,
    waitForDelay: core.delay,
  };
});

const recordedAt = "2026-08-18T12:00:00Z";

function navigateStep(waitAfter?: WorkflowStep["waitAfter"]): WorkflowStep {
  return {
    id: "step-0",
    order: 0,
    name: "Navigate",
    enabled: true,
    page: { id: "page", url: "https://example.com" },
    type: "navigate",
    payload: { url: "https://example.com" },
    ...(waitAfter ? { waitAfter } : {}),
    metadata: { recordedAt, origin: "recorded", sensitive: false },
  };
}

function clickStep(): WorkflowStep {
  return {
    id: "step-0",
    order: 0,
    name: "Click",
    enabled: true,
    page: { id: "page", url: "https://example.com" },
    target: { candidates: [{ kind: "testId", value: "submit", exact: true }] },
    type: "click",
    metadata: { recordedAt, origin: "recorded", sensitive: false },
  };
}

function assertionStep(): WorkflowStep {
  return {
    id: "step-0",
    order: 0,
    name: "Assert visible",
    enabled: true,
    page: { id: "page", url: "https://example.com" },
    target: { candidates: [{ kind: "testId", value: "submit", exact: true }] },
    type: "assertion",
    expectation: { kind: "visible" },
    metadata: { recordedAt, origin: "recorded", sensitive: false },
  };
}

function engineFor(step: WorkflowStep, messages: ServerMessage[]): ReplayEngine {
  const workflow = createWorkflow("recorded-session");
  workflow.steps = [step];
  return new ReplayEngine(
    crypto.randomUUID(),
    {} as Page,
    preflightReplay(workflow),
    (message) => messages.push(message),
  );
}

async function waitForFailure(messages: ServerMessage[], phase: "settling" | "waiting"): Promise<void> {
  await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({
    type: "replay.step",
    status: "failed",
    phase,
  })));
}

beforeEach(() => {
  core.bootstrap.mockReset().mockResolvedValue(undefined);
  core.condition.mockReset().mockResolvedValue(undefined);
  core.delay.mockReset().mockResolvedValue(undefined);
  core.dispose.mockReset();
  core.execute.mockReset().mockResolvedValue({ locatorKind: "testId", attempts: [] });
  core.settle.mockReset().mockResolvedValue(undefined);
});

describe("replay phase checkpoints", () => {
  it("retries settling without repeating a successful action and retains its locator kind", async () => {
    core.settle
      .mockRejectedValueOnce(new ReplayCoreError("settle_failed", "settling"))
      .mockResolvedValueOnce(undefined);
    const messages: ServerMessage[] = [];
    const engine = engineFor(navigateStep(), messages);

    const running = engine.run();
    await waitForFailure(messages, "settling");
    engine.retry();
    await running;

    expect(core.execute).toHaveBeenCalledOnce();
    expect(core.settle).toHaveBeenCalledTimes(2);
    expect(core.dispose).toHaveBeenCalledOnce();
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      status: "failed",
      diagnostic: { message: "The page could not finish settling.", attemptedLocators: [] },
    }));
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      status: "passed",
      locatorKind: "testId",
    }));
  });

  it("retries only the unfinished delay and condition phases", async () => {
    core.delay
      .mockRejectedValueOnce(new ReplayCoreError("wait_failed", "waiting"))
      .mockResolvedValueOnce(undefined);
    core.condition
      .mockRejectedValueOnce(new ReplayCoreError("wait_failed", "waiting"))
      .mockResolvedValueOnce(undefined);
    const messages: ServerMessage[] = [];
    const engine = engineFor(navigateStep({
      delayMs: 250,
      condition: {
        state: "visible",
        target: { candidates: [{ kind: "testId", value: "ready", exact: true }] },
      },
    }), messages);

    const running = engine.run();
    await waitForFailure(messages, "waiting");
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      status: "failed",
      diagnostic: { message: "The replay delay could not be completed.", attemptedLocators: [] },
    }));
    engine.retry();
    await vi.waitFor(() => expect(core.condition).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(messages.filter(
      (message) => message.type === "replay.step" && message.status === "failed",
    )).toHaveLength(2));
    engine.resume();
    await running;

    expect(core.execute).toHaveBeenCalledOnce();
    expect(core.settle).toHaveBeenCalledOnce();
    expect(core.delay).toHaveBeenCalledTimes(2);
    expect(core.condition).toHaveBeenCalledTimes(2);
  });

  it("aborts a blocking action and disposes run-owned activity tracking on stop", async () => {
    core.execute.mockImplementationOnce((_page, _step, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        reject(new ReplayCoreError("cancelled", "acting"));
      }, { once: true });
    }));
    const messages: ServerMessage[] = [];
    const engine = engineFor(navigateStep(), messages);
    const running = engine.run();

    await vi.waitFor(() => expect(core.execute).toHaveBeenCalledOnce());
    engine.stop();
    await running;

    expect(core.dispose).toHaveBeenCalledOnce();
    expect(messages.some(
      (message) => message.type === "replay.step" && message.status === "failed",
    )).toBe(false);
    expect(messages.some(
      (message) => message.type === "replay.status" && message.status === "completed",
    )).toBe(false);
  });

  it.each([
    {
      name: "bootstrap navigation",
      step: clickStep(),
      phase: "acting" as const,
      operation: core.bootstrap,
      optionsIndex: 2,
    },
    {
      name: "assertion",
      step: assertionStep(),
      phase: "asserting" as const,
      operation: core.execute,
      optionsIndex: 2,
    },
    {
      name: "settling",
      step: navigateStep(),
      phase: "settling" as const,
      operation: core.settle,
      optionsIndex: 2,
    },
    {
      name: "delay",
      step: navigateStep({ delayMs: 30_000 }),
      phase: "waiting" as const,
      operation: core.delay,
      optionsIndex: 1,
    },
    {
      name: "condition wait",
      step: navigateStep({
        condition: {
          state: "visible",
          target: { candidates: [{ kind: "testId", value: "ready", exact: true }] },
        },
      }),
      phase: "waiting" as const,
      operation: core.condition,
      optionsIndex: 4,
    },
  ])("cancels $name without emitting a recoverable failure", async ({
    step,
    phase,
    operation,
    optionsIndex,
  }) => {
    operation.mockImplementationOnce((...args: unknown[]) => new Promise((_resolve, reject) => {
      const options = args[optionsIndex] as { signal?: AbortSignal };
      options.signal?.addEventListener("abort", () => {
        reject(new ReplayCoreError("cancelled", phase));
      }, { once: true });
    }));
    const messages: ServerMessage[] = [];
    const engine = engineFor(step, messages);
    const running = engine.run();

    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    engine.stop();
    await running;

    expect(core.dispose).toHaveBeenCalledOnce();
    expect(messages.some(
      (message) => message.type === "replay.step" && message.status === "failed",
    )).toBe(false);
  });

  it("disposes activity tracking when bootstrap fails unexpectedly", async () => {
    core.bootstrap.mockRejectedValueOnce(new ReplayCoreError("bootstrap_failed", "acting"));
    const engine = engineFor(clickStep(), []);

    await expect(engine.run()).rejects.toThrow("The recorded starting page could not be opened.");

    expect(core.dispose).toHaveBeenCalledOnce();
  });

  it("stops from paused recovery without retrying or completing", async () => {
    core.settle.mockRejectedValueOnce(new ReplayCoreError("settle_failed", "settling"));
    const messages: ServerMessage[] = [];
    const engine = engineFor(navigateStep(), messages);
    const running = engine.run();

    await waitForFailure(messages, "settling");
    engine.stop();
    await running;

    expect(core.execute).toHaveBeenCalledOnce();
    expect(core.settle).toHaveBeenCalledOnce();
    expect(core.dispose).toHaveBeenCalledOnce();
    expect(messages.some(
      (message) => message.type === "replay.status" && message.status === "completed",
    )).toBe(false);
  });
});
