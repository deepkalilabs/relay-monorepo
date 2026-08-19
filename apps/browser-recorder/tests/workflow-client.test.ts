import { afterEach, describe, expect, it, vi } from "vitest";
import { workflowEditorClient } from "@/features/workflow-editor";
import { workflowLibraryClient } from "@/features/workflow-library";
import { createWorkflow } from "@/shared/contracts/workflow/schema";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workflow editor client", () => {
  it("loads a complete workflow by ID", async () => {
    const workflow = createWorkflow();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(workflow), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(workflowEditorClient.get(workflow.id)).resolves.toEqual(workflow);
    expect(fetchMock).toHaveBeenCalledWith(`/api/workflows/${workflow.id}`);
  });

  it("sends the workflow and expected revision on explicit saves", async () => {
    const workflow = createWorkflow();
    const saved = { ...workflow, revision: workflow.revision + 1 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(workflowEditorClient.save(workflow.id, workflow, workflow.revision)).resolves.toEqual(saved);
    expect(fetchMock).toHaveBeenCalledWith(`/api/workflows/${workflow.id}`, expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ workflow, expectedRevision: workflow.revision }),
    }));
  });

  it("exposes revision conflicts without discarding the local workflow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "The workflow changed on disk." }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));

    const workflow = createWorkflow();
    const request = workflowEditorClient.save(workflow.id, workflow, workflow.revision);

    await expect(request).rejects.toMatchObject({
      status: 409,
      message: "The workflow changed on disk.",
    });
  });
});

describe("workflow Library client", () => {
  it("preserves the status of Library list failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Workflow storage is unavailable." }),
      { status: 503 },
    )));

    await expect(workflowLibraryClient.list()).rejects.toMatchObject({
      name: "WorkflowLibraryRequestError",
      status: 503,
      message: "Workflow storage is unavailable.",
    });
  });

  it("loads full workflows and saves bindings with revision protection", async () => {
    const workflow = createWorkflow();
    const saved = { ...workflow, revision: 2 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(workflow), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(saved), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(workflowLibraryClient.get(workflow.id)).resolves.toEqual(workflow);
    await expect(workflowLibraryClient.save(workflow.id, workflow, 1)).resolves.toEqual(saved);

    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/workflows/${workflow.id}`);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/workflows/${workflow.id}`, expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ workflow, expectedRevision: 1 }),
    }));
  });

  it("preserves the status of Library save conflicts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "The workflow changed since it was loaded." }),
      { status: 409 },
    )));

    const workflow = createWorkflow();
    await expect(workflowLibraryClient.save(workflow.id, workflow, 1)).rejects.toMatchObject({
      status: 409,
      message: "The workflow changed since it was loaded.",
    });
  });
});
