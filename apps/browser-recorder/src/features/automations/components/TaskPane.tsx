import { Info, Play, Plus, X } from "lucide-react";
import type { AutomationFolder, AutomationTask } from "../model/automationWorkspace";
import { AutomationThumbnail } from "./AutomationThumbnail";
import styles from "../AutomationsScreen.module.css";

interface TaskPaneProps {
  folder: AutomationFolder;
  tasks: AutomationTask[];
  runnableCount: number;
  includesNestedFolders: boolean;
  runActive: boolean;
  loading?: boolean;
  error?: string | null;
  invalidFileCount?: number;
  onAdd: () => void;
  onRemove: (taskId: string) => void;
  onRun: () => void;
}

export function TaskPane({
  folder,
  tasks,
  runnableCount,
  includesNestedFolders,
  runActive,
  loading = false,
  error = null,
  invalidFileCount = 0,
  onAdd,
  onRemove,
  onRun,
}: TaskPaneProps) {
  const inboxSelected = folder.id === "inbox";
  const readOnly = Boolean(folder.readOnly);
  const itemNoun = readOnly
    ? (tasks.length === 1 ? "workflow" : "workflows")
    : (tasks.length === 1 ? "task" : "tasks");
  return (
    <section className={styles.tasks} aria-label={`${folder.name} ${readOnly ? "workflows" : "tasks"}`}>
      <header className={styles.taskHeader}>
        <div>
          <h2>{folder.name}</h2>
          <p>
            {loading ? "Loading workflows…" : `${tasks.length} ${itemNoun}`}
            {includesNestedFolders ? " · Includes nested folders" : ""}
          </p>
        </div>
        <div className={styles.taskActions}>
          <button
            className={styles.primaryAction}
            type="button"
            disabled={readOnly || loading || Boolean(error) || !runnableCount || runActive}
            onClick={onRun}
          >
            <Play size={14} fill="currentColor" aria-hidden="true" />
            {runActive ? "Running folder…" : "Run folder"}
          </button>
          <button
            className={styles.secondaryAction}
            type="button"
            disabled={readOnly || inboxSelected}
            onClick={onAdd}
          >
            <Plus size={15} aria-hidden="true" />
            Add task
          </button>
        </div>
      </header>
      <h3 className={styles.sectionLabel}>{readOnly ? "Workflows" : "Tasks"}</h3>
      {invalidFileCount ? (
        <p className={styles.taskWarning} role="note">
          {invalidFileCount} workflow {invalidFileCount === 1 ? "file" : "files"} could not be loaded.
        </p>
      ) : null}
      {loading ? (
        <div className={styles.emptyTasks} role="status" aria-busy="true">
          <p>Loading workflows…</p>
          <span>The rest of Automations remains available.</span>
        </div>
      ) : error ? (
        <div className={styles.emptyTasks} role="alert">
          <p>{error}</p>
          <span>Refresh the page to try again.</span>
        </div>
      ) : tasks.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.taskTable}>
            <thead>
              <tr>
                <th scope="col">{readOnly ? "Workflow" : "Task"}</th>
                <th scope="col">Steps</th>
                <th scope="col">Last updated</th>
                <th scope="col"><span className="sr-only">Folder action</span></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <th scope="row">
                    <span className={styles.taskIdentity}>
                      <AutomationThumbnail variant={task.thumbnail} />
                      <span>{task.name}</span>
                    </span>
                  </th>
                  <td>{task.steps} {task.steps === 1 ? "step" : "steps"}</td>
                  <td>{task.status === "draft" ? "Draft · " : ""}{task.updated}</td>
                  <td>
                    {!inboxSelected && !readOnly ? (
                      <button
                        className={styles.removeAction}
                        type="button"
                        aria-label={`Remove ${task.name} from folder`}
                        onClick={() => onRemove(task.id)}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.emptyTasks} role="status">
          <p>{readOnly ? "No saved workflows." : "No tasks in this folder."}</p>
          <span>{readOnly ? "Create a recording in Library to get started." : "Add a task from Inbox to get started."}</span>
        </div>
      )}
      {!inboxSelected && !readOnly ? (
        <p className={styles.taskNote}>
          <Info size={14} aria-hidden="true" />
          Removing a task returns it to Inbox.
        </p>
      ) : readOnly ? (
        <p className={styles.taskNote}>
          <Info size={14} aria-hidden="true" />
          All workflows mirrors your saved Library workflows and is read-only for now.
        </p>
      ) : null}
    </section>
  );
}
