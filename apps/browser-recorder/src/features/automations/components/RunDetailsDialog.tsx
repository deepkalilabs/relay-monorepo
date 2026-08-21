import { Modal } from "@/shared/ui/modal";
import type { AutomationRun } from "../model/automationWorkspace";
import styles from "../AutomationsScreen.module.css";

interface RunDetailsDialogProps {
  run: AutomationRun;
  onClose: () => void;
}

function assertionKindLabel(kind: AutomationRun["assertionResults"][number]["kind"]): string {
  return {
    visible: "Visible",
    text_contains: "Text contains",
    group_exists: "Group exists",
    page_text_contains: "Page text match",
  }[kind];
}

export function RunDetailsDialog({ run, onClose }: RunDetailsDialogProps) {
  return (
    <Modal
      open
      title={`${run.name} run details`}
      description={`Recorded ${run.updated}.`}
      onClose={onClose}
    >
      <dl className={styles.runDetails}>
        <div>
          <dt>Status</dt>
          <dd>{run.state === "completed"
            ? "Completed"
            : run.failedStep ? `Failed at step ${run.failedStep}` : "Failed"}</dd>
        </div>
        {run.durationMs === undefined ? null : (
          <div><dt>Duration</dt><dd>{run.durationMs} ms</dd></div>
        )}
        {run.state === "failed" ? (
          <div><dt>Failure</dt><dd>{run.detail ?? "The workflow did not complete."}</dd></div>
        ) : null}
      </dl>
      {run.assertionResults.length > 0 ? (
        <section className={styles.assertionResults} aria-labelledby="assertion-results-title">
          <h3 id="assertion-results-title">Executed assertions</h3>
          <ul>
            {run.assertionResults.map((assertion) => (
              <li key={assertion.stepId}>
                <strong>{assertion.stepName}</strong>
                <span>{assertionKindLabel(assertion.kind)} · {assertion.durationMs} ms</span>
                <span>Matched: {assertion.matched ? "Yes" : "No"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="modal-actions">
        <button className="button button-primary" type="button" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
