"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { workflowListClient, type WorkflowListClient } from "@/shared/api/workflowListClient";
import type { LibraryWorkflowItem } from "@/shared/contracts/workflow/library";
import { AppSidebar } from "@/shared/ui/navigation";
import { ActivityPane } from "./components/ActivityPane";
import { AddTaskDialog } from "./components/AddTaskDialog";
import { CreateFolderDialog } from "./components/CreateFolderDialog";
import { FolderPane } from "./components/FolderPane";
import { RunDetailsDialog } from "./components/RunDetailsDialog";
import { TaskPane } from "./components/TaskPane";
import {
  ALL_WORKFLOWS_FOLDER_ID,
  createInitialAutomationState,
  runnableTasksForFolder,
  tasksForFolder,
  workspaceReducer,
  type AutomationRun,
} from "./model/automationWorkspace";
import { useBackgroundBatch } from "./model/useBackgroundBatch";
import styles from "./AutomationsScreen.module.css";

export interface AutomationsScreenProps {
  client?: WorkflowListClient;
}

const THUMBNAILS = ["search", "form", "table", "message"] as const;

function thumbnailForWorkflow(name: string) {
  let hash = 2_166_136_261;
  for (const character of name.normalize("NFKC").trim().toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return THUMBNAILS[(hash >>> 0) % THUMBNAILS.length];
}

function updatedLabel(updatedAt: string): string {
  const minutes = Math.floor(Math.max(0, Date.now() - new Date(updatedAt).getTime()) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Updated ${hours}h ago` : `Updated ${Math.floor(hours / 24)}d ago`;
}

function libraryTask(workflow: LibraryWorkflowItem) {
  return {
    id: workflow.id,
    name: workflow.name,
    status: workflow.status,
    steps: workflow.steps.length,
    updated: updatedLabel(workflow.updatedAt),
    thumbnail: thumbnailForWorkflow(workflow.name),
    folderId: "inbox",
  };
}

export function AutomationsScreen({ client = workflowListClient }: AutomationsScreenProps) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, createInitialAutomationState);
  const batch = useBackgroundBatch();
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [detailRunKey, setDetailRunKey] = useState<string | null>(null);
  const [runFolderName, setRunFolderName] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [invalidFileCount, setInvalidFileCount] = useState(0);

  useEffect(() => {
    let active = true;
    client.list().then(
      (result) => {
        if (!active) return;
        dispatch({ type: "hydrate-workflows", tasks: result.workflows.map(libraryTask) });
        setInvalidFileCount(result.invalidFileCount);
        setLibraryLoading(false);
      },
      () => {
        if (!active) return;
        setLibraryError("All workflows could not be loaded.");
        setLibraryLoading(false);
      },
    );
    return () => { active = false; };
  }, [client]);

  const selectedFolder = state.folders.find((folder) => folder.id === state.selectedFolderId)
    ?? state.folders[0];
  const allWorkflowsSelected = selectedFolder.id === ALL_WORKFLOWS_FOLDER_ID;
  const visibleTasks = tasksForFolder(state, selectedFolder.id);
  const runnableTasks = runnableTasksForFolder(state, selectedFolder.id);
  const inboxTasks = tasksForFolder(state, "inbox");
  const includesNestedFolders = state.folders.some((folder) => folder.parentId === selectedFolder.id);
  const runs = useMemo<AutomationRun[]>(() => batch.runs.map((run) => {
    const task = state.tasks.find((candidate) => candidate.id === run.workflowId);
    return {
      id: run.workflowId,
      taskId: run.workflowId,
      name: task?.name ?? "Workflow",
      state: run.status,
      currentStep: run.currentStep,
      totalSteps: run.totalSteps,
      updated: "Just now",
      thumbnail: task?.thumbnail,
      detail: run.error,
      failedStep: run.status === "failed" && run.currentStep > 0 ? run.currentStep : undefined,
      screenshot: run.status === "failed" || run.status === "completed"
        ? run.screenshot
        : undefined,
    };
  }), [batch.runs, state.tasks]);
  const detailRun = runs.find((run) => run.id === detailRunKey);
  const batchAnnouncement = batch.status === "finished"
    ? `${runFolderName} run ${batch.succeeded ? "completed" : "failed"}.`
    : batch.error ?? "";

  return (
    <>
      <div className={styles.shell}>
        <AppSidebar activeDestination="automations" />
        <main className={styles.content}>
          <header className={styles.pageHeader}>
            <div><h1>Automations</h1><p>Organize and run workflows by folder.</p></div>
            <p className={styles.demoBanner}>
              <FlaskConical size={14} aria-hidden="true" />
              POC: folders and run activity reset on refresh.
            </p>
          </header>
          {batch.error ? <p role="alert">{batch.error}</p> : null}
          <div className={styles.workspace}>
            <FolderPane
              state={state}
              allWorkflowsCount={state.tasks.length}
              onNew={() => setCreateFolderOpen(true)}
              onSelect={(folderId) => dispatch({ type: "select-folder", folderId })}
              onToggle={(folderId) => dispatch({ type: "toggle-folder", folderId })}
            />
            <TaskPane
              folder={selectedFolder}
              tasks={visibleTasks}
              runnableCount={runnableTasks.length}
              includesNestedFolders={includesNestedFolders}
              runActive={batch.active}
              loading={allWorkflowsSelected && libraryLoading}
              error={allWorkflowsSelected ? libraryError : null}
              invalidFileCount={allWorkflowsSelected ? invalidFileCount : 0}
              onAdd={() => setAddTaskOpen(true)}
              onRemove={(taskId) => dispatch({ type: "move-task", taskId, folderId: "inbox" })}
              onRun={() => {
                setRunFolderName(selectedFolder.name);
                void batch.start(runnableTasks.map((task) => task.id));
              }}
            />
            <ActivityPane runs={runs} onViewDetails={setDetailRunKey} />
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {batchAnnouncement || state.announcement}
          </span>
        </main>
      </div>
      {createFolderOpen ? (
        <CreateFolderDialog
          state={state}
          onClose={() => setCreateFolderOpen(false)}
          onCreate={(name, parentId) => {
            dispatch({ type: "create-folder", folder: { id: crypto.randomUUID(), name, parentId } });
            setCreateFolderOpen(false);
          }}
        />
      ) : null}
      {addTaskOpen ? (
        <AddTaskDialog
          folder={selectedFolder}
          inboxTasks={inboxTasks}
          onClose={() => setAddTaskOpen(false)}
          onAdd={(taskId) => {
            dispatch({ type: "move-task", taskId, folderId: selectedFolder.id });
            setAddTaskOpen(false);
          }}
        />
      ) : null}
      {detailRun ? <RunDetailsDialog run={detailRun} onClose={() => setDetailRunKey(null)} /> : null}
    </>
  );
}
