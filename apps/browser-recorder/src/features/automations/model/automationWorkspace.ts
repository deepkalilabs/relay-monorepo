import type { WorkflowStatus } from "@/shared/contracts/workflow/domain";

export type AutomationThumbnailVariant = "search" | "form" | "table" | "message";

export interface AutomationFolder {
  id: string;
  name: string;
  parentId: string | null;
  system?: boolean;
  readOnly?: boolean;
}

export interface AutomationTask {
  id: string;
  name: string;
  status: WorkflowStatus;
  steps: number;
  updated: string;
  thumbnail: AutomationThumbnailVariant;
  folderId: string;
}

export interface AutomationRunScreenshot {
  url: string;
  width: number;
  height: number;
}

export interface AutomationRun {
  id: string;
  taskId: string;
  name: string;
  state: "queued" | "running" | "completed" | "failed";
  currentStep: number;
  totalSteps: number;
  updated: string;
  thumbnail?: AutomationThumbnailVariant;
  detail?: string;
  failedStep?: number;
  screenshot?: AutomationRunScreenshot;
}

export interface AutomationWorkspaceState {
  folders: AutomationFolder[];
  tasks: AutomationTask[];
  selectedFolderId: string;
  expandedFolderIds: string[];
  announcement: string;
}

export type AutomationWorkspaceAction =
  | { type: "select-folder"; folderId: string }
  | { type: "toggle-folder"; folderId: string }
  | { type: "create-folder"; folder: Pick<AutomationFolder, "id" | "name" | "parentId"> }
  | { type: "move-task"; taskId: string; folderId: string }
  | { type: "hydrate-workflows"; tasks: AutomationTask[] };

export const ALL_WORKFLOWS_FOLDER_ID = "all-workflows";

const initialFolders: AutomationFolder[] = [
  {
    id: ALL_WORKFLOWS_FOLDER_ID,
    name: "All workflows",
    parentId: null,
    system: true,
    readOnly: true,
  },
  { id: "inbox", name: "Inbox", parentId: null, system: true },
  { id: "customers", name: "Customers", parentId: null },
  { id: "verification", name: "Verification", parentId: "customers" },
  { id: "leads", name: "Leads", parentId: "customers" },
  { id: "research", name: "Research", parentId: null },
];

export function createInitialAutomationState(): AutomationWorkspaceState {
  return {
    folders: initialFolders.map((folder) => ({ ...folder })),
    tasks: [],
    selectedFolderId: ALL_WORKFLOWS_FOLDER_ID,
    expandedFolderIds: ["customers"],
    announcement: "",
  };
}

function descendantFolderIds(state: AutomationWorkspaceState, folderId: string): Set<string> {
  const result = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of state.folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

export function tasksForFolder(
  state: AutomationWorkspaceState,
  folderId: string,
): AutomationTask[] {
  if (folderId === ALL_WORKFLOWS_FOLDER_ID) return state.tasks;
  const folderIds = descendantFolderIds(state, folderId);
  return state.tasks.filter((task) => folderIds.has(task.folderId));
}

export function runnableTasksForFolder(
  state: AutomationWorkspaceState,
  folderId: string,
): AutomationTask[] {
  return tasksForFolder(state, folderId).filter((task) => task.status === "complete");
}

export function taskCountForFolder(state: AutomationWorkspaceState, folderId: string): number {
  return tasksForFolder(state, folderId).length;
}

export function folderNameError(
  state: AutomationWorkspaceState,
  value: string,
  parentId: string | null,
): string | null {
  if (parentId && state.folders.find((folder) => folder.id === parentId)?.system) {
    return "Choose a custom folder as the parent.";
  }
  const name = value.trim();
  if (!name) return "Enter a folder name.";
  if (name.length > 80) return "Folder names must be 80 characters or fewer.";
  const duplicate = state.folders.some((folder) => (
    folder.parentId === parentId
    && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  ));
  return duplicate ? "A folder with this name already exists here." : null;
}

export function workspaceReducer(
  state: AutomationWorkspaceState,
  action: AutomationWorkspaceAction,
): AutomationWorkspaceState {
  switch (action.type) {
    case "hydrate-workflows": {
      const previousFolders = new Map(state.tasks.map((task) => [task.id, task.folderId]));
      const validFolderIds = new Set(state.folders.map((folder) => folder.id));
      return {
        ...state,
        tasks: action.tasks.map((task) => {
          const previousFolder = previousFolders.get(task.id);
          return {
            ...task,
            folderId: previousFolder && validFolderIds.has(previousFolder)
              ? previousFolder
              : "inbox",
          };
        }),
      };
    }
    case "select-folder":
      return state.folders.some((folder) => folder.id === action.folderId)
        ? { ...state, selectedFolderId: action.folderId }
        : state;
    case "toggle-folder": {
      const expanded = state.expandedFolderIds.includes(action.folderId);
      return {
        ...state,
        expandedFolderIds: expanded
          ? state.expandedFolderIds.filter((id) => id !== action.folderId)
          : [...state.expandedFolderIds, action.folderId],
      };
    }
    case "create-folder": {
      const error = folderNameError(state, action.folder.name, action.folder.parentId);
      if (error) return { ...state, announcement: error };
      const folder = { ...action.folder, name: action.folder.name.trim() };
      return {
        ...state,
        folders: [...state.folders, folder],
        selectedFolderId: folder.id,
        expandedFolderIds: Array.from(new Set([
          ...state.expandedFolderIds,
          ...(folder.parentId ? [folder.parentId] : []),
          folder.id,
        ])),
        announcement: `${folder.name} folder created.`,
      };
    }
    case "move-task": {
      const movedTask = state.tasks.find((task) => task.id === action.taskId);
      const targetFolder = state.folders.find((folder) => folder.id === action.folderId);
      if (!movedTask || !targetFolder || targetFolder.readOnly) return state;
      return {
        ...state,
        tasks: state.tasks.map((task) => task.id === action.taskId
          ? { ...task, folderId: action.folderId, updated: "Updated just now" }
          : task),
        announcement: `${movedTask.name} moved to ${targetFolder.name}.`,
      };
    }
  }
}
