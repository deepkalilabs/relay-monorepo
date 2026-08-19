"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BrowserActions, BrowserPanelAlert, BrowserViewModel } from "@/features/browser";
import { profileClient } from "@/features/profile";
import { useRecorderSession } from "@/features/recorder";
import {
  downloadWorkflow,
  initialWorkflowState,
  WorkflowRequestError,
  workflowEditorClient,
  workflowReducer,
} from "@/features/workflow-editor";
import type { ReplayStepResultState } from "@/shared/contracts/protocol";
import type { Profile } from "@/shared/contracts/profile";
import type { WorkflowStep } from "@/shared/contracts/workflow/domain";
import { resolveWorkflowParameters } from "@/shared/contracts/workflow/parameters";
import { WorkflowSchema } from "@/shared/contracts/workflow/schema";
import { useWorkspacePanels } from "./useWorkspacePanels";

type Confirmation = "sensitiveExport" | null;
type PersistenceStatus = "loading" | "ready" | "saving" | "error" | "conflict";

export function useWorkspaceController(workflowId: string, profileId = "", autoRun = false) {
  const router = useRouter();
  const [workflowState, dispatch] = useReducer(workflowReducer, undefined, initialWorkflowState);
  const workflowStateRef = useRef(workflowState);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pendingReplayStartId, setPendingReplayStartId] = useState<string | undefined>();
  const [runtimeValues, setRuntimeValues] = useState<Record<string, string>>({});
  const [runProfile, setRunProfile] = useState<Profile | null>(null);
  const [runProfileStatus, setRunProfileStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [runProfileError, setRunProfileError] = useState<string | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>("loading");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [workflowLoaded, setWorkflowLoaded] = useState(false);
  const autoRunRequested = useRef(false);
  const runProfileRequestId = useRef(0);

  useEffect(() => {
    workflowStateRef.current = workflowState;
  }, [workflowState]);

  useEffect(() => {
    autoRunRequested.current = false;
  }, [workflowId]);

  const onSessionStarted = useCallback((sessionId: string) => {
    dispatch({ type: "setSessionId", sessionId });
  }, []);
  const onReplaySessionStarted = useCallback((sessionId: string) => {
    dispatch({ type: "setSessionId", sessionId });
  }, []);
  const onStepRecorded = useCallback((step: WorkflowStep) => {
    dispatch({ type: "append", step });
    setAnnouncement(`${step.name} added to the workflow.`);
  }, []);
  const onStartUrl = useCallback((url: string) => {
    dispatch({ type: "setStartUrl", url });
  }, []);
  const onReplayStepChange = useCallback((stepId: string, status: ReplayStepResultState["status"]) => {
    if (status === "running" || status === "failed") dispatch({ type: "select", id: stepId });
    setAnnouncement(`Replay step ${status}.`);
  }, []);

  const session = useRecorderSession({
    onSessionStarted,
    onReplaySessionStarted,
    onStartUrl,
    onStepRecorded,
    onReplayStepChange,
  });
  const replayLocked = ["preparing", "running", "pausing", "paused", "manual", "stopping"].includes(
    session.replayStatus,
  );
  const captchaLocked = session.captchaStatus === "solving";
  const assertionPicking = session.assertionPick?.status === "picking";
  const assertionSelection = session.assertionPick?.status === "selected" ? session.assertionPick : null;
  const assertionAvailable = Boolean(
    session.liveViewUrl
    && session.transportStatus === "connected"
    && ["recording", "reconnecting"].includes(session.displayStatus)
    && !captchaLocked
    && !replayLocked,
  );
  const persistenceLocked = persistenceStatus === "loading" || persistenceStatus === "saving";
  const workflowLocked = replayLocked || captchaLocked || persistenceLocked || assertionPicking;
  const panels = useWorkspacePanels({
    selectedStepId: workflowState.selectedStepId,
    overlayOpen: Boolean(confirmation || runDialogOpen || assertionSelection),
  });

  const loadSavedWorkflow = useCallback(async () => {
    setWorkflowLoaded(false);
    setPersistenceStatus("loading");
    setPersistenceError(null);
    try {
      const workflow = await workflowEditorClient.get(workflowId);
      dispatch({ type: "load", workflow });
      setWorkflowLoaded(true);
      setPersistenceStatus("ready");
      setAnnouncement(`${workflow.name} loaded.`);
    } catch (error) {
      setPersistenceStatus("error");
      setPersistenceError(error instanceof Error ? error.message : "The workflow could not be loaded.");
    }
  }, [workflowId]);

  useEffect(() => {
    let active = true;
    workflowEditorClient.get(workflowId).then(
      (workflow) => {
        if (!active) return;
        dispatch({ type: "load", workflow });
        setWorkflowLoaded(true);
        setPersistenceStatus("ready");
        setPersistenceError(null);
        setAnnouncement(`${workflow.name} loaded.`);
      },
      (error: unknown) => {
        if (!active) return;
        setPersistenceStatus("error");
        setPersistenceError(error instanceof Error ? error.message : "The workflow could not be loaded.");
      },
    );
    return () => {
      active = false;
    };
  }, [workflowId]);

  useEffect(() => {
    if (!workflowState.deletedStep) return;
    const timeout = window.setTimeout(() => dispatch({ type: "dismissDelete" }), 5_000);
    return () => window.clearTimeout(timeout);
  }, [workflowState.deletedStep]);

  useEffect(() => {
    if (!captchaLocked) return;
    const timeout = window.setTimeout(() => {
      setRunDialogOpen(false);
      setConfirmation(null);
      setPendingReplayStartId(undefined);
      setRuntimeValues({});
      runProfileRequestId.current += 1;
      setRunProfile(null);
      setRunProfileStatus("idle");
      setRunProfileError(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [captchaLocked]);

  const beginRecording = () => session.startRecording();

  const beginAssertionPick = () => {
    if (!assertionAvailable) return;
    const requestId = crypto.randomUUID();
    if (!session.startAssertionPick(requestId)) {
      setAnnouncement("The assertion picker could not start.");
    }
  };

  const closeAssertionPick = () => {
    const current = session.assertionPick;
    if (current) session.cancelAssertionPick(current.requestId);
  };

  const closeRunDialog = () => {
    setRunDialogOpen(false);
    setPendingReplayStartId(undefined);
    setRuntimeValues({});
    runProfileRequestId.current += 1;
    setRunProfile(null);
    setRunProfileStatus("idle");
    setRunProfileError(null);
  };

  const rangeNeedsProfile = useCallback((startStepId?: string) => {
    const startIndex = startStepId
      ? workflowStateRef.current.workflow.steps.findIndex((step) => step.id === startStepId)
      : 0;
    return workflowStateRef.current.workflow.steps.slice(Math.max(0, startIndex)).some((step) => (
      step.enabled && step.type === "fill" && step.parameterBinding.source === "profile"
    ));
  }, []);

  const loadRunProfile = useCallback(async () => {
    if (!profileId) return;
    const requestId = ++runProfileRequestId.current;
    setRunProfile(null);
    setRunProfileStatus("loading");
    setRunProfileError(null);
    try {
      const loaded = await profileClient.get(profileId);
      if (requestId !== runProfileRequestId.current) return;
      setRunProfile(loaded);
      setRunProfileStatus("ready");
    } catch (error) {
      if (requestId !== runProfileRequestId.current) return;
      setRunProfileStatus("error");
      setRunProfileError(error instanceof Error ? error.message : "The selected profile could not be loaded.");
    }
  }, [profileId]);

  const requestReplay = useCallback((startStepId?: string) => {
    setPendingReplayStartId(startStepId);
    setRuntimeValues({});
    setRunProfile(null);
    setRunProfileError(null);
    if (rangeNeedsProfile(startStepId) && profileId) void loadRunProfile();
    else {
      runProfileRequestId.current += 1;
      setRunProfileStatus("idle");
    }
    setRunDialogOpen(true);
  }, [loadRunProfile, profileId, rangeNeedsProfile]);

  useEffect(() => {
    if (!autoRun || !workflowLoaded || autoRunRequested.current) return;
    autoRunRequested.current = true;
    requestReplay();
  }, [autoRun, requestReplay, workflowLoaded]);

  const startReplayNow = () => {
    const startStepId = pendingReplayStartId;
    const parameterResult = resolveWorkflowParameters(workflowState.workflow, {
      profile: runProfile,
      runtimeValues,
      startStepId,
    });
    if (!parameterResult.resolvedWorkflow) return;
    setRunDialogOpen(false);
    setPendingReplayStartId(undefined);
    setRuntimeValues({});
    runProfileRequestId.current += 1;
    setRunProfile(null);
    setRunProfileStatus("idle");
    setRunProfileError(null);
    session.startReplay(parameterResult.resolvedWorkflow, startStepId);
  };

  const exportNow = () => {
    const parsed = WorkflowSchema.safeParse(workflowState.workflow);
    if (!parsed.success) {
      session.reportError(`Workflow export is blocked: ${parsed.error.issues[0]?.message}`);
      return;
    }
    downloadWorkflow(parsed.data);
    setConfirmation(null);
    setAnnouncement("Workflow JSON downloaded.");
  };

  const requestExport = () => {
    if (workflowState.workflow.steps.some((step) => step.metadata.sensitive)) {
      setConfirmation("sensitiveExport");
    } else {
      exportNow();
    }
  };

  const saveWorkflow = async () => {
    const baseWorkflow = workflowState.workflow;
    const parsed = WorkflowSchema.safeParse(baseWorkflow);
    if (!parsed.success) {
      setPersistenceStatus("error");
      setPersistenceError(`Workflow save is blocked: ${parsed.error.issues[0]?.message}`);
      return;
    }
    setPersistenceStatus("saving");
    setPersistenceError(null);
    try {
      const saved = await workflowEditorClient.save(workflowId, parsed.data, parsed.data.revision);
      dispatch({ type: "saved", workflow: saved, baseWorkflow });
      setPersistenceStatus("ready");
      setAnnouncement("Workflow saved.");
    } catch (error) {
      const conflict = error instanceof WorkflowRequestError && error.status === 409;
      setPersistenceStatus(conflict ? "conflict" : "error");
      setPersistenceError(error instanceof Error ? error.message : "The workflow could not be saved.");
    }
  };

  const finishWorkflow = async () => {
    if (!workflowState.workflow.steps.length) {
      setPersistenceStatus("error");
      setPersistenceError("Add at least one step before finishing this workflow.");
      return;
    }
    setPersistenceStatus("saving");
    setPersistenceError(null);
    try {
      await session.stopRecordingAndWait();
      const baseWorkflow = workflowStateRef.current.workflow;
      const parsed = WorkflowSchema.safeParse(baseWorkflow);
      if (!parsed.success) {
        setPersistenceStatus("error");
        setPersistenceError(`Workflow finish is blocked: ${parsed.error.issues[0]?.message}`);
        return;
      }
      const saved = await workflowEditorClient.finish(workflowId, parsed.data, parsed.data.revision);
      dispatch({ type: "saved", workflow: saved, baseWorkflow });
      setAnnouncement("Recording finished.");
      router.push(`/library?selected=${encodeURIComponent(saved.id)}`);
    } catch (error) {
      const conflict = error instanceof WorkflowRequestError && error.status === 409;
      setPersistenceStatus(conflict ? "conflict" : "error");
      setPersistenceError(error instanceof Error ? error.message : "The workflow could not be finished.");
    }
  };

  const selectedStep = useMemo(
    () => workflowState.workflow.steps.find((step) => step.id === workflowState.selectedStepId) ?? null,
    [workflowState.workflow.steps, workflowState.selectedStepId],
  );
  const pendingReplayStep = useMemo(
    () => workflowState.workflow.steps.find((step) => step.id === pendingReplayStartId),
    [pendingReplayStartId, workflowState.workflow.steps],
  );
  const pendingReplayRange = useMemo(() => {
    const startIndex = pendingReplayStartId
      ? workflowState.workflow.steps.findIndex((step) => step.id === pendingReplayStartId)
      : 0;
    return workflowState.workflow.steps.slice(Math.max(0, startIndex));
  }, [pendingReplayStartId, workflowState.workflow.steps]);
  const pendingNeedsProfile = pendingReplayRange.some((step) => (
    step.enabled && step.type === "fill" && step.parameterBinding.source === "profile"
  ));
  const replayParameterResult = useMemo(() => resolveWorkflowParameters(workflowState.workflow, {
    profile: runProfile,
    runtimeValues,
    startStepId: pendingReplayStartId,
  }), [pendingReplayStartId, runProfile, runtimeValues, workflowState.workflow]);
  const runtimeFields = pendingReplayRange.flatMap((step) => (
    step.enabled && step.type === "fill" && step.parameterBinding.source === "runtime"
      ? [{
          id: step.id,
          name: step.name,
          value: runtimeValues[step.id] ?? "",
          sensitive: step.metadata.sensitive,
        }]
      : []
  ));
  const firstBlockingResolution = Object.values(replayParameterResult.resolutions).find((resolution) => (
    resolution.status === "missing-fixed"
    || resolution.status === "missing-profile"
    || resolution.status === "invalid-runtime"
  ));
  const replayBlockedReason = pendingNeedsProfile && !profileId
    ? "Choose a run profile from the Library before replaying this workflow."
    : pendingNeedsProfile && runProfileStatus === "loading"
      ? "Loading the selected run profile…"
      : pendingNeedsProfile && runProfileStatus === "error"
        ? (runProfileError ?? "The selected profile could not be loaded.")
        : firstBlockingResolution?.status === "missing-profile"
          ? "The selected profile is missing a value required by this workflow."
          : firstBlockingResolution?.status === "missing-fixed"
            ? "A fixed parameter value is empty. Configure it in the Library before replaying."
            : firstBlockingResolution?.status === "invalid-runtime"
              ? "A runtime value exceeds 10,000 characters."
              : undefined;
  const workflowContainsSensitiveValues = useMemo(
    () => pendingReplayRange.some((step) => step.enabled && step.metadata.sensitive),
    [pendingReplayRange],
  );
  const replayReadyCount = workflowState.workflow.steps.length;
  const browserModel: BrowserViewModel = {
    page: session.browserPage,
    liveViewUrl: session.liveViewUrl,
    popup: session.popup,
    datePicker: session.datePicker,
    selectPicker: session.selectPicker,
    captchaStatus: session.captchaStatus,
    nativeSelects: session.nativeSelects,
    nativeSelectsEnabled: Boolean(
      !captchaLocked
      && !assertionPicking
      && session.liveViewUrl
      && session.transportStatus === "connected"
      && !["preparing", "running", "pausing", "paused", "stopping"].includes(session.replayStatus),
    ),
    preparing: session.displayStatus === "starting" || session.replayStatus === "preparing",
    reconnecting: session.displayStatus === "reconnecting",
    restoreFocusAfterCaptcha: ["recording", "reconnecting"].includes(session.displayStatus),
    navigation: {
      enabled: Boolean(
      !captchaLocked
        && !assertionPicking
        && session.liveViewUrl
        && !session.navigationPending
        && (
          ["recording", "reconnecting"].includes(session.displayStatus)
          || session.replayStatus === "manual"
        ),
      ),
      pending: session.navigationPending,
      error: session.navigationError,
    },
  };
  const browserActions: BrowserActions = {
    goBack: () => session.sendBrowserCommand({ type: "browser.back" }),
    goForward: () => session.sendBrowserCommand({ type: "browser.forward" }),
    navigate: (url) => session.sendBrowserCommand({ type: "browser.navigate", url }),
    reload: () => session.sendBrowserCommand({ type: "browser.reload" }),
    switchPopup: session.switchPopup,
    selectDate: session.selectDate,
    dismissDatePicker: session.dismissDatePicker,
    selectPickerOption: session.selectPickerOption,
    dismissSelectPicker: session.dismissSelectPicker,
    setNativeSelects: session.setNativeSelects,
    continueAfterCaptcha: session.continueAfterCaptcha,
  };
  const browserAlert: BrowserPanelAlert | null = session.displayError
    ? {
        title: session.errorContext === "replay"
          ? "Replay needs attention"
          : "Browser session needs attention",
        message: session.displayError,
        actionLabel: session.errorContext === "replay" ? "Review workflow" : "Try a new recording",
        onAction: session.errorContext === "replay" ? session.clearError : beginRecording,
      }
    : null;
  const replayCurrentResult = session.replayCurrentStepId
    ? session.replayResults[session.replayCurrentStepId]
    : undefined;

  return {
    browser: {
      actions: browserActions,
      alert: browserAlert,
      emptyState: {
        title: replayReadyCount ? "Workflow ready to replay" : "Start with a fresh cloud browser",
        description: replayReadyCount
          ? `${replayReadyCount} steps are loaded. Replay them, then keep recording in the same browser.`
          : "Your interactions become structured, editable workflow steps in real time.",
        replayReadyCount,
        replayDisabled: (
          session.displayStatus === "configurationMissing"
          || session.transportStatus === "offline"
          || !["idle", "stopped", "error"].includes(session.displayStatus)
        ),
        startDisabled: (
          session.displayStatus === "configurationMissing"
          || session.transportStatus === "offline"
        ),
      },
      model: browserModel,
    },
    recorder: {
      actions: {
        start: beginRecording,
        stop: session.stopRecording,
      },
      model: {
        startedAt: session.startedAt,
        status: session.displayStatus,
        transportStatus: session.transportStatus,
      },
    },
    replay: {
      actions: {
        pause: session.pauseReplay,
        request: requestReplay,
        resume: session.resumeReplay,
        retry: session.retryReplay,
        skip: session.skipReplay,
        start: startReplayNow,
        stop: session.stopReplay,
        takeControl: session.takeControlOfReplay,
      },
      model: {
        currentIndex: session.replayCurrentIndex,
        currentResult: replayCurrentResult,
        locked: replayLocked,
        results: session.replayResults,
        status: session.replayStatus,
        totalSteps: session.replayTotalSteps,
      },
    },
    workflow: {
      actions: {
        deleteStep: (id: string) => dispatch({ type: "delete", id }),
        dismissDelete: () => dispatch({ type: "dismissDelete" }),
        insertStep: (step: WorkflowStep) => dispatch({
          type: "insert",
          step,
          afterId: workflowState.selectedStepId ?? undefined,
        }),
        rename: (name: string) => dispatch({ type: "renameWorkflow", name }),
        reorderSteps: (activeId: string, overId: string) => dispatch({ type: "reorder", activeId, overId }),
        requestExport,
        reload: loadSavedWorkflow,
        save: saveWorkflow,
        finish: finishWorkflow,
        selectStep: (id: string) => {
          dispatch({ type: "select", id });
          panels.setInspectorCollapsed(false);
        },
        toggleStep: (step: WorkflowStep) => dispatch({ type: "update", step }),
        undoDelete: () => dispatch({ type: "undoDelete" }),
        updateStep: (step: WorkflowStep) => dispatch({ type: "update", step }),
      },
      model: {
        locked: workflowLocked,
        loaded: workflowLoaded,
        persistenceError,
        persistenceStatus,
        reviewLocked: captchaLocked,
        selectedStep,
        state: workflowState,
      },
    },
    layout: {
      actions: {
        beginPanelResize: panels.beginPanelResize,
        collapseInspector: panels.collapseInspector,
        collapseTimeline: panels.collapseTimeline,
        expandInspector: panels.expandInspector,
        expandTimeline: panels.expandTimeline,
        resizePanelWithKeyboard: panels.resizePanelWithKeyboard,
      },
      model: {
        announcement: assertionSelection
          ? `${assertionSelection.name} selected for an assertion.`
          : announcement,
        inspectorCollapsed: panels.inspectorCollapsed,
        inspectorWidth: panels.inspectorWidth,
        panelLimits: panels.panelLimits,
        timelineCollapsed: panels.timelineCollapsed,
        timelineWidth: panels.timelineWidth,
      },
    },
    dialogs: {
      actions: {
        addAssertion: beginAssertionPick,
        closeAssertion: closeAssertionPick,
        closeConfirmation: () => setConfirmation(null),
        closeRun: closeRunDialog,
        confirmSensitiveExport: exportNow,
        retryRunProfile: () => void loadRunProfile(),
        updateRuntimeValue: (stepId: string, value: string) => {
          setRuntimeValues((current) => ({ ...current, [stepId]: value }));
        },
      },
      model: {
        assertionAvailable,
        assertionPicking,
        assertionSelection,
        blockedReason: replayBlockedReason,
        canRun: replayParameterResult.ready && !replayBlockedReason,
        confirmation,
        libraryHref: pendingNeedsProfile && !profileId
          ? `/library?selected=${encodeURIComponent(workflowId)}`
          : undefined,
        pendingReplayStep,
        profileRetryAvailable: pendingNeedsProfile && runProfileStatus === "error",
        runDialogOpen,
        runtimeFields,
        workflowContainsSensitiveValues,
      },
    },
  };
}
