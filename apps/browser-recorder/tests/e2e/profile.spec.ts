import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("creates, restores, updates, and permanently deletes a JSON-backed profile", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "New profile" }).first().click();

  await expect(page.getByLabel("Profile name")).toHaveValue("Untitled profile");
  await page.getByLabel("Full name").fill("Alex Johnson");
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(page).toHaveURL(/\/profile\?selected=[0-9a-f-]+$/);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  const selectedUrl = page.url();

  await page.getByLabel("Email address").fill("alex@example.com");
  await page.getByLabel("Country/region").fill("United States");
  await page.getByLabel("ZIP code").fill("94103");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(selectedUrl);
  await expect(page.getByLabel("Email address")).toHaveValue("alex@example.com");
  await expect(page.getByRole("heading", { name: "Browser" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run a workflow with this profile" })).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  const deleteButton = page.getByRole("button", { name: "Delete" });
  await deleteButton.click();
  await expect(page.getByRole("dialog", { name: "Delete Untitled profile?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await page.getByRole("button", { name: "Delete profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "No saved profiles" })).toBeVisible();
});

test("fits the supported desktop viewport and guards smaller screens", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profiles", level: 1 })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByRole("heading", { name: "A larger screen is required" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profiles", level: 1 })).toBeHidden();
});
