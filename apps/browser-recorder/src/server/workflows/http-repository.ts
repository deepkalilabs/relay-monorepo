import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Workflow } from "@/shared/contracts/workflow/domain";
import {
  CompatibleWorkflowSchema,
  WorkflowSchema,
} from "@/shared/contracts/workflow/schema";
import {
  RemoteHttpClient,
  type RemoteHttpCredentials,
  type RemoteHttpClientOptions,
} from "@/server/infrastructure/storage/remote-http-client";
import {
  WorkflowConflictError,
  WorkflowNotFoundError,
  WorkflowUnavailableError,
  WorkflowValidationError,
  type WorkflowListResult,
  type WorkflowRepository,
} from "./repository";

const WorkflowSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  status: z.enum(["draft", "complete"]),
  updatedAt: z.iso.datetime(),
  steps: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    order: z.number().int().nonnegative(),
  }).strict()),
}).strict();

const WorkflowListResponseSchema = z.object({
  workflows: z.array(WorkflowSummarySchema),
}).strict();

export class RemoteWorkflowRepository implements WorkflowRepository {
  private readonly client: RemoteHttpClient;
  private readonly collectionPath: string;

  constructor(
    baseUrl: string,
    credentials: RemoteHttpCredentials,
    options: RemoteHttpClientOptions = {},
    readonly namespaceId?: string,
  ) {
    this.client = new RemoteHttpClient(baseUrl, credentials, options);
    this.collectionPath = namespaceId
      ? `v1/namespaces/${encodeURIComponent(namespaceId)}/workflows`
      : "v1/workflows";
  }

  async list(): Promise<WorkflowListResult> {
    const response = await this.request(this.collectionPath);
    const result = await this.parse(response, 200, WorkflowListResponseSchema);
    return { workflows: result.workflows, skippedRecordCount: 0 };
  }

  async create(): Promise<Workflow> {
    return this.parse(await this.request(this.collectionPath, {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
    }), 201, WorkflowSchema);
  }

  async get(id: string): Promise<Workflow> {
    return this.parse(
      await this.request(`${this.collectionPath}/${encodeURIComponent(id)}`),
      200,
      CompatibleWorkflowSchema,
    );
  }

  async save(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow> {
    const snapshot = this.parseSnapshot(id, workflow);
    return this.parse(await this.request(`${this.collectionPath}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: this.mutationHeaders(),
      body: JSON.stringify({ workflow: snapshot, expectedRevision }),
    }), 200, WorkflowSchema);
  }

  async finish(id: string, workflow: Workflow, expectedRevision: number): Promise<Workflow> {
    const snapshot = this.parseSnapshot(id, workflow);
    return this.parse(await this.request(`${this.collectionPath}/${encodeURIComponent(id)}/finish`, {
      method: "POST",
      headers: this.mutationHeaders(),
      body: JSON.stringify({ workflow: snapshot, expectedRevision }),
    }), 200, WorkflowSchema);
  }

  private mutationHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    };
  }

  private parseSnapshot(id: string, workflow: Workflow): Workflow {
    if (workflow.id !== id) throw new WorkflowValidationError("The workflow ID cannot be changed.");
    const parsed = WorkflowSchema.safeParse(workflow);
    if (!parsed.success) {
      throw new WorkflowValidationError(parsed.error.issues[0]?.message ?? "The workflow is invalid.");
    }
    return parsed.data;
  }

  private async request(pathname: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.client.request(pathname, init);
    } catch {
      throw new WorkflowUnavailableError();
    }
  }

  private async parse<T>(response: Response, expectedStatus: number, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) this.throwResponseError(response.status);
    if (response.status !== expectedStatus) throw new WorkflowUnavailableError();
    const body = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new WorkflowUnavailableError();
    return parsed.data;
  }

  private throwResponseError(status: number): never {
    if (status === 400 || status === 413) {
      throw new WorkflowValidationError("The workflow request is invalid.");
    }
    if (status === 404) throw new WorkflowNotFoundError();
    if (status === 409) throw new WorkflowConflictError();
    throw new WorkflowUnavailableError();
  }
}
