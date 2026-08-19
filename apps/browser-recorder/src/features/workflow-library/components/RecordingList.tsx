import type { LibraryWorkflowItem } from "@/shared/contracts/workflow/library";
import styles from "../LibraryScreen.module.css";

interface RecordingListProps {
  workflows: readonly LibraryWorkflowItem[];
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
}

const THUMBNAIL_VARIANTS = [
  "search",
  "analytics",
  "products",
  "checkout",
  "calendar",
  "inbox",
  "profile",
  "table",
  "settings",
  "article",
] as const;

function thumbnailVariantForTitle(title: string): (typeof THUMBNAIL_VARIANTS)[number] {
  let hash = 2_166_136_261;
  for (const character of title.normalize("NFKC").trim().toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return THUMBNAIL_VARIANTS[(hash >>> 0) % THUMBNAIL_VARIANTS.length];
}

function RecordingThumbnail({ title }: { title: string }) {
  return (
    <span className="workflow-thumb" data-variant={thumbnailVariantForTitle(title)} aria-hidden="true">
      <span className="workflow-thumb__chrome">
        <i />
        <i />
        <i />
      </span>
      <span className="workflow-thumb__canvas">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

function updatedLabel(updatedAt: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(updatedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

export function RecordingList({ workflows, selectedWorkflowId, onSelect }: RecordingListProps) {
  return (
    <section className={styles.recordingList} aria-labelledby="workflows-heading">
      <h2 id="workflows-heading" className={styles.listHeading}>
        Workflows
      </h2>
      <ul className={styles.recordingItems}>
        {workflows.map((workflow) => {
          const selected = workflow.id === selectedWorkflowId;
          return (
            <li className={styles.recordingItem} key={workflow.id}>
              <button
                className={`${styles.recordingButton} ${selected ? styles.recordingButtonSelected : ""}`}
                type="button"
                aria-label={`Select ${workflow.name} workflow`}
                aria-pressed={selected}
                onClick={() => onSelect(workflow.id)}
              >
                <RecordingThumbnail title={workflow.name} />
                <span className={styles.recordingCopy}>
                  <strong>{workflow.name}</strong>
                  <span>
                    {workflow.steps.length} steps · {updatedLabel(workflow.updatedAt)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
