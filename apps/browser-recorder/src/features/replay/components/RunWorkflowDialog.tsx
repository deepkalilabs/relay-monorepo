"use client";

import { AlertTriangle, Play } from "lucide-react";
import Link from "next/link";
import { Modal } from "@/shared/ui/modal";
import { MAX_PARAMETER_VALUE_LENGTH } from "@/shared/contracts/workflow";

export interface RuntimeParameterField {
  id: string;
  name: string;
  value: string;
  sensitive: boolean;
}

interface RunWorkflowDialogProps {
  open: boolean;
  sensitive: boolean;
  startStepName?: string;
  runtimeFields?: RuntimeParameterField[];
  blockedReason?: string;
  libraryHref?: string;
  canRun?: boolean;
  onRuntimeValueChange?: (stepId: string, value: string) => void;
  onRetryProfile?: () => void;
  onClose: () => void;
  onRun: () => void;
}

export function RunWorkflowDialog({ open, ...props }: RunWorkflowDialogProps) {
  if (!open) return null;
  return <OpenRunWorkflowDialog {...props} />;
}

function OpenRunWorkflowDialog({
  sensitive,
  startStepName,
  runtimeFields = [],
  blockedReason,
  libraryHref,
  canRun = true,
  onRuntimeValueChange,
  onRetryProfile,
  onClose,
  onRun,
}: Omit<RunWorkflowDialogProps, "open">) {
  const title = startStepName ? "Run workflow from this step?" : "Run workflow?";
  const description = startStepName
    ? `Close the current cloud browser, start a fresh Browserbase session at “${startStepName},” and continue through the remaining enabled steps.`
    : "Close the current cloud browser and run this workflow in a fresh Browserbase session.";

  return (
    <Modal open title={title} description={description} onClose={onClose}>
      <form
        className="run-workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canRun && !blockedReason) onRun();
        }}
      >
        {blockedReason ? (
          <div className="run-workflow-blocked" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{blockedReason}</span>
          </div>
        ) : null}
        {runtimeFields.length ? (
          <fieldset className="run-workflow-runtime">
            <legend>Values required for this run</legend>
            {runtimeFields.map((field) => (
              <label key={field.id}>
                <span>{field.name}</span>
                <input
                  type={field.sensitive ? "password" : "text"}
                  value={field.value}
                  maxLength={MAX_PARAMETER_VALUE_LENGTH}
                  autoComplete="off"
                  onChange={(event) => onRuntimeValueChange?.(field.id, event.target.value)}
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        {sensitive ? (
          <div className="run-workflow-warning" role="note">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>This workflow contains sensitive values</strong>
              <p>Values will be sent to this local server and typed into the destination website. Resolved profile and run-time values are not written back to the workflow or included in replay diagnostics.</p>
            </div>
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="button button-ghost" type="button" onClick={onClose}>Cancel</button>
          {blockedReason && libraryHref ? (
            <Link className="button button-primary" href={libraryHref}>Choose profile in Library</Link>
          ) : blockedReason && onRetryProfile ? (
            <button className="button button-primary" type="button" onClick={onRetryProfile}>
              Retry profile
            </button>
          ) : (
            <button
              className={`button ${sensitive ? "button-danger" : "button-primary"}`}
              type="submit"
              disabled={!canRun}
            >
              <Play size={16} aria-hidden="true" /> {sensitive ? "Run sensitive workflow" : "Run workflow"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
