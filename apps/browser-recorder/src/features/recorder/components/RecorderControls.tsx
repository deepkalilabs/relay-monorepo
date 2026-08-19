"use client";

import { useEffect, useReducer } from "react";
import { CircleStop, LoaderCircle, Play } from "lucide-react";
import type { RecordingStatus, TransportStatus } from "../model/recorder.types";

const labels: Record<RecordingStatus, string> = {
  configurationMissing: "Setup required",
  idle: "Ready",
  starting: "Starting",
  recording: "Recording",
  reconnecting: "Reconnecting",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Needs attention",
};

interface RecorderControlsProps {
  status: RecordingStatus;
  transportStatus: TransportStatus;
  startedAt?: number | null;
  onStart: () => void;
  onStop: () => void;
  variant?: "chrome" | "rail";
  announce?: boolean;
}

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function RecorderTimer({ startedAt }: { startedAt: number | null }) {
  const [, tick] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return <span className="recorder-timer">{formatElapsed(startedAt)}</span>;
}

export function RecorderControls({
  status,
  transportStatus,
  startedAt = null,
  onStart,
  onStop,
  variant = "chrome",
  announce = false,
}: RecorderControlsProps) {
  const active = ["starting", "recording", "reconnecting", "stopping"].includes(status);
  const busy = status === "starting" || status === "stopping";
  const label = status === "configurationMissing"
    ? labels[status]
    : transportStatus === "offline"
      ? "Offline"
      : transportStatus === "connecting" && (status === "idle" || status === "stopped")
        ? "Connecting"
        : transportStatus === "reconnecting"
          ? "Reconnecting"
          : labels[status];
  const visualStatus = transportStatus === "offline"
    ? "error"
    : transportStatus === "connecting" && (status === "idle" || status === "stopped")
      ? "starting"
      : transportStatus === "reconnecting"
        ? "reconnecting"
        : status;
  const startDisabled = status === "configurationMissing" || transportStatus === "offline";
  const actionLabel = active ? "Stop recording" : "Start recording";

  return (
    <div
      className={`recorder-controls recorder-controls-${variant}`}
      aria-live={announce ? "polite" : undefined}
    >
      <span className="recorder-status" aria-label={`Recorder status: ${label}`} title={variant === "rail" ? label : undefined}>
        <span className={`recorder-status-dot recorder-status-${visualStatus}`} aria-hidden="true" />
        {variant === "chrome" ? <strong className="recorder-status-label">{label}</strong> : null}
        {variant === "chrome" && active ? <RecorderTimer startedAt={startedAt} /> : null}
      </span>
      <button
        className={`recorder-action recorder-action-${active ? "stop" : "start"}`}
        type="button"
        onClick={active ? onStop : onStart}
        disabled={active ? busy : startDisabled}
        aria-label={`${actionLabel}; recorder ${label.toLowerCase()}`}
        title={variant === "rail" ? actionLabel : undefined}
      >
        {busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : active ? <CircleStop size={16} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        {variant === "chrome" ? <span className="recorder-action-label">{active ? "Stop" : "Start"}</span> : null}
      </button>
    </div>
  );
}
