import { describe, expect, it, vi } from "vitest";
import type { Frame, Locator, Page, Request } from "playwright-core";
import type { ServerMessage } from "@/shared/contracts/protocol";
import type { Workflow, WorkflowStep } from "@/shared/contracts/workflow/domain";
import { createWorkflow } from "@/shared/contracts/workflow/schema";
import { applyPositionBefore, preflightReplay, ReplayEngine, resolveTarget, resolveTargetOnce } from "@/server/replay/engine";
import { isRedundantOptionClickBeforeSelect } from "@relay/replay-core";

const recordedAt = new Date().toISOString();
const target = { candidates: [{ kind: "testId" as const, value: "target", exact: true }] };
type ClickStep = Extract<WorkflowStep, { type: "click" }>;
type SelectStep = Extract<WorkflowStep, { type: "select" }>;

function baseStep(type: WorkflowStep["type"], order: number) {
  return {
    id: `step-${order}`,
    order,
    name: `${type} step`,
    enabled: true,
    page: { id: "page", url: "https://example.com" },
    target,
    metadata: { recordedAt, origin: "recorded" as const, sensitive: false },
  };
}

function workflowWith(steps: WorkflowStep[]): Workflow {
  const workflow = createWorkflow("recorded-session");
  workflow.steps = steps;
  return workflow;
}

function replayPage(click = vi.fn(async () => undefined)) {
  const locator = {
    check: vi.fn(async () => undefined),
    click,
    count: vi.fn(async () => 1),
    evaluate: vi.fn(async () => true),
    fill: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    isVisible: vi.fn(async () => true),
    innerText: vi.fn(async () => "  READY\n for   Review "),
    press: vi.fn(async () => undefined),
    pressSequentially: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => ["value"]),
    uncheck: vi.fn(async () => undefined),
  } as unknown as Locator;
  const frame = {
    childFrames: vi.fn(() => []),
    evaluate: vi.fn(async () => false),
    getByRole: vi.fn(() => locator),
    getByTestId: vi.fn(() => locator),
    isDetached: vi.fn(() => false),
  } as unknown as Frame;
  const page = {
    frames: vi.fn(() => [frame]),
    goto: vi.fn(async () => null),
    mainFrame: vi.fn(() => frame),
  } as unknown as Page;
  return { page, locator };
}

function nativeSelectPair(): [ClickStep, SelectStep] {
  const click: ClickStep = {
    ...baseStep("click", 0),
    type: "click",
    name: "Illinois",
    target: {
      tagName: "div",
      candidates: [{ kind: "role", value: "option", name: "Illinois", exact: true }],
    },
  };
  const select: SelectStep = {
    ...baseStep("select", 1),
    type: "select",
    name: "State",
    target: {
      tagName: "select",
      candidates: [{ kind: "testId", value: "state", exact: true }],
    },
    payload: { value: "IL", label: "Illinois" },
  };
  return [click, select];
}

describe("replay preflight", () => {
  it("uses recorded page context when an explicit start URL is absent", () => {
    const click = { ...baseStep("click", 0), type: "click" as const };
    expect(preflightReplay(workflowWith([click])).bootstrapUrl).toBe("https://example.com");
    const withStart = workflowWith([click]);
    withStart.source.startUrl = "https://start.example.com";
    expect(preflightReplay(withStart).bootstrapUrl).toBe("https://start.example.com");
    const withoutHttpContext = { ...click, page: { ...click.page, url: "about:blank" } };
    expect(() => preflightReplay(workflowWith([withoutHttpContext]))).toThrow(/recorded HTTP page URL/i);
  });

  it("rejects missing selected steps and duplicate IDs", () => {
    const navigate = { ...baseStep("navigate", 0), type: "navigate" as const, payload: { url: "https://example.com" } };
    expect(() => preflightReplay(workflowWith([navigate]), "missing")).toThrow(/no longer/i);
    expect(() => preflightReplay(workflowWith([navigate, { ...navigate, order: 1 }]))).toThrow(/unique/i);
  });

  it("rejects a selected range without enabled steps", () => {
    const disabled = { ...baseStep("click", 0), type: "click" as const, enabled: false };
    expect(() => preflightReplay(workflowWith([disabled]))).toThrow(/no enabled steps/i);
  });
});

describe("redundant native select clicks", () => {
  it("recognizes a recorded option click immediately followed by its semantic select", () => {
    const [click, select] = nativeSelectPair();
    expect(isRedundantOptionClickBeforeSelect(click, select)).toBe(true);
  });

  it("does not match unrelated, manual, disabled, delayed, cross-page, or cross-frame steps", () => {
    const [click, select] = nativeSelectPair();
    const cases: Array<[WorkflowStep, WorkflowStep]> = [
      [click, { ...select, payload: { ...select.payload, label: "California" } }],
      [{ ...click, metadata: { ...click.metadata, origin: "manual" } }, select],
      [click, { ...select, enabled: false }],
      [{ ...click, waitAfter: { delayMs: 100 } }, select],
      [click, { ...select, page: { ...select.page, id: "another-page" } }],
      [
        { ...click, target: { ...click.target, frameUrl: "https://example.com/first-frame" } },
        { ...select, target: { ...select.target, frameUrl: "https://example.com/second-frame" } },
      ],
    ];

    for (const pair of cases) expect(isRedundantOptionClickBeforeSelect(...pair)).toBe(false);
  });
});

describe("replay engine", () => {
  it("evaluates assertions immediately with normalized case-insensitive text", async () => {
    const steps: WorkflowStep[] = [
      { ...baseStep("assertion", 0), type: "assertion", expectation: { kind: "visible" } },
      { ...baseStep("assertion", 1), type: "assertion", expectation: { kind: "text_contains", expected: "ready FOR review" } },
    ];
    const messages: ServerMessage[] = [];
    const { page } = replayPage();
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith(steps)), (message) => messages.push(message));

    await engine.run();

    expect(messages.filter((message) => message.type === "replay.step" && message.status === "passed")).toHaveLength(2);
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      stepId: "step-1",
      status: "running",
      phase: "asserting",
    }));
    expect(messages.some((message) => message.type === "replay.step" && message.phase === "settling")).toBe(false);
  });

  it("fails missing, ambiguous, and hidden assertion targets in one resolution pass", async () => {
    const cases = [
      { count: 0, visible: true, reason: "No match." },
      { count: 2, visible: true, reason: "Matched 2 elements." },
      { count: 1, visible: false, reason: "The only match is not visible." },
    ];

    for (const scenario of cases) {
      const { page, locator } = replayPage();
      vi.mocked(locator.count).mockResolvedValue(scenario.count);
      vi.mocked(locator.isVisible).mockResolvedValue(scenario.visible);

      await expect(resolveTargetOnce(page, target)).rejects.toMatchObject({
        attempts: [{ kind: "testId", reason: scenario.reason }],
      });
      expect(locator.count).toHaveBeenCalledOnce();
    }
  });

  it("falls through locator matches that conflict with the recorded element tag", async () => {
    const ambiguousRole = {
      count: vi.fn(async () => 2),
      isVisible: vi.fn(async () => true),
    } as unknown as Locator;
    const labelledTextboxClick = vi.fn(async () => undefined);
    const labelledTextbox = {
      click: labelledTextboxClick,
      count: vi.fn(async () => 1),
      evaluate: vi.fn(async () => ({ tagName: "input", inputType: "text" })),
      isVisible: vi.fn(async () => true),
    } as unknown as Locator;
    const searchButtonClick = vi.fn(async () => undefined);
    const searchButton = {
      click: searchButtonClick,
      count: vi.fn(async () => 1),
      evaluate: vi.fn(async () => ({ tagName: "button" })),
      isVisible: vi.fn(async () => true),
    } as unknown as Locator;
    const frame = {
      getByLabel: vi.fn(() => labelledTextbox),
      getByRole: vi.fn(() => ambiguousRole),
      locator: vi.fn(() => searchButton),
      url: vi.fn(() => "https://www.courtlistener.com/opinion/"),
    } as unknown as Frame;
    const page = {
      frames: vi.fn(() => [frame]),
      goto: vi.fn(async () => null),
      mainFrame: vi.fn(() => frame),
    } as unknown as Page;
    const step: WorkflowStep = {
      ...baseStep("click", 0),
      type: "click",
      page: { id: "page", url: "https://www.courtlistener.com/opinion/" },
      target: {
        tagName: "button",
        candidates: [
          { kind: "role", value: "button", name: "Search", exact: true },
          { kind: "accessibleName", value: "Search", exact: true },
          { kind: "css", value: "#search-button", exact: true, unique: true },
        ],
      },
    };
    const messages: ServerMessage[] = [];
    const workflow = workflowWith([step]);
    workflow.source.startUrl = step.page.url;
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflow), (message) => messages.push(message));

    const resolved = await resolveTargetOnce(page, step.target, step.page.url);
    expect(resolved.attempts).toContainEqual({
      kind: "accessibleName",
      reason: "Expected button, matched input.",
    });

    await engine.run();

    expect(labelledTextboxClick).not.toHaveBeenCalled();
    expect(searchButtonClick).toHaveBeenCalledOnce();
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      stepId: step.id,
      status: "passed",
      locatorKind: "css",
    }));
  });

  it("falls through locator matches with the wrong recorded input type", async () => {
    const textInput = {
      count: vi.fn(async () => 1),
      evaluate: vi.fn(async () => ({ tagName: "input", inputType: "text" })),
      isVisible: vi.fn(async () => true),
    } as unknown as Locator;
    const checkbox = {
      count: vi.fn(async () => 1),
      evaluate: vi.fn(async () => ({ tagName: "input", inputType: "checkbox" })),
      isVisible: vi.fn(async () => true),
    } as unknown as Locator;
    const frame = {
      getByLabel: vi.fn(() => textInput),
      locator: vi.fn(() => checkbox),
    } as unknown as Frame;
    const page = {
      frames: vi.fn(() => [frame]),
      mainFrame: vi.fn(() => frame),
    } as unknown as Page;

    const resolved = await resolveTargetOnce(page, {
      tagName: "input",
      inputType: "checkbox",
      candidates: [
        { kind: "label", value: "Accept terms", exact: true },
        { kind: "css", value: "#accept-terms", exact: true, unique: true },
      ],
    });

    expect(resolved.kind).toBe("css");
    expect(resolved.attempts).toContainEqual({
      kind: "label",
      reason: "Expected input type checkbox, matched input type text.",
    });
  });

  it("fails text assertions once with expected and observed diagnostics", async () => {
    const step: WorkflowStep = {
      ...baseStep("assertion", 0),
      type: "assertion",
      expectation: { kind: "text_contains", expected: "completed" },
    };
    const messages: ServerMessage[] = [];
    const { page, locator } = replayPage();
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), (message) => messages.push(message));

    const running = engine.run();
    await vi.waitFor(() => expect(messages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true));
    engine.skip();
    await running;

    expect(locator.count).toHaveBeenCalledOnce();
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      status: "failed",
      phase: "asserting",
      diagnostic: expect.objectContaining({ message: 'Expected text to contain "completed", but observed "ready for review".' }),
    }));
  });

  it("retries assertions with a fresh immediate evaluation", async () => {
    const step: WorkflowStep = {
      ...baseStep("assertion", 0),
      type: "assertion",
      expectation: { kind: "text_contains", expected: "ready" },
    };
    const messages: ServerMessage[] = [];
    const { page, locator } = replayPage();
    vi.mocked(locator.innerText)
      .mockResolvedValueOnce("Waiting")
      .mockResolvedValueOnce("Ready");
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), (message) => messages.push(message));

    const running = engine.run();
    await vi.waitFor(() => expect(messages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true));
    engine.retry();
    await running;

    expect(locator.count).toHaveBeenCalledTimes(2);
    expect(locator.innerText).toHaveBeenCalledTimes(2);
    expect(messages).toContainEqual(expect.objectContaining({ type: "replay.step", stepId: step.id, status: "passed" }));
  });

  it("reports privacy-safe page-text diagnostics and retries with a fresh scan", async () => {
    const base = baseStep("assertion", 0);
    const step: WorkflowStep = {
      id: base.id,
      order: base.order,
      name: base.name,
      enabled: base.enabled,
      page: base.page,
      metadata: base.metadata,
      type: "assertion",
      expectation: { kind: "page_text_contains", expected: "John Snow" },
    };
    const messages: ServerMessage[] = [];
    const { page } = replayPage();
    const frame = page.mainFrame();
    vi.mocked(frame.evaluate)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const engine = new ReplayEngine(
      crypto.randomUUID(),
      page,
      preflightReplay(workflowWith([step])),
      (message) => messages.push(message),
    );

    const running = engine.run();
    await vi.waitFor(() => expect(messages.some((message) =>
      message.type === "replay.step" && message.status === "failed",
    )).toBe(true));
    const failed = messages.find((message) => message.type === "replay.step" && message.status === "failed");
    expect(failed).toMatchObject({
      diagnostic: {
        message: 'Page text did not contain "John Snow".',
        attemptedLocators: [],
      },
    });

    engine.retry();
    await running;

    expect(frame.evaluate).toHaveBeenCalledTimes(2);
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      stepId: step.id,
      status: "passed",
      locatorKind: "page-text",
    }));
    expect(JSON.stringify(messages)).not.toContain("private observed page content");
  });
  it("skips a legacy option click and replays the following semantic select", async () => {
    const [click, select] = nativeSelectPair();
    const messages: ServerMessage[] = [];
    const { page, locator } = replayPage();
    vi.mocked(locator.evaluate).mockResolvedValue({ tagName: "select" } as never);
    const engine = new ReplayEngine(
      crypto.randomUUID(),
      page,
      preflightReplay(workflowWith([click, select])),
      (message) => messages.push(message),
    );

    await engine.run();

    expect(locator.click).not.toHaveBeenCalled();
    expect(locator.selectOption).toHaveBeenCalledWith({ value: "IL" }, expect.anything());
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      stepId: click.id,
      status: "skipped",
    }));
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      stepId: select.id,
      status: "passed",
    }));
  });

  it("replays an unrelated option-like click before a select", async () => {
    const [click, select] = nativeSelectPair();
    const unrelated: ClickStep = {
      ...click,
      name: "California",
      target: {
        tagName: "option",
        candidates: [{ kind: "testId", value: "target", exact: true }],
      },
    };
    const { page, locator } = replayPage();
    vi.mocked(locator.evaluate)
      .mockResolvedValueOnce({ tagName: "option" } as never)
      .mockResolvedValueOnce({ tagName: "select" } as never);
    const engine = new ReplayEngine(
      crypto.randomUUID(),
      page,
      preflightReplay(workflowWith([unrelated, select])),
      vi.fn(),
    );

    await engine.run();

    expect(locator.click).toHaveBeenCalledOnce();
    expect(locator.selectOption).toHaveBeenCalledOnce();
  });

  it("applies the recorded absolute position to the action frame", async () => {
    const mainFrame = { url: vi.fn(() => "https://example.com") } as unknown as Frame;
    const evaluate = vi.fn(async () => undefined);
    const childFrame = {
      evaluate,
      url: vi.fn(() => "https://widgets.example.com/frame"),
    } as unknown as Frame;
    const page = {
      frames: vi.fn(() => [mainFrame, childFrame]),
      mainFrame: vi.fn(() => mainFrame),
    } as unknown as Page;
    const step: WorkflowStep = {
      ...baseStep("click", 0),
      type: "click",
      position: { x: 40, y: 120, frameUrl: "https://widgets.example.com/frame" },
    };

    await applyPositionBefore(page, step);

    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), { x: 40, y: 120 });
  });

  it("uses the current main frame for legacy main-frame URLs", async () => {
    const locator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true) } as unknown as Locator;
    const mainFrame = {
      getByTestId: vi.fn(() => locator),
      url: vi.fn(() => "https://example.com/app?live=2#current"),
    } as unknown as Frame;
    const page = { frames: vi.fn(() => [mainFrame]), mainFrame: vi.fn(() => mainFrame) } as unknown as Page;

    await resolveTarget(page, { ...target, frameUrl: "https://example.com/app?recorded=1#old" }, "https://example.com/app?recorded=1");

    expect(mainFrame.getByTestId).toHaveBeenCalledWith("target");
  });

  it("matches a unique child frame by origin and path when query values change", async () => {
    const locator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true) } as unknown as Locator;
    const mainFrame = { url: vi.fn(() => "https://example.com/app") } as unknown as Frame;
    const childFrame = {
      getByTestId: vi.fn(() => locator),
      url: vi.fn(() => "https://widgets.example.com/embed/?token=new#live"),
    } as unknown as Frame;
    const page = { frames: vi.fn(() => [mainFrame, childFrame]), mainFrame: vi.fn(() => mainFrame) } as unknown as Page;

    await resolveTarget(page, { ...target, frameUrl: "https://widgets.example.com/embed?token=old" }, "https://example.com/app");

    expect(childFrame.getByTestId).toHaveBeenCalledWith("target");
  });

  it("matches an exact child frame URL", async () => {
    const locator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true) } as unknown as Locator;
    const mainFrame = { url: vi.fn(() => "https://example.com/app") } as unknown as Frame;
    const childFrame = {
      getByTestId: vi.fn(() => locator),
      url: vi.fn(() => "https://widgets.example.com/embed?token=same"),
    } as unknown as Frame;
    const page = { frames: vi.fn(() => [mainFrame, childFrame]), mainFrame: vi.fn(() => mainFrame) } as unknown as Page;

    await resolveTarget(page, { ...target, frameUrl: childFrame.url() }, "https://example.com/app");

    expect(childFrame.getByTestId).toHaveBeenCalledWith("target");
  });

  it("reports ambiguous normalized child-frame matches", async () => {
    const mainFrame = { url: vi.fn(() => "https://example.com/app") } as unknown as Frame;
    const first = { url: vi.fn(() => "https://widgets.example.com/embed?token=one") } as unknown as Frame;
    const second = { url: vi.fn(() => "https://widgets.example.com/embed?token=two") } as unknown as Frame;
    const page = { frames: vi.fn(() => [mainFrame, first, second]), mainFrame: vi.fn(() => mainFrame) } as unknown as Page;

    await expect(resolveTarget(page, { ...target, frameUrl: "https://widgets.example.com/embed?token=old" }, "https://example.com/app"))
      .rejects.toThrow(/multiple frames/i);
  });

  it("reports a missing child frame", async () => {
    const mainFrame = { url: vi.fn(() => "https://example.com/app") } as unknown as Frame;
    const page = { frames: vi.fn(() => [mainFrame]), mainFrame: vi.fn(() => mainFrame) } as unknown as Page;

    await expect(resolveTarget(page, { ...target, frameUrl: "https://widgets.example.com/embed" }, "https://example.com/app"))
      .rejects.toThrow(/not available/i);
  });

  it("executes every supported action and reports completion", async () => {
    const steps: WorkflowStep[] = [
      { ...baseStep("navigate", 0), type: "navigate", payload: { url: "https://example.com" } },
      { ...baseStep("click", 1), type: "click" },
      {
        ...baseStep("fill", 2),
        type: "fill",
        payload: { value: "hello" },
        parameterBinding: { source: "recorded" },
      },
      { ...baseStep("set_date", 3), type: "set_date", payload: { value: "2026-07-21" } },
      { ...baseStep("select", 4), type: "select", payload: { value: "one" } },
      { ...baseStep("check", 5), type: "check" },
      { ...baseStep("uncheck", 6), type: "uncheck" },
      { ...baseStep("keypress", 7), type: "keypress", payload: { key: "Enter", modifiers: ["Control"] } },
      { ...baseStep("submit", 8), type: "submit" },
    ];
    const messages: ServerMessage[] = [];
    const { page, locator } = replayPage();
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith(steps)), (message) => messages.push(message));
    await engine.run();
    expect(page.goto).toHaveBeenCalledOnce();
    expect(locator.click).toHaveBeenCalledOnce();
    expect(locator.fill).toHaveBeenCalledTimes(2);
    expect(locator.selectOption).toHaveBeenCalledOnce();
    expect(locator.check).toHaveBeenCalledOnce();
    expect(locator.uncheck).toHaveBeenCalledOnce();
    expect(locator.press).toHaveBeenCalledWith("Control+Enter", expect.anything());
    expect(locator.evaluate).toHaveBeenCalledOnce();
    expect(messages.at(-1)).toMatchObject({ type: "replay.status", status: "completed" });
  });

  it("types naturally into combobox fills without changing ordinary fills", async () => {
    const ordinaryFill: WorkflowStep = {
      ...baseStep("fill", 0),
      type: "fill",
      payload: { value: "ordinary value" },
      parameterBinding: { source: "recorded" },
    };
    const comboboxFill: WorkflowStep = {
      ...baseStep("fill", 1),
      type: "fill",
      target: {
        candidates: [{ kind: "role", value: "combobox", name: "Location", exact: true }],
      },
      payload: { value: "9320 S Clifton Park Ave" },
      parameterBinding: { source: "recorded" },
    };
    const { page, locator } = replayPage();
    const engine = new ReplayEngine(
      crypto.randomUUID(),
      page,
      preflightReplay(workflowWith([ordinaryFill, comboboxFill])),
      vi.fn(),
    );

    await engine.run();

    expect(locator.fill).toHaveBeenCalledOnce();
    expect(locator.fill).toHaveBeenCalledWith("ordinary value", expect.anything());
    expect(locator.focus).toHaveBeenCalledOnce();
    expect(locator.press).toHaveBeenNthCalledWith(1, "ControlOrMeta+A", expect.anything());
    expect(locator.press).toHaveBeenNthCalledWith(2, "Backspace", expect.anything());
    expect(locator.pressSequentially).toHaveBeenCalledWith(
      "9320 S Clifton Park Ave",
      expect.objectContaining({ delay: 20 }),
    );
  });

  it("restores the action frame position before resolving its locator", async () => {
    const click = vi.fn(async () => undefined);
    const locator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), click } as unknown as Locator;
    const evaluate = vi.fn(async () => undefined);
    const mainFrame = {
      evaluate,
      getByTestId: vi.fn(() => locator),
      url: vi.fn(() => "https://example.com"),
    } as unknown as Frame;
    const page = {
      frames: vi.fn(() => [mainFrame]),
      goto: vi.fn(async () => null),
      mainFrame: vi.fn(() => mainFrame),
    } as unknown as Page;
    const step: WorkflowStep = {
      ...baseStep("click", 0),
      type: "click",
      position: { x: 100, y: 250 },
    };
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), vi.fn());

    await engine.run();

    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), { x: 100, y: 250 });
    expect(click).toHaveBeenCalledOnce();
  });

  it("reapplies attached positions idempotently when retrying a failed action", async () => {
    const applyPosition = vi.fn<(callback: unknown, position?: { x: number; y: number }) => Promise<void>>()
      .mockResolvedValue(undefined);
    const click = vi.fn().mockRejectedValueOnce(new Error("Not ready")).mockResolvedValue(undefined);
    const locator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), click } as unknown as Locator;
    const frame = {
      evaluate: applyPosition,
      getByTestId: vi.fn(() => locator),
      url: vi.fn(() => "https://example.com"),
    } as unknown as Frame;
    const page = {
      frames: vi.fn(() => [frame]),
      goto: vi.fn(async () => null),
      mainFrame: vi.fn(() => frame),
    } as unknown as Page;
    const step: WorkflowStep = {
      ...baseStep("click", 0),
      type: "click",
      position: { x: 0, y: 500 },
    };
    const messages: ServerMessage[] = [];
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), (message) => messages.push(message));
    const running = engine.run();
    await vi.waitFor(() => expect(messages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true));

    engine.retry();
    await running;

    expect(applyPosition).toHaveBeenCalledTimes(2);
    expect(applyPosition.mock.calls.map((call) => call[1])).toEqual([
      { x: 0, y: 500 },
      { x: 0, y: 500 },
    ]);
    expect(click).toHaveBeenCalledTimes(2);
    expect(messages.at(-1)).toMatchObject({ type: "replay.status", status: "completed" });
  });

  it("pauses on failure and continues after the user skips the step", async () => {
    const failure = new Error("Button is disabled");
    const click = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const steps: WorkflowStep[] = [
      { ...baseStep("navigate", 0), type: "navigate", payload: { url: "https://example.com" } },
      { ...baseStep("click", 1), type: "click" },
    ];
    const messages: ServerMessage[] = [];
    const { page } = replayPage(click);
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith(steps)), (message) => messages.push(message));
    const running = engine.run();
    await vi.waitFor(() => expect(messages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true));
    engine.skip();
    await running;
    expect(messages).toContainEqual(expect.objectContaining({ type: "replay.step", stepId: "step-1", status: "skipped" }));
    expect(messages.at(-1)).toMatchObject({ type: "replay.status", status: "completed" });
  });

  it("pauses cooperatively before the next step and resumes without repeating work", async () => {
    let finishFirst!: () => void;
    const click = vi.fn()
      .mockImplementationOnce(() => new Promise<undefined>((resolve) => {
        finishFirst = () => resolve(undefined);
      }))
      .mockResolvedValue(undefined);
    const steps: WorkflowStep[] = [
      { ...baseStep("click", 0), type: "click" },
      { ...baseStep("click", 1), type: "click" },
    ];
    const messages: ServerMessage[] = [];
    const { page } = replayPage(click);
    const engine = new ReplayEngine(
      crypto.randomUUID(),
      page,
      preflightReplay(workflowWith(steps)),
      (message) => messages.push(message),
    );
    const running = engine.run();

    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
    engine.pause();
    finishFirst();
    await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.status",
      status: "paused",
    })));
    expect(click).toHaveBeenCalledOnce();
    engine.resume();
    await running;

    expect(click).toHaveBeenCalledTimes(2);
  });

  it("enters manual takeover after failure and treats resume as a retry", async () => {
    const click = vi.fn()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue(undefined);
    const messages: ServerMessage[] = [];
    const { page } = replayPage(click);
    const step: WorkflowStep = { ...baseStep("click", 0), type: "click" };
    const engine = new ReplayEngine(
      crypto.randomUUID(),
      page,
      preflightReplay(workflowWith([step])),
      (message) => messages.push(message),
    );
    const running = engine.run();

    await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.step",
      status: "failed",
    })));
    engine.takeControl();
    expect(messages).toContainEqual(expect.objectContaining({
      type: "replay.status",
      status: "manual",
    }));
    engine.resume();
    await running;

    expect(click).toHaveBeenCalledTimes(2);
    expect(messages.at(-1)).toMatchObject({ type: "replay.status", status: "completed" });
  });

  it("uses fixed action diagnostics without exposing provider messages", async () => {
    const click = vi.fn().mockRejectedValue(
      new Error('locator("#private-selector").click failed at https://private.example.com'),
    );
    const messages: ServerMessage[] = [];
    const { page } = replayPage(click);
    const step: WorkflowStep = { ...baseStep("click", 0), type: "click" };
    const engine = new ReplayEngine(
      crypto.randomUUID(),
      page,
      preflightReplay(workflowWith([step])),
      (message) => messages.push(message),
    );

    const running = engine.run();
    await vi.waitFor(() => expect(messages.some(
      (message) => message.type === "replay.step" && message.status === "failed",
    )).toBe(true));
    engine.skip();
    await running;

    const failed = messages.find(
      (message) => message.type === "replay.step" && message.status === "failed",
    );
    expect(failed).toMatchObject({
      type: "replay.step",
      phase: "acting",
      diagnostic: { message: "The replay action could not be completed." },
    });
    expect(JSON.stringify(failed)).not.toContain("private-selector");
    expect(JSON.stringify(failed)).not.toContain("private.example.com");
  });

  it("waits for DOM and request quiet before executing the next step", async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Map<string, Set<(request: Request) => void>>();
      const emit = (event: string, request: Request) => listeners.get(event)?.forEach((listener) => listener(request));
      const request = { resourceType: () => "xhr" } as unknown as Request;
      let lastMutation = Date.now();
      let requestFinishedAt: number | null = null;
      let secondActionAt: number | null = null;
      const firstClick = vi.fn(async () => {
        emit("request", request);
        setTimeout(() => {
          lastMutation = Date.now();
          requestFinishedAt = Date.now();
          emit("requestfinished", request);
        }, 100);
      });
      const secondClick = vi.fn(async () => { secondActionAt = Date.now(); });
      const firstLocator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), click: firstClick } as unknown as Locator;
      const secondLocator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), click: secondClick } as unknown as Locator;
      const frame = {
        getByTestId: vi.fn((value: string) => value === "first" ? firstLocator : secondLocator),
      } as unknown as Frame;
      const page = {
        evaluate: vi.fn(async (_callback: unknown, quietMs?: number) => {
          if (quietMs === 200) return Date.now() - lastMutation >= quietMs;
          lastMutation = Date.now();
          return undefined;
        }),
        frames: vi.fn(() => [frame]),
        goto: vi.fn(async () => null),
        mainFrame: vi.fn(() => frame),
        on: vi.fn((event: string, listener: (request: Request) => void) => {
          const registered = listeners.get(event) ?? new Set();
          registered.add(listener);
          listeners.set(event, registered);
          return page;
        }),
        off: vi.fn((event: string, listener: (request: Request) => void) => {
          listeners.get(event)?.delete(listener);
          return page;
        }),
        waitForLoadState: vi.fn(async () => undefined),
      } as unknown as Page;
      const steps: WorkflowStep[] = [
        { ...baseStep("click", 0), target: { candidates: [{ kind: "testId", value: "first", exact: true }] }, type: "click" },
        { ...baseStep("click", 1), target: { candidates: [{ kind: "testId", value: "second", exact: true }] }, type: "click" },
      ];
      const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith(steps)), vi.fn());
      const running = engine.run();

      await vi.waitFor(() => expect(firstClick).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(1_000);
      await running;
      expect(secondClick).toHaveBeenCalledOnce();
      if (requestFinishedAt === null || secondActionAt === null) throw new Error("Expected both replay actions to finish.");
      expect(secondActionAt - requestFinishedAt).toBeGreaterThanOrEqual(200);
      expect(secondActionAt - requestFinishedAt).toBeLessThan(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("extends settling until DOM mutations have been quiet for 200 milliseconds", async () => {
    vi.useFakeTimers();
    try {
      let lastMutation = Date.now();
      let finalMutationAt: number | null = null;
      let secondActionAt: number | null = null;
      const firstClick = vi.fn(async () => {
        setTimeout(() => { lastMutation = Date.now(); }, 150);
        setTimeout(() => {
          lastMutation = Date.now();
          finalMutationAt = Date.now();
        }, 300);
      });
      const secondClick = vi.fn(async () => { secondActionAt = Date.now(); });
      const firstLocator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), click: firstClick } as unknown as Locator;
      const secondLocator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), click: secondClick } as unknown as Locator;
      const frame = {
        getByTestId: vi.fn((value: string) => value === "first" ? firstLocator : secondLocator),
      } as unknown as Frame;
      const page = {
        evaluate: vi.fn(async (_callback: unknown, quietMs?: number) => {
          if (quietMs === 200) return Date.now() - lastMutation >= quietMs;
          lastMutation = Date.now();
          return undefined;
        }),
        frames: vi.fn(() => [frame]),
        goto: vi.fn(async () => null),
        mainFrame: vi.fn(() => frame),
        waitForLoadState: vi.fn(async () => undefined),
      } as unknown as Page;
      const steps: WorkflowStep[] = [
        { ...baseStep("click", 0), target: { candidates: [{ kind: "testId", value: "first", exact: true }] }, type: "click" },
        { ...baseStep("click", 1), target: { candidates: [{ kind: "testId", value: "second", exact: true }] }, type: "click" },
      ];
      const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith(steps)), vi.fn());
      const running = engine.run();

      await vi.waitFor(() => expect(firstClick).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(1_000);
      await running;
      expect(secondClick).toHaveBeenCalledOnce();
      if (finalMutationAt === null || secondActionAt === null) throw new Error("Expected DOM settling timestamps.");
      expect(secondActionAt - finalMutationAt).toBeGreaterThanOrEqual(200);
      expect(secondActionAt - finalMutationAt).toBeLessThan(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues after the five-second automatic settling cap", async () => {
    vi.useFakeTimers();
    try {
      const locator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true) } as unknown as Locator;
      const frame = { getByTestId: vi.fn(() => locator) } as unknown as Frame;
      const messages: ServerMessage[] = [];
      const page = {
        evaluate: vi.fn(async (_callback: unknown, quietMs?: number) => quietMs === 200 ? false : undefined),
        frames: vi.fn(() => [frame]),
        goto: vi.fn(async () => null),
        mainFrame: vi.fn(() => frame),
        waitForLoadState: vi.fn(async () => undefined),
      } as unknown as Page;
      const step = { ...baseStep("navigate", 0), type: "navigate" as const, payload: { url: "https://example.com" } };
      const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), (message) => messages.push(message));
      const running = engine.run();

      await vi.advanceTimersByTimeAsync(5_100);
      await running;
      expect(messages.at(-1)).toMatchObject({ type: "replay.status", status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("honors an explicit post-action delay", async () => {
    vi.useFakeTimers();
    try {
      const { page } = replayPage();
      const messages: ServerMessage[] = [];
      const step: WorkflowStep = {
        ...baseStep("navigate", 0),
        type: "navigate",
        payload: { url: "https://example.com" },
        waitAfter: { delayMs: 1_000 },
      };
      const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), (message) => messages.push(message));
      const running = engine.run();

      await vi.advanceTimersByTimeAsync(999);
      expect(messages.some((message) => message.type === "replay.status" && message.status === "completed")).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(messages.at(-1)).toMatchObject({ type: "replay.status", status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["visible", "hidden"] as const)("waits for a child-frame element to remain %s", async (conditionState) => {
    vi.useFakeTimers();
    try {
      let visible = conditionState === "hidden";
      const conditionLocator = {
        count: vi.fn(async () => 1),
        isVisible: vi.fn(async () => visible),
      } as unknown as Locator;
      const mainFrame = { url: vi.fn(() => "https://example.com") } as unknown as Frame;
      const childFrame = {
        getByTestId: vi.fn(() => conditionLocator),
        url: vi.fn(() => "https://widgets.example.com/frame"),
      } as unknown as Frame;
      const page = {
        frames: vi.fn(() => [mainFrame, childFrame]),
        goto: vi.fn(async () => {
          setTimeout(() => { visible = conditionState === "visible"; }, 100);
          return null;
        }),
        mainFrame: vi.fn(() => mainFrame),
      } as unknown as Page;
      const step: WorkflowStep = {
        ...baseStep("navigate", 0),
        type: "navigate",
        payload: { url: "https://example.com" },
        waitAfter: {
          condition: {
            state: conditionState,
            target: {
              frameUrl: "https://widgets.example.com/frame",
              candidates: [{ kind: "testId", value: "ready", exact: true }],
            },
          },
        },
      };
      const messages: ServerMessage[] = [];
      const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), (message) => messages.push(message));
      const running = engine.run();

      await vi.advanceTimersByTimeAsync(399);
      expect(messages.some((message) => message.type === "replay.step" && message.status === "passed")).toBe(false);
      await vi.advanceTimersByTimeAsync(51);
      await running;
      expect(messages).toContainEqual(expect.objectContaining({ type: "replay.step", status: "passed" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a timed-out wait condition without repeating its successful action", async () => {
    vi.useFakeTimers();
    try {
      let ready = false;
      const actionClick = vi.fn(async () => undefined);
      const actionLocator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), click: actionClick } as unknown as Locator;
      const readyLocator = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => ready) } as unknown as Locator;
      const frame = {
        getByTestId: vi.fn((value: string) => value === "action" ? actionLocator : readyLocator),
      } as unknown as Frame;
      const page = { frames: vi.fn(() => [frame]), goto: vi.fn(async () => null), mainFrame: vi.fn(() => frame) } as unknown as Page;
      const step: WorkflowStep = {
        ...baseStep("click", 0),
        target: { candidates: [{ kind: "testId", value: "action", exact: true }] },
        type: "click",
        waitAfter: {
          condition: {
            state: "visible",
            target: { candidates: [{ kind: "testId", value: "ready", exact: true }] },
          },
        },
      };
      const messages: ServerMessage[] = [];
      const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), (message) => messages.push(message));
      const running = engine.run();
      await vi.advanceTimersByTimeAsync(15_100);
      expect(messages).toContainEqual(expect.objectContaining({ type: "replay.step", status: "failed", phase: "waiting" }));

      ready = true;
      engine.retry();
      await vi.advanceTimersByTimeAsync(350);
      await running;
      expect(actionClick).toHaveBeenCalledOnce();
      expect(messages.at(-1)).toMatchObject({ type: "replay.status", status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops promptly during an explicit wait", async () => {
    vi.useFakeTimers();
    try {
      const { page } = replayPage();
      const step: WorkflowStep = {
        ...baseStep("navigate", 0),
        type: "navigate",
        payload: { url: "https://example.com" },
        waitAfter: { delayMs: 30_000 },
      };
      const messages: ServerMessage[] = [];
      const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflowWith([step])), (message) => messages.push(message));
      const running = engine.run();
      await vi.advanceTimersByTimeAsync(100);
      engine.stop();
      await vi.advanceTimersByTimeAsync(50);
      await running;
      expect(messages.some((message) => message.type === "replay.status" && message.status === "completed")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops promptly during a blocked action without reporting a recoverable failure", async () => {
    const click = vi.fn(() => new Promise<undefined>(() => undefined));
    const { page } = replayPage(click);
    const messages: ServerMessage[] = [];
    const step: WorkflowStep = { ...baseStep("click", 0), type: "click" };
    const engine = new ReplayEngine(
      crypto.randomUUID(),
      page,
      preflightReplay(workflowWith([step])),
      (message) => messages.push(message),
    );
    const running = engine.run();

    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
    engine.stop();
    const result = await Promise.race([
      running.then(() => "stopped"),
      new Promise((resolve) => setTimeout(() => resolve("timed out"), 100)),
    ]);

    expect(result).toBe("stopped");
    expect(messages.some(
      (message) => message.type === "replay.step" && message.status === "failed",
    )).toBe(false);
  });
});
