"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/shared/ui/modal";
import {
  folderNameError,
  type AutomationFolder,
  type AutomationWorkspaceState,
} from "../model/automationWorkspace";
import styles from "../AutomationsScreen.module.css";

interface CreateFolderDialogProps {
  state: AutomationWorkspaceState;
  onClose: () => void;
  onCreate: (name: string, parentId: string | null) => void;
}

export function CreateFolderDialog({
  state,
  onClose,
  onCreate,
}: CreateFolderDialogProps) {
  const selectedFolder = state.folders.find((folder) => folder.id === state.selectedFolderId);
  const initialParentId = selectedFolder?.system ? "" : state.selectedFolderId;
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(initialParentId);
  const [submitted, setSubmitted] = useState(false);
  const error = submitted ? folderNameError(state, name, parentId || null) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (folderNameError(state, name, parentId || null)) return;
    onCreate(name, parentId || null);
  };

  const availableParents = state.folders.filter((folder) => !folder.system);

  return (
    <Modal
      open
      title="Create folder"
      description="This folder exists only until the page is refreshed."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <label className={styles.dialogField}>
          <span>Folder name</span>
          <input
            maxLength={80}
            value={name}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "folder-name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setSubmitted(false);
            }}
          />
        </label>
        {error ? <p className="field-error" id="folder-name-error">{error}</p> : null}
        <label className={styles.dialogField}>
          <span>Parent folder</span>
          <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">Top level</option>
            {availableParents.map((folder: AutomationFolder) => (
              <option value={folder.id} key={folder.id}>{folder.name}</option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button className="button button-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit">Create folder</button>
        </div>
      </form>
    </Modal>
  );
}
