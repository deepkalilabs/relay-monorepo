"use client";

import { AlertTriangle, Plus, Search, SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ProfileSummary } from "@/shared/contracts/profile";
import type { WorkflowLibraryResponse } from "@/shared/contracts/workflow/library";
import { LibrarySidebar } from "./LibrarySidebar";
import { RecordingDetails } from "./RecordingDetails";
import { RecordingList } from "./RecordingList";
import {
  workflowLibraryClient,
  type WorkflowLibraryClient,
} from "../api/workflowLibraryClient";
import {
  parameterProfileClient,
  type ParameterProfileClient,
} from "../api/parameterProfileClient";
import styles from "../LibraryScreen.module.css";

export interface LibraryScreenProps {
  client?: WorkflowLibraryClient;
  profileClient?: ParameterProfileClient;
  initialSelectedId?: string;
}

const initialData: WorkflowLibraryResponse | null = null;

export function LibraryScreen({
  client = workflowLibraryClient,
  profileClient = parameterProfileClient,
  initialSelectedId = "",
}: LibraryScreenProps) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(initialSelectedId);
  const [creating, setCreating] = useState(false);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.list().then(
      (result) => {
        if (!active) return;
        setData(result);
        setError(null);
      },
      () => {
        if (!active) return;
        setError("Library could not be loaded. Refresh the page to try again.");
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    profileClient.list().then(
      (result) => {
        if (!active) return;
        setProfiles(result.profiles);
        setProfilesError(null);
        setProfilesLoading(false);
      },
      () => {
        if (!active) return;
        setProfiles([]);
        setProfilesError("Profiles could not be loaded.");
        setProfilesLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [profileClient]);

  const visibleWorkflows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!data) return [];
    if (!normalizedQuery) return data.workflows;
    return data.workflows.filter((workflow) => workflow.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [data, query]);
  const selectedWorkflow =
    visibleWorkflows.find((workflow) => workflow.id === selectedWorkflowId) ?? visibleWorkflows[0];

  const createRecording = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const workflow = await client.create();
      router.push(`/workflows/${workflow.id}/edit`);
    } catch {
      setCreating(false);
      setError("A new recording could not be created. Try again.");
    }
  };

  if (!data && !error) {
    return (
      <main className={styles.viewportState} aria-busy="true">
        <p role="status">Loading workflows…</p>
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
        <LibrarySidebar />
        <main className={styles.content}>
          <header className={styles.pageHeader}>
            <div>
              <h1>Library</h1>
              <p>Browse and continue your saved workflows.</p>
            </div>
            <button
              className={styles.newRecording}
              type="button"
              disabled={creating}
              onClick={() => void createRecording()}
            >
              {creating ? "Creating…" : "New recording"}
              <Plus size={17} aria-hidden="true" />
            </button>
          </header>
          <div className={styles.libraryTools}>
            <label className={styles.search}>
              <span className="sr-only">Search workflows</span>
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="Search workflows"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {data?.invalidFileCount ? (
              <p className={styles.libraryWarning} role="note">
                {data.invalidFileCount} workflow {data.invalidFileCount === 1 ? "file" : "files"} could not be loaded.
              </p>
            ) : null}
          </div>
          {error ? (
            <section className={styles.emptyState} role="alert">
              <AlertTriangle size={26} aria-hidden="true" />
              <h2>Library could not be loaded</h2>
              <p>{error}</p>
            </section>
          ) : selectedWorkflow ? (
            <div className={styles.workspace}>
              <RecordingList
                workflows={visibleWorkflows}
                selectedWorkflowId={selectedWorkflow.id}
                onSelect={setSelectedWorkflowId}
              />
              <RecordingDetails
                workflow={selectedWorkflow}
                workflowClient={client}
                profileClient={profileClient}
                profiles={profiles}
                profilesLoading={profilesLoading}
                profilesError={profilesError}
                navigate={(url) => router.push(url)}
              />
            </div>
          ) : (
            <section className={styles.emptyState} role="status">
              <SearchX size={26} aria-hidden="true" />
              <h2>{data?.workflows.length ? "No workflows match" : "No saved workflows"}</h2>
              <p>{data?.workflows.length ? "Try a different search term." : "Create a recording to get started."}</p>
            </section>
          )}
        </main>
      </div>
    </>
  );
}
