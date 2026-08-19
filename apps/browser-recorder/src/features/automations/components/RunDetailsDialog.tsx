import { Modal } from "@/shared/ui/modal";
import type { AutomationRun } from "../model/automationWorkspace";
import styles from "../AutomationsScreen.module.css";

interface RunDetailsDialogProps {
  run: AutomationRun;
  onClose: () => void;
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
        <div><dt>Status</dt><dd>{run.failedStep ? `Failed at step ${run.failedStep}` : "Failed"}</dd></div>
        <div><dt>Failure</dt><dd>{run.detail ?? "The workflow did not complete."}</dd></div>
      </dl>
      <div className="modal-actions">
        <button className="button button-primary" type="button" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
