import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkflow } from "@/shared/contracts/workflow/schema";
import {
  WorkflowConflictError,
} from "@/server/workflows/repository";
import { FileWorkflowRepository } from "@/server/workflows/filesystem-repository";

const directories: string[] = [];

async function repository() {
  const rootDir = await mkdtemp(join(tmpdir(), "memory-recorder-workflows-"));
  directories.push(rootDir);
  return { rootDir, repository: new FileWorkflowRepository(rootDir) };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FileWorkflowRepository", () => {
  it("creates a durable draft and lists it newest first", async () => {
    const { rootDir, repository: workflows } = await repository();

    const created = await workflows.create();
    const loaded = await workflows.get(created.id);
    const listed = await workflows.list();

    expect(created).toMatchObject({
      schemaVersion: "1.2",
      name: "Untitled recording",
      status: "draft",
      revision: 1,
      steps: [],
    });
    expect(loaded).toEqual(created);
    expect(listed).toEqual({
      workflows: [{
        id: created.id,
        name: created.name,
        status: created.status,
        updatedAt: created.updatedAt,
        steps: [],
      }],
      skippedRecordCount: 0,
    });
    expect(JSON.parse(await readFile(join(rootDir, `${created.id}.json`), "utf8"))).toEqual(created);
  });

  it("saves an edited snapshot and finishes a non-empty draft", async () => {
    const { repository: workflows } = await repository();
    const created = await workflows.create();
    const edited = createWorkflow("session-1");
    edited.id = created.id;
    edited.name = "Checkout";
    edited.createdAt = created.createdAt;
    edited.updatedAt = created.updatedAt;
    edited.steps = [{
      id: crypto.randomUUID(),
      order: 0,
      name: "Open checkout",
      enabled: true,
      type: "navigate",
      page: { id: "page-1", url: "https://example.com" },
      payload: { url: "https://example.com" },
      metadata: { recordedAt: new Date().toISOString(), origin: "recorded", sensitive: false },
    }];

    const saved = await workflows.save(created.id, edited, 1);
    const finished = await workflows.finish(created.id, saved, 2);

    expect(saved).toMatchObject({ name: "Checkout", status: "draft", revision: 2 });
    expect(finished).toMatchObject({ name: "Checkout", status: "complete", revision: 3 });
    expect(finished.finishedAt).toBeDefined();
  });

  it("rejects stale and concurrent writes instead of silently overwriting", async () => {
    const { repository: workflows } = await repository();
    const created = await workflows.create();
    const first = { ...created, name: "First edit" };
    const second = { ...created, name: "Second edit" };

    const results = await Promise.allSettled([
      workflows.save(created.id, first, 1),
      workflows.save(created.id, second, 1),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({ reason: expect.any(WorkflowConflictError) });
    await expect(workflows.save(created.id, second, 1)).rejects.toBeInstanceOf(WorkflowConflictError);
  });

  it("keeps valid workflows usable when another canonical JSON file is invalid", async () => {
    const { rootDir, repository: workflows } = await repository();
    const created = await workflows.create();
    await writeFile(join(rootDir, `${crypto.randomUUID()}.json`), "{", "utf8");

    const listed = await workflows.list();

    expect(listed.workflows).toEqual([{
      id: created.id,
      name: created.name,
      status: created.status,
      updatedAt: created.updatedAt,
      steps: [],
    }]);
    expect(listed.skippedRecordCount).toBe(1);
  });
});
