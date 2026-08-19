import type { AutomationThumbnailVariant } from "../model/automationWorkspace";
import styles from "../AutomationsScreen.module.css";

export function AutomationThumbnail({ variant }: { variant: AutomationThumbnailVariant }) {
  return (
    <span className={styles.thumbnail} data-variant={variant} aria-hidden="true">
      <span className={styles.thumbnailChrome}><i /><i /><i /></span>
      <span className={styles.thumbnailCanvas}><i /><i /><i /><i /></span>
    </span>
  );
}
