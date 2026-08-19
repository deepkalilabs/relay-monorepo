import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProfileRequestError,
  ProfileScreen,
  type ProfileClient,
} from "@/features/profile";
import type { Profile, ProfileInput, ProfileSummary } from "@/shared/contracts/profile";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const workProfile: Profile = {
  schemaVersion: "1.1",
  id: "b2f93d58-0ff2-4dcf-9cf4-07fe48bf95d5",
  name: "Work — US",
  identity: { fullName: "Alex Johnson", email: "alex@example.com" },
  location: { countryRegion: "United States", postalCode: "94103" },
  status: "ready",
  revision: 1,
  createdAt: "2026-07-28T12:00:00.000Z",
  updatedAt: "2026-07-28T12:00:00.000Z",
};

const personalProfile: Profile = {
  ...workProfile,
  id: "8c926282-abda-47a3-b3dc-de9b48f85370",
  name: "Personal",
  identity: { fullName: "Alex Johnson", email: "personal@example.com" },
  updatedAt: "2026-07-27T12:00:00.000Z",
};

const summaries: ProfileSummary[] = [workProfile, personalProfile].map((profile) => ({
  id: profile.id,
  name: profile.name,
  status: profile.status,
  updatedAt: profile.updatedAt,
}));

function client(overrides: Partial<ProfileClient> = {}): ProfileClient {
  const profiles = new Map([workProfile, personalProfile].map((profile) => [profile.id, profile]));
  return {
    list: vi.fn(async () => ({ profiles: summaries, invalidFileCount: 0 })),
    get: vi.fn(async (id) => {
      const profile = profiles.get(id);
      if (!profile) throw new ProfileRequestError("Missing", 404);
      return profile;
    }),
    create: vi.fn(async (input) => ({ ...workProfile, ...input, id: crypto.randomUUID() })),
    save: vi.fn(async (id, input, revision) => ({
      ...(profiles.get(id) ?? workProfile),
      ...input,
      revision: revision + 1,
    })),
    delete: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  replace.mockReset();
});

describe("ProfileScreen", () => {
  it("loads summaries, fetches the selected profile, and renders editable details", async () => {
    const profileClient = client();
    render(<ProfileScreen client={profileClient} initialSelectedId={personalProfile.id} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading profiles");
    expect(await screen.findByRole("heading", { name: "Profiles", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("Create reusable parameters for your workflow runs.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Personal profile" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByLabelText("Email address")).toHaveValue("personal@example.com");
    expect(screen.getByLabelText("Profile description (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Company (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("State / Province (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toBeInTheDocument();
    expect(profileClient.get).toHaveBeenCalledWith(personalProfile.id);
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Browser" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Operating system")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a workflow with this profile" })).not.toBeInTheDocument();
  });

  it("creates locally and persists only on the first explicit save", async () => {
    const user = userEvent.setup();
    const create = vi.fn(async (input: ProfileInput) => ({
      ...workProfile,
      ...input,
      id: "39cb2b34-a827-40c0-afcc-b837f972cb40",
      status: "draft" as const,
    }));
    const profileClient = client({ create });
    render(<ProfileScreen client={profileClient} />);
    await screen.findByRole("button", { name: "New profile" });

    await user.click(screen.getByRole("button", { name: "New profile" }));

    expect(create).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Profile name")).toHaveValue("Untitled profile");
    expect(screen.getByLabelText("Full name")).toHaveValue("");
    expect(screen.getByText("Draft")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Profile description (optional)"), "Presentation only");
    await user.type(screen.getByLabelText("Phone number (optional)"), "+1 555 123 4567");
    await user.type(screen.getByLabelText("Company (optional)"), "Example Co.");
    await user.type(screen.getByLabelText("State / Province (optional)"), "California");
    await user.type(screen.getByLabelText("City"), "San Francisco");
    expect(create).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Full name"), "Taylor");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toMatchObject({
      name: "Untitled profile",
      identity: { fullName: "Taylor", email: "" },
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty("description");
    expect(create.mock.calls[0][0].identity).not.toHaveProperty("phone");
    expect(create.mock.calls[0][0].identity).not.toHaveProperty("company");
    expect(create.mock.calls[0][0].location).not.toHaveProperty("stateProvince");
    expect(create.mock.calls[0][0].location).not.toHaveProperty("city");
    expect(replace).toHaveBeenCalledWith("/profile?selected=39cb2b34-a827-40c0-afcc-b837f972cb40");
  });

  it("saves existing edits and immediately discards them when another profile is selected", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_id: string, input: ProfileInput, revision: number) => ({
      ...workProfile,
      ...input,
      revision: revision + 1,
    }));
    const profileClient = client({ save });
    render(<ProfileScreen client={profileClient} />);
    await screen.findByDisplayValue("alex@example.com");

    await user.clear(screen.getByLabelText("Email address"));
    await user.type(screen.getByLabelText("Email address"), "changed@example.com");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(
      workProfile.id,
      expect.objectContaining({ identity: expect.objectContaining({ email: "changed@example.com" }) }),
      1,
    ));

    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Unsaved");
    await user.click(screen.getByRole("button", { name: "Select Personal profile" }));

    expect(await screen.findByLabelText("Full name")).toHaveValue("Alex Johnson");
    expect(screen.getByLabelText("Email address")).toHaveValue("personal@example.com");
    expect(replace).toHaveBeenLastCalledWith(`/profile?selected=${personalProfile.id}`);
  });

  it("preserves edits on conflict and can reload the saved version", async () => {
    const user = userEvent.setup();
    const profileClient = client({
      save: vi.fn(async () => {
        throw new ProfileRequestError("The profile changed since it was loaded.", 409);
      }),
    });
    render(<ProfileScreen client={profileClient} />);
    await screen.findByDisplayValue("Alex Johnson");

    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Local edit");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("changed since it was loaded");
    expect(screen.getByLabelText("Full name")).toHaveValue("Local edit");
    await user.click(screen.getByRole("button", { name: "Reload saved version" }));
    expect(await screen.findByLabelText("Full name")).toHaveValue("Alex Johnson");
  });

  it("confirms permanent deletion and selects the next profile", async () => {
    const user = userEvent.setup();
    const remove = vi.fn(async () => undefined);
    render(<ProfileScreen client={client({ delete: remove })} />);
    await screen.findByDisplayValue("Alex Johnson");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Work — US?" });
    expect(within(dialog).getByText(/permanently delete/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete profile" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(workProfile.id, 1));
    expect(await screen.findByLabelText("Email address")).toHaveValue("personal@example.com");
    expect(replace).toHaveBeenLastCalledWith(`/profile?selected=${personalProfile.id}`);
  });

  it("shows empty, invalid-file, and load-failure states", async () => {
    const emptyClient = client({
      list: vi.fn(async () => ({ profiles: [], invalidFileCount: 2 })),
    });
    const { rerender } = render(<ProfileScreen client={emptyClient} />);

    expect(await screen.findByRole("heading", { name: "No saved profiles" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("2 profile files could not be loaded");

    rerender(<ProfileScreen client={client({
      list: vi.fn(async () => {
        throw new Error("offline");
      }),
    })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Profiles could not be loaded");
  });
});
