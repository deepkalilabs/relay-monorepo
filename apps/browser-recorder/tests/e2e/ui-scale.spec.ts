import { expect, test, type Page } from "@playwright/test";

const productRoutes = [
  { path: "/automations", heading: "Automations" },
  { path: "/library", heading: "Library" },
  { path: "/profile", heading: "Profiles" },
];

async function readLayoutMetrics(page: Page) {
  return page.evaluate(() => {
    const visibleRoot = [...document.body.children].find((element) => (
      element.getBoundingClientRect().height > 0
    ));
    const rootBounds = visibleRoot?.getBoundingClientRect();

    return {
      zoom: Number.parseFloat(getComputedStyle(document.documentElement).zoom),
      rootHeight: rootBounds?.height ?? 0,
      documentOverflow: document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    };
  });
}

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1440, height: 960 },
]) {
  test(`uses the 80% app scale and fills the ${viewport.width}px viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);

    for (const route of productRoutes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading, level: 1 })).toBeVisible();

      const metrics = await readLayoutMetrics(page);
      expect(metrics.zoom).toBeCloseTo(0.8, 5);
      expect(metrics.rootHeight).toBeGreaterThanOrEqual(viewport.height - 1);
      expect(metrics.documentOverflow).toBeLessThanOrEqual(0);
      expect(metrics.bodyOverflow).toBeLessThanOrEqual(0);
    }
  });
}

test("expands the desktop product rail without moving page content", async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1440, height: 960 },
  ]) {
    await page.setViewportSize(viewport);

    for (const route of productRoutes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading, level: 1 })).toBeVisible();

      const sidebar = page.getByRole("complementary", { name: "Primary navigation" });
      const content = page.getByRole("main");
      const homeLink = sidebar.getByRole("link", { name: "Memory Recorder home" });
      const libraryLink = sidebar.getByRole("link", { name: "Library" });
      const collapsedSidebar = await sidebar.boundingBox();
      const initialContent = await content.boundingBox();

      expect(collapsedSidebar?.width).toBeCloseTo(60 * 0.8, 0);
      await expect(homeLink).toHaveAttribute("title", "Memory Recorder home");
      await expect(libraryLink).toHaveAttribute("title", "Library");
      expect((await libraryLink.locator("svg").boundingBox())?.width).toBeCloseTo(17 * 0.8, 0);

      await sidebar.hover();
      await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeCloseTo(216 * 0.8, 0);
      const hoveredContent = await content.boundingBox();
      expect(hoveredContent?.x).toBeCloseTo(initialContent?.x ?? 0, 0);

      await page.mouse.move(600, 10);
      await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeCloseTo(60 * 0.8, 0);

      await libraryLink.focus();
      await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeCloseTo(216 * 0.8, 0);
      const focusedContent = await content.boundingBox();
      expect(focusedContent?.x).toBeCloseTo(initialContent?.x ?? 0, 0);

      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeCloseTo(60 * 0.8, 0);
    }
  }
});

test("keeps automation dialogs inside the scaled viewport", async ({ page }) => {
  const viewport = { width: 1024, height: 768 };
  await page.setViewportSize(viewport);
  await page.goto("/automations");
  await page.getByRole("button", { name: "Select Verification folder" }).click();
  await page.getByRole("button", { name: "Add task" }).click();

  const dialog = page.getByRole("dialog", { name: /Add task to Verification/ });
  await expect(dialog).toBeVisible();

  const [backdropBounds, dialogBounds] = await Promise.all([
    page.locator(".modal-backdrop").boundingBox(),
    dialog.boundingBox(),
  ]);

  expect(backdropBounds?.width).toBeCloseTo(viewport.width, 0);
  expect(backdropBounds?.height).toBeCloseTo(viewport.height, 0);
  expect(dialogBounds?.y).toBeGreaterThanOrEqual(0);
  expect((dialogBounds?.y ?? 0) + (dialogBounds?.height ?? 0)).toBeLessThanOrEqual(
    viewport.height,
  );
});
