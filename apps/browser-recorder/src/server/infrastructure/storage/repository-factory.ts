import { FileProfileRepository } from "@/server/profiles/filesystem-repository";
import type { ProfileRepository } from "@/server/profiles/repository";
import { FileWorkflowRepository } from "@/server/workflows/filesystem-repository";
import { RemoteWorkflowRepository } from "@/server/workflows/http-repository";
import type { WorkflowRepository } from "@/server/workflows/repository";
import { z } from "zod";
import { RemoteHttpClient, type RemoteHttpCredentials } from "./remote-http-client";

const NamespaceListResponse = z.object({
  namespaces: z.array(z.object({
    id: z.uuid(),
    name: z.string().min(1).max(100),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }).strict()),
}).strict();

export interface WorkflowWorkspace {
  key: string;
  name: string;
  source: "local" | "namespace";
}

export interface WorkflowWorkspaceCatalog {
  workspaces: WorkflowWorkspace[];
  defaultKey: string;
  namespaceWarning?: string;
}

export class WorkspaceSelectionError extends Error {
  constructor(message = "Select a valid workspace before using workflows.") {
    super(message);
    this.name = "WorkspaceSelectionError";
  }
}

export interface WorkflowRepositoryResolver {
  listWorkspaces(): Promise<WorkflowWorkspaceCatalog>;
  resolve(key: string | undefined): Promise<WorkflowRepository>;
}

export interface RepositorySet {
  profileRepository: ProfileRepository;
  workflowRepository: WorkflowRepository;
}

interface ResolverOptions {
  development: boolean;
}

interface RemoteStorageConfig {
  baseUrl: string;
  credentials: RemoteHttpCredentials;
}

function remoteStorageConfig(
  environment: Readonly<Record<string, string | undefined>>,
  required: boolean,
): RemoteStorageConfig | null {
  const baseUrl = environment.RELAY_API_BASE_URL?.trim();
  const username = environment.RELAY_API_USERNAME?.trim();
  const password = environment.RELAY_API_PASSWORD;
  if (!baseUrl && !username && !password?.trim() && !required) return null;
  if (!baseUrl) throw new Error("RELAY_API_BASE_URL is required for Relay workspaces.");
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("RELAY_API_BASE_URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    throw new Error("RELAY_API_BASE_URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new Error("RELAY_API_BASE_URL must not include credentials, query parameters, or a fragment.");
  }
  if (!parsedBaseUrl.pathname.endsWith("/")) parsedBaseUrl.pathname += "/";
  if (!username) throw new Error("RELAY_API_USERNAME is required for Relay workspaces.");
  if (username.includes(":")) throw new Error("RELAY_API_USERNAME must not include a colon.");
  if (!password?.trim()) throw new Error("RELAY_API_PASSWORD is required for Relay workspaces.");
  return {
    baseUrl: parsedBaseUrl.toString(),
    credentials: { username, password },
  };
}

export function createWorkflowRepositoryResolver(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  { development }: ResolverOptions = { development: environment.NODE_ENV !== "production" },
): WorkflowRepositoryResolver {
  const localRepository = development ? new FileWorkflowRepository() : null;
  const remote = remoteStorageConfig(environment, !development);
  const namespaceClient = remote ? new RemoteHttpClient(remote.baseUrl, remote.credentials) : null;
  const namespaceRepositories = new Map<string, RemoteWorkflowRepository>();
  let knownNamespaceIds = new Set<string>();

  const discoverNamespaces = async (): Promise<WorkflowWorkspace[]> => {
    if (!namespaceClient) return [];
    const response = await namespaceClient.request("v1/namespaces");
    if (response.status !== 200) throw new Error("Relay namespaces could not be loaded.");
    const parsed = NamespaceListResponse.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new Error("Relay namespaces could not be loaded.");
    knownNamespaceIds = new Set(parsed.data.namespaces.map(({ id }) => id));
    return parsed.data.namespaces.map(({ id, name }) => ({
      key: id,
      name,
      source: "namespace" as const,
    }));
  };

  const listWorkspaces = async (): Promise<WorkflowWorkspaceCatalog> => {
    const localWorkspace: WorkflowWorkspace[] = development
      ? [{ key: "local", name: "Local", source: "local" }]
      : [];
    if (!namespaceClient) {
      return {
        workspaces: localWorkspace,
        defaultKey: "local",
        namespaceWarning: "Relay namespaces are not configured.",
      };
    }
    try {
      const namespaces = await discoverNamespaces();
      if (!namespaces.length && !development) {
        throw new Error("Relay has no available namespaces.");
      }
      const workspaces = [...localWorkspace, ...namespaces];
      return {
        workspaces,
        defaultKey: development ? "local" : namespaces[0]!.key,
      };
    } catch (error) {
      if (!development) throw error;
      knownNamespaceIds.clear();
      return {
        workspaces: localWorkspace,
        defaultKey: "local",
        namespaceWarning: "Relay namespaces could not be loaded.",
      };
    }
  };

  return {
    listWorkspaces,
    async resolve(key) {
      if (key === "local" && localRepository) return localRepository;
      const namespaceId = key ?? "";
      if (!z.uuid().safeParse(namespaceId).success) throw new WorkspaceSelectionError();
      if (!knownNamespaceIds.size) await listWorkspaces();
      if (!knownNamespaceIds.has(namespaceId) || !remote) throw new WorkspaceSelectionError();
      const existing = namespaceRepositories.get(namespaceId);
      if (existing) return existing;
      const repository = new RemoteWorkflowRepository(
        remote.baseUrl,
        remote.credentials,
        {},
        namespaceId,
      );
      namespaceRepositories.set(namespaceId, repository);
      return repository;
    },
  };
}

export function createRepositories(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RepositorySet {
  const dataSource = environment.DATA_SOURCE || "filesystem";
  if (dataSource === "filesystem") {
    return {
      profileRepository: new FileProfileRepository(),
      workflowRepository: new FileWorkflowRepository(),
    };
  }
  if (dataSource !== "remote") {
    throw new Error('DATA_SOURCE must be either "filesystem" or "remote".');
  }

  const remote = remoteStorageConfig(environment, true)!;

  return {
    profileRepository: new FileProfileRepository(),
    workflowRepository: new RemoteWorkflowRepository(remote.baseUrl, remote.credentials),
  };
}
