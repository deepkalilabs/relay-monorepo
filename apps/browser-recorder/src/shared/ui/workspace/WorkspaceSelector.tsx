import { Database, FolderOpen } from "lucide-react";
import type { WorkspaceOption } from "@/shared/api/workspaceClient";
import styles from "./Workspace.module.css";

interface WorkspaceSelectorProps {
  actionLabel: string;
  options: WorkspaceOption[];
  selectedKey: string;
  warning?: string;
  onChange: (key: string) => void;
  onSubmit: () => void;
}

export function WorkspaceSelector({
  actionLabel,
  options,
  selectedKey,
  warning,
  onChange,
  onSubmit,
}: WorkspaceSelectorProps) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <fieldset className={styles.options}>
        <legend className="sr-only">Available workspaces</legend>
        {options.map((option) => {
          const Icon = option.source === "local" ? FolderOpen : Database;
          return (
            <label className={styles.option} key={option.key}>
              <input
                type="radio"
                name="workspace"
                value={option.key}
                checked={selectedKey === option.key}
                onChange={() => onChange(option.key)}
              />
              <Icon size={18} aria-hidden="true" />
              <span>
                <strong>{option.name}</strong>
                <small>{option.source === "local" ? "Files on this machine" : "Relay namespace"}</small>
              </span>
            </label>
          );
        })}
      </fieldset>
      {warning ? <p className={styles.warning} role="note">{warning}</p> : null}
      <div className={styles.actions}>
        <button className="button button-primary" type="submit" disabled={!selectedKey}>
          {actionLabel}
        </button>
      </div>
    </form>
  );
}
