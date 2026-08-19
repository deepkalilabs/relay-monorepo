"use client";

import { AlertTriangle, ArrowRight, ChevronLeft, Play, RotateCcw, X } from "lucide-react";
import { BrowserPanel } from "@/features/browser";
import { RecorderControls } from "@/features/recorder";
import { ReplayControls, ReplayFailurePanel, RunWorkflowDialog } from "@/features/replay";
import { AssertionStepDialog, StepEditor, WorkflowTimeline } from "@/features/workflow-editor";
import { Modal } from "@/shared/ui/modal";
import { WorkspaceNavbar } from "./WorkspaceNavbar";
import { useWorkspaceController } from "../_hooks/useWorkspaceController";

interface RecorderWorkspaceProps {
  workflowId: string;
  profileId?: string;
  autoRun?: boolean;
}

export function RecorderWorkspace({ workflowId, profileId, autoRun }: RecorderWorkspaceProps) {
  const controller = useWorkspaceController(workflowId, profileId, autoRun);
  const { browser, dialogs, layout, recorder, replay, workflow } = controller;
  const workflowState = workflow.model.state;
  const saveState = workflow.model.persistenceStatus === "saving"
    ? "saving"
    : workflow.model.persistenceStatus === "conflict"
      ? "conflict"
      : workflow.model.persistenceStatus === "error"
        ? "error"
        : workflowState.dirty
          ? "unsaved"
          : "saved";

  if (!workflow.model.loaded) {
    return (
      <main className="workspace-load-state">
        {workflow.model.persistenceStatus === "loading" ? (
          <>
            <span className="workspace-load-spinner" aria-hidden="true" />
            <h1>Loading workflow…</h1>
            <p>The editor will be available when the saved workflow is ready.</p>
          </>
        ) : (
          <>
            <AlertTriangle size={28} aria-hidden="true" />
            <h1>Workflow could not be loaded</h1>
            <p role="alert">{workflow.model.persistenceError}</p>
            <button className="button button-primary" type="button" onClick={workflow.actions.reload}>
              Try again
            </button>
          </>
        )}
      </main>
    );
  }

  return (
    <>
      <div className="viewport-guard" role="main">
        <span className="guard-icon"><AlertTriangle size={24} /></span>
        <h1>A larger screen is required</h1>
        <p>Memory Recorder is a desktop workspace designed for viewports at least 1024px wide.</p>
      </div>
      <div className="desktop-app">
        <a className="skip-link" href="#browser-workspace">Skip to browser workspace</a>
        <main
          className="workspace"
          style={{
            "--timeline-width": `${layout.model.timelineCollapsed ? 44 : layout.model.timelineWidth}px`,
            "--inspector-width": `${layout.model.inspectorCollapsed ? 44 : layout.model.inspectorWidth}px`,
          } as React.CSSProperties}
        >
          <div className={`timeline-shell ${layout.model.timelineCollapsed ? "collapsed" : ""}`}>
            <WorkspaceNavbar
              collapsed={layout.model.timelineCollapsed}
              workflowName={workflowState.workflow.name}
              workflowStatus={workflowState.workflow.status}
              saveState={saveState}
              status={recorder.model.status}
              transportStatus={recorder.model.transportStatus}
              stepCount={workflowState.workflow.steps.length}
              onNameChange={workflow.actions.rename}
              onExpand={layout.actions.expandTimeline}
              onStart={recorder.actions.start}
              onStop={recorder.actions.stop}
              onExport={workflow.actions.requestExport}
              onSave={() => void workflow.actions.save()}
              onFinish={() => void workflow.actions.finish()}
              onReplay={() => replay.actions.request()}
              replayDisabled={
                !workflowState.workflow.steps.some((step) => step.enabled)
                || workflow.model.locked
                || recorder.model.transportStatus === "offline"
              }
              locked={workflow.model.locked}
            />
            {!layout.model.timelineCollapsed ? (
              <>
                <WorkflowTimeline
                  steps={workflowState.workflow.steps}
                  selectedId={workflowState.selectedStepId}
                  onSelect={workflow.actions.selectStep}
                  onToggle={workflow.actions.toggleStep}
                  onDelete={workflow.actions.deleteStep}
                  onReorder={workflow.actions.reorderSteps}
                  onAddAssertion={dialogs.actions.addAssertion}
                  assertionAvailable={dialogs.model.assertionAvailable}
                  onCollapse={layout.actions.collapseTimeline}
                  replayResults={replay.model.results}
                  locked={workflow.model.locked}
                  reviewLocked={workflow.model.reviewLocked}
                />
                <div
                  className="panel-resizer timeline-resizer"
                  role="separator"
                  tabIndex={workflow.model.reviewLocked ? -1 : 0}
                  aria-disabled={workflow.model.reviewLocked || undefined}
                  aria-label="Resize workflow timeline"
                  aria-orientation="vertical"
                  aria-valuemin={layout.model.panelLimits.timeline.min}
                  aria-valuemax={layout.model.panelLimits.timeline.max}
                  aria-valuenow={layout.model.timelineWidth}
                  onPointerDown={
                    workflow.model.reviewLocked
                      ? undefined
                      : (event) => layout.actions.beginPanelResize("timeline", event)
                  }
                  onKeyDown={
                    workflow.model.reviewLocked
                      ? undefined
                      : (event) => layout.actions.resizePanelWithKeyboard("timeline", event)
                  }
                />
              </>
            ) : null}
          </div>
          <div id="browser-workspace" className="main-stage" tabIndex={-1}>
            <BrowserPanel
              model={browser.model}
              actions={browser.actions}
              emptyState={browser.emptyState}
              alert={browser.alert}
              toolbar={replay.model.locked ? (
                <ReplayControls
                  status={replay.model.status}
                  currentIndex={replay.model.currentIndex}
                  totalSteps={replay.model.totalSteps}
                  failed={replay.model.currentResult?.status === "failed"}
                  phase={replay.model.currentResult?.phase}
                  onPause={replay.actions.pause}
                  onResume={replay.actions.resume}
                  onRetry={replay.actions.retry}
                  onSkip={replay.actions.skip}
                  onTakeControl={replay.actions.takeControl}
                  onStop={replay.actions.stop}
                />
              ) : (
                <RecorderControls
                  status={recorder.model.status}
                  transportStatus={recorder.model.transportStatus}
                  startedAt={recorder.model.startedAt}
                  onStart={recorder.actions.start}
                  onStop={recorder.actions.stop}
                  announce
                />
              )}
              emptyActions={(
                <>
                  {browser.emptyState.replayReadyCount ? (
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => replay.actions.request()}
                      disabled={browser.emptyState.replayDisabled}
                    >
                      Replay workflow <Play size={17} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    className={`button ${
                      browser.emptyState.replayReadyCount ? "button-secondary" : "button-primary"
                    }`}
                    type="button"
                    onClick={recorder.actions.start}
                    disabled={browser.emptyState.startDisabled}
                  >
                    Start recording <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </>
              )}
              contentOverlay={
                replay.model.currentResult?.status === "failed" && replay.model.currentResult.diagnostic ? (
                  <ReplayFailurePanel
                    message={replay.model.currentResult.diagnostic.message}
                    onRetry={replay.actions.retry}
                    onSkip={replay.actions.skip}
                    onTakeControl={replay.actions.takeControl}
                    onStop={replay.actions.stop}
                  />
                ) : null
              }
            />
          </div>
          <aside
            className={`inspector-shell ${layout.model.inspectorCollapsed ? "collapsed" : ""}`}
            aria-label="Selected step editor"
          >
            {layout.model.inspectorCollapsed ? (
              <div className="panel-rail panel-rail-right">
                <button
                  id="inspector-expand"
                  className="rail-button"
                  type="button"
                  disabled={workflow.model.reviewLocked}
                  onClick={layout.actions.expandInspector}
                  aria-label="Expand step details"
                  title="Expand details"
                >
                  <ChevronLeft size={19} aria-hidden="true" />
                  <span>Details</span>
                </button>
              </div>
            ) : (
              <>
                <div
                  className="panel-resizer inspector-resizer"
                  role="separator"
                  tabIndex={workflow.model.reviewLocked ? -1 : 0}
                  aria-disabled={workflow.model.reviewLocked || undefined}
                  aria-label="Resize step details"
                  aria-orientation="vertical"
                  aria-valuemin={layout.model.panelLimits.inspector.min}
                  aria-valuemax={layout.model.panelLimits.inspector.max}
                  aria-valuenow={layout.model.inspectorWidth}
                  onPointerDown={
                    workflow.model.reviewLocked
                      ? undefined
                      : (event) => layout.actions.beginPanelResize("inspector", event)
                  }
                  onKeyDown={
                    workflow.model.reviewLocked
                      ? undefined
                      : (event) => layout.actions.resizePanelWithKeyboard("inspector", event)
                  }
                />
                <StepEditor
                  step={workflow.model.selectedStep}
                  onUpdate={workflow.actions.updateStep}
                  onCollapse={layout.actions.collapseInspector}
                  locked={workflow.model.locked}
                  reviewLocked={workflow.model.reviewLocked}
                  replayResult={
                    workflow.model.selectedStep
                      ? replay.model.results[workflow.model.selectedStep.id]
                      : undefined
                  }
                  onRunFromHere={() => {
                    if (workflow.model.selectedStep) replay.actions.request(workflow.model.selectedStep.id);
                  }}
                />
              </>
            )}
          </aside>
        </main>
        {workflowState.deletedStep ? (
          <div className="undo-toast">
            <span role="status" aria-live="polite">Step deleted</span>
            <div className="undo-toast-actions">
              <button className="undo-toast-action" type="button" onClick={workflow.actions.undoDelete}>
                <RotateCcw size={16} aria-hidden="true" /> Undo
              </button>
              <button
                className="undo-toast-close"
                type="button"
                onClick={workflow.actions.dismissDelete}
                aria-label="Dismiss undo notification"
                title="Dismiss"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}
        {workflow.model.persistenceError ? (
          <div className="workspace-persistence-alert" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <span>{workflow.model.persistenceError}</span>
            {workflow.model.persistenceStatus === "conflict" ? (
              <button className="button button-secondary" type="button" onClick={workflow.actions.reload}>
                Reload saved version
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="sr-only" aria-live="polite">{layout.model.announcement}</div>
      </div>
      <AssertionStepDialog
        open={Boolean(dialogs.model.assertionSelection)}
        order={workflowState.workflow.steps.length}
        selection={dialogs.model.assertionSelection}
        onClose={dialogs.actions.closeAssertion}
        onInsert={workflow.actions.insertStep}
      />
      <RunWorkflowDialog
        open={dialogs.model.runDialogOpen}
        sensitive={dialogs.model.workflowContainsSensitiveValues}
        startStepName={dialogs.model.pendingReplayStep?.name}
        runtimeFields={dialogs.model.runtimeFields}
        blockedReason={dialogs.model.blockedReason}
        libraryHref={dialogs.model.libraryHref}
        canRun={dialogs.model.canRun}
        onRuntimeValueChange={dialogs.actions.updateRuntimeValue}
        onRetryProfile={
          dialogs.model.profileRetryAvailable
            ? dialogs.actions.retryRunProfile
            : undefined
        }
        onClose={dialogs.actions.closeRun}
        onRun={replay.actions.start}
      />
      <Modal
        open={dialogs.model.confirmation === "sensitiveExport"}
        title="This export contains sensitive values"
        description="Passwords, tokens, or payment-related fields were detected."
        onClose={dialogs.actions.closeConfirmation}
      >
        <p className="modal-copy">
          The downloaded JSON contains recorded values in plain text. Store it like a secret and do not commit it to
          source control.
        </p>
        <div className="modal-actions">
          <button className="button button-ghost" type="button" onClick={dialogs.actions.closeConfirmation}>Cancel</button>
          <button className="button button-danger" type="button" onClick={dialogs.actions.confirmSensitiveExport}>
            Export sensitive JSON
          </button>
        </div>
      </Modal>
    </>
  );
}
