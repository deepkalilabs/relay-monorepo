"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRecorderSocket } from "../transport/useRecorderSocket";
import type {
  AssertionPickState,
  BrowserPageState,
  CaptchaStatus,
  ClientMessage,
  DatePickerState,
  PopupState,
  ReplayStatus,
  ReplayStepResultState,
  SelectPickerState,
  ServerMessage,
} from "@/shared/contracts/protocol";
import type { Workflow, WorkflowStep } from "@/shared/contracts/workflow/domain";
import type { RecordingStatus } from "./recorder.types";
import { getDisplayError, getDisplayStatus } from "./session.selectors";
import { stepFromRecordedAction } from "./stepFromRecordedAction";

interface RecorderSessionOptions {
  onSessionStarted: (sessionId: string) => void;
  onReplaySessionStarted: (sessionId: string) => void;
  onStartUrl: (url: string) => void;
  onStepRecorded: (step: WorkflowStep) => void;
  onReplayStepChange?: (stepId: string, status: ReplayStepResultState["status"]) => void;
}

export function useRecorderSession({ onSessionStarted, onReplaySessionStarted, onStartUrl, onStepRecorded, onReplayStepChange }: RecorderSessionOptions) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [browserPage, setBrowserPage] = useState<BrowserPageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorContext, setErrorContext] = useState<"recording" | "replay">("recording");
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [datePicker, setDatePicker] = useState<DatePickerState | null>(null);
  const [selectPicker, setSelectPicker] = useState<SelectPickerState | null>(null);
  const [assertionPick, setAssertionPick] = useState<AssertionPickState | null>(null);
  const [nativeSelects, setNativeSelectsState] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>("idle");
  const [replayRunId, setReplayRunId] = useState<string | null>(null);
  const [replayCurrentStepId, setReplayCurrentStepId] = useState<string | null>(null);
  const [replayCurrentIndex, setReplayCurrentIndex] = useState(0);
  const [replayTotalSteps, setReplayTotalSteps] = useState(0);
  const [replayResults, setReplayResults] = useState<Record<string, ReplayStepResultState>>({});
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [captchaStatuses, setCaptchaStatuses] = useState<Record<string, CaptchaStatus>>({});
  const captchaNoticeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const stopWaiter = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);

  const settleStopWaiter = useCallback((error?: Error) => {
    const waiter = stopWaiter.current;
    if (!waiter) return;
    stopWaiter.current = null;
    clearTimeout(waiter.timeout);
    if (error) waiter.reject(error);
    else waiter.resolve();
  }, []);

  const resetCaptchaState = useCallback(() => {
    for (const timer of captchaNoticeTimers.current.values()) clearTimeout(timer);
    captchaNoticeTimers.current.clear();
    setCaptchaStatuses({});
    setActivePageId(null);
  }, []);

  useEffect(() => () => {
    for (const timer of captchaNoticeTimers.current.values()) clearTimeout(timer);
    captchaNoticeTimers.current.clear();
    settleStopWaiter();
  }, [settleStopWaiter]);

  const handleServerMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case "server.ready":
        setStatus((current) => message.configured ? (current === "configurationMissing" ? "idle" : current) : "configurationMissing");
        break;
      case "session.started":
        onSessionStarted(message.sessionId);
        resetCaptchaState();
        setActivePageId(message.pageId);
        setLiveViewUrl(message.liveViewUrl);
        setBrowserPage(null);
        setNavigationError(null);
        setNavigationPending(false);
        setDatePicker(null);
        setSelectPicker(null);
        setAssertionPick(null);
        setStartedAt(Date.now());
        setError(null);
        setErrorContext("recording");
        break;
      case "session.status":
        setStatus(message.status);
        if (message.status === "stopped") {
          settleStopWaiter();
          resetCaptchaState();
          setStartedAt(null);
          setNavigationPending(false);
          setNavigationError(null);
          setBrowserPage(null);
          setLiveViewUrl(null);
          setDatePicker(null);
          setSelectPicker(null);
          setAssertionPick(null);
        }
        break;
      case "recording.startUrl":
        onStartUrl(message.url);
        break;
      case "recorded.action":
        onStepRecorded(stepFromRecordedAction(message.action, 0));
        break;
      case "popup.detected":
        setPopup({ pageId: message.pageId, title: message.title, url: message.url });
        break;
      case "popup.switched":
        setActivePageId(message.pageId);
        setLiveViewUrl(message.liveViewUrl);
        setBrowserPage(null);
        setPopup(null);
        setDatePicker(null);
        setSelectPicker(null);
        setAssertionPick(null);
        break;
      case "browser.page":
        setActivePageId(message.pageId);
        setBrowserPage({ pageId: message.pageId, title: message.title, url: message.url });
        setNavigationError(null);
        setNavigationPending(false);
        break;
      case "browser.navigation.error":
        setNavigationError(message.message);
        setNavigationPending(false);
        break;
      case "date.picker.open":
        setSelectPicker(null);
        setDatePicker({
          requestId: message.requestId,
          value: message.value,
          min: message.min,
          max: message.max,
          rect: message.rect,
          viewport: message.viewport,
        });
        break;
      case "date.picker.closed":
        setDatePicker((current) => current?.requestId === message.requestId ? null : current);
        break;
      case "select.picker.open":
        setDatePicker(null);
        setSelectPicker({
          requestId: message.requestId,
          name: message.name,
          value: message.value,
          options: message.options,
          rect: message.rect,
          viewport: message.viewport,
        });
        break;
      case "select.picker.closed":
        setSelectPicker((current) => current?.requestId === message.requestId ? null : current);
        break;
      case "assertion.pick.selected":
        setAssertionPick((current) => current?.requestId === message.requestId
          ? {
              status: "selected",
              kind: "element",
              requestId: message.requestId,
              name: message.name,
              text: message.text,
              target: message.target,
              position: message.position,
              page: message.page,
            }
          : current);
        break;
      case "assertion.pick.groupSelected":
        setAssertionPick((current) => current?.requestId === message.requestId
          ? {
              status: "selected",
              kind: "group",
              requestId: message.requestId,
              name: message.name,
              groupTarget: message.groupTarget,
              position: message.position,
              page: message.page,
            }
          : current);
        break;
      case "assertion.pick.cancelled":
        setAssertionPick((current) => current?.requestId === message.requestId ? null : current);
        break;
      case "captcha.status": {
        const existingTimer = captchaNoticeTimers.current.get(message.pageId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          captchaNoticeTimers.current.delete(message.pageId);
        }
        if (message.status === "cancelled") {
          setCaptchaStatuses((current) => {
            const next = { ...current };
            delete next[message.pageId];
            return next;
          });
          break;
        }
        setCaptchaStatuses((current) => ({ ...current, [message.pageId]: message.status }));
        if (message.status === "solving") {
          setDatePicker(null);
          setSelectPicker(null);
          setAssertionPick(null);
          break;
        }
        const timer = setTimeout(() => {
          captchaNoticeTimers.current.delete(message.pageId);
          setCaptchaStatuses((current) => {
            if (current[message.pageId] !== message.status) return current;
            const next = { ...current };
            delete next[message.pageId];
            return next;
          });
        }, 4_000);
        captchaNoticeTimers.current.set(message.pageId, timer);
        break;
      }
      case "replay.started":
        resetCaptchaState();
        setActivePageId(message.pageId);
        onReplaySessionStarted(message.sessionId);
        setReplayRunId(message.runId);
        setReplayTotalSteps(message.totalSteps);
        setLiveViewUrl(message.liveViewUrl);
        setBrowserPage(null);
        setStatus("recording");
        setStartedAt((current) => current ?? Date.now());
        setError(null);
        setErrorContext("replay");
        setNavigationError(null);
        setNavigationPending(false);
        setPopup(null);
        setDatePicker(null);
        setSelectPicker(null);
        setAssertionPick(null);
        break;
      case "replay.status":
        setReplayRunId(message.runId);
        setReplayStatus(message.status);
        setReplayTotalSteps(message.totalSteps);
        setReplayCurrentStepId(message.currentStepId ?? null);
        setReplayCurrentIndex(message.currentIndex ?? 0);
        if (message.status === "stopped") {
          setReplayRunId(null);
          setReplayCurrentStepId(null);
        }
        break;
      case "replay.step":
        setReplayResults((current) => ({
          ...current,
          [message.stepId]: {
            status: message.status,
            phase: message.phase,
            durationMs: message.durationMs,
            locatorKind: message.locatorKind,
            diagnostic: message.diagnostic,
          },
        }));
        onReplayStepChange?.(message.stepId, message.status);
        break;
      case "buffer.gap":
        setError("Some events could not be recovered after the connection interruption. Stop and review this workflow before exporting.");
        break;
      case "server.error":
        settleStopWaiter(new Error(message.message));
        resetCaptchaState();
        setNavigationPending(false);
        if (message.code === "INVALID_MESSAGE" && liveViewUrl) {
          setNavigationError(message.message);
          break;
        }
        setError(message.message);
        if (replayStatus !== "idle" && replayStatus !== "stopped") {
          setErrorContext("replay");
          setReplayStatus("stopped");
        }
        else setStatus("error");
        break;
    }
  }, [liveViewUrl, onReplaySessionStarted, onReplayStepChange, onSessionStarted, onStartUrl, onStepRecorded, replayStatus, resetCaptchaState, settleStopWaiter]);

  const { transportStatus, send } = useRecorderSocket(handleServerMessage);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data !== "browserbase-disconnected") return;
      setStatus("error");
      setError("Browserbase ended the Live View connection. The workflow recorded so far is preserved.");
      setLiveViewUrl(null);
      setBrowserPage(null);
      setDatePicker(null);
      setSelectPicker(null);
      setNavigationPending(false);
      resetCaptchaState();
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [resetCaptchaState]);

  const resetSessionState = () => {
    resetCaptchaState();
    setStatus("starting");
    setError(null);
    setErrorContext("recording");
    setNavigationError(null);
    setNavigationPending(false);
    setBrowserPage(null);
    setPopup(null);
    setLiveViewUrl(null);
    setDatePicker(null);
    setSelectPicker(null);
    setAssertionPick(null);
  };

  const sessionStartCommand = (): ClientMessage => ({
    type: status === "error" || liveViewUrl ? "session.restart" : "session.start",
    nativeSelects,
  });

  const startRecording = () => {
    const command = sessionStartCommand();
    resetSessionState();
    if (!send(command)) {
      setStatus("error");
      setError("The recorder is not connected yet. Wait a moment and retry.");
    }
  };

  const stopRecording = () => {
    setStatus("stopping");
    send({ type: "session.stop" });
  };

  const stopRecordingAndWait = () => {
    if (["idle", "stopped", "error", "configurationMissing"].includes(status)) {
      return Promise.resolve();
    }
    if (stopWaiter.current) {
      return Promise.reject(new Error("The browser session is already stopping."));
    }
    setStatus("stopping");
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        settleStopWaiter(new Error("The browser session did not stop in time."));
      }, 15_000);
      stopWaiter.current = { resolve, reject, timeout };
      if (!send({ type: "session.stop" })) {
        settleStopWaiter(new Error("The recorder connection is unavailable."));
      }
    });
  };

  const startReplay = (workflow: Workflow, startStepId?: string) => {
    setReplayStatus("preparing");
    setReplayRunId(null);
    setReplayCurrentStepId(null);
    setReplayCurrentIndex(0);
    setReplayTotalSteps(workflow.steps.slice(startStepId ? workflow.steps.findIndex((step) => step.id === startStepId) : 0).length);
    const startIndex = startStepId ? workflow.steps.findIndex((step) => step.id === startStepId) : 0;
    setReplayResults(Object.fromEntries(workflow.steps.slice(Math.max(0, startIndex)).map((step) => [step.id, { status: "pending" as const }])));
    setError(null);
    setErrorContext("replay");
    setPopup(null);
    setDatePicker(null);
    setSelectPicker(null);
    if (!send({ type: "replay.start", workflow, startStepId, nativeSelects })) {
      setReplayStatus("stopped");
      setError("The recorder connection is unavailable. Wait a moment and try again.");
    }
  };

  const sendBrowserCommand = (command: ClientMessage) => {
    setNavigationError(null);
    if (send(command)) {
      setNavigationPending(true);
      return;
    }
    setNavigationPending(false);
    setNavigationError("The recorder connection is unavailable. Wait a moment and try again.");
  };

  const displayStatus = getDisplayStatus(status, transportStatus);
  const displayError = getDisplayError(status, transportStatus, error);
  const captchaStatus = transportStatus === "offline" || !activePageId ? null : captchaStatuses[activePageId] ?? null;
  const selectDate = useCallback((requestId: string, value: string) => {
    setDatePicker((current) => current?.requestId === requestId ? null : current);
    send({ type: "date.picker.select", requestId, value });
  }, [send]);
  const dismissDatePicker = useCallback((requestId: string) => {
    setDatePicker((current) => current?.requestId === requestId ? null : current);
    send({ type: "date.picker.dismiss", requestId });
  }, [send]);
  const selectPickerOption = useCallback((requestId: string, value: string) => {
    setSelectPicker((current) => current?.requestId === requestId ? null : current);
    send({ type: "select.picker.select", requestId, value });
  }, [send]);
  const dismissSelectPicker = useCallback((requestId: string) => {
    setSelectPicker((current) => current?.requestId === requestId ? null : current);
    send({ type: "select.picker.dismiss", requestId });
  }, [send]);
  const setNativeSelects = useCallback((enabled: boolean) => {
    setNativeSelectsState(enabled);
    if (enabled) setSelectPicker(null);
    send({ type: "select.native.set", enabled });
  }, [send]);
  const startAssertionPick = useCallback((requestId: string) => {
    setAssertionPick({ status: "picking", requestId });
    if (send({ type: "assertion.pick.start", requestId })) return true;
    setAssertionPick(null);
    return false;
  }, [send]);
  const cancelAssertionPick = useCallback((requestId: string) => {
    setAssertionPick((current) => current?.requestId === requestId ? null : current);
    return send({ type: "assertion.pick.cancel", requestId });
  }, [send]);

  return {
    assertionPick,
    browserPage,
    captchaPageId: activePageId,
    captchaStatus,
    datePicker,
    displayError,
    errorContext,
    displayStatus,
    startedAt,
    liveViewUrl,
    navigationError,
    navigationPending,
    popup,
    replayCurrentIndex,
    replayCurrentStepId,
    replayResults,
    replayRunId,
    replayStatus,
    replayTotalSteps,
    nativeSelects,
    selectPicker,
    reportError: setError,
    clearError: () => setError(null),
    continueAfterCaptcha: () => activePageId ? send({ type: "captcha.continue", pageId: activePageId }) : false,
    sendBrowserCommand,
    selectDate,
    dismissDatePicker,
    selectPickerOption,
    dismissSelectPicker,
    setNativeSelects,
    startAssertionPick,
    cancelAssertionPick,
    startReplay,
    startRecording,
    stopRecording,
    stopRecordingAndWait,
    switchPopup: (pageId: string) => send({ type: "popup.switch", pageId }),
    pauseReplay: () => send({ type: "replay.pause" }),
    resumeReplay: () => send({ type: "replay.resume" }),
    retryReplay: () => send({ type: "replay.retry" }),
    skipReplay: () => send({ type: "replay.skip" }),
    takeControlOfReplay: () => send({ type: "replay.takeControl" }),
    stopReplay: () => send({ type: "replay.stop" }),
    transportStatus,
  };
}
