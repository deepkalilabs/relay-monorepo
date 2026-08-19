import { z } from "zod";

export const WORKSPACE_STORAGE_KEY = "browser-replay.workspace";

const WorkspaceOptionSchema = z.discriminatedUnion("source", [
  z.object({
    key: z.literal("local"),
    name: z.string().min(1).max(100),
    source: z.literal("local"),
  }).strict(),
  z.object({
    key: z.uuid(),
    name: z.string().min(1).max(100),
    source: z.literal("namespace"),
  }).strict(),
]);

const WorkspaceCatalogSchema = z.object({
  workspaces: z.array(WorkspaceOptionSchema).min(1),
  defaultKey: z.string().min(1),
  namespaceWarning: z.string().min(1).optional(),
}).strict().refine(
  ({ workspaces, defaultKey }) => workspaces.some(({ key }) => key === defaultKey),
  "The default workspace must be available.",
);

export type WorkspaceOption = z.infer<typeof WorkspaceOptionSchema>;
export type WorkspaceCatalog = z.infer<typeof WorkspaceCatalogSchema>;

export interface WorkspaceCatalogClient {
  list(): Promise<WorkspaceCatalog>;
}

export const workspaceCatalogClient: WorkspaceCatalogClient = {
  async list() {
    const response = await fetch("/api/workspaces", { cache: "no-store" });
    if (!response.ok) throw new Error("Workspaces could not be loaded.");
    return WorkspaceCatalogSchema.parse(await response.json());
  },
};

export function workspaceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const workspaceKey = typeof localStorage === "undefined"
    ? null
    : localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!workspaceKey) return init === undefined ? fetch(input) : fetch(input, init);

  const headers = new Headers(init?.headers);
  headers.set("x-workspace-key", workspaceKey);
  return fetch(input, { ...init, headers });
}
