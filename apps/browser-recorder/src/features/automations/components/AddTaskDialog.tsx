"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/shared/ui/modal";
import type { AutomationFolder, AutomationTask } from "../model/automationWorkspace";
import styles from "../AutomationsScreen.module.css";

interface AddTaskDialogProps {
  folder: AutomationFolder;
  inboxTasks: AutomationTask[];
  onClose: () => void;
  onAdd: (taskId: string) => void;
}

export function AddTaskDialog({
  folder,
  inboxTasks,
  onClose,
  onAdd,
}: AddTaskDialogProps) {
  const [taskId, setTaskId] = useState(inboxTasks[0]?.id ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (taskId) onAdd(taskId);
  };

  return (
    <Modal
      open
      title={`Add task to ${folder.name}`}
      description="Choose a task from Inbox. The move resets when the page is refreshed."
      onClose={onClose}
    >
      {inboxTasks.length ? (
        <form className="modal-form" onSubmit={submit}>
          <label className={styles.dialogField}>
            <span>Inbox task</span>
            <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              {inboxTasks.map((task) => (
                <option value={task.id} key={task.id}>{task.name}</option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <button className="button button-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit">
              Add task to {folder.name}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="modal-copy">Inbox has no available tasks.</p>
          <div className="modal-actions">
            <button className="button button-primary" type="button" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Modal>
  );
}
