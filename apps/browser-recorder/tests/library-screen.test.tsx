import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LibraryScreen,
  WorkflowLibraryRequestError,
  type ParameterProfileClient,
  type WorkflowLibraryClient,
} from "@/features/workflow-library";
import type { Profile } from "@/shared/contracts/profile";
import type { Workflow } from "@/shared/contracts/workflow";
import type { LibraryWorkflowItem } from "@/shared/contracts/workflow/library";
import { createWorkflow } from "@/shared/contracts/workflow/schema";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const workflows: LibraryWorkflowItem[] = [
  {
    id: "checkout-flow",
    name: "Checkout flow",
    status: "draft",
    updatedAt: "2026-07-27T20:00:00.000Z",
    steps: [
      { id: "checkout-1", name: "Open checkout", order: 0 },
      { id: "checkout-2", name: "Enter contact information", order: 1 },
    ],
  },
  {
    id: "support-ticket",
    name: "Create support ticket",
    status: "complete",
    updatedAt: "2026-07-26T20:00:00.000Z",
    steps: [{ id: "support-1", name: "Open the support portal", order: 0 }],
  },
];

const readyProfile: Profile = {
  schemaVersion: "1.1",
  id: "1a4b4040-7ec0-4e5c-b727-c338ab1bd962",
  name: "Alex · US",
  identity: { fullName: "Alex Morgan", email: "alex@example.com" },
  location: { countryRegion: "United States", postalCode: "94107" },
  status: "ready",
  revision: 1,
  createdAt: "2026-07-29T12:00:00.000Z",
  updatedAt: "2026-07-29T12:00:00.000Z",
};

function parameterizedWorkflow(): Workflow {
  const workflow = createWorkflow();
  workflow.id = "checkout-flow";
  workflow.name = "Checkout flow";
  workflow.steps = [{
    id: "checkout-email",
    order: 0,
    name: "Enter email address",
    enabled: true,
    type: "fill",
    page: { id: "page", url: "https://example.com" },
    target: {
      name: "Email address",
      candidates: [{ kind: "label", value: "Email address", exact: true }],
    },
    payload: { value: "recorded@example.com" },
    parameterBinding: { source: "recorded" },
    metadata: { recordedAt: workflow.updatedAt, origin: "recorded", sensitive: true },
  }];
  return workflow;
}

function client(overrides: Partial<WorkflowLibraryClient> = {}): WorkflowLibraryClient {
  const detailed = new Map(workflows.map((summary) => {
    const workflow = createWorkflow();
    workflow.id = summary.id;
    workflow.name = summary.name;
    workflow.status = summary.status;
    workflow.updatedAt = summary.updatedAt;
    workflow.steps = summary.steps.map((step, index) => index === 1 ? {
      id: step.id,
      order: step.order,
      name: step.name,
      enabled: true,
      type: "fill",
      page: { id: "page", url: "https://example.com" },
      target: { name: step.name, candidates: [{ kind: "label", value: step.name, exact: true }] },
      payload: { value: "Recorded value" },
      parameterBinding: { source: "recorded" },
      metadata: { recordedAt: workflow.updatedAt, origin: "recorded", sensitive: false },
    } : {
      id: step.id,
      order: step.order,
      name: step.name,
      enabled: true,
      type: "navigate",
      page: { id: "page", url: "https://example.com" },
      payload: { url: "https://example.com" },
      metadata: { recordedAt: workflow.updatedAt, origin: "recorded", sensitive: false },
    });
    return [summary.id, workflow] as const;
  }));
  return {
    list: vi.fn(async () => ({ workflows, invalidFileCount: 0 })),
    create: vi.fn(async () => createWorkflow()),
    get: vi.fn(async (id) => {
      const workflow = detailed.get(id);
      if (!workflow) throw new Error("Workflow not found.");
      return workflow;
    }),
    save: vi.fn(async (_id, workflow) => ({ ...workflow, revision: workflow.revision + 1 })),
    ...overrides,
  };
}

function profilesClient(): ParameterProfileClient {
  return {
    list: vi.fn(async () => ({ profiles: [], invalidFileCount: 0 })),
    get: vi.fn(async () => {
      throw new Error("Profile not found.");
    }),
  };
}

function readyProfilesClient(): ParameterProfileClient {
  return {
    list: vi.fn(async () => ({
      profiles: [{
        id: readyProfile.id,
        name: readyProfile.name,
        status: readyProfile.status,
        updatedAt: readyProfile.updatedAt,
      }],
      invalidFileCount: 0,
    })),
    get: vi.fn(async () => readyProfile),
  };
}

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("LibraryScreen", () => {
  it("loads real workflow names and ordered step names with a static preview", async () => {
    render(<LibraryScreen client={client()} profileClient={profilesClient()} initialSelectedId="checkout-flow" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading workflows");
    expect(await screen.findByRole("heading", { name: "Library", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Select Checkout flow workflow" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const details = screen.getByRole("region", { name: "Workflow details" });
    expect(within(details).getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    expect(within(details).getByText("Open checkout")).toBeInTheDocument();
    expect(within(details).getByText("Enter contact information")).toBeInTheDocument();
    expect(within(details).getByText("Draft")).toBeInTheDocument();
    expect(within(details).getByTestId("static-workflow-preview")).toBeInTheDocument();
    expect(within(details).getByRole("link", { name: "Continue editing Checkout flow" })).toHaveAttribute(
      "href",
      "/workflows/checkout-flow/edit",
    );
    expect(within(details).getByRole("button", { name: "Run workflow" })).toBeEnabled();
  });

  it("updates details and filters workflows case-insensitively", async () => {
    const user = userEvent.setup();
    const profileApi = profilesClient();
    render(<LibraryScreen client={client()} profileClient={profileApi} />);
    await screen.findByRole("button", { name: "Select Create support ticket workflow" });

    await user.click(screen.getByRole("button", { name: "Select Create support ticket workflow" }));
    expect(screen.getByRole("region", { name: "Workflow details" })).toHaveTextContent(
      "This workflow has no inputs to configure",
    );
    expect(screen.getByRole("link", { name: "Edit workflow Create support ticket" })).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search workflows" }), "CHECKOUT");
    expect(screen.getAllByRole("button", { name: /Select .* workflow/ })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    await waitFor(() => expect(profileApi.list).toHaveBeenCalledOnce());
  });

  it("assigns stable thumbnail variants from normalized workflow titles", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LibraryScreen client={client()} profileClient={profilesClient()} />);
    const checkoutButton = await screen.findByRole("button", { name: "Select Checkout flow workflow" });
    const supportButton = screen.getByRole("button", { name: "Select Create support ticket workflow" });

    expect(checkoutButton.querySelector("[data-variant]")).toHaveAttribute("data-variant", "article");
    expect(supportButton.querySelector("[data-variant]")).toHaveAttribute("data-variant", "calendar");

    await user.type(screen.getByRole("searchbox", { name: "Search workflows" }), "checkout");
    expect(screen.getByRole("button", { name: "Select Checkout flow workflow" }).querySelector("[data-variant]"))
      .toHaveAttribute("data-variant", "article");

    const renamedWorkflows = workflows.map((workflow) => (
      workflow.id === "checkout-flow" ? { ...workflow, name: "Renamed checkout" } : workflow
    ));
    rerender(<LibraryScreen profileClient={profilesClient()} client={client({
      list: vi.fn(async () => ({ workflows: renamedWorkflows, invalidFileCount: 0 })),
    })} />);

    const renamedButton = await screen.findByRole("button", { name: "Select Renamed checkout workflow" });
    expect(renamedButton.querySelector("[data-variant]")).toHaveAttribute("data-variant", "table");
  });

  it("creates a durable draft before navigating to its editor", async () => {
    const user = userEvent.setup();
    const created = createWorkflow();
    created.id = "new-workflow";
    const create = vi.fn(async () => created);
    render(<LibraryScreen client={client({ create })} profileClient={profilesClient()} />);
    await screen.findByRole("button", { name: "New recording" });

    await user.click(screen.getByRole("button", { name: "New recording" }));

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(push).toHaveBeenCalledWith("/workflows/new-workflow/edit");
  });

  it("shows empty, invalid-file warning, and load-failure states", async () => {
    const emptyClient = client({
      list: vi.fn(async () => ({ workflows: [], invalidFileCount: 2 })),
    });
    const { rerender } = render(<LibraryScreen client={emptyClient} profileClient={profilesClient()} />);

    expect(await screen.findByRole("heading", { name: "No saved workflows" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("2 workflow files could not be loaded");

    rerender(<LibraryScreen profileClient={profilesClient()} client={client({ list: vi.fn(async () => {
      throw new Error("offline");
    }) })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Library could not be loaded");
  });

  it("auto-maps profile values, masks sensitive previews, saves, and hands off IDs only", async () => {
    const user = userEvent.setup();
    let current = parameterizedWorkflow();
    const get = vi.fn(async () => current);
    const save = vi.fn(async (_id: string, workflow: Workflow) => {
      current = { ...workflow, revision: workflow.revision + 1 };
      return current;
    });
    render(
      <LibraryScreen
        client={client({ get, save })}
        profileClient={readyProfilesClient()}
        initialSelectedId="checkout-flow"
      />,
    );

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Run profile" }),
      readyProfile.id,
    );
    await user.click(screen.getByRole("button", { name: "Auto-map fields" }));

    expect(await screen.findByRole("combobox", { name: "Profile field for Enter email address" }))
      .toHaveValue("identity.email");
    expect(screen.getByText("••••••••")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(current.steps[0]).toMatchObject({
      payload: { value: "recorded@example.com" },
      parameterBinding: { source: "profile", field: "identity.email" },
    });

    await user.click(screen.getByRole("button", { name: "Run workflow" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(
      `/workflows/checkout-flow/edit?profile=${readyProfile.id}`,
    ));
    expect(push.mock.calls[0]?.[0]).not.toContain("alex@example.com");
  });

  it("blocks Run when profile summaries fail to load", async () => {
    const profileApi = profilesClient();
    profileApi.list = vi.fn(async () => {
      throw new Error("offline");
    });

    render(
      <LibraryScreen
        client={client({ get: vi.fn(async () => parameterizedWorkflow()) })}
        profileClient={profileApi}
        initialSelectedId="checkout-flow"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Profiles could not be loaded");
    expect(screen.getByRole("button", { name: "Run workflow" })).toBeDisabled();
  });

  it("retries a selected profile detail load without losing the selection", async () => {
    const user = userEvent.setup();
    const profileApi = readyProfilesClient();
    profileApi.get = vi.fn()
      .mockRejectedValueOnce(new Error("Profile temporarily unavailable."))
      .mockResolvedValueOnce(readyProfile);

    render(
      <LibraryScreen
        client={client({ get: vi.fn(async () => parameterizedWorkflow()) })}
        profileClient={profileApi}
        initialSelectedId="checkout-flow"
      />,
    );

    const profilePicker = await screen.findByRole("combobox", { name: "Run profile" });
    await user.selectOptions(profilePicker, readyProfile.id);
    expect(await screen.findByRole("alert")).toHaveTextContent("Profile temporarily unavailable");
    expect(profilePicker).toHaveValue(readyProfile.id);

    await user.click(screen.getByRole("button", { name: "Retry profile" }));

    await waitFor(() => expect(profileApi.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Profile temporarily unavailable.")).not.toBeInTheDocument());
    expect(profilePicker).toHaveValue(readyProfile.id);
  });

  it("requires row-level resolution for overlapping save conflicts", async () => {
    const user = userEvent.setup();
    const base = parameterizedWorkflow();
    const latest = structuredClone(base);
    latest.revision = 2;
    if (latest.steps[0]?.type === "fill") latest.steps[0].parameterBinding = { source: "runtime" };
    let getCount = 0;
    const get = vi.fn(async () => getCount++ ? latest : base);
    const save = vi.fn()
      .mockRejectedValueOnce(new WorkflowLibraryRequestError("Changed.", 409))
      .mockImplementation(async (_id: string, workflow: Workflow) => ({
        ...workflow,
        revision: workflow.revision + 1,
      }));
    render(
      <LibraryScreen
        client={client({ get, save })}
        profileClient={readyProfilesClient()}
        initialSelectedId="checkout-flow"
      />,
    );

    await screen.findByRole("combobox", { name: "Value source for Enter email address" });
    await user.click(screen.getByRole("button", { name: "Auto-map fields" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/changed elsewhere/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep mine" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[1]).toMatchObject({
      revision: 2,
      steps: [expect.objectContaining({
        parameterBinding: { source: "profile", field: "identity.email" },
      })],
    });
  });
});
