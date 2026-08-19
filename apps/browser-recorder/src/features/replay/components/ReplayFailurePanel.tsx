"use client";

import { AlertTriangle } from "lucide-react";

export interface ReplayFailurePanelProps {
  message: string;
  onRetry: () => void;
  onSkip: () => void;
  onTakeControl: () => void;
  onStop: () => void;
}

export function ReplayFailurePanel({
  message,
  onRetry,
  onSkip,
  onTakeControl,
  onStop,
}: ReplayFailurePanelProps) {
  return (
    <div className="replay-failure-card" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <div>
        <strong>Replay paused on this step</strong>
        <p>{message}</p>
      </div>
      <div className="replay-failure-actions">
        <button type="button" onClick={onRetry}>Retry</button>
        <button type="button" onClick={onSkip}>Skip</button>
        <button type="button" onClick={onTakeControl}>Take control</button>
        <button type="button" onClick={onStop}>Stop</button>
      </div>
    </div>
  );
}
