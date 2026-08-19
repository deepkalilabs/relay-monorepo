import { ChevronDown, ChevronRight, Folder, Plus } from "lucide-react";
import {
  ALL_WORKFLOWS_FOLDER_ID,
  taskCountForFolder,
  type AutomationFolder,
  type AutomationWorkspaceState,
} from "../model/automationWorkspace";
import styles from "../AutomationsScreen.module.css";

interface FolderNodeProps {
  folder: AutomationFolder;
  state: AutomationWorkspaceState;
  count?: number;
  onSelect: (folderId: string) => void;
  onToggle: (folderId: string) => void;
}

function Count({ value }: { value: number }) {
  return <span className={styles.folderCount}>{value}</span>;
}

function FolderNode({ folder, state, count, onSelect, onToggle }: FolderNodeProps) {
  const children = state.folders.filter((candidate) => candidate.parentId === folder.id);
  const expanded = state.expandedFolderIds.includes(folder.id);
  const selected = state.selectedFolderId === folder.id;
  return (
    <div className={styles.folderNode}>
      <div className={`${styles.folderRow} ${selected ? styles.folderRowSelected : ""}`}>
        {children.length ? (
          <button
            className={styles.folderToggle}
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name} folder`}
            aria-expanded={expanded}
            onClick={() => onToggle(folder.id)}
          >
            {expanded
              ? <ChevronDown size={15} aria-hidden="true" />
              : <ChevronRight size={15} aria-hidden="true" />}
          </button>
        ) : <span className={styles.folderTogglePlaceholder} />}
        <Folder size={17} aria-hidden="true" />
        <button
          className={styles.folderSelect}
          type="button"
          aria-label={`Select ${folder.name} folder`}
          aria-pressed={selected}
          onClick={() => onSelect(folder.id)}
        >
          {folder.name}
        </button>
        <Count value={count ?? taskCountForFolder(state, folder.id)} />
      </div>
      {children.length && expanded ? (
        <div className={styles.folderChildren}>
          {children.map((child) => (
            <FolderNode
              folder={child}
              state={state}
              onSelect={onSelect}
              onToggle={onToggle}
              key={child.id}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface FolderPaneProps {
  state: AutomationWorkspaceState;
  allWorkflowsCount: number;
  onNew: () => void;
  onSelect: (folderId: string) => void;
  onToggle: (folderId: string) => void;
}

export function FolderPane({
  state,
  allWorkflowsCount,
  onNew,
  onSelect,
  onToggle,
}: FolderPaneProps) {
  const allWorkflows = state.folders.find((folder) => folder.id === ALL_WORKFLOWS_FOLDER_ID)!;
  const inbox = state.folders.find((folder) => folder.id === "inbox")!;
  const roots = state.folders.filter((folder) => (
    folder.parentId === null
    && folder.id !== "inbox"
    && folder.id !== ALL_WORKFLOWS_FOLDER_ID
  ));
  return (
    <section className={styles.folders} aria-label="Automation folders">
      <header className={styles.paneHeader}>
        <h2>Folders</h2>
        <button className={styles.textAction} type="button" onClick={onNew}>
          <Plus size={15} aria-hidden="true" />
          New folder
        </button>
      </header>
      <div className={styles.folderTree}>
        <FolderNode
          folder={allWorkflows}
          state={state}
          count={allWorkflowsCount}
          onSelect={onSelect}
          onToggle={onToggle}
        />
        <FolderNode folder={inbox} state={state} onSelect={onSelect} onToggle={onToggle} />
        {roots.map((folder) => (
          <FolderNode
            folder={folder}
            state={state}
            onSelect={onSelect}
            onToggle={onToggle}
            key={folder.id}
          />
        ))}
      </div>
    </section>
  );
}
