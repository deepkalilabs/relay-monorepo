import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/shared/ui/navigation";
import {
  WorkspaceProvider,
  type WorkspaceCatalogClient,
} from "@/shared/ui/workspace";
import { WORKSPACE_STORAGE_KEY } from "@/shared/api/workspaceClient";

const namespaceId = "bf8b0a03-13db-4d9d-984d-fcb166096283";

function catalogClient(overrides: Partial<WorkspaceCatalogClient> = {}): WorkspaceCatalogClient {
  return {
    list: vi.fn(async () => ({
      workspaces: [
        { key: "local" as const, name: "Local", source: "local" as const },
        { key: namespaceId, name: "gen", source: "namespace" as const },
      ],
      defaultKey: "local",
    })),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("WorkspaceProvider", () => {
  it("requires first-time confirmation and persists the development default", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider client={catalogClient()}>
        <p>Product content</p>
      </WorkspaceProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading workspaces");
    expect(await screen.findByRole("heading", { name: "Choose a workspace" })).toBeInTheDocument();
    expect(screen.queryByText("Product content")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Local/ })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Product content")).toBeInTheDocument();
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe("local");
  });

  it("supports selecting and continuing with the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider client={catalogClient()}>
        <p>Product content</p>
      </WorkspaceProvider>,
    );
    const local = await screen.findByRole("radio", { name: /Local/ });

    local.focus();
    await user.keyboard("{ArrowDown}{Tab}{Enter}");

    expect(await screen.findByText("Product content")).toBeInTheDocument();
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(namespaceId);
  });

  it("resumes a remembered namespace only while it remains valid", async () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, namespaceId);
    render(
      <WorkspaceProvider client={catalogClient()}>
        <p>Product content</p>
      </WorkspaceProvider>,
    );

    expect(await screen.findByText("Product content")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose a workspace" })).not.toBeInTheDocument();

    cleanup();
    render(
      <WorkspaceProvider client={catalogClient({
        list: vi.fn(async () => ({
          workspaces: [{ key: "local" as const, name: "Local", source: "local" as const }],
          defaultKey: "local",
        })),
      })}>
        <p>Product content</p>
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Choose a workspace" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Local/ })).toBeChecked();
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });

  it("clears a malformed remembered selection and requires confirmation", async () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, "not-a-workspace");

    render(
      <WorkspaceProvider client={catalogClient()}>
        <p>Product content</p>
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Choose a workspace" })).toBeInTheDocument();
    expect(screen.queryByText("Product content")).not.toBeInTheDocument();
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });

  it("shows a retry state when production workspace discovery fails", async () => {
    const user = userEvent.setup();
    const list = vi.fn()
      .mockRejectedValueOnce(new Error("private failure"))
      .mockResolvedValueOnce({
          workspaces: [{ key: namespaceId, name: "gen", source: "namespace" }],
          defaultKey: namespaceId,
      });
    render(
      <WorkspaceProvider client={catalogClient({ list })}>
        <p>Product content</p>
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Workspaces could not be loaded" }))
      .toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Check the storage service");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("radio", { name: /gen/ })).toBeChecked();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("switches from the sidebar and reloads the Library", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    localStorage.setItem(WORKSPACE_STORAGE_KEY, "local");
    render(
      <WorkspaceProvider client={catalogClient()} navigate={navigate}>
        <AppSidebar activeDestination="library" />
      </WorkspaceProvider>,
    );
    const switcher = await screen.findByRole("button", { name: "Change workspace. Current workspace: Local" });

    await user.click(switcher);
    expect(screen.getByRole("dialog", { name: "Change workspace" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /gen/ }));
    await user.click(screen.getByRole("button", { name: "Switch workspace" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/library"));
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(namespaceId);
  });
});
