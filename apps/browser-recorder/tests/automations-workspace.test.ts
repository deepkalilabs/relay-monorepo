import { describe, expect, it } from "vitest";
// Reducer unit tests intentionally target this feature-private model.
// eslint-disable-next-line no-restricted-imports
import {
  ALL_WORKFLOWS_FOLDER_ID,
  createInitialAutomationState,
  folderNameError,
  runnableTasksForFolder,
  taskCountForFolder,
  tasksForFolder,
  workspaceReducer,
  type AutomationTask,
} from "@/features/automations/model/automationWorkspace";

function task(name: string, status: "draft" | "complete" = "complete"): AutomationTask {
  return {
    id: crypto.randomUUID(),
    name,
    status,
    steps: 2,
    updated: "Updated just now",
    thumbnail: "search",
    folderId: "inbox",
  };
}

describe("automation workspace model", () => {
  it("starts without fictional tasks or runs and protects All workflows", () => {
    const state = createInitialAutomationState();
    const allWorkflows = state.folders.find((folder) => folder.id === ALL_WORKFLOWS_FOLDER_ID);

    expect(state.tasks).toEqual([]);
    expect(state.selectedFolderId).toBe(ALL_WORKFLOWS_FOLDER_ID);
    expect(allWorkflows).toMatchObject({ name: "All workflows", system: true, readOnly: true });
    expect(folderNameError(state, "Nested", ALL_WORKFLOWS_FOLDER_ID)).toMatch(/custom folder/i);
  });

  it("hydrates real Library tasks into Inbox and keeps All workflows as a projection", () => {
    const draft = task("Checkout", "draft");
    const complete = task("Support ticket");

    const state = workspaceReducer(createInitialAutomationState(), {
      type: "hydrate-workflows",
      tasks: [draft, complete],
    });

    expect(tasksForFolder(state, ALL_WORKFLOWS_FOLDER_ID)).toEqual([draft, complete]);
    expect(tasksForFolder(state, "inbox")).toEqual([draft, complete]);
    expect(taskCountForFolder(state, "inbox")).toBe(2);
    expect(runnableTasksForFolder(state, "inbox")).toEqual([complete]);
  });

  it("preserves folder membership when Library summaries refresh", () => {
    const workflow = task("Checkout");
    let state = workspaceReducer(createInitialAutomationState(), {
      type: "hydrate-workflows",
      tasks: [workflow],
    });
    state = workspaceReducer(state, {
      type: "move-task",
      taskId: workflow.id,
      folderId: "verification",
    });

    state = workspaceReducer(state, {
      type: "hydrate-workflows",
      tasks: [{ ...workflow, name: "Checkout updated" }],
    });

    expect(tasksForFolder(state, "verification")).toMatchObject([{
      id: workflow.id,
      name: "Checkout updated",
      folderId: "verification",
    }]);
    expect(tasksForFolder(state, ALL_WORKFLOWS_FOLDER_ID)).toHaveLength(1);
  });

  it("creates nested folders and includes descendant workflows in a run", () => {
    const first = task("First");
    const second = task("Second", "draft");
    let state = workspaceReducer(createInitialAutomationState(), {
      type: "hydrate-workflows",
      tasks: [first, second],
    });
    state = workspaceReducer(state, {
      type: "create-folder",
      folder: { id: "parent", name: "Parent", parentId: null },
    });
    state = workspaceReducer(state, {
      type: "create-folder",
      folder: { id: "child", name: "Child", parentId: "parent" },
    });
    state = workspaceReducer(state, { type: "move-task", taskId: first.id, folderId: "child" });
    state = workspaceReducer(state, { type: "move-task", taskId: second.id, folderId: "parent" });

    expect(tasksForFolder(state, "parent")).toHaveLength(2);
    expect(runnableTasksForFolder(state, "parent")).toEqual([
      expect.objectContaining({ id: first.id }),
    ]);
  });

  it("rejects duplicate sibling folder names and read-only moves", () => {
    const workflow = task("Checkout");
    const state = workspaceReducer(createInitialAutomationState(), {
      type: "hydrate-workflows",
      tasks: [workflow],
    });

    expect(folderNameError(state, " verification ", "customers")).toMatch(/already exists/i);
    expect(folderNameError(state, "   ", "customers")).toMatch(/name/i);
    expect(folderNameError(state, "A".repeat(81), null)).toMatch(/80/);
    expect(workspaceReducer(state, {
      type: "move-task",
      taskId: workflow.id,
      folderId: ALL_WORKFLOWS_FOLDER_ID,
    })).toBe(state);
  });
});
