"use client";

import {
  AlertTriangle,
  Plus,
  SearchX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  type Profile,
  type ProfileInput,
  type ProfileSummary,
} from "@/shared/contracts/profile";
import { Modal } from "@/shared/ui/modal";
import { AppSidebar } from "@/shared/ui/navigation";
import {
  ProfileRequestError,
  profileClient,
  type ProfileClient,
} from "./api/profileClient";
import { ProfileDetails } from "./components/ProfileDetails";
import { ProfileList } from "./components/ProfileList";
import styles from "./ProfileScreen.module.css";

const emptyProfile: ProfileInput = {
  name: "Untitled profile",
  identity: { fullName: "", email: "" },
  location: { countryRegion: "", postalCode: "" },
};

function profileInput(profile: Profile): ProfileInput {
  return {
    name: profile.name,
    identity: { ...profile.identity },
    location: { ...profile.location },
  };
}

function summaryFor(profile: Profile): ProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    status: profile.status,
    updatedAt: profile.updatedAt,
  };
}

function sortSummaries(profiles: ProfileSummary[]): ProfileSummary[] {
  return [...profiles].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export interface ProfileScreenProps {
  client?: ProfileClient;
  initialSelectedId?: string;
}

export function ProfileScreen({
  client = profileClient,
  initialSelectedId = "",
}: ProfileScreenProps) {
  const router = useRouter();
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const [invalidFileCount, setInvalidFileCount] = useState(0);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [persistedProfile, setPersistedProfile] = useState<Profile | null>(null);
  const [input, setInput] = useState<ProfileInput | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.list().then(
      (result) => {
        if (!active) return;
        setListError(null);
        setCreating(false);
        setPersistedProfile(null);
        setInput(null);
        setProfiles(result.profiles);
        setInvalidFileCount(result.invalidFileCount);
        const target = result.profiles.some(({ id }) => id === initialSelectedId)
          ? initialSelectedId
          : (result.profiles[0]?.id ?? "");
        setDetailLoading(Boolean(target));
        setSelectedId(target);
      },
      () => {
        if (!active) return;
        setProfiles([]);
        setListError("Profiles could not be loaded. Refresh the page to try again.");
      },
    );
    return () => {
      active = false;
    };
  }, [client, initialSelectedId]);

  const profilesLoaded = profiles !== null;

  useEffect(() => {
    if (
      !selectedId ||
      creating ||
      !profilesLoaded ||
      persistedProfile?.id === selectedId
    ) return;
    let active = true;
    client.get(selectedId).then(
      (profile) => {
        if (!active) return;
        setPersistedProfile(profile);
        setInput(profileInput(profile));
        setDetailLoading(false);
      },
      () => {
        if (!active) return;
        setDetailLoading(false);
        setOperationError("This profile could not be loaded. Select another profile or refresh the page.");
      },
    );
    return () => {
      active = false;
    };
  }, [client, creating, persistedProfile, profilesLoaded, selectedId]);

  const dirty = useMemo(() => {
    if (!input) return false;
    if (creating || !persistedProfile) return true;
    return JSON.stringify(input) !== JSON.stringify(profileInput(persistedProfile));
  }, [creating, input, persistedProfile]);

  const selectProfile = (id: string) => {
    setCreating(false);
    setSelectedId(id);
    setPersistedProfile(null);
    setInput(null);
    setOperationError(null);
    setConflict(false);
    setAnnouncement("");
    setDetailLoading(true);
    router.replace(`/profile?selected=${id}`);
  };

  const startNewProfile = () => {
    setCreating(true);
    setSelectedId("");
    setPersistedProfile(null);
    setInput({
      ...emptyProfile,
      identity: { ...emptyProfile.identity },
      location: { ...emptyProfile.location },
    });
    setOperationError(null);
    setConflict(false);
    setAnnouncement("");
    router.replace("/profile");
  };

  const saveProfile = async () => {
    if (!input || saving) return;
    setSaving(true);
    setOperationError(null);
    setConflict(false);
    setAnnouncement("");
    try {
      const saved = creating || !persistedProfile
        ? await client.create(input)
        : await client.save(persistedProfile.id, input, persistedProfile.revision);
      setProfiles((current) => sortSummaries([
        summaryFor(saved),
        ...(current ?? []).filter(({ id }) => id !== saved.id),
      ]));
      setCreating(false);
      setSelectedId(saved.id);
      setPersistedProfile(saved);
      setInput(profileInput(saved));
      setAnnouncement("Profile saved.");
      router.replace(`/profile?selected=${saved.id}`);
    } catch (error) {
      const isConflict = error instanceof ProfileRequestError && error.status === 409;
      setConflict(isConflict);
      setOperationError(
        error instanceof Error ? error.message : "The profile could not be saved. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadProfile = async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setOperationError(null);
    setConflict(false);
    try {
      const profile = await client.get(selectedId);
      setPersistedProfile(profile);
      setInput(profileInput(profile));
      setAnnouncement("Saved profile reloaded.");
    } catch {
      setOperationError("The saved profile could not be reloaded. Try again.");
    } finally {
      setDetailLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!persistedProfile || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.delete(persistedProfile.id, persistedProfile.revision);
      const current = profiles ?? [];
      const deletedIndex = current.findIndex(({ id }) => id === persistedProfile.id);
      const remaining = current.filter(({ id }) => id !== persistedProfile.id);
      setProfiles(remaining);
      setDeleteOpen(false);
      setPersistedProfile(null);
      setInput(null);
      const next = remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)];
      if (next) {
        selectProfile(next.id);
      } else {
        setSelectedId("");
        setCreating(false);
        setAnnouncement("Profile deleted.");
        router.replace("/profile");
      }
    } catch (error) {
      if (error instanceof ProfileRequestError && error.status === 409) {
        setDeleteError("This profile changed since it was loaded. Close this dialog and reload the saved version.");
      } else {
        setDeleteError("The profile could not be deleted. Try again.");
      }
    } finally {
      setDeleting(false);
    }
  };

  if (profiles === null && !listError) {
    return (
      <main className={styles.viewportState} aria-busy="true">
        <p role="status">Loading profiles…</p>
      </main>
    );
  }

  return (
    <>
      <div className={styles.viewportGuard} role="main">
        <AlertTriangle size={28} aria-hidden="true" />
        <h1>A larger screen is required</h1>
        <p>Memory Recorder is a desktop workspace designed for viewports at least 1024px wide.</p>
      </div>
      <div className={styles.shell}>
        <AppSidebar activeDestination="profiles" />
        <main className={styles.content}>
          <div className={styles.workspace}>
            <ProfileList
              profiles={profiles ?? []}
              selectedId={selectedId}
              invalidFileCount={invalidFileCount}
              onNew={startNewProfile}
              onSelect={selectProfile}
            />
            {listError ? (
              <section className={styles.emptyState} role="alert">
                <AlertTriangle size={26} aria-hidden="true" />
                <h2>Profiles could not be loaded</h2>
                <p>{listError}</p>
              </section>
            ) : detailLoading || (Boolean(selectedId) && !input && !operationError) ? (
              <section className={styles.emptyState} aria-busy="true">
                <p role="status">Loading profile…</p>
              </section>
            ) : input ? (
              <ProfileDetails
                input={input}
                persisted={Boolean(persistedProfile)}
                dirty={dirty}
                saving={saving}
                error={operationError}
                conflict={conflict}
                announcement={announcement}
                onChange={(next) => {
                  setInput(next);
                  setOperationError(null);
                  setConflict(false);
                  setAnnouncement("");
                }}
                onDelete={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
                onReload={() => void reloadProfile()}
                onSave={() => void saveProfile()}
              />
            ) : operationError ? (
              <section className={styles.emptyState} role="alert">
                <AlertTriangle size={26} aria-hidden="true" />
                <h2>Profile could not be loaded</h2>
                <p>{operationError}</p>
              </section>
            ) : (
              <section className={styles.emptyState}>
                <SearchX size={26} aria-hidden="true" />
                <h2>No saved profiles</h2>
                <p>Create a profile to reuse identity, location, and browser details.</p>
                <button className={styles.primaryAction} type="button" onClick={startNewProfile}>
                  New profile
                  <Plus size={16} aria-hidden="true" />
                </button>
              </section>
            )}
          </div>
        </main>
      </div>
      <Modal
        open={deleteOpen}
        title={`Delete ${persistedProfile?.name ?? "profile"}?`}
        description="This action cannot be undone."
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
      >
        <p className="modal-copy">
          This will permanently delete the profile and its local JSON file.
        </p>
        {deleteError ? <p className="field-error" role="alert">{deleteError}</p> : null}
        <div className="modal-actions">
          <button
            className="button button-ghost"
            type="button"
            disabled={deleting}
            onClick={() => setDeleteOpen(false)}
          >
            Cancel
          </button>
          <button
            className="button button-danger"
            type="button"
            disabled={deleting}
            onClick={() => void confirmDelete()}
          >
            {deleting ? "Deleting…" : "Delete profile"}
          </button>
        </div>
      </Modal>
    </>
  );
}
