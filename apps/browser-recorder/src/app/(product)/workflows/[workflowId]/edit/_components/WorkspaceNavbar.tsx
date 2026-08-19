"use client";

import { ArrowLeft, Check, ChevronLeft, ChevronRight, Pencil, Radio, Save } from "lucide-react";
import Link from "next/link";
import { RecorderControls } from "@/features/recorder";
import type { WorkflowStatus } from "@/shared/contracts/workflow/domain";
import type { RecordingStatus, TransportStatus } from "@/features/recorder";

export type WorkflowSaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";

interface WorkspaceNavbarProps {
  collapsed: boolean;
  workflowName: string;
  workflowStatus?: WorkflowStatus;
  saveState?: WorkflowSaveState;
  status: RecordingStatus;
  transportStatus: TransportStatus;
  stepCount: number;
  onNameChange: (name: string) => void;
  onCollapse: () => void;
  onExpand: () => void;
  onStart: () => void;
  onStop: () => void;
  onSave?: () => void;
  onFinish?: () => void;
  collapseDisabled?: boolean;
  locked?: boolean;
}

export function WorkspaceNavbar({
  collapsed,
  workflowName,
  workflowStatus = "complete",
  saveState = "saved",
  status,
  transportStatus,
  stepCount,
  onNameChange,
  onCollapse,
  onExpand,
  onStart,
  onStop,
  onSave = () => undefined,
  onFinish = () => undefined,
  collapseDisabled = false,
  locked = false,
}: WorkspaceNavbarProps) {
  const saving = saveState === "saving";
  const saveLabel = saveState === "saved"
    ? "Saved"
    : saveState === "saving"
      ? "Saving…"
      : saveState === "conflict"
        ? "Changed elsewhere"
        : saveState === "error"
          ? "Unable to save"
          : "Unsaved changes";

  if (collapsed) {
    return (
      <aside className="workspace-rail" aria-label="Collapsed workflow navbar">
        <h1 className="rail-brand" aria-label="Browser Memory Recorder">
          <Radio size={18} aria-hidden="true" />
        </h1>
        <button
          id="timeline-expand"
          className="workspace-rail-button"
          type="button"
          disabled={locked}
          onClick={onExpand}
          aria-label="Expand workflow timeline"
          title="Expand timeline"
        >
          <ChevronRight size={19} aria-hidden="true" />
        </button>
        <RecorderControls
          status={status}
          transportStatus={transportStatus}
          onStart={onStart}
          onStop={onStop}
          variant="rail"
        />
        <span className="workspace-rail-spacer" />
        <button
          className="workspace-rail-button"
          type="button"
          onClick={onSave}
          disabled={locked || saving || saveState === "saved"}
          aria-label="Save workflow"
          title={saveLabel}
        >
          <Save size={18} aria-hidden="true" />
        </button>
        {workflowStatus === "draft" ? (
          <button
            className="workspace-rail-button"
            type="button"
            onClick={onFinish}
            disabled={locked || saving || !stepCount}
            aria-label="Finish recording"
            title="Finish recording"
          >
            <Check size={18} aria-hidden="true" />
          </button>
        ) : null}
      </aside>
    );
  }

  return (
    <header className="workspace-navbar">
      <div className="workspace-navbar-primary">
        <h1 className="brand" aria-label="Browser Memory Recorder">
          <span className="brand-mark"><Radio size={18} aria-hidden="true" /></span>
          <span>Memory Recorder</span>
        </h1>
        <button
          className="icon-button"
          type="button"
          id="timeline-collapse"
          onClick={onCollapse}
          disabled={collapseDisabled}
          aria-label="Collapse workflow timeline"
          title="Collapse timeline"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>
      <Link className="workspace-library-link" href="/library">
        <ArrowLeft size={17} aria-hidden="true" />
        <span>Back to library</span>
      </Link>
      <div className="workspace-persistence">
        <span className={`workspace-save-state ${saveState}`} role="status">{saveLabel}</span>
        <button
          className="button button-secondary"
          type="button"
          onClick={onSave}
          disabled={locked || saving || saveState === "saved"}
          aria-label="Save workflow"
        >
          <Save size={16} aria-hidden="true" />
          Save
        </button>
        {workflowStatus === "draft" ? (
          <button
            className="button button-primary"
            type="button"
            onClick={onFinish}
            disabled={locked || saving || !stepCount}
            aria-label="Finish recording"
          >
            <Check size={16} aria-hidden="true" />
            Finish
          </button>
        ) : null}
      </div>
      <label className="workspace-workflow-name">
        <span className="sr-only">Workflow name</span>
        <input
          value={workflowName}
          disabled={locked}
          onChange={(event) => onNameChange(event.target.value)}
          aria-label="Workflow name"
        />
        <Pencil size={14} aria-hidden="true" />
      </label>
    </header>
  );
}
