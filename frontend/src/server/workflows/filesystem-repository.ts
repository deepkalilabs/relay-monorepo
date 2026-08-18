import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Workflow } from "@/shared/contracts/workflow/domain";
import {
  MAX_WORKFLOW_FILE_BYTES,
  parseWorkflowJson,
  serializeWorkflow,
} from "@/shared/contracts/workflow/serialization";
import { createWorkflow, WorkflowSchema } from "@/shared/contracts/workflow/schema";
import { toLibraryWorkflowItem } from "./library-projection";
import {
  WorkflowConflictError,
  WorkflowNotFoundError,
  WorkflowValidationError,
  type WorkflowListResult,
  type WorkflowRepository,
} from "./repository";

const WORKFLOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function defaultWorkflowDataDirectory(): string {
  return process.env.WORKFLOW_DATA_DIR || path.join(process.cwd(), ".data", "workflows");
}

export class FileWorkflowRepository implements WorkflowRepository {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly rootDir = defaultWorkflowDataDirectory()) {}

  async list(): Promise<WorkflowListResult> {
    await this.ensureRoot();
    const filenames = await readdir(this.rootDir);
    const workflows: Workflow[] = [];
    let invalidFileCount = 0;

    await Promise.all(filenames.filter((filename) => filename.endsWith(".json")).map(async (filename) => {
      try {
        const id = filename.slice(0, -".json".length);
        if (!WORKFLOW_ID.test(id)) throw new WorkflowValidationError("Workflow filenames must use a UUID.");
        const workflow = await this.read(id);
        if (workflow.id !== id) throw new WorkflowValidationError("The workflow ID does not match its filename.");
        workflows.push(workflow);
      } catch {
        invalidFileCount += 1;
      }
    }));

    workflows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      workflows: workflows.map(toLibraryWorkflowItem),
      skippedRecordCount: invalidFileCount,
    };
  }

  async create(): Promise<Workflow> {
    return this.withLock(randomUUID(), async (id) => {
      const workflow = createWorkflow();
      workflow.id = id;
      await this.write(workflow);
      return workflow;
    });
  }

  async get(id: string): Promise<Workflow> {
    this.assertId(id);
    return this.read(id);
  }

  async save(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow> {
    return this.withLock(id, async () => {
      const current = await this.read(id);
      this.assertRevision(current, expectedRevision);
      const next = this.nextSnapshot(current, workflow);
      await this.write(next);
      return next;
    });
  }

  async finish(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow> {
    return this.withLock(id, async () => {
      const current = await this.read(id);
      this.assertRevision(current, expectedRevision);
      if (!workflow.steps.length) {
        throw new WorkflowValidationError("Add at least one workflow step before finishing.");
      }
      const now = new Date().toISOString();
      const next = this.nextSnapshot(current, workflow, {
        status: "complete",
        finishedAt: current.finishedAt ?? now,
        updatedAt: now,
      });
      await this.write(next);
      return next;
    });
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  private assertId(id: string): void {
    if (!WORKFLOW_ID.test(id)) throw new WorkflowValidationError("Workflow IDs must be UUIDs.");
  }

  private assertRevision(workflow: Workflow, expectedRevision: number): void {
    if (workflow.revision !== expectedRevision) throw new WorkflowConflictError();
  }

  private nextSnapshot(
    current: Workflow,
    incoming: Workflow,
    lifecycle: Partial<Pick<Workflow, "status" | "finishedAt" | "updatedAt">> = {},
  ): Workflow {
    if (incoming.id !== current.id) {
      throw new WorkflowValidationError("The workflow ID cannot be changed.");
    }
    const next = {
      ...incoming,
      schemaVersion: "1.4" as const,
      id: current.id,
      status: lifecycle.status ?? current.status,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: lifecycle.updatedAt ?? new Date().toISOString(),
      finishedAt: lifecycle.finishedAt ?? current.finishedAt,
    };
    const parsed = WorkflowSchema.safeParse(next);
    if (!parsed.success) {
      throw new WorkflowValidationError(parsed.error.issues[0]?.message ?? "The workflow is invalid.");
    }
    return parsed.data;
  }

  private async read(id: string): Promise<Workflow> {
    this.assertId(id);
    const filename = this.filename(id);
    try {
      const file = await stat(filename);
      if (file.size > MAX_WORKFLOW_FILE_BYTES) {
        throw new WorkflowValidationError("Workflow files must be 1 MiB or smaller.");
      }
      return parseWorkflowJson(await readFile(filename, "utf8"), file.size);
    } catch (error) {
      if (error instanceof WorkflowValidationError) throw error;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new WorkflowNotFoundError();
      }
      throw error;
    }
  }

  private async write(workflow: Workflow): Promise<void> {
    await this.ensureRoot();
    const temporary = path.join(this.rootDir, `.${workflow.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, serializeWorkflow(workflow), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filename(workflow.id));
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private filename(id: string): string {
    return path.join(this.rootDir, `${id}.json`);
  }

  private async withLock<T>(id: string, task: (id: string) => Promise<T>): Promise<T> {
    this.assertId(id);
    const previous = this.locks.get(id) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => task(id));
    const settled = result.then(() => undefined, () => undefined);
    this.locks.set(id, settled);
    try {
      return await result;
    } finally {
      if (this.locks.get(id) === settled) this.locks.delete(id);
    }
  }
}
