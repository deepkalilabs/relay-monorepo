import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function createDraft(request: APIRequestContext, name = "Untitled recording") {
  const response = await request.post("/api/workflows");
  expect(response.status()).toBe(201);
  const workflow = await response.json();
  if (name !== workflow.name) {
    workflow.name = name;
    const saved = await request.put(`/api/workflows/${workflow.id}`, {
      data: { workflow, expectedRevision: workflow.revision },
    });
    expect(saved.status()).toBe(200);
    return saved.json();
  }
  return workflow;
}

async function openDraft(page: Page, request: APIRequestContext, name?: string) {
  const workflow = await createDraft(request, name);
  await page.goto(`/workflows/${workflow.id}/edit`);
  await expect(page.getByRole("textbox", { name: /workflow name/i })).toHaveValue(workflow.name);
  return workflow;
}

test("redirects the former workspace root to the Library", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
});

test("loads a workflow route and keeps the editor accessible", async ({ page, request }) => {
  await openDraft(page, request, "Accessible draft");
  const navbar = page.locator(".workspace-navbar");
  const browserNavigation = page.locator(".browser-navigation");

  await expect(navbar.getByText("Memory Recorder", { exact: true })).toBeVisible();
  await expect(navbar.getByRole("button", { name: "Save workflow" })).toBeDisabled();
  await expect(navbar.getByRole("button", { name: "Finish recording" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: /workflow steps/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /fresh cloud browser/i })).toBeVisible();
  await expect(browserNavigation.getByRole("button", { name: /start recording/i })).toBeVisible();

  await page.getByRole("button", { name: /collapse workflow timeline/i }).click();
  const rail = page.locator(".workspace-rail");
  await expect(rail.getByRole("button", { name: /expand workflow timeline/i })).toBeFocused();
  await expect(rail.getByRole("button", { name: /save workflow/i })).toBeDisabled();
  await rail.getByRole("button", { name: /expand workflow timeline/i }).click();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("creates, saves, refreshes, finishes, selects, and reopens a local workflow", async ({ page, request }) => {
  const workflow = await createDraft(request, "Durable checkout");
  workflow.steps = [{
    id: crypto.randomUUID(),
    order: 0,
    name: "Confirm the order",
    enabled: true,
    page: { id: "page", url: "https://example.com/checkout" },
    target: { candidates: [{ kind: "role", value: "button", name: "Confirm", exact: true }] },
    metadata: { recordedAt: new Date().toISOString(), origin: "recorded", sensitive: false },
    type: "click",
  }];
  const seeded = await request.put(`/api/workflows/${workflow.id}`, {
    data: { workflow, expectedRevision: workflow.revision },
  });
  expect(seeded.status()).toBe(200);

  await page.goto(`/workflows/${workflow.id}/edit`);
  await page.getByRole("button", { name: "Confirm the order 1 · click", exact: true }).click();
  await page.getByLabel("Step name").fill("Confirm the purchase");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add assertion" })).toBeDisabled();
  await expect(page.getByText(/add a step manually/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Action$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Save workflow" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Confirm the purchase 1 · click", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish recording" }).click();

  await expect(page).toHaveURL(new RegExp(`/library\\?selected=${workflow.id}$`));
  await expect(page.getByRole("button", { name: "Select Durable checkout workflow" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Complete workflow")).toBeVisible();
  await page.getByRole("link", { name: "Edit workflow Durable checkout" }).click();
  await expect(page.getByRole("textbox", { name: /workflow name/i })).toHaveValue("Durable checkout");
  await expect(page.getByRole("button", { name: "Finish recording" })).toHaveCount(0);
});

test("loads, edits, saves, and reloads both assertion kinds", async ({ page, request }) => {
  const workflow = await createDraft(request, "Assertion checks");
  const recordedAt = new Date().toISOString();
  workflow.steps = [
    {
      id: crypto.randomUUID(),
      order: 0,
      name: "Checkout is visible",
      enabled: true,
      page: { id: "page", url: "https://example.com/checkout" },
      target: { candidates: [{ kind: "testId", value: "checkout", exact: true }] },
      expectation: { kind: "visible" },
      metadata: { recordedAt, origin: "manual", sensitive: false },
      type: "assertion",
    },
    {
      id: crypto.randomUUID(),
      order: 1,
      name: "Order status contains text",
      enabled: true,
      page: { id: "page", url: "https://example.com/checkout" },
      target: { candidates: [{ kind: "role", value: "status", name: "Ready", exact: true }] },
      expectation: { kind: "text_contains", expected: "Ready" },
      metadata: { recordedAt, origin: "manual", sensitive: false },
      type: "assertion",
    },
  ];
  const saved = await request.put(`/api/workflows/${workflow.id}`, {
    data: { workflow, expectedRevision: workflow.revision },
  });
  expect(saved.status()).toBe(200);

  await page.goto(`/workflows/${workflow.id}/edit`);
  await page.getByRole("button", { name: /Checkout is visible 1 · assertion/ }).click();
  await expect(page.getByLabel("Expectation")).toHaveValue("visible");
  await expect(page.getByText("Replay wait", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Order status contains text 2 · assertion/ }).click();
  await expect(page.getByLabel("Expected text")).toHaveValue("Ready");
  await page.getByLabel("Expected text").fill("Approved");
  await page.getByRole("button", { name: "Save workflow" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /Order status contains text 2 · assertion/ }).click();
  await expect(page.getByLabel("Expected text")).toHaveValue("Approved");
});

test("back to Library discards changes since the last save", async ({ page, request }) => {
  const workflow = await openDraft(page, request, "Saved title");
  await page.getByRole("textbox", { name: /workflow name/i }).fill("Unsaved title");
  await page.getByRole("link", { name: "Back to library" }).click();
  await page.goto(`/workflows/${workflow.id}/edit`);
  await expect(page.getByRole("textbox", { name: /workflow name/i })).toHaveValue("Saved title");
});

test("shows a revision conflict and can reload the saved version", async ({ page, request }) => {
  const workflow = await openDraft(page, request, "Original title");
  const external = await request.get(`/api/workflows/${workflow.id}`).then((response) => response.json());
  external.name = "Changed on disk";
  const externalSave = await request.put(`/api/workflows/${workflow.id}`, {
    data: { workflow: external, expectedRevision: external.revision },
  });
  expect(externalSave.status()).toBe(200);

  await page.getByRole("textbox", { name: /workflow name/i }).fill("Local title");
  await page.getByRole("button", { name: "Save workflow" }).click();
  await expect(page.getByText("Changed elsewhere")).toBeVisible();
  await expect(page.locator(".workspace-persistence-alert")).toContainText("changed since it was loaded");

  await page.getByRole("button", { name: "Reload saved version" }).click();
  await expect(page.getByRole("textbox", { name: /workflow name/i })).toHaveValue("Changed on disk");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("shows a load failure for an unknown workflow", async ({ page }) => {
  await page.goto("/workflows/00000000-0000-4000-8000-000000000000/edit");
  await expect(page.getByRole("heading", { name: "Workflow could not be loaded" })).toBeVisible();
  await expect(page.getByText("The workflow was not found.")).toBeVisible();
});

test("blocks direct replay when a profile-bound workflow has no selected profile", async ({ page, request }) => {
  const workflow = await createDraft(request, "Profile-bound workflow");
  workflow.steps = [{
    id: crypto.randomUUID(),
    order: 0,
    name: "Enter email address",
    enabled: true,
    page: { id: "manual", url: "https://example.com" },
    metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
    type: "fill",
    target: { candidates: [{ kind: "label", value: "Email address", exact: true }] },
    payload: { value: "recorded@example.com" },
    parameterBinding: { source: "profile", field: "identity.email" },
  }];
  const saved = await request.put(`/api/workflows/${workflow.id}`, {
    data: { workflow, expectedRevision: workflow.revision },
  });
  expect(saved.status()).toBe(200);

  await page.goto(`/workflows/${workflow.id}/edit`);
  await page.getByRole("button", { name: "Run workflow" }).click();

  const runDialog = page.getByRole("dialog", { name: "Run workflow?" });
  await expect(runDialog.getByRole("alert")).toContainText("Choose a run profile from the Library");
  await expect(runDialog.getByRole("link", { name: "Choose profile in Library" })).toHaveAttribute(
    "href",
    `/library?selected=${workflow.id}`,
  );
  await expect(runDialog.getByRole("button", { name: "Run workflow" })).toHaveCount(0);
});

test("keeps the desktop workspace within the 1024px viewport", async ({ page, request }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openDraft(page, request);
  await expect(page.getByRole("button", { name: /expand step details/i })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
  const workspaceBounds = await page.locator(".workspace").boundingBox();
  expect(workspaceBounds?.height).toBeCloseTo(768, 0);
});

test("shows the desktop-only guard below 1024px", async ({ page, request }) => {
  const workflow = await createDraft(request);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`/workflows/${workflow.id}/edit`);
  await expect(page.getByRole("heading", { name: /larger screen is required/i })).toBeVisible();
});
