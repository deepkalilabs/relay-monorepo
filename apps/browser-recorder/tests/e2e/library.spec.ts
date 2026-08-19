import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("shows filesystem workflows with a static preview, search, and local selection", async ({ page, request }) => {
  const firstResponse = await request.post("/api/workflows");
  const first = await firstResponse.json();
  first.name = "Checkout flow";
  first.steps = [{
    id: crypto.randomUUID(),
    order: 0,
    name: "Enter contact information",
    enabled: true,
    page: { id: "manual", url: "" },
    metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
    type: "click",
    target: { candidates: [{ kind: "css", value: "body", exact: true, unique: true }] },
    payload: {},
  }];
  await request.put(`/api/workflows/${first.id}`, {
    data: { workflow: first, expectedRevision: first.revision },
  });

  const secondResponse = await request.post("/api/workflows");
  const second = await secondResponse.json();
  second.name = "Weekly analytics export";
  await request.put(`/api/workflows/${second.id}`, {
    data: { workflow: second, expectedRevision: second.revision },
  });

  await page.goto(`/library?selected=${first.id}`);

  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  const checkoutButton = page.getByRole("button", { name: "Select Checkout flow workflow" });
  await expect(checkoutButton).toHaveAttribute("aria-pressed", "true");
  const checkoutThumbnail = checkoutButton.locator(".workflow-thumb");
  await expect(checkoutThumbnail).toHaveAttribute("data-variant", "article");
  const thumbnailBounds = await checkoutThumbnail.boundingBox();
  expect(thumbnailBounds?.width).toBeCloseTo(124 * 0.8, 0);
  expect(thumbnailBounds?.height).toBeCloseTo(70 * 0.8, 0);
  await expect(page.getByTestId("static-workflow-preview")).toBeVisible();
  await expect(page.getByText("Enter contact information")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue editing Checkout flow" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search workflows" }).fill("weekly");
  const analyticsButton = page.getByRole("button", { name: "Select Weekly analytics export workflow" });
  await expect(analyticsButton).toBeVisible();
  await expect(analyticsButton.locator(".workflow-thumb")).toHaveAttribute("data-variant", "calendar");
  await expect(page.getByRole("button", { name: "Select Checkout flow workflow" })).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("configures profile and runtime inputs before handing off to replay", async ({ page, request }) => {
  const profileResponse = await request.post("/api/profiles", {
    data: {
      profile: {
        name: "Alex · US",
        identity: { fullName: "Alex Morgan", email: "alex@example.com" },
        location: { countryRegion: "United States", postalCode: "94107" },
      },
    },
  });
  expect(profileResponse.status()).toBe(201);
  const profile = await profileResponse.json();

  const workflowResponse = await request.post("/api/workflows");
  const workflow = await workflowResponse.json();
  workflow.name = "Parameterized checkout";
  workflow.steps = [
    {
      id: crypto.randomUUID(),
      order: 0,
      name: "Enter email address",
      enabled: true,
      page: { id: "manual", url: "https://example.com" },
      metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
      type: "fill",
      target: { candidates: [{ kind: "label", value: "Email address", exact: true }] },
      payload: { value: "recorded@example.com" },
      parameterBinding: { source: "recorded" },
    },
    {
      id: crypto.randomUUID(),
      order: 1,
      name: "Order reference",
      enabled: true,
      page: { id: "manual", url: "https://example.com" },
      metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
      type: "fill",
      target: { candidates: [{ kind: "label", value: "Order reference", exact: true }] },
      payload: { value: "recorded-reference" },
      parameterBinding: { source: "recorded" },
    },
  ];
  const savedResponse = await request.put(`/api/workflows/${workflow.id}`, {
    data: { workflow, expectedRevision: workflow.revision },
  });
  expect(savedResponse.status()).toBe(200);

  await page.goto(`/library?selected=${workflow.id}`);
  await page.getByRole("combobox", { name: "Run profile" }).selectOption(profile.id);
  await page.getByRole("button", { name: "Auto-map fields" }).click();
  await expect(page.getByText("alex@example.com")).toBeVisible();
  await page.getByRole("combobox", { name: "Value source for Order reference" }).selectOption("runtime");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Value source for Order reference" })).toHaveValue("runtime");
  await page.getByRole("combobox", { name: "Run profile" }).selectOption(profile.id);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "Run workflow" }).click();

  await expect(page).toHaveURL(new RegExp(
    `/workflows/${workflow.id}/edit\\?profile=${profile.id}$`,
  ));
  await expect(page.getByRole("dialog", { name: "Run workflow?" })).toBeVisible();
  const runDialog = page.getByRole("dialog", { name: "Run workflow?" });
  await expect(runDialog.getByRole("textbox", { name: "Order reference" })).toHaveAttribute("maxlength", "10000");
  await runDialog.getByRole("textbox", { name: "Order reference" }).fill("RUN-42");
  await expect(runDialog.getByRole("button", { name: "Run workflow" })).toBeEnabled();
  expect(page.url()).not.toContain("RUN-42");
});

test("new recording creates a draft before opening the editor", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "New recording" }).click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]+\/edit$/);
  await expect(page.getByRole("textbox", { name: /workflow name/i })).toHaveValue("Untitled recording");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("keeps the Library within the supported 1024px desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
});

test("shows the desktop-only guard below 1024px", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "A larger screen is required" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Library" })).toBeHidden();
});
