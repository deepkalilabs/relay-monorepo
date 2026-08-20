"use client";

import Image from "next/image";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AutomationRun, AutomationRunScreenshot } from "../model/automationWorkspace";
import { AutomationThumbnail } from "./AutomationThumbnail";
import styles from "../AutomationsScreen.module.css";

interface RunCardProps {
  run: AutomationRun;
  onViewDetails: (runKey: string) => void;
}

interface EvidencePanelProps {
  id: string;
  label: string;
  screenshot: AutomationRunScreenshot;
  alt: string;
  borderClassName: string;
  metadata: ReactNode;
  temporary?: boolean;
}

function EvidencePanel({
  id,
  label,
  screenshot,
  alt,
  borderClassName,
  metadata,
  temporary = false,
}: EvidencePanelProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const unavailable = failedUrl === screenshot.url;
  return (
    <div className={styles.runEvidence} id={id} role="region" aria-label={label}>
      <div className={`${styles.evidenceFrame} ${borderClassName}`}>
        {unavailable ? (
          <p className={styles.evidenceUnavailable} role="status">Screenshot unavailable</p>
        ) : (
          <Image
            className={styles.evidenceImage}
            src={screenshot.url}
            alt={alt}
            width={screenshot.width}
            height={screenshot.height}
            sizes="(max-width: 639px) calc(100vw - 52px), (max-width: 1399px) 30vw, 380px"
            unoptimized={temporary}
            onError={() => setFailedUrl(screenshot.url)}
          />
        )}
      </div>
      <div className={styles.evidenceMeta}>{metadata}</div>
    </div>
  );
}

function RunCard({ run, onViewDetails }: RunCardProps) {
  const [evidenceExpanded, setEvidenceExpanded] = useState(true);
  const progress = run.totalSteps ? Math.round((run.currentStep / run.totalSteps) * 100) : 0;
  const evidenceId = `run-evidence-${run.id}`;
  const captured = run.updated
    .replace(/^Updated\s+/i, "")
    .replace(/^./, (character) => character.toLocaleLowerCase());
  const status = run.state === "running"
    ? run.totalSteps
      ? `Running · Step ${run.currentStep} of ${run.totalSteps}`
      : "Running"
    : run.state === "failed"
      ? run.failedStep
        ? `Failed at step ${run.failedStep}`
        : "Failed"
      : run.state === "completed"
        ? `Completed · ${run.totalSteps} steps`
        : "Queued";
  return (
    <article className={styles.runCard} aria-label={`${run.name}: ${status}`}>
      <AutomationThumbnail variant={run.thumbnail ?? "search"} />
      <div className={styles.runCopy}>
        <div className={styles.runTitle}>
          <h4>{run.name}</h4>
          <div className={styles.runActions}>
            <span className={styles.runTimestamp}>{run.updated}</span>
            {run.screenshot ? (
              <button
                className={styles.evidenceToggle}
                type="button"
                aria-label={`${evidenceExpanded ? "Hide" : "Show"} evidence for ${run.name}`}
                aria-expanded={evidenceExpanded}
                aria-controls={evidenceId}
                onClick={() => setEvidenceExpanded((expanded) => !expanded)}
              >
                {evidenceExpanded ? "Hide evidence" : "Show evidence"}
                {evidenceExpanded
                  ? <ChevronUp size={13} aria-hidden="true" />
                  : <ChevronDown size={13} aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        </div>
        <p className={styles[`${run.state}Status`]}>
          {run.state === "failed"
            ? <CircleAlert size={13} fill="currentColor" aria-hidden="true" />
            : null}
          {run.state === "completed"
            ? <CheckCircle2 size={13} aria-hidden="true" />
            : null}
          {status}
        </p>
        {run.state === "running" ? (
          <progress
            className={styles.runProgress}
            aria-label={`${run.name} progress`}
            value={progress}
            max={100}
          />
        ) : null}
        {run.detail ? <p className={styles.failureDetail}>{run.detail}</p> : null}
        {run.state === "failed" || run.assertionResults.length > 0 ? (
          <button
            className={styles.viewDetails}
            type="button"
            aria-label={`View details for ${run.name}`}
            onClick={() => onViewDetails(run.id)}
          >
            View details
          </button>
        ) : null}
      </div>
      {run.screenshot && evidenceExpanded ? (
        <EvidencePanel
          id={evidenceId}
          label={`${run.name} run evidence`}
          screenshot={run.screenshot}
          alt={`Run evidence for ${run.name}`}
          borderClassName={run.state === "failed" ? styles.failedEvidence : styles.completedEvidence}
          temporary
          metadata={(
            <>
            <span>Captured {captured}</span>
            {run.totalSteps > 0 ? <span>Step {run.currentStep} of {run.totalSteps}</span> : null}
            </>
          )}
        />
      ) : null}
    </article>
  );
}

interface RunSectionProps {
  id: string;
  title: string;
  runs: AutomationRun[];
  className?: string;
  onViewDetails: (runKey: string) => void;
}

function RunSection({ id, title, runs, className, onViewDetails }: RunSectionProps) {
  return (
    <section className={className} aria-labelledby={id} aria-label={title}>
      <h3 id={id}>{title}</h3>
      <div className={styles.runList}>
        {runs.length
          ? runs.map((run) => (
            <RunCard run={run} onViewDetails={onViewDetails} key={run.id} />
          ))
          : <p className={styles.runEmpty}>No {title.toLocaleLowerCase()}.</p>}
      </div>
    </section>
  );
}

interface ActivityPaneProps {
  runs: AutomationRun[];
  onViewDetails: (runKey: string) => void;
}

export function ActivityPane({ runs, onViewDetails }: ActivityPaneProps) {
  const activeRuns = runs.filter((run) => run.state === "running" || run.state === "queued");
  const failedRuns = runs.filter((run) => run.state === "failed");
  const completedRuns = runs.filter((run) => run.state === "completed");

  return (
    <section className={styles.activity} aria-label="Run activity">
      <header className={styles.activityHeader}>
        <h2>Run activity</h2>
      </header>
      <div className={styles.activityBody}>
        <RunSection
          id="active-runs-heading"
          title="Active runs"
          runs={activeRuns}
          onViewDetails={onViewDetails}
        />
        <RunSection
          id="failed-runs-heading"
          title="Failed runs"
          runs={failedRuns}
          className={styles.failedSection}
          onViewDetails={onViewDetails}
        />
        <RunSection
          id="completed-runs-heading"
          title="Completed runs"
          runs={completedRuns}
          className={styles.completedSection}
          onViewDetails={onViewDetails}
        />
      </div>
    </section>
  );
}
