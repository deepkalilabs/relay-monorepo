import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@/shared/contracts/protocol";
import { useRecorderSession } from "@/features/recorder";
import { createWorkflow } from "@/shared/contracts/workflow/schema";

const socket = vi.hoisted(() => ({
  onMessage: null as ((message: ServerMessage) => void) | null,
  send: vi.fn(() => true),
}));

vi.mock("../src/features/recorder/transport/useRecorderSocket", () => ({
  useRecorderSocket: (onMessage: (message: ServerMessage) => void) => {
    socket.onMessage = onMessage;
    return { transportStatus: "connected" as const, send: socket.send };
  },
}));

describe("useRecorderSession", () => {
  beforeEach(() => {
    socket.onMessage = null;
    socket.send.mockClear();
  });

  it("forwards session identity and normalized recorded steps to the workspace", () => {
    const onSessionStarted = vi.fn();
    const onReplaySessionStarted = vi.fn();
    const onStartUrl = vi.fn();
    const onStepRecorded = vi.fn();
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted, onReplaySessionStarted, onStartUrl, onStepRecorded }));

    act(() => socket.onMessage?.({
      type: "session.started",
      sessionId: "session-1",
      liveViewUrl: "https://example.com/live",
      pageId: "page-1",
    }));
    act(() => socket.onMessage?.({ type: "recording.startUrl", url: "https://example.com/start" }));
    act(() => socket.onMessage?.({
      type: "recorded.action",
      action: {
        type: "click",
        name: "Click Continue",
        sensitive: false,
        target: { candidates: [{ kind: "role", value: "button", name: "Continue", exact: true }] },
        position: { x: 0, y: 480 },
        page: { id: "page-1", url: "https://example.com" },
        recordedAt: new Date().toISOString(),
      },
    }));

    expect(onSessionStarted).toHaveBeenCalledWith("session-1");
    expect(result.current.startedAt).toEqual(expect.any(Number));
    expect(onStartUrl).toHaveBeenCalledWith("https://example.com/start");
    expect(onStepRecorded).toHaveBeenCalledWith(expect.objectContaining({
      type: "click",
      name: "Click Continue",
      order: 0,
      position: { x: 0, y: 480 },
    }));
  });

  it("opens the parent date picker and sends one semantic selection command", () => {
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted: vi.fn(), onStartUrl: vi.fn(), onStepRecorded: vi.fn() }));
    const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";

    act(() => socket.onMessage?.({
      type: "date.picker.open",
      requestId,
      value: "2026-07-21",
      min: "2026-07-01",
      max: "2026-08-31",
      rect: { x: 100, y: 120, width: 160, height: 32 },
      viewport: { width: 1280, height: 720 },
    }));
    expect(result.current.datePicker?.value).toBe("2026-07-21");

    act(() => result.current.selectDate(requestId, "2026-07-22"));
    expect(result.current.datePicker).toBeNull();
    expect(socket.send).toHaveBeenCalledWith({ type: "date.picker.select", requestId, value: "2026-07-22" });
  });

  it("opens the parent select picker and sends selection and dismissal commands", () => {
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted: vi.fn(), onStartUrl: vi.fn(), onStepRecorded: vi.fn() }));
    const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";

    act(() => socket.onMessage?.({
      type: "select.picker.open",
      requestId,
      name: "Construction type",
      value: "frame",
      options: [
        { value: "frame", label: "Frame", disabled: false },
        { value: "masonry", label: "Masonry", disabled: false },
      ],
      rect: { x: 100, y: 120, width: 240, height: 40 },
      viewport: { width: 1280, height: 720 },
    }));
    expect(result.current.selectPicker?.name).toBe("Construction type");

    act(() => result.current.selectPickerOption(requestId, "masonry"));
    expect(result.current.selectPicker).toBeNull();
    expect(socket.send).toHaveBeenCalledWith({ type: "select.picker.select", requestId, value: "masonry" });

    act(() => socket.onMessage?.({
      type: "select.picker.open",
      requestId,
      name: "Construction type",
      value: "masonry",
      options: [{ value: "masonry", label: "Masonry", disabled: false }],
      rect: { x: 100, y: 120, width: 240, height: 40 },
      viewport: { width: 1280, height: 720 },
    }));
    act(() => result.current.dismissSelectPicker(requestId));
    expect(socket.send).toHaveBeenCalledWith({ type: "select.picker.dismiss", requestId });
  });

  it("starts, receives, and cancels a request-correlated assertion picker", () => {
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted: vi.fn(), onStartUrl: vi.fn(), onStepRecorded: vi.fn() }));
    const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";

    act(() => result.current.startAssertionPick(requestId));
    expect(result.current.assertionPick).toEqual({ status: "picking", requestId });
    expect(socket.send).toHaveBeenCalledWith({ type: "assertion.pick.start", requestId });

    act(() => socket.onMessage?.({
      type: "assertion.pick.selected",
      requestId,
      name: "Ready status",
      text: "Ready for review",
      target: { candidates: [{ kind: "role", value: "status", name: "Ready for review", exact: true }] },
      position: { x: 0, y: 320 },
      page: { id: "page-1", url: "https://example.com", title: "Example" },
    }));
    expect(result.current.assertionPick).toMatchObject({ status: "selected", requestId, name: "Ready status" });

    act(() => result.current.cancelAssertionPick(requestId));
    expect(result.current.assertionPick).toBeNull();
    expect(socket.send).toHaveBeenCalledWith({ type: "assertion.pick.cancel", requestId });
  });

  it("receives a request-correlated repeated-group assertion selection", () => {
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted: vi.fn(), onStartUrl: vi.fn(), onStepRecorded: vi.fn() }));
    const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
    act(() => result.current.startAssertionPick(requestId));

    act(() => socket.onMessage?.({
      type: "assertion.pick.groupSelected",
      requestId,
      name: "Profile card group",
      groupTarget: {
        version: 1,
        algorithm: "structural-token-v1",
        root: { tagName: "article", role: "article", sharedClasses: ["profile-card"] },
        structureTokens: ["0:article:article", "1:header:", "1:section:", "1:footer:"],
        capturedMatchCount: 2,
      },
      position: { x: 0, y: 320 },
      page: { id: "page-1", url: "https://example.com", title: "Example" },
    }));

    expect(result.current.assertionPick).toMatchObject({
      status: "selected",
      kind: "group",
      requestId,
      name: "Profile card group",
      groupTarget: { capturedMatchCount: 2 },
    });
  });

  it("keeps native dropdown mode for the task and includes it in new sessions", () => {
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted: vi.fn(), onStartUrl: vi.fn(), onStepRecorded: vi.fn() }));
    const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
    expect(result.current.nativeSelects).toBe(false);

    act(() => socket.onMessage?.({
      type: "select.picker.open",
      requestId,
      name: "Plan",
      value: "free",
      options: [{ value: "free", label: "Free", disabled: false }],
      rect: { x: 100, y: 120, width: 240, height: 40 },
      viewport: { width: 1280, height: 720 },
    }));
    act(() => result.current.setNativeSelects(true));

    expect(result.current.nativeSelects).toBe(true);
    expect(result.current.selectPicker).toBeNull();
    expect(socket.send).toHaveBeenCalledWith({ type: "select.native.set", enabled: true });

    act(() => result.current.startRecording());
    expect(socket.send).toHaveBeenLastCalledWith({ type: "session.start", nativeSelects: true });
  });

  it("waits for the browser session to stop before resolving a finish request", async () => {
    const { result } = renderHook(() => useRecorderSession({
      onSessionStarted: vi.fn(),
      onReplaySessionStarted: vi.fn(),
      onStartUrl: vi.fn(),
      onStepRecorded: vi.fn(),
    }));
    act(() => result.current.startRecording());

    let resolved = false;
    let stopping!: Promise<void>;
    act(() => {
      stopping = result.current.stopRecordingAndWait().then(() => {
        resolved = true;
      });
    });

    expect(socket.send).toHaveBeenLastCalledWith({ type: "session.stop" });
    expect(resolved).toBe(false);

    act(() => socket.onMessage?.({ type: "session.status", status: "stopped" }));
    await act(async () => stopping);
    expect(resolved).toBe(true);
  });

  it("tracks CAPTCHA state per active page and sends the continue command", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted: vi.fn(), onStartUrl: vi.fn(), onStepRecorded: vi.fn() }));
      act(() => socket.onMessage?.({
        type: "session.started",
        sessionId: "session-1",
        liveViewUrl: "https://example.com/live",
        pageId: "page-1",
      }));
      act(() => socket.onMessage?.({ type: "captcha.status", pageId: "page-1", status: "solving" }));

      expect(result.current.captchaStatus).toBe("solving");
      act(() => result.current.continueAfterCaptcha());
      expect(socket.send).toHaveBeenCalledWith({ type: "captcha.continue", pageId: "page-1" });

      act(() => socket.onMessage?.({ type: "captcha.status", pageId: "page-1", status: "continued" }));
      expect(result.current.captchaStatus).toBe("continued");
      act(() => vi.advanceTimersByTime(4_000));
      expect(result.current.captchaStatus).toBeNull();

      act(() => socket.onMessage?.({ type: "captcha.status", pageId: "popup-1", status: "solving" }));
      expect(result.current.captchaStatus).toBeNull();
      act(() => socket.onMessage?.({ type: "popup.switched", pageId: "popup-1", liveViewUrl: "https://example.com/popup-live" }));
      expect(result.current.captchaStatus).toBe("solving");
      act(() => socket.onMessage?.({ type: "captcha.status", pageId: "popup-1", status: "cancelled" }));
      expect(result.current.captchaStatus).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears CAPTCHA state when replay replaces the recording session", () => {
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted: vi.fn(), onStartUrl: vi.fn(), onStepRecorded: vi.fn() }));
    const runId = "c7daf0b9-d92a-44db-9967-db33d1516976";
    act(() => socket.onMessage?.({ type: "session.started", sessionId: "session-1", liveViewUrl: "https://example.com/live", pageId: "page-1" }));
    act(() => socket.onMessage?.({ type: "captcha.status", pageId: "page-1", status: "solving" }));
    expect(result.current.captchaStatus).toBe("solving");

    act(() => socket.onMessage?.({ type: "replay.started", runId, sessionId: "session-2", liveViewUrl: "https://example.com/replay", pageId: "page-2", totalSteps: 1 }));
    expect(result.current.captchaStatus).toBeNull();
  });

  it("tracks replay progress and exposes recovery commands", () => {
    const onReplayStepChange = vi.fn();
    const onReplaySessionStarted = vi.fn();
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted, onStartUrl: vi.fn(), onStepRecorded: vi.fn(), onReplayStepChange }));
    const runId = "c7daf0b9-d92a-44db-9967-db33d1516976";

    act(() => socket.onMessage?.({ type: "replay.status", runId, status: "running", currentStepId: "step-1", currentIndex: 0, totalSteps: 2 }));
    act(() => socket.onMessage?.({ type: "replay.started", runId, sessionId: "session-2", liveViewUrl: "https://example.com/live", pageId: "page-1", totalSteps: 2 }));
    act(() => socket.onMessage?.({
      type: "replay.step",
      runId,
      stepId: "step-1",
      status: "failed",
      phase: "waiting",
      durationMs: 42,
      diagnostic: { message: "No visible match", attemptedLocators: [{ kind: "role", reason: "No match." }] },
    }));

    expect(result.current.replayStatus).toBe("running");
    expect(result.current.displayStatus).toBe("recording");
    expect(onReplaySessionStarted).toHaveBeenCalledWith("session-2");
    expect(result.current.replayResults["step-1"]).toMatchObject({ status: "failed", phase: "waiting", durationMs: 42 });
    expect(onReplayStepChange).toHaveBeenCalledWith("step-1", "failed");
    act(() => result.current.retryReplay());
    act(() => result.current.skipReplay());
    act(() => result.current.takeControlOfReplay());
    expect(socket.send).toHaveBeenCalledWith({ type: "replay.retry" });
    expect(socket.send).toHaveBeenCalledWith({ type: "replay.skip" });
    expect(socket.send).toHaveBeenCalledWith({ type: "replay.takeControl" });

    act(() => socket.onMessage?.({ type: "replay.status", runId, status: "stopped", totalSteps: 2 }));
    expect(result.current.liveViewUrl).toBe("https://example.com/live");
  });

  it("starts replay with the current native dropdown preference", () => {
    const { result } = renderHook(() => useRecorderSession({ onSessionStarted: vi.fn(), onReplaySessionStarted: vi.fn(), onStartUrl: vi.fn(), onStepRecorded: vi.fn() }));
    const workflow = createWorkflow("session-1");

    act(() => result.current.startReplay(workflow));
    expect(socket.send).toHaveBeenLastCalledWith({ type: "replay.start", workflow, startStepId: undefined, nativeSelects: false });
  });
});
