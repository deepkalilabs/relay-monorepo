import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { ClientMessageSchema } from "@/shared/contracts/protocol";
import {
  hideLiveViewNavbar,
  selectLiveViewPage,
} from "@/server/infrastructure/browser/browserbase";
import type { BrowserProvider } from "@/server/infrastructure/browser/types";
import {
  isRecordableNavigationUrl,
  normalizeBrowserUrl,
  RecordingRuntime,
} from "@/server/recording/runtime";
import { createWorkflow } from "@/shared/contracts/workflow/schema";

let captchaConsoleInfo: ReturnType<typeof vi.spyOn>;

function captchaLogs(): Array<Record<string, unknown>> {
  return captchaConsoleInfo.mock.calls.map(([line]: unknown[]) => {
    expect(line).toEqual(expect.stringMatching(/^\[captcha\] \{/));
    return JSON.parse((line as string).slice("[captcha] ".length)) as Record<string, unknown>;
  });
}

describe("browser navigation", () => {
  beforeEach(() => {
    captchaConsoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    captchaConsoleInfo.mockRestore();
  });

  it("normalizes scheme-less addresses and rejects unsafe protocols", () => {
    expect(normalizeBrowserUrl("example.com/path")).toBe("https://example.com/path");
    expect(normalizeBrowserUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeBrowserUrl("localhost:3000/path")).toBe("https://localhost:3000/path");
    expect(() => normalizeBrowserUrl("javascript:alert(1)")).toThrow(/http or https/i);
    expect(() => normalizeBrowserUrl("   ")).toThrow(/web address/i);
    expect(isRecordableNavigationUrl("https://example.com")).toBe(true);
    expect(isRecordableNavigationUrl("about:blank")).toBe(false);
  });

  it("stores an already-loaded page as the start URL without recording a navigate action", async () => {
    let currentUrl = "https://example.com/start";
    const mainFrame = {};
    const goto = vi.fn(async () => { currentUrl = "https://resolved.example.net/"; return null; });
    const page = {
      evaluate: vi.fn(async () => undefined),
      goto,
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn(),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async () => undefined),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });

    const startedIndex = runtime.buffer.findIndex((item) => item.message.type === "session.started");
    const startUrl = runtime.buffer.find((item) => item.message.type === "recording.startUrl");
    expect(startUrl?.message).toEqual({ type: "recording.startUrl", url: currentUrl });
    expect(runtime.buffer.indexOf(startUrl!)).toBeGreaterThan(startedIndex);
    expect(runtime.buffer.some((item) => item.message.type === "recorded.action")).toBe(false);

    await runtime.navigate("pasted.example.com/path");
    const startUrls = runtime.buffer.flatMap((item) => item.message.type === "recording.startUrl" ? [item.message.url] : []);
    expect(startUrls).toEqual(["https://example.com/start", "https://pasted.example.com/path"]);
    expect(currentUrl).toBe("https://resolved.example.net/");
  });

  it("correlates assertion picker requests and cancels the active picker when CAPTCHA begins", async () => {
    const currentUrl = "https://example.com/status";
    let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const mainFrame = {
      evaluate: vi.fn(async () => undefined),
      url: vi.fn(() => currentUrl),
    };
    const page = {
      evaluate: vi.fn(async () => ({ width: 1280, height: 720 })),
      frames: vi.fn(() => [mainFrame]),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
      title: vi.fn(async () => "Status"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "Status", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    const inactiveRequestId = crypto.randomUUID();
    await expect(runtime.startAssertionPick(inactiveRequestId)).resolves.toBeUndefined();
    expect(runtime.buffer.at(-1)?.message).toEqual({ type: "assertion.pick.cancelled", requestId: inactiveRequestId });
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    runtime.buffer.splice(0);

    const staleRequestId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    await runtime.startAssertionPick(staleRequestId);
    await runtime.startAssertionPick(requestId);
    expect(runtime.buffer.some((item) => item.message.type === "assertion.pick.cancelled" && item.message.requestId === staleRequestId)).toBe(true);

    const selected = {
      type: "assertion-picker.selected",
      name: "Ready status",
      text: "Ready for review",
      target: { candidates: [{ kind: "role", value: "status", name: "Ready for review", exact: true }] },
      position: { x: 10, y: 320 },
    };
    await binding?.({ page, frame: mainFrame }, { ...selected, requestId: staleRequestId });
    expect(runtime.buffer.some((item) => item.message.type === "assertion.pick.selected")).toBe(false);

    await binding?.({ page, frame: mainFrame }, { ...selected, requestId });
    expect(runtime.buffer.findLast((item) => item.message.type === "assertion.pick.selected")?.message).toMatchObject({
      type: "assertion.pick.selected",
      requestId,
      name: "Ready status",
      text: "Ready for review",
      page: { url: currentUrl, title: "Status" },
    });

    const groupRequestId = crypto.randomUUID();
    await runtime.startAssertionPick(groupRequestId);
    await binding?.({ page, frame: mainFrame }, {
      type: "assertion-picker.group-selected",
      requestId: groupRequestId,
      name: "Profile card group",
      groupTarget: {
        version: 1,
        algorithm: "structural-token-v1",
        root: { tagName: "article", role: "article", sharedClasses: ["profile-card"] },
        structureTokens: ["0:article:article", "1:header:", "1:section:", "1:footer:"],
        capturedMatchCount: 2,
      },
      position: { x: 10, y: 320 },
    });
    expect(runtime.buffer.findLast((item) => item.message.type === "assertion.pick.groupSelected")?.message).toMatchObject({
      type: "assertion.pick.groupSelected",
      requestId: groupRequestId,
      name: "Profile card group",
      groupTarget: { capturedMatchCount: 2 },
      page: { url: currentUrl, title: "Status" },
    });

    const captchaRequestId = crypto.randomUUID();
    await runtime.startAssertionPick(captchaRequestId);
    handlers.get("console")?.({ text: () => "browserbase-solving-started" });
    expect(runtime.buffer.some((item) => item.message.type === "assertion.pick.cancelled" && item.message.requestId === captchaRequestId)).toBe(true);
    expect(mainFrame.evaluate).toHaveBeenCalledWith(expect.any(Function), null);
  });

  it("locks recording input while preserving passive Browserbase CAPTCHA diagnostics", async () => {
    vi.useFakeTimers();
    try {
      const currentUrl = "https://example.com/form";
      let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
      const handlers = new Map<string, (...args: unknown[]) => void>();
      const mainFrame = {
        evaluate: vi.fn(async () => undefined),
        locator: vi.fn(() => ({ boundingBox: vi.fn(async () => null) })),
        url: vi.fn(() => currentUrl),
      };
      const page = {
        evaluate: vi.fn(async () => ({ width: 1280, height: 720 })),
        frames: vi.fn(() => [mainFrame]),
        mainFrame: vi.fn(() => mainFrame),
        on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
        title: vi.fn(async () => "Example"),
        url: vi.fn(() => currentUrl),
      } as unknown as Page;
      const context = {
        addInitScript: vi.fn(async () => undefined),
        exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
        on: vi.fn(),
        pages: vi.fn(() => [page]),
      } as unknown as BrowserContext;
      const provider: BrowserProvider = {
        connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
        createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
        getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: currentUrl, liveViewUrl: "https://example.com/live" })),
        releaseSession: vi.fn(async () => undefined),
      };
      const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
      await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
      runtime.buffer.splice(0);

      const click = {
        type: "click",
        name: "Click Continue",
        target: { candidates: [{ kind: "role", value: "button", name: "Continue", exact: true }] },
        sensitive: false,
      };
      await binding?.({ page, frame: mainFrame }, {
        type: "date-picker.request",
        selector: "#appointment-date",
        name: "Set appointment date",
        target: { candidates: [{ kind: "label", value: "Appointment date", exact: true }], inputType: "date" },
        value: "2026-07-23",
        min: "",
        max: "",
        position: { x: 0, y: 0 },
        rect: { x: 20, y: 30, width: 160, height: 32 },
      });
      expect(runtime.buffer.at(-1)?.message).toMatchObject({ type: "date.picker.open" });

      handlers.get("console")?.({ text: () => "ordinary page console output" });
      expect(captchaLogs()).toEqual([]);
      handlers.get("console")?.({ text: () => "browser-solving-pending" });
      expect(captchaLogs()).toContainEqual(expect.objectContaining({
        sessionId: "session",
        mode: "recording",
        action: "unrecognized_event",
        rawMessage: "browser-solving-pending",
      }));
      expect(runtime.buffer.some((item) => item.message.type === "captcha.status")).toBe(false);

      handlers.get("console")?.({ text: () => "browserbase-solving-started" });
      expect(runtime.buffer.some((item) => item.message.type === "date.picker.closed")).toBe(true);
      expect(runtime.buffer.some((item) => item.message.type === "captcha.status" && item.message.status === "solving")).toBe(true);
      expect(mainFrame.evaluate).toHaveBeenCalledWith(expect.any(Function), true);
      expect(captchaLogs()).toContainEqual(expect.objectContaining({
        sessionId: "session",
        mode: "recording",
        action: "observed_start",
        rawMessage: "browserbase-solving-started",
      }));
      expect(captchaLogs().at(-1)).not.toHaveProperty("url");

      await binding?.({ page, frame: mainFrame }, click);
      expect(runtime.buffer.some((item) => item.message.type === "recorded.action")).toBe(false);

      await vi.advanceTimersByTimeAsync(30_000);
      handlers.get("console")?.({ text: () => "browser-solving-started" });
      expect(captchaLogs().at(-1)).toMatchObject({
        action: "observed_start",
        rawMessage: "browser-solving-started",
        elapsedMs: 30_000,
        restarted: true,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(runtime.buffer.some((item) => item.message.type === "captcha.status" && item.message.status === "timed_out")).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);

      handlers.get("console")?.({ text: () => "browser-solving-completed" });
      expect(captchaLogs().at(-1)).toMatchObject({
        action: "observed_finish",
        rawMessage: "browser-solving-completed",
        elapsedMs: 20_000,
        startObserved: true,
      });
      expect(runtime.buffer.some((item) => item.message.type === "captcha.status" && item.message.status === "solved")).toBe(true);
      expect(mainFrame.evaluate).toHaveBeenCalledWith(expect.any(Function), false);

      handlers.get("console")?.({ text: () => "browser-solving-started" });
      handlers.get("console")?.({ text: () => "browserbase-solving-finished" });
      expect(captchaLogs().slice(-2).map((log) => [log.action, log.rawMessage])).toEqual([
        ["observed_start", "browser-solving-started"],
        ["observed_finish", "browserbase-solving-finished"],
      ]);

      handlers.get("console")?.({ text: () => "browserbase-solving-started" });
      await runtime.release();
      expect(runtime.buffer.some((item) => item.message.type === "captcha.status" && item.message.status === "cancelled")).toBe(true);
      expect(captchaLogs().at(-1)).toMatchObject({
        sessionId: "session",
        action: "incomplete_observation",
        reason: "session_released",
        elapsedMs: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out and manually continues the UI lock without losing passive completion timing", async () => {
    vi.useFakeTimers();
    try {
      const currentUrl = "https://example.com/form";
      let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
      const handlers = new Map<string, (...args: unknown[]) => void>();
      const mainFrame = { url: vi.fn(() => currentUrl) };
      const page = {
        evaluate: vi.fn(async () => undefined),
        frames: vi.fn(() => [mainFrame]),
        mainFrame: vi.fn(() => mainFrame),
        on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
        title: vi.fn(async () => "Example"),
        url: vi.fn(() => currentUrl),
      } as unknown as Page;
      const context = {
        addInitScript: vi.fn(async () => undefined),
        exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
        on: vi.fn(),
        pages: vi.fn(() => [page]),
      } as unknown as BrowserContext;
      const provider: BrowserProvider = {
        connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
        createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
        getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: currentUrl, liveViewUrl: "https://example.com/live" })),
        releaseSession: vi.fn(async () => undefined),
      };
      const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
      await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
      runtime.buffer.splice(0);

      handlers.get("console")?.({ text: () => "browserbase-solving-finished" });
      expect(captchaLogs().at(-1)).toMatchObject({
        action: "observed_finish",
        rawMessage: "browserbase-solving-finished",
        startObserved: false,
      });

      handlers.get("console")?.({ text: () => "browserbase-solving-started" });
      await vi.advanceTimersByTimeAsync(45_000);
      expect(runtime.buffer.some((item) => item.message.type === "captcha.status" && item.message.status === "timed_out")).toBe(true);
      const click = {
        type: "click",
        name: "Click Continue",
        target: { candidates: [{ kind: "role", value: "button", name: "Continue", exact: true }] },
        sensitive: false,
      };
      await binding?.({ page, frame: mainFrame }, click);
      expect(runtime.buffer.some((item) => item.message.type === "recorded.action")).toBe(true);

      handlers.get("console")?.({ text: () => "browserbase-solving-finished" });
      expect(captchaLogs().at(-1)).toMatchObject({
        action: "observed_finish",
        rawMessage: "browserbase-solving-finished",
        elapsedMs: 45_000,
        startObserved: true,
      });

      const solvedAfterTimeout = runtime.buffer.filter((item) => item.message.type === "captcha.status" && item.message.status === "solved");
      expect(solvedAfterTimeout).toHaveLength(0);

      handlers.get("console")?.({ text: () => "browser-solving-started" });
      const solvingMessage = runtime.buffer.findLast((item) => item.message.type === "captcha.status" && item.message.status === "solving")?.message;
      if (solvingMessage?.type !== "captcha.status") throw new Error("CAPTCHA lock was not started");
      runtime.continueAfterCaptcha(solvingMessage.pageId);
      expect(runtime.buffer.at(-1)?.message).toMatchObject({
        type: "captcha.status",
        pageId: solvingMessage.pageId,
        status: "continued",
      });
      handlers.get("console")?.({ text: () => "browserbase-solving-finished" });
      expect(runtime.buffer.filter((item) => item.message.type === "captcha.status" && item.message.status === "solved")).toHaveLength(0);
      await runtime.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks incomplete CAPTCHA observations across popup switching and page closure", async () => {
    vi.useFakeTimers();
    try {
      const pageHandlers = new Map<string, (...args: unknown[]) => void>();
      const popupHandlers = new Map<string, (...args: unknown[]) => void>();
      let onPopup: ((page: Page) => void) | undefined;
      const mainFrame = { url: vi.fn(() => "https://example.com") };
      const popupFrame = { url: vi.fn(() => "https://example.com/challenge") };
      const page = {
        evaluate: vi.fn(async () => undefined),
        frames: vi.fn(() => [mainFrame]),
        mainFrame: vi.fn(() => mainFrame),
        on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { pageHandlers.set(name, handler); }),
        title: vi.fn(async () => "Example"),
        url: vi.fn(() => "https://example.com"),
      } as unknown as Page;
      const popupPage = {
        evaluate: vi.fn(async () => undefined),
        frames: vi.fn(() => [popupFrame]),
        mainFrame: vi.fn(() => popupFrame),
        on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { popupHandlers.set(name, handler); }),
        title: vi.fn(async () => "Verification"),
        url: vi.fn(() => "https://example.com/challenge"),
        waitForLoadState: vi.fn(async () => undefined),
      } as unknown as Page;
      const context = {
        addInitScript: vi.fn(async () => undefined),
        exposeBinding: vi.fn(async () => undefined),
        on: vi.fn((name: string, handler: (page: Page) => void) => {
          if (name === "page") onPopup = handler;
        }),
        pages: vi.fn(() => [page]),
      } as unknown as BrowserContext;
      const provider: BrowserProvider = {
        connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
        createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
        getLiveView: vi.fn(async (_sessionId, pageIndex = 0) => ({
          id: `page-${pageIndex}`,
          title: pageIndex ? "Verification" : "Example",
          url: pageIndex ? "https://example.com/challenge" : "https://example.com",
          liveViewUrl: `https://example.com/live-${pageIndex}`,
        })),
        releaseSession: vi.fn(async () => undefined),
      };
      const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
      await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
      runtime.buffer.splice(0);

      onPopup?.(popupPage);
      await vi.advanceTimersByTimeAsync(0);
      const detected = runtime.buffer.find((item) => item.message.type === "popup.detected")?.message;
      if (detected?.type !== "popup.detected") throw new Error("Popup was not registered");

      popupHandlers.get("console")?.({ text: () => "browserbase-solving-started" });

      await runtime.switchPage(detected.pageId);

      popupHandlers.get("close")?.();
      expect(runtime.buffer.some((item) => item.message.type === "captcha.status" && item.message.status === "cancelled")).toBe(true);
      expect(captchaLogs().at(-1)).toMatchObject({
        action: "incomplete_observation",
        reason: "page_closed",
        elapsedMs: 0,
      });
      await runtime.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("passively logs Browserbase CAPTCHA console events during replay", async () => {
    let finishNavigation: (() => void) | undefined;
    const navigation = new Promise<void>((resolve) => { finishNavigation = resolve; });
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const mainFrame = { url: vi.fn(() => "https://example.com") };
    const page = {
      evaluate: vi.fn(async () => undefined),
      frames: vi.fn(() => [mainFrame]),
      goto: vi.fn(async () => { await navigation; return null; }),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
      off: vi.fn(),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => "https://example.com"),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async () => undefined),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: "https://example.com", liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const workflow = createWorkflow("session");
    workflow.steps.push({
      id: "navigate",
      order: 0,
      name: "Open example",
      enabled: true,
      page: { id: "page", url: "https://example.com" },
      metadata: { recordedAt: new Date().toISOString(), origin: "recorded", sensitive: false },
      type: "navigate",
      payload: { url: "https://example.com" },
    });
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());

    await runtime.startReplay(workflow, undefined, { timeoutSeconds: 120, region: "us-west-2" });
    handlers.get("console")?.({ text: () => "browserbase-solving-started" });
    expect(captchaLogs().at(-1)).toMatchObject({
      sessionId: "session",
      mode: "replay",
      action: "observed_start",
      rawMessage: "browserbase-solving-started",
    });
    expect(runtime.buffer.some((item) => item.message.type === "captcha.status")).toBe(false);

    finishNavigation?.();
    await vi.waitFor(() => expect(runtime.buffer.some((item) => item.message.type === "replay.status" && item.message.status === "completed")).toBe(true));
    await runtime.release();
  });

  it("stores the start URL before the first injected action when the navigation event was missed", async () => {
    let currentUrl = "about:blank";
    const mainFrame = {};
    let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
    const page = {
      evaluate: vi.fn(async () => undefined),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn(),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "New Tab", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    runtime.buffer.splice(0);

    currentUrl = "https://example.com/form";
    await binding?.({ page, frame: mainFrame }, {
      type: "click",
      name: "Click Continue",
      target: { candidates: [{ kind: "role", value: "button", name: "Continue", exact: true }] },
      sensitive: false,
    });

    expect(runtime.buffer.map((item) => item.message.type)).toEqual(["recording.startUrl", "recorded.action"]);
    expect(runtime.buffer[0].message).toEqual({ type: "recording.startUrl", url: currentUrl });
    expect(runtime.buffer[1].message).toMatchObject({ type: "recorded.action", action: { type: "click" } });
  });

  it("preserves the synchronous position carried by each accepted action", async () => {
    const currentUrl = "https://example.com/form";
    let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
    const mainFrame = { url: vi.fn(() => currentUrl) };
    const childFrame = { url: vi.fn(() => "https://widgets.example.com/frame") };
    const page = {
      evaluate: vi.fn(async () => undefined),
      frames: vi.fn(() => [mainFrame, childFrame]),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn(),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    runtime.buffer.splice(0);

    await binding?.({ page, frame: mainFrame }, { type: "not-an-action" });
    expect(runtime.buffer).toHaveLength(0);

    const click = {
      type: "click",
      name: "Click Continue",
      target: { candidates: [{ kind: "role", value: "button", name: "Continue", exact: true }] },
      position: { x: 0, y: 0 },
      sensitive: false,
    };
    await binding?.({ page, frame: mainFrame }, click);

    expect(runtime.buffer).toHaveLength(1);
    expect(runtime.buffer[0].message).toMatchObject({
      type: "recorded.action",
      action: {
        type: "click",
        position: { x: 0, y: 0 },
      },
    });

    await binding?.({ page, frame: mainFrame }, { ...click, position: { x: 0, y: 720 } });
    expect(runtime.buffer).toHaveLength(1);

    await binding?.({
      page,
      frame: childFrame,
    }, {
      ...click,
      name: "Click Submit",
      target: { candidates: [{ kind: "testId", value: "submit", exact: true }] },
      position: { x: 15, y: 180, frameUrl: "https://widgets.example.com/frame" },
    });
    expect(runtime.buffer).toHaveLength(2);
    expect(runtime.buffer[1].message).toMatchObject({
      type: "recorded.action",
      action: {
        name: "Click Submit",
        position: { x: 15, y: 180, frameUrl: "https://widgets.example.com/frame" },
      },
    });
  });

  it("preserves the date-picker position until the semantic date action is emitted", async () => {
    const currentUrl = "https://example.com/form";
    let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
    const locator = {
      boundingBox: vi.fn(async () => ({ x: 20, y: 30, width: 160, height: 32 })),
      dispatchEvent: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
    };
    const mainFrame = {
      locator: vi.fn(() => locator),
      url: vi.fn(() => currentUrl),
    };
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const page = {
      evaluate: vi.fn(async () => ({ width: 1280, height: 720 })),
      isClosed: vi.fn(() => false),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    runtime.buffer.splice(0);

    await binding?.({ page, frame: mainFrame }, {
      type: "date-picker.request",
      selector: "#appointment-date",
      name: "Set date Appointment date",
      target: { candidates: [{ kind: "label", value: "Appointment date", exact: true }], inputType: "date" },
      value: "2026-07-21",
      min: "2026-07-01",
      max: "2026-08-31",
      position: { x: 0, y: 480 },
      rect: { x: 20, y: 30, width: 160, height: 32 },
    });
    const open = runtime.buffer.find((item) => item.message.type === "date.picker.open")?.message;
    expect(open?.type).toBe("date.picker.open");
    if (open?.type !== "date.picker.open") throw new Error("Date picker did not open");

    await runtime.selectDate(open.requestId, "2026-07-22");

    const recorded = runtime.buffer.find((item) => item.message.type === "recorded.action")?.message;
    expect(recorded).toMatchObject({
      type: "recorded.action",
      action: {
        type: "set_date",
        payload: { value: "2026-07-22" },
        position: { x: 0, y: 480 },
      },
    });
  });

  it("applies native select picker choices once and rejects disabled options", async () => {
    const currentUrl = "https://example.com/form";
    let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
    const locator = {
      boundingBox: vi.fn(async () => ({ x: 20, y: 80, width: 240, height: 40 })),
      evaluate: vi.fn(async (_callback: unknown, value: string) => value === "wood"
        ? { label: "Wood", disabled: true }
        : { label: "Masonry", disabled: false }),
      focus: vi.fn(async () => undefined),
      selectOption: vi.fn(async ({ value }: { value: string }) => [value]),
    };
    const mainFrame = {
      evaluate: vi.fn(async () => undefined),
      locator: vi.fn(() => locator),
      url: vi.fn(() => currentUrl),
    };
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const page = {
      evaluate: vi.fn(async () => ({ width: 1280, height: 720 })),
      isClosed: vi.fn(() => false),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
        handlers.set(name, handler);
      }),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    mainFrame.evaluate.mockClear();
    runtime.buffer.splice(0);

    const request = {
      type: "select-picker.request",
      selector: "#construction-type",
      name: "Construction type",
      target: { candidates: [{ kind: "label", value: "Construction type", exact: true }] },
      value: "frame",
      options: [
        { value: "frame", label: "Frame", disabled: false },
        { value: "masonry", label: "Masonry", disabled: false },
        { value: "wood", label: "Wood", disabled: true },
      ],
      sensitive: false,
      position: { x: 0, y: 480 },
      rect: { x: 20, y: 80, width: 240, height: 40 },
    };
    await binding?.({ page, frame: mainFrame }, request);
    const open = runtime.buffer.find((item) => item.message.type === "select.picker.open")?.message;
    expect(open).toMatchObject({ type: "select.picker.open", name: "Construction type", value: "frame", options: request.options });
    if (open?.type !== "select.picker.open") throw new Error("Select picker did not open");

    await runtime.selectPickerOption(open.requestId, "masonry");

    expect(locator.selectOption).toHaveBeenCalledWith({ value: "masonry" });
    expect(locator.focus).toHaveBeenCalledOnce();
    expect(mainFrame.evaluate).toHaveBeenCalledTimes(2);
    expect(runtime.buffer.filter((item) => item.message.type === "recorded.action")).toHaveLength(1);
    expect(runtime.buffer.find((item) => item.message.type === "recorded.action")?.message).toMatchObject({
      type: "recorded.action",
      action: {
        type: "select",
        name: "Construction type",
        payload: { value: "masonry", label: "Masonry" },
        position: { x: 0, y: 480 },
      },
    });

    await runtime.selectPickerOption(open.requestId, "masonry");
    expect(locator.selectOption).toHaveBeenCalledOnce();

    await binding?.({ page, frame: mainFrame }, request);
    const disabledOpen = runtime.buffer.filter((item) => item.message.type === "select.picker.open").at(-1)?.message;
    if (disabledOpen?.type !== "select.picker.open") throw new Error("Select picker did not reopen");
    await expect(runtime.selectPickerOption(disabledOpen.requestId, "wood")).rejects.toThrow(/disabled/i);
    expect(locator.selectOption).toHaveBeenCalledOnce();

    await binding?.({ page, frame: mainFrame }, request);
    const navigationOpen = runtime.buffer.filter((item) => item.message.type === "select.picker.open").at(-1)?.message;
    if (navigationOpen?.type !== "select.picker.open") throw new Error("Select picker did not reopen for navigation");
    handlers.get("framenavigated")?.(mainFrame);
    expect(runtime.buffer.some((item) => item.message.type === "select.picker.closed" && item.message.requestId === navigationOpen.requestId)).toBe(true);
    expect(mainFrame.evaluate).toHaveBeenCalledTimes(4);
    await runtime.selectPickerOption(navigationOpen.requestId, "masonry");
    expect(locator.selectOption).toHaveBeenCalledOnce();

    await binding?.({ page, frame: mainFrame }, request);
    const toggleOpen = runtime.buffer.filter((item) => item.message.type === "select.picker.open").at(-1)?.message;
    if (toggleOpen?.type !== "select.picker.open") throw new Error("Select picker did not reopen for native mode");
    mainFrame.evaluate.mockClear();
    await runtime.setNativeSelects(true);
    expect(mainFrame.evaluate).toHaveBeenCalledOnce();
    expect(runtime.buffer.some((item) => item.message.type === "select.picker.closed" && item.message.requestId === toggleOpen.requestId)).toBe(true);

    const openCount = runtime.buffer.filter((item) => item.message.type === "select.picker.open").length;
    await binding?.({ page, frame: mainFrame }, request);
    expect(runtime.buffer.filter((item) => item.message.type === "select.picker.open")).toHaveLength(openCount);
  });

  it("stores only the first main-frame URL while ignoring later navigations", async () => {
    let currentUrl = "about:blank";
    const mainFrame = {};
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const page = {
      evaluate: vi.fn(async () => undefined),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async () => undefined),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "New Tab", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    runtime.buffer.splice(0);

    handlers.get("framenavigated")?.({});
    handlers.get("framenavigated")?.(mainFrame);
    currentUrl = "https://example.com/one";
    handlers.get("framenavigated")?.(mainFrame);
    handlers.get("framenavigated")?.(mainFrame);
    currentUrl = "https://example.com/two";
    handlers.get("framenavigated")?.(mainFrame);

    const startUrls = runtime.buffer.flatMap((item) => item.message.type === "recording.startUrl" ? [item.message.url] : []);
    expect(startUrls).toEqual(["https://example.com/one"]);
    expect(runtime.buffer.some((item) => item.message.type === "recorded.action")).toBe(false);
  });

  it("turns a fresh replay session into a recorder after the workflow completes", async () => {
    let currentUrl = "about:blank";
    const handlers = new Map<string, (...args: unknown[]) => void>();
    let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
    const mainFrame = { url: vi.fn(() => currentUrl) };
    const page = {
      evaluate: vi.fn(async () => undefined),
      frames: vi.fn(() => [mainFrame]),
      goto: vi.fn(async (url: string) => { currentUrl = url; return null; }),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
      title: vi.fn(async () => "Replay"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "replay-session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "Replay", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const workflow = createWorkflow("recorded-session");
    workflow.steps.push({
      id: "navigate",
      order: 0,
      name: "Open example",
      enabled: true,
      page: { id: "recorded-page", url: "https://example.com" },
      metadata: { recordedAt: new Date().toISOString(), origin: "recorded", sensitive: false },
      type: "navigate",
      payload: { url: "https://example.com" },
    });
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.startReplay(workflow, undefined, { timeoutSeconds: 120, region: "us-west-2" });
    await vi.waitFor(() => expect(runtime.buffer.some((item) => item.message.type === "replay.status" && item.message.status === "completed")).toBe(true));
    runtime.buffer.splice(0);

    currentUrl = "https://example.com/after-replay";
    handlers.get("framenavigated")?.(mainFrame);
    expect(runtime.buffer.some((item) => item.message.type === "recorded.action")).toBe(false);
    expect(runtime.buffer.some((item) => item.message.type === "recording.startUrl")).toBe(false);

    await binding?.({ page, frame: mainFrame }, {
      type: "click",
      name: "Click Continue",
      target: { candidates: [{ kind: "role", value: "button", name: "Continue", exact: true }] },
      sensitive: false,
    });
    expect(runtime.buffer.some((item) => item.message.type === "recorded.action" && item.message.action.name === "Click Continue")).toBe(true);
    expect(runtime.buffer.at(-1)?.message).toEqual({ type: "recorded.action", action: expect.objectContaining({ name: "Click Continue" }) });
    expect(provider.createSession).toHaveBeenCalledOnce();
    expect(provider.releaseSession).not.toHaveBeenCalled();
  });

  it("replays the growing workflow in a fresh session every time", async () => {
    let currentUrl = "https://example.com/start";
    let binding: ((source: { page: Page; frame: unknown }, raw: unknown) => Promise<void>) | undefined;
    const locator = {
      count: vi.fn(async () => 1),
      isVisible: vi.fn(async () => true),
      click: vi.fn(async () => {
        await binding?.({ page, frame: mainFrame }, {
          type: "click",
          name: "Replay-generated click",
          target: { candidates: [{ kind: "testId", value: "continue", exact: true }] },
          position: { x: 0, y: 500 },
          sensitive: false,
        });
      }),
    };
    const mainFrame = {
      getByTestId: vi.fn(() => locator),
      url: vi.fn(() => currentUrl),
    };
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const page = {
      evaluate: vi.fn(async () => undefined),
      frames: vi.fn(() => [mainFrame]),
      goto: vi.fn(async (url: string) => { currentUrl = url; return null; }),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const closeBrowser = vi.fn(async () => undefined);
    let nextSessionId = 0;
    const createSession = vi.fn(async () => ({ id: `session-${++nextSessionId}`, connectUrl: "ws://example.com" }));
    const releaseSession = vi.fn(async () => undefined);
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: closeBrowser } as unknown as Browser, context })),
      createSession,
      getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession,
    };
    const workflow = createWorkflow("session");
    workflow.source.startUrl = "https://example.com/start";
    workflow.steps.push({
      id: "continue",
      order: 0,
      name: "Click Continue",
      enabled: true,
      page: { id: "recorded-page", url: "https://example.com/start" },
      target: { candidates: [{ kind: "testId", value: "continue", exact: true }] },
      metadata: { recordedAt: new Date().toISOString(), origin: "recorded", sensitive: false },
      type: "click",
    });
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    runtime.buffer.splice(0);

    const invalidWorkflow = createWorkflow("session-1");
    await expect(runtime.startReplay(invalidWorkflow, undefined, { timeoutSeconds: 120, region: "us-west-2" })).rejects.toThrow(/no enabled steps/i);
    expect(provider.createSession).toHaveBeenCalledOnce();
    expect(provider.releaseSession).not.toHaveBeenCalled();

    await runtime.startReplay(workflow, undefined, { timeoutSeconds: 120, region: "us-west-2" });
    await vi.waitFor(() => expect(runtime.buffer.some((item) => item.message.type === "replay.status" && item.message.status === "completed")).toBe(true));

    expect(provider.createSession).toHaveBeenCalledTimes(2);
    expect(provider.releaseSession).toHaveBeenCalledWith("session-1");
    expect(releaseSession.mock.invocationCallOrder[0]).toBeLessThan(createSession.mock.invocationCallOrder[1]);
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(runtime.buffer.some((item) => item.message.type === "recorded.action" && item.message.action.name === "Replay-generated click")).toBe(false);
    expect(runtime.buffer.at(-1)?.message).toEqual({ type: "session.status", status: "recording" });

    await binding?.({ page, frame: mainFrame }, {
      type: "click",
      name: "Click next step",
      target: { candidates: [{ kind: "testId", value: "next", exact: true }] },
      position: { x: 0, y: 0 },
      sensitive: false,
    });
    const nextAction = runtime.buffer.at(-1)?.message;
    expect(nextAction).toEqual({ type: "recorded.action", action: expect.objectContaining({ name: "Click next step" }) });
    if (nextAction?.type === "recorded.action") {
      expect(nextAction.action.position).toEqual({ x: 0, y: 0 });
    }

    locator.click.mockRejectedValueOnce(new Error("Button unavailable"));
    await runtime.startReplay(workflow, undefined, { timeoutSeconds: 120, region: "us-west-2" });
    await vi.waitFor(() => expect(runtime.buffer.some((item) => item.message.type === "replay.step" && item.message.status === "failed")).toBe(true));
    await runtime.stopReplay();

    expect(provider.createSession).toHaveBeenCalledTimes(3);
    expect(provider.releaseSession).toHaveBeenCalledTimes(2);
    expect(closeBrowser).toHaveBeenCalledTimes(2);
    expect(runtime.buffer.at(-1)?.message).toEqual({ type: "session.status", status: "recording" });
  });

  it("cleans up when the fresh Browserbase session cannot connect", async () => {
    let currentUrl = "https://example.com/start";
    const mainFrame = { url: vi.fn(() => currentUrl) };
    const page = {
      evaluate: vi.fn(async () => undefined),
      frames: vi.fn(() => [mainFrame]),
      goto: vi.fn(async (url: string) => { currentUrl = url; return null; }),
      mainFrame: vi.fn(() => mainFrame),
      on: vi.fn(),
      title: vi.fn(async () => "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async () => undefined),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const closeBrowser = vi.fn(async () => undefined);
    let nextSessionId = 0;
    const createSession = vi.fn(async () => ({ id: `session-${++nextSessionId}`, connectUrl: "ws://example.com" }));
    const provider: BrowserProvider = {
      connect: vi.fn()
        .mockResolvedValueOnce({ browser: { close: closeBrowser } as unknown as Browser, context })
        .mockRejectedValueOnce(new Error("Browserbase connection failed")),
      createSession,
      getLiveView: vi.fn(async () => ({ id: "page", title: "Example", url: currentUrl, liveViewUrl: "https://example.com/live" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const workflow = createWorkflow("session");
    workflow.steps.push({
      id: "navigate",
      order: 0,
      name: "Open example",
      enabled: true,
      page: { id: "recorded-page", url: "https://example.com" },
      metadata: { recordedAt: new Date().toISOString(), origin: "recorded", sensitive: false },
      type: "navigate",
      payload: { url: "https://example.com" },
    });
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    runtime.buffer.splice(0);

    await expect(runtime.startReplay(workflow, undefined, { timeoutSeconds: 120, region: "us-west-2" })).rejects.toThrow(/browserbase connection failed/i);

    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(provider.releaseSession).toHaveBeenNthCalledWith(1, "session-1");
    expect(provider.releaseSession).toHaveBeenNthCalledWith(2, "session-2");
    expect(page.goto).not.toHaveBeenCalled();
    expect(runtime.buffer.some((item) => item.message.type === "replay.started")).toBe(false);
  });

  it("uses Browserbase fullscreen URLs without the native navbar", () => {
    const url = hideLiveViewNavbar("https://example.com/live?token=abc");
    expect(url).toContain("token=abc");
    expect(url).toContain("navbar=false");
    const liveView = selectLiveViewPage({
      debuggerFullscreenUrl: "https://example.com/session-fullscreen?token=session",
      pages: [{
        id: "page",
        title: "Example",
        url: "https://example.com/",
        debuggerFullscreenUrl: "https://example.com/page-fullscreen?token=page",
      }],
    }, 0);
    expect(liveView.liveViewUrl).toContain("page-fullscreen");
    expect(liveView.liveViewUrl).toContain("navbar=false");
  });

  it("accepts the custom browser command protocol", () => {
    expect(ClientMessageSchema.safeParse({ type: "browser.navigate", url: "example.com" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "browser.back" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "browser.forward" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "browser.reload" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "browser.navigate", url: "" }).success).toBe(false);
    const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
    expect(ClientMessageSchema.safeParse({ type: "select.picker.select", requestId, value: "masonry" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "select.picker.dismiss", requestId }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "select.picker.select", requestId: "not-a-uuid", value: "masonry" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "select.native.set", enabled: true }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "select.native.set", enabled: "yes" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "captcha.continue", pageId: "page-1" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "captcha.continue", pageId: "" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "session.start", nativeSelects: false }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "session.start" }).success).toBe(false);
    const workflow = createWorkflow("session");
    expect(ClientMessageSchema.safeParse({ type: "replay.start", workflow, nativeSelects: true }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "replay.start", workflow }).success).toBe(false);
  });

  it("runs commands against the active page and emits recoverable page state", async () => {
    let currentUrl = "about:blank";
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const goto = vi.fn(async () => { currentUrl = "https://resolved.example.net/"; return null; });
    const goBack = vi.fn(async () => null);
    const goForward = vi.fn(async () => null);
    const reload = vi.fn(async () => null);
    const page = {
      evaluate: vi.fn(async () => undefined),
      goBack,
      goForward,
      goto,
      mainFrame: vi.fn(() => ({})),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
      reload,
      title: vi.fn(async () => currentUrl === "about:blank" ? "New Tab" : "Example"),
      url: vi.fn(() => currentUrl),
    } as unknown as Page;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      exposeBinding: vi.fn(async () => undefined),
      on: vi.fn(),
      pages: vi.fn(() => [page]),
    } as unknown as BrowserContext;
    const provider: BrowserProvider = {
      connect: vi.fn(async () => ({ browser: { close: vi.fn(async () => undefined) } as unknown as Browser, context })),
      createSession: vi.fn(async () => ({ id: "session", connectUrl: "ws://example.com" })),
      getLiveView: vi.fn(async () => ({ id: "page", title: "New Tab", url: currentUrl, liveViewUrl: "https://example.com/live?navbar=false" })),
      releaseSession: vi.fn(async () => undefined),
    };
    const runtime = new RecordingRuntime(crypto.randomUUID(), provider, vi.fn());
    await runtime.start({ timeoutSeconds: 120, region: "us-west-2" });
    runtime.buffer.splice(0);

    await runtime.navigate("example.com");
    await runtime.goBack();
    await runtime.goForward();
    await runtime.reload();

    expect(goto).toHaveBeenCalledWith("https://example.com/", expect.objectContaining({ waitUntil: "domcontentloaded" }));
    expect(goBack).toHaveBeenCalledOnce();
    expect(goForward).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(runtime.buffer.some((item) => item.message.type === "recording.startUrl" && item.message.url === "https://example.com/")).toBe(true);
    expect(runtime.buffer.some((item) => item.message.type === "browser.page" && item.message.url === "https://resolved.example.net/")).toBe(true);

    goto.mockClear();
    goBack.mockClear();
    goForward.mockClear();
    reload.mockClear();
    handlers.get("console")?.({ text: () => "browserbase-solving-started" });
    await runtime.navigate("blocked.example.com");
    await runtime.goBack();
    await runtime.goForward();
    await runtime.reload();
    expect(goto).not.toHaveBeenCalled();
    expect(goBack).not.toHaveBeenCalled();
    expect(goForward).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    const solvingMessage = runtime.buffer.findLast((item) => item.message.type === "captcha.status" && item.message.status === "solving")?.message;
    if (solvingMessage?.type !== "captcha.status") throw new Error("CAPTCHA lock was not started");
    runtime.continueAfterCaptcha(solvingMessage.pageId);
    await runtime.reload();
    expect(reload).toHaveBeenCalledOnce();

    runtime.buffer.splice(0);
    await runtime.navigate("file:///tmp/private");
    expect(runtime.buffer.at(-1)?.message).toEqual({ type: "browser.navigation.error", message: "Use an HTTP or HTTPS web address." });
    await runtime.release();
  });
});
