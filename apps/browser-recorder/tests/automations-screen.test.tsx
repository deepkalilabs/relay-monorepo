import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationsScreen } from "@/features/automations";
import { WORKSPACE_STORAGE_KEY } from "@/shared/api/workspaceClient";
import type { WorkflowLibraryResponse } from "@/shared/contracts/workflow/library";
import { WorkspaceProvider } from "@/shared/ui/workspace";

const DRAFT_ID = "36df661c-f159-47ac-bdf5-2afc0680cc4d";
const COMPLETE_ID = "1d942a81-b2e4-4dc9-916d-8a761db5f75f";
const ARTIFACT_ID = "3e23db5e-1683-4857-bfb7-a5c2eea6d41f";
const SCREENSHOT = { url: `/api/run-artifacts/${ARTIFACT_ID}`, width: 480, height: 300 };

const libraryData: WorkflowLibraryResponse = {
  workflows: [
    {
      id: DRAFT_ID,
      name: "Checkout flow",
      status: "draft",
      updatedAt: "2026-07-27T20:00:00.000Z",
      steps: [{ id: "checkout-1", name: "Open checkout", order: 0 }],
    },
    {
      id: COMPLETE_ID,
      name: "Create support ticket",
      status: "complete",
      updatedAt: "2026-07-26T20:00:00.000Z",
      steps: [
        { id: "support-1", name: "Open portal", order: 0 },
        { id: "support-2", name: "Submit ticket", order: 1 },
      ],
    },
  ],
  invalidFileCount: 0,
};

function libraryClient(data = libraryData) {
  return { list: vi.fn(async () => data) };
}

beforeEach(() => {
  vi.setSystemTime(new Date("2026-07-27T21:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function moveWorkflowToVerification(name: string, id: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Select Verification folder" }));
  await user.click(screen.getByRole("button", { name: "Add task" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Inbox task" }), id);
  await user.click(screen.getByRole("button", { name: "Add task to Verification" }));
  expect(screen.getByRole("region", { name: "Verification tasks" })).toHaveTextContent(name);
}

describe("AutomationsScreen", () => {
  it("hydrates Inbox and All workflows from Library without fictional activity", async () => {
    render(<AutomationsScreen client={libraryClient()} />);

    const allWorkflows = await screen.findByRole("region", { name: "All workflows workflows" });
    expect(within(allWorkflows).getByRole("row", { name: /Checkout flow/ })).toHaveTextContent("Draft");
    expect(within(allWorkflows).getByRole("row", { name: /Create support ticket/ })).toHaveTextContent("2 steps");
    expect(within(allWorkflows).getByRole("button", { name: "Run folder" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Select Inbox folder" }));
    expect(screen.getByRole("region", { name: "Inbox tasks" }).querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Run activity" })).toHaveTextContent("No active runs");
    const completedRuns = screen.getByRole("region", { name: "Completed runs" });
    expect(within(completedRuns).getByText("No completed runs.")).toBeInTheDocument();
    expect(within(completedRuns).queryByRole("button", { name: /View details/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Salesforce connection timed out")).not.toBeInTheDocument();
  });

  it("keeps folder creation and real workflow movement in the current session", async () => {
    const user = userEvent.setup();
    render(<AutomationsScreen client={libraryClient()} />);
    await screen.findByText("Create support ticket");

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByRole("textbox", { name: "Folder name" }), "Renewals");
    await user.click(screen.getByRole("button", { name: "Create folder" }));
    await user.click(screen.getByRole("button", { name: "Add task" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Inbox task" }), COMPLETE_ID);
    await user.click(screen.getByRole("button", { name: "Add task to Renewals" }));

    const renewals = screen.getByRole("region", { name: "Renewals tasks" });
    expect(renewals).toHaveTextContent("Create support ticket");
    expect(within(renewals).getByRole("button", { name: "Run folder" })).toBeEnabled();
  });

  it("submits only completed workflows and renders real polling progress", async () => {
    const batchId = "dc375e45-9624-4b7b-b9d0-32eae90d7868";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ batchId, runCount: 1 }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        batchId,
        runs: [{
          id: COMPLETE_ID,
          workflowId: COMPLETE_ID,
          status: "running",
          currentStep: 1,
          totalSteps: 2,
          assertionResults: [],
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        batchId,
        runs: [{
          id: COMPLETE_ID,
          workflowId: COMPLETE_ID,
          status: "completed",
          currentStep: 2,
          totalSteps: 2,
          screenshot: SCREENSHOT,
          assertionResults: [],
        }],
      }), { status: 200 }));
    render(<AutomationsScreen client={libraryClient()} />);
    await screen.findByText("Create support ticket");
    await moveWorkflowToVerification("Create support ticket", COMPLETE_ID);
    await moveWorkflowToVerification("Checkout flow", DRAFT_ID);

    fireEvent.click(screen.getByRole("button", { name: "Run folder" }));

    expect(await screen.findByText("Running · Step 1 of 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide evidence for Create support ticket" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Running folder…" })).toBeDisabled();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ workflowIds: [COMPLETE_ID] });

    expect(await screen.findByText("Completed · 2 steps", {}, { timeout: 2_000 })).toBeInTheDocument();
    const evidenceToggle = screen.getByRole("button", {
      name: "Hide evidence for Create support ticket",
    });
    expect(evidenceToggle).toHaveAttribute("aria-expanded", "true");
    const realRun = screen.getByRole("article", { name: /Create support ticket: Completed/ });
    const realEvidence = within(realRun).getByRole("img", {
      name: "Run evidence for Create support ticket",
    });
    expect(realEvidence.getAttribute("src")).toMatch(new RegExp(`${SCREENSHOT.url}$`));
    expect(realEvidence).toHaveAttribute("width", "480");
    expect(realEvidence).toHaveAttribute("height", "300");
    expect(within(realRun).getByText("Captured just now")).toBeInTheDocument();
    expect(within(realRun).getByText("Step 2 of 2")).toBeInTheDocument();

    await userEvent.click(evidenceToggle);
    expect(evidenceToggle).toHaveAccessibleName("Show evidence for Create support ticket");
    expect(evidenceToggle).toHaveAttribute("aria-expanded", "false");
    expect(within(realRun).queryByRole("img", { name: "Run evidence for Create support ticket" }))
      .not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Verification run completed."));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const nextBatchId = "44ee43bc-022a-4c1b-a788-94d303a15eed";
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ batchId: nextBatchId, runCount: 1 }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        batchId: nextBatchId,
        runs: [{
          id: COMPLETE_ID,
          workflowId: COMPLETE_ID,
          status: "completed",
          currentStep: 2,
          totalSteps: 2,
          screenshot: SCREENSHOT,
          assertionResults: [],
        }],
      }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Run folder" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
  });

  it("shows safe Relay failure details without mock copy", async () => {
    const batchId = "dc375e45-9624-4b7b-b9d0-32eae90d7868";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ batchId, runCount: 1 }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        batchId,
        runs: [{
          id: COMPLETE_ID,
          workflowId: COMPLETE_ID,
          status: "failed",
          currentStep: 0,
          totalSteps: 0,
          error: "The page did not load.",
          screenshot: SCREENSHOT,
          assertionResults: [],
        }],
      }), { status: 200 }));
    const user = userEvent.setup();
    render(<AutomationsScreen client={libraryClient()} />);
    await screen.findByText("Create support ticket");
    await moveWorkflowToVerification("Create support ticket", COMPLETE_ID);

    await user.click(screen.getByRole("button", { name: "Run folder" }));
    expect(await screen.findByRole("button", {
      name: "Hide evidence for Create support ticket",
    })).toHaveAttribute("aria-expanded", "true");
    const realImage = screen.getByRole("img", { name: "Run evidence for Create support ticket" });
    fireEvent.error(realImage);
    expect(screen.getByText("Screenshot unavailable")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "View details for Create support ticket" }));

    const dialog = screen.getByRole("dialog", { name: "Create support ticket run details" });
    expect(dialog).toHaveTextContent("Failed");
    expect(dialog).not.toHaveTextContent("step 0");
    expect(dialog).toHaveTextContent("The page did not load.");
    expect(dialog).not.toHaveTextContent("Mock run");
  });

  it("omits evidence controls for active and terminal runs without screenshots", async () => {
    const batchId = "dc375e45-9624-4b7b-b9d0-32eae90d7868";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ batchId, runCount: 1 }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        batchId,
        runs: [{
          id: COMPLETE_ID,
          workflowId: COMPLETE_ID,
          status: "failed",
          currentStep: 1,
          totalSteps: 2,
          assertionResults: [],
        }],
      }), { status: 200 }));
    render(<AutomationsScreen client={libraryClient()} />);
    await screen.findByText("Create support ticket");
    await moveWorkflowToVerification("Create support ticket", COMPLETE_ID);

    fireEvent.click(screen.getByRole("button", { name: "Run folder" }));
    const failedRun = await screen.findByRole("article", { name: /Create support ticket: Failed/ });
    expect(within(failedRun).queryByRole("button", { name: /evidence/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Demo · Not a real run")).not.toBeInTheDocument();
  });

  it("hydrates repeated namespace runs and shows safe assertion results after refresh", async () => {
    const namespaceId = "57b87465-d9a3-4c21-aa53-2e824be3d9b5";
    const completedRunId = "68209b23-1e24-4f62-a1e9-a4fa725d600e";
    const failedRunId = "751eb1f3-07dd-43f7-9083-0a0f1605b4c5";
    localStorage.setItem(WORKSPACE_STORAGE_KEY, namespaceId);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      runs: [
        {
          id: failedRunId,
          workflowId: COMPLETE_ID,
          workflowRevision: 4,
          status: "failed",
          currentStep: 2,
          totalSteps: 2,
          durationMs: 29,
          failedStepIndex: 1,
          failureCode: "automation_failed",
          createdAt: "2026-07-27T20:58:00.000Z",
          updatedAt: "2026-07-27T20:59:00.000Z",
          assertionResults: [{
            stepId: "assert-copy",
            stepIndex: 1,
            stepName: "Confirmation text matches",
            kind: "page_text_contains",
            matched: false,
            durationMs: 17,
            failureCode: "assertion_failed",
          }],
        },
        {
          id: completedRunId,
          workflowId: COMPLETE_ID,
          workflowRevision: 3,
          status: "completed",
          currentStep: 2,
          totalSteps: 2,
          durationMs: 22,
          createdAt: "2026-07-27T20:48:00.000Z",
          updatedAt: "2026-07-27T20:49:00.000Z",
          assertionResults: [{
            stepId: "assert-visible",
            stepIndex: 1,
            stepName: "Confirmation is visible",
            kind: "visible",
            matched: true,
            durationMs: 11,
          }],
          screenshot: {
            url: `/api/namespaces/${namespaceId}/workflow-runs/${completedRunId}/screenshot`,
            width: 480,
            height: 300,
          },
        },
      ],
    }), { status: 200 }));
    const workspaceClient = {
      list: vi.fn(async () => ({
        workspaces: [{ key: namespaceId, name: "Team", source: "namespace" as const }],
        defaultKey: namespaceId,
      })),
    };

    render(
      <WorkspaceProvider client={workspaceClient}>
        <AutomationsScreen client={libraryClient()} />
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("article", { name: /Create support ticket: Failed/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Create support ticket: Completed/ }))
      .toBeInTheDocument();
    const screenshot = screen.getByRole("img", { name: "Run evidence for Create support ticket" });
    expect(screenshot.getAttribute("src")).toMatch(
      new RegExp(`/api/namespaces/${namespaceId}/workflow-runs/${completedRunId}/screenshot$`),
    );

    const details = screen.getAllByRole("button", { name: "View details for Create support ticket" });
    await userEvent.click(details[0]);
    const dialog = screen.getByRole("dialog", { name: "Create support ticket run details" });
    expect(dialog).toHaveTextContent("Confirmation text matches");
    expect(dialog).toHaveTextContent("Page text match · 17 ms");
    expect(dialog).toHaveTextContent("Matched: No");
    expect(dialog).not.toHaveTextContent("expected");
    expect(dialog).not.toHaveTextContent("observed");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/workflow-runs");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-workspace-key"))
      .toBe(namespaceId);
  });

  it("continues polling a nonterminal namespace run recovered after refresh", async () => {
    const namespaceId = "899e8fbb-8c64-42e8-bb2e-56533a4b0dd2";
    const runId = "c7448de6-8d89-4a58-8401-73d0c7f9916d";
    localStorage.setItem(WORKSPACE_STORAGE_KEY, namespaceId);
    const run = {
      id: runId,
      workflowId: COMPLETE_ID,
      workflowRevision: 4,
      currentStep: 0,
      totalSteps: 2,
      createdAt: "2026-07-27T20:58:00.000Z",
      updatedAt: "2026-07-27T20:58:00.000Z",
      assertionResults: [],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        runs: [{ ...run, status: "queued" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        runs: [{ ...run, status: "completed", currentStep: 2 }],
      }), { status: 200 }));
    const workspaceClient = {
      list: vi.fn(async () => ({
        workspaces: [{ key: namespaceId, name: "Team", source: "namespace" as const }],
        defaultKey: namespaceId,
      })),
    };

    render(
      <WorkspaceProvider client={workspaceClient}>
        <AutomationsScreen client={libraryClient()} />
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("article", { name: "Create support ticket: Queued" }))
      .toBeInTheDocument();
    expect(await screen.findByRole(
      "article",
      { name: "Create support ticket: Completed · 2 steps" },
      { timeout: 2_000 },
    )).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
