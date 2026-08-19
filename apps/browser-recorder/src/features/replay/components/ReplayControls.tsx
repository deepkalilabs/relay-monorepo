"use client";

import { CircleStop, Hand, LoaderCircle, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { ReplayPhase, ReplayStatus } from "@/shared/contracts/protocol";

const replayPhaseLabels: Record<ReplayPhase, string> = {
  acting: "",
  asserting: " · checking assertion",
  settling: " · settling UI",
  waiting: " · waiting for UI",
};

interface ReplayControlsProps {
  status: ReplayStatus;
  currentIndex: number;
  totalSteps: number;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onSkip: () => void;
  onTakeControl: () => void;
  onStop: () => void;
  failed?: boolean;
  phase?: ReplayPhase;
}

export function ReplayControls({ status, currentIndex, totalSteps, onPause, onResume, onRetry, onSkip, onTakeControl, onStop, failed = false, phase }: ReplayControlsProps) {
  const busy = status === "preparing" || status === "pausing" || status === "stopping";
  const phaseLabel = phase ? replayPhaseLabels[phase] : "";
  const progress = totalSteps ? `Step ${Math.min(currentIndex + 1, totalSteps)} of ${totalSteps}${phaseLabel}` : "Preparing replay";
  return (
    <div className="replay-controls" aria-live="polite">
      <span className={`replay-state replay-state-${status}`}>
        {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        <strong>{status === "completed" ? "Replay complete" : progress}</strong>
      </span>
      {status === "running" ? <button type="button" onClick={onPause}><Pause size={15} /> Pause</button> : null}
      {status === "pausing" ? <button type="button" disabled><LoaderCircle className="spin" size={15} /> Pausing</button> : null}
      {status === "paused" && !failed ? <button type="button" onClick={onResume}><Play size={15} /> Resume</button> : null}
      {status === "manual" ? <button type="button" onClick={onResume}><RotateCcw size={15} /> Retry step</button> : null}
      {status === "paused" && failed ? (
        <>
          <button type="button" onClick={onRetry}><RotateCcw size={15} /> Retry</button>
          <button type="button" onClick={onSkip}><SkipForward size={15} /> Skip</button>
          <button type="button" onClick={onTakeControl}><Hand size={15} /> Take control</button>
        </>
      ) : null}
      <button className="replay-stop" type="button" onClick={onStop} disabled={status === "stopping"}>
        <CircleStop size={15} /> Stop replay
      </button>
    </div>
  );
}
