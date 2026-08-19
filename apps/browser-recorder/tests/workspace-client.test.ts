import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_STORAGE_KEY,
  workspaceFetch,
} from "@/shared/api/workspaceClient";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("workspaceFetch", () => {
  it("adds the remembered workspace without replacing existing headers", async () => {
    const namespaceId = crypto.randomUUID();
    localStorage.setItem(WORKSPACE_STORAGE_KEY, namespaceId);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await workspaceFetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-workspace-key")).toBe(namespaceId);
  });

  it("leaves the header absent until the startup gate confirms a selection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await workspaceFetch("/api/workflows");

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("x-workspace-key")).toBe(false);
  });
});
