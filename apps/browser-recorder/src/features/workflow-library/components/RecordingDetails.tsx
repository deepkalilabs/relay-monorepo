"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ProfileSummary } from "@/shared/contracts/profile";
import type { LibraryWorkflowItem } from "@/shared/contracts/workflow/library";
import type { ParameterProfileClient } from "../api/parameterProfileClient";
import type { WorkflowLibraryClient } from "../api/workflowLibraryClient";
import { useParameterWorkspace } from "../model/useParameterWorkspace";
import { WorkflowParameters } from "./WorkflowParameters";
import styles from "../LibraryScreen.module.css";

interface RecordingDetailsProps {
  workflow: LibraryWorkflowItem;
  workflowClient: WorkflowLibraryClient;
  profileClient: ParameterProfileClient;
  profiles: ProfileSummary[];
  profilesLoading: boolean;
  profilesError: string | null;
  navigate: (url: string) => void;
}

function MockBrowserPreview() {
  return (
    <div className={styles.preview} data-testid="static-workflow-preview" aria-hidden="true">
      <div className={styles.previewChrome}>
        <span className={styles.windowDots}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.addressBar} />
      </div>
      <div className={styles.previewToolbar}>
        <span className={styles.previewLogo}>mr</span>
        <span />
        <span />
      </div>
      <div className={styles.checkoutCanvas}>
        <div className={styles.checkoutMain}>
          <div className={styles.checkoutProgress}>
            <span className={styles.progressActive}>1</span>
            <small>Information</small>
            <span>2</span>
            <small>Shipping</small>
            <span>3</span>
            <small>Payment</small>
            <span>4</span>
            <small>Review</small>
          </div>
          <strong>Contact information</strong>
          <span className={styles.mockInput}>Email address</span>
          <span className={styles.mockInput}>Phone number</span>
          <strong>Shipping address</strong>
          <span className={styles.mockInput}>Full name</span>
        </div>
        <aside className={styles.orderSummary}>
          <strong>Order summary</strong>
          <div><i /><span /><b /></div>
          <div><i /><span /><b /></div>
          <div><i /><span /><b /></div>
          <footer><strong>Total</strong><strong>$129.00</strong></footer>
        </aside>
      </div>
    </div>
  );
}

export function RecordingDetails(props: RecordingDetailsProps) {
  return <RecordingDetailsView key={props.workflow.id} {...props} />;
}

function RecordingDetailsView({
  workflow,
  workflowClient,
  profileClient,
  profiles,
  profilesLoading,
  profilesError,
  navigate,
}: RecordingDetailsProps) {
  const draft = workflow.status === "draft";
  const workspace = useParameterWorkspace({
    workflowId: workflow.id,
    workflowClient,
    profileClient,
    profiles,
    profilesLoading,
    profilesError,
    navigate,
  });

  return (
    <section className={styles.details} aria-label="Workflow details">
      <header className={styles.detailsHeader}>
        <div>
          <span className={draft ? styles.statusBadge : "sr-only"}>{draft ? "Draft" : "Complete workflow"}</span>
          <h2>{workflow.name}</h2>
          <p>{workflow.steps.length} steps</p>
        </div>
        <div className={styles.detailActions}>
          <Link
            className={styles.primaryAction}
            href={`/workflows/${workflow.id}/edit`}
            aria-label={`${draft ? "Continue editing" : "Edit workflow"} ${workflow.name}`}
          >
            {draft ? "Continue editing" : "Edit workflow"}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </header>
      <MockBrowserPreview />
      {workspace.workflowLoading ? (
        <div className={styles.parameterLoadState} aria-busy="true">
          Loading workflow parameters…
        </div>
      ) : workspace.workflow && workspace.parameterResult ? (
        <WorkflowParameters
          workflow={workspace.workflow}
          profiles={workspace.profiles}
          profilesLoading={workspace.profilesLoading}
          profilesError={workspace.profilesError}
          selectedProfileId={workspace.selectedProfileId}
          profileLoading={workspace.profileLoading}
          profileError={workspace.profileError}
          result={workspace.parameterResult}
          dirty={workspace.dirty}
          saving={workspace.status === "saving"}
          conflicts={workspace.conflicts}
          error={workspace.error}
          onSelectProfile={workspace.selectProfile}
          onRetryProfile={workspace.retryProfile}
          onBindingChange={workspace.updateBinding}
          onAutoMap={workspace.autoMap}
          onSave={() => void workspace.save()}
          onRun={() => void workspace.run()}
          onResolveConflict={workspace.resolveConflict}
        />
      ) : (
        <div className={styles.parameterLoadError} role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{workspace.error ?? "Workflow parameters could not be loaded."}</span>
        </div>
      )}
    </section>
  );
}
