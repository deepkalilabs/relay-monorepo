import type { ReactNode } from "react";
import {
  BrowserPanel,
  type BrowserActions,
  type BrowserPageState,
  type DatePickerState,
  type PopupState,
  type SelectPickerState,
} from "@/features/browser";
import {
  RecorderControls,
  type RecordingStatus,
  type TransportStatus,
} from "@/features/recorder";
import {
  ReplayControls,
  ReplayFailurePanel,
} from "@/features/replay";
import type {
  CaptchaStatus,
  ReplayStatus,
  ReplayStepResultState,
} from "@/shared/contracts/protocol";

interface TestBrowserPanelProps {
  status: RecordingStatus;
  transportStatus: TransportStatus;
  startedAt: number | null;
  liveViewUrl: string | null;
  error: string | null;
  navigationError: string | null;
  navigationPending: boolean;
  page: BrowserPageState | null;
  popup: PopupState | null;
  datePicker?: DatePickerState | null;
  selectPicker?: SelectPickerState | null;
  nativeSelects?: boolean;
  captchaStatus?: CaptchaStatus | null;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (url: string) => void;
  onReload: () => void;
  onStart: () => void;
  onStop: () => void;
  onRetry: () => void;
  onSwitchPopup: (pageId: string) => void;
  onDateSelect?: (requestId: string, value: string) => void;
  onDateDismiss?: (requestId: string) => void;
  onSelectPickerSelect?: (requestId: string, value: string) => void;
  onSelectPickerDismiss?: (requestId: string) => void;
  onNativeSelectsChange?: (enabled: boolean) => void;
  onCaptchaContinue?: () => void;
  replayStatus?: ReplayStatus;
  replayCurrentIndex?: number;
  replayTotalSteps?: number;
  replayCurrentResult?: ReplayStepResultState;
  replayReadyCount?: number;
  onReplay?: () => void;
  onReplayPause?: () => void;
  onReplayResume?: () => void;
  onReplayRetry?: () => void;
  onReplaySkip?: () => void;
  onReplayTakeControl?: () => void;
  onReplayStop?: () => void;
  errorContext?: "recording" | "replay";
  onDismissError?: () => void;
  toolbar?: ReactNode;
}

const noop = () => undefined;

export function TestBrowserPanel({
  status,
  transportStatus,
  startedAt,
  liveViewUrl,
  error,
  navigationError,
  navigationPending,
  page,
  popup,
  datePicker = null,
  selectPicker = null,
  nativeSelects = false,
  captchaStatus = null,
  onBack,
  onForward,
  onNavigate,
  onReload,
  onStart,
  onStop,
  onRetry,
  onSwitchPopup,
  onDateSelect = noop,
  onDateDismiss = noop,
  onSelectPickerSelect = noop,
  onSelectPickerDismiss = noop,
  onNativeSelectsChange = noop,
  onCaptchaContinue = noop,
  replayStatus = "idle",
  replayCurrentIndex = 0,
  replayTotalSteps = 0,
  replayCurrentResult,
  replayReadyCount = 0,
  onReplay = noop,
  onReplayPause = noop,
  onReplayResume = noop,
  onReplayRetry = noop,
  onReplaySkip = noop,
  onReplayTakeControl = noop,
  onReplayStop = noop,
  errorContext = "recording",
  onDismissError = noop,
  toolbar,
}: TestBrowserPanelProps) {
  const captchaLocked = captchaStatus === "solving";
  const replayMode = ["preparing", "running", "pausing", "paused", "manual", "stopping"].includes(
    replayStatus,
  );
  const actions: BrowserActions = {
    goBack: onBack,
    goForward: onForward,
    navigate: onNavigate,
    reload: onReload,
    switchPopup: onSwitchPopup,
    selectDate: onDateSelect,
    dismissDatePicker: onDateDismiss,
    selectPickerOption: onSelectPickerSelect,
    dismissSelectPicker: onSelectPickerDismiss,
    setNativeSelects: onNativeSelectsChange,
    continueAfterCaptcha: onCaptchaContinue,
  };

  return (
    <BrowserPanel
      model={{
        page,
        liveViewUrl,
        popup,
        datePicker,
        selectPicker,
        captchaStatus,
        nativeSelects,
        nativeSelectsEnabled: Boolean(
          !captchaLocked
          && liveViewUrl
          && transportStatus === "connected"
          && !["preparing", "running", "pausing", "paused", "stopping"].includes(replayStatus),
        ),
        preparing: status === "starting" || replayStatus === "preparing",
        reconnecting: status === "reconnecting",
        restoreFocusAfterCaptcha: ["recording", "reconnecting"].includes(status),
        navigation: {
          enabled: Boolean(
            !captchaLocked
            && liveViewUrl
            && !navigationPending
            && (["recording", "reconnecting"].includes(status) || replayStatus === "manual"),
          ),
          pending: navigationPending,
          error: navigationError,
        },
      }}
      actions={actions}
      emptyState={{
        title: replayReadyCount ? "Workflow ready to replay" : "Start with a fresh cloud browser",
        description: replayReadyCount
          ? `${replayReadyCount} steps are loaded. Replay them, then keep recording in the same browser.`
          : "Your interactions become structured, editable workflow steps in real time.",
      }}
      toolbar={toolbar ?? (replayMode ? (
        <ReplayControls
          status={replayStatus}
          currentIndex={replayCurrentIndex}
          totalSteps={replayTotalSteps}
          failed={replayCurrentResult?.status === "failed"}
          phase={replayCurrentResult?.phase}
          onPause={onReplayPause}
          onResume={onReplayResume}
          onRetry={onReplayRetry}
          onSkip={onReplaySkip}
          onTakeControl={onReplayTakeControl}
          onStop={onReplayStop}
        />
      ) : (
        <RecorderControls
          status={status}
          transportStatus={transportStatus}
          startedAt={startedAt}
          onStart={onStart}
          onStop={onStop}
          announce
        />
      ))}
      emptyActions={(
        <>
          {replayReadyCount ? <button type="button" onClick={onReplay}>Replay workflow</button> : null}
          <button type="button" onClick={onStart}>Start recording</button>
        </>
      )}
      alert={error ? {
        title: errorContext === "replay" ? "Replay needs attention" : "Browser session needs attention",
        message: error,
        actionLabel: errorContext === "replay" ? "Review workflow" : "Try a new recording",
        onAction: errorContext === "replay" ? onDismissError : onRetry,
      } : null}
      contentOverlay={
        replayCurrentResult?.status === "failed" && replayCurrentResult.diagnostic ? (
          <ReplayFailurePanel
            message={replayCurrentResult.diagnostic.message}
            onRetry={onReplayRetry}
            onSkip={onReplaySkip}
            onTakeControl={onReplayTakeControl}
            onStop={onReplayStop}
          />
        ) : null
      }
    />
  );
}
