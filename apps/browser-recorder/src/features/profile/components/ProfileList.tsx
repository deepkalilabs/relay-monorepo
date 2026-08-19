import { Plus, UserRound } from "lucide-react";
import type { ProfileSummary } from "@/shared/contracts/profile";
import styles from "../ProfileScreen.module.css";

interface ProfileListProps {
  profiles: ProfileSummary[];
  selectedId: string;
  invalidFileCount: number;
  onNew: () => void;
  onSelect: (id: string) => void;
}

function updatedLabel(value: string): string {
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))}`;
}

export function ProfileList({
  profiles,
  selectedId,
  invalidFileCount,
  onNew,
  onSelect,
}: ProfileListProps) {
  return (
    <section className={styles.profileList} aria-label="Saved profiles">
      <header className={styles.listHeader}>
        <h1>Profiles</h1>
        <button className={styles.secondaryAction} type="button" onClick={onNew}>
          New profile
          <Plus size={16} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.listBody}>
        {invalidFileCount ? (
          <p className={styles.libraryWarning} role="note">
            {invalidFileCount} profile {invalidFileCount === 1 ? "file" : "files"} could not be loaded.
          </p>
        ) : null}
        <ul className={styles.profileItems}>
          {profiles.map((profile) => {
            const selected = profile.id === selectedId;
            return (
              <li key={profile.id}>
                <button
                  className={`${styles.profileItem} ${selected ? styles.profileItemSelected : ""}`}
                  type="button"
                  aria-label={`Select ${profile.name} profile`}
                  aria-pressed={selected}
                  onClick={() => onSelect(profile.id)}
                >
                  <span className={styles.profileIcon} aria-hidden="true">
                    <UserRound size={25} />
                  </span>
                  <span className={styles.profileCopy}>
                    <strong>{profile.name || "Untitled profile"}</strong>
                    <span>{updatedLabel(profile.updatedAt)} · {profile.status === "ready" ? "Ready" : "Draft"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
