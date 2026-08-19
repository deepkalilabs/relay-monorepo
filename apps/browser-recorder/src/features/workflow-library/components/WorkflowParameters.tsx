"use client";

import { AlertTriangle, Check, Play, Save, WandSparkles } from "lucide-react";
import Link from "next/link";
import type { ProfileFieldId, ProfileSummary } from "@/shared/contracts/profile";
import {
  MAX_PARAMETER_VALUE_LENGTH,
  type FillStep,
  type ParameterBinding,
  type Workflow,
} from "@/shared/contracts/workflow";
import type {
  ParameterResolution,
  WorkflowParameterResult,
} from "@/shared/contracts/workflow/parameters";
import type { ParameterBindingConflict } from "../model/rebaseParameterBindings";
import layoutStyles from "../LibraryScreen.module.css";
import styles from "./WorkflowParameters.module.css";

const fieldLabels: Record<ProfileFieldId, string> = {
  "identity.fullName": "Full name",
  "identity.email": "Email address",
  "location.countryRegion": "Country / region",
  "location.postalCode": "ZIP / postal code",
};

const fields = Object.entries(fieldLabels) as Array<[ProfileFieldId, string]>;

interface WorkflowParametersProps {
  workflow: Workflow;
  profiles: ProfileSummary[];
  profilesLoading: boolean;
  profilesError: string | null;
  selectedProfileId: string;
  profileLoading: boolean;
  profileError: string | null;
  result: WorkflowParameterResult;
  dirty: boolean;
  saving: boolean;
  conflicts: ParameterBindingConflict[];
  error: string | null;
  onSelectProfile: (profileId: string) => void;
  onRetryProfile: () => void;
  onBindingChange: (stepId: string, binding: ParameterBinding) => void;
  onAutoMap: () => void;
  onSave: () => void;
  onRun: () => void;
  onResolveConflict: (stepId: string, choice: "saved" | "local") => void;
}

function bindingForSource(step: FillStep, source: ParameterBinding["source"]): ParameterBinding {
  switch (source) {
    case "recorded":
      return { source };
    case "fixed":
      return step.parameterBinding.source === "fixed"
        ? step.parameterBinding
        : { source, value: "" };
    case "profile":
      return step.parameterBinding.source === "profile"
        ? step.parameterBinding
        : { source, field: "identity.fullName" };
    case "runtime":
      return { source };
  }
}

function previewText(resolution: ParameterResolution | undefined, sensitive: boolean): string {
  if (!resolution) return "—";
  switch (resolution.status) {
    case "resolved":
      return sensitive ? "••••••••" : resolution.value;
    case "missing-fixed":
      return "Enter a value";
    case "missing-profile":
      return `Missing ${fieldLabels[resolution.field]}`;
    case "runtime-required":
      return "Required at run time";
    case "invalid-runtime":
      return "Runtime value is too long";
  }
}

function ParameterValueControl({
  step,
  profileAvailable,
  onChange,
}: {
  step: FillStep;
  profileAvailable: boolean;
  onChange: (binding: ParameterBinding) => void;
}) {
  switch (step.parameterBinding.source) {
    case "recorded":
      return <output className={styles.recordedValue}>{step.payload.value || "(empty value)"}</output>;
    case "fixed":
      return (
        <input
          value={step.parameterBinding.value}
          maxLength={MAX_PARAMETER_VALUE_LENGTH}
          aria-label={`Fixed value for ${step.name}`}
          onChange={(event) => onChange({ source: "fixed", value: event.target.value })}
        />
      );
    case "profile":
      return (
        <select
          value={step.parameterBinding.field}
          aria-label={`Profile field for ${step.name}`}
          disabled={!profileAvailable}
          onChange={(event) => onChange({
            source: "profile",
            field: event.target.value as ProfileFieldId,
          })}
        >
          {fields.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      );
    case "runtime":
      return <span className={styles.runtimeValue}>Required at run time</span>;
  }
}

export function WorkflowParameters(props: WorkflowParametersProps) {
  const hasInputs = props.workflow.steps.some((step) => step.type === "fill");
  const hasBlockingResolution = !props.result.canEnterPreflight;
  const runDisabled = props.saving
    || props.conflicts.length > 0
    || hasBlockingResolution
    || props.profilesLoading
    || Boolean(props.profilesError)
    || props.profileLoading
    || Boolean(props.profileError);

  return (
    <section className={styles.parametersSection} aria-labelledby="parameters-heading">
      <div className={styles.parameterToolbar}>
        <div>
          <h3 id="parameters-heading">Parameters</h3>
          <p>Choose where each input gets its value.</p>
        </div>
        <div className={styles.parameterTools}>
          <label>
            <span>Run profile</span>
            <select
              value={props.selectedProfileId}
              disabled={props.profilesLoading || Boolean(props.profilesError)}
              onChange={(event) => props.onSelectProfile(event.target.value)}
            >
              <option value="">No profile selected</option>
              {props.profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name} · {profile.status === "ready" ? "Ready" : "Draft"}
                </option>
              ))}
            </select>
          </label>
          <button
            className={layoutStyles.secondaryAction}
            type="button"
            disabled={!hasInputs || !props.profiles.length || props.saving}
            onClick={props.onAutoMap}
          >
            <WandSparkles size={15} aria-hidden="true" />
            Auto-map fields
          </button>
        </div>
      </div>

      {props.profilesError ? <p className={styles.parameterAlert} role="alert">{props.profilesError}</p> : null}
      {!props.profilesLoading && !props.profilesError && !props.profiles.length ? (
        <p className={styles.parameterNotice}>
          No saved profiles. <Link href="/profile">Create a profile</Link> to use profile mappings.
        </p>
      ) : null}
      {props.profileError ? (
        <div className={styles.parameterAlert} role="alert">
          <span>{props.profileError}</span>
          {props.selectedProfileId ? (
            <button type="button" onClick={props.onRetryProfile}>Retry profile</button>
          ) : null}
        </div>
      ) : null}

      {!hasInputs ? (
        <div className={styles.noParameters} role="status">
          This workflow has no inputs to configure.
        </div>
      ) : null}
      <div className={styles.parameterMatrix} role="table" aria-label="Workflow parameters">
          <div className={styles.parameterColumns} role="row">
            <span role="columnheader">Parameter</span>
            <span role="columnheader">Value source</span>
            <span role="columnheader">Value / mapping</span>
            <span role="columnheader">Resolved preview</span>
          </div>
          {props.workflow.steps.map((step, index) => {
            const resolution = props.result.resolutions[step.id];
            const conflict = props.conflicts.find((candidate) => candidate.stepId === step.id);
            return (
              <div className={styles.parameterRow} role="row" key={step.id}>
                <div className={styles.stepIdentity} role="cell">
                  <span>{index + 1}</span>
                  <p>{step.name}</p>
                </div>
                {step.type === "fill" ? (
                  <>
                    <div className={styles.parameterField} role="cell">
                      <label>
                        <span className="sr-only">Value source for {step.name}</span>
                        <select
                          value={step.parameterBinding.source}
                          onChange={(event) => props.onBindingChange(
                            step.id,
                            bindingForSource(step, event.target.value as ParameterBinding["source"]),
                          )}
                        >
                          <option value="profile" disabled={!props.profiles.length}>Profile field</option>
                          <option value="recorded">Recorded value</option>
                          <option value="fixed">Fixed value</option>
                          <option value="runtime">Ask when run</option>
                        </select>
                      </label>
                    </div>
                    <div className={styles.parameterField} role="cell">
                      <ParameterValueControl
                        step={step}
                        profileAvailable={Boolean(props.profiles.length)}
                        onChange={(binding) => props.onBindingChange(step.id, binding)}
                      />
                    </div>
                    <div
                      className={`${styles.resolvedPreview} ${
                        resolution?.status === "resolved" ? styles.resolvedPreviewSuccess : styles.resolvedPreviewPending
                      }`}
                      role="cell"
                    >
                      {resolution?.status === "resolved"
                        ? <Check size={15} aria-label="Resolved" />
                        : <AlertTriangle size={15} aria-hidden="true" />}
                      <span>{previewText(resolution, step.metadata.sensitive)}</span>
                    </div>
                    {conflict ? (
                      <div className={styles.parameterConflict} role="alert">
                        <span>This source also changed in the saved workflow.</span>
                        <button type="button" onClick={() => props.onResolveConflict(step.id, "saved")}>
                          Use saved
                        </button>
                        <button type="button" onClick={() => props.onResolveConflict(step.id, "local")}>
                          Keep mine
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className={styles.noValue} role="cell">No input required</span>
                    <span className={styles.noValue} role="cell">—</span>
                    <span className={styles.noValue} role="cell">—</span>
                  </>
                )}
              </div>
            );
          })}
      </div>

      <footer className={styles.parameterFooter}>
        <div>
          <strong>{props.result.configuredCount} of {props.result.requiredCount} required inputs configured.</strong>
          {props.error ? <p role="alert">{props.error}</p> : null}
        </div>
        <div>
          {hasInputs ? (
            <button
              className={layoutStyles.secondaryAction}
              type="button"
              disabled={!props.dirty || props.saving || props.conflicts.length > 0}
              onClick={props.onSave}
            >
              <Save size={15} aria-hidden="true" />
              {props.saving ? "Saving…" : "Save"}
            </button>
          ) : null}
          <button
            className={layoutStyles.primaryAction}
            type="button"
            disabled={runDisabled}
            onClick={props.onRun}
          >
            <Play size={15} aria-hidden="true" />
            Run workflow
          </button>
        </div>
      </footer>
    </section>
  );
}
