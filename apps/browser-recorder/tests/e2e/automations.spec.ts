import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

const ARTIFACT_IDS = [
  "3e23db5e-1683-4857-bfb7-a5c2eea6d41f",
  "618fcde7-443f-4d13-9ed9-0b8f160738dd",
];
const WEBP_BODY = Buffer.from(
  "UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoQAAoAAgA0JaACdLoB+AADsAD+y7f/1BnyDPkGfqpf/IL1b5tjQAAA",
  "base64",
);

async function createCompleteWorkflow(request: APIRequestContext, name: string) {
  const created = await request.post("/api/workflows").then((response) => response.json());
  created.name = name;
  created.steps = [{
    id: crypto.randomUUID(),
    order: 0,
    name: "Open page",
    enabled: true,
    page: { id: "manual", url: "" },
    metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
    type: "navigate",
    payload: { url: "https://example.com" },
  }];
  const saved = await request.put(`/api/workflows/${created.id}`, {
    data: { workflow: created, expectedRevision: created.revision },
  }).then((response) => response.json());
  return request.post(`/api/workflows/${created.id}/finish`, {
    data: { workflow: saved, expectedRevision: saved.revision },
  }).then((response) => response.json());
}

test("mirrors saved Library workflows in a read-only All workflows folder", async ({ page, request }) => {
  const consoleProblems: string[] = [];
  const failedResources: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.location().url.endsWith("/favicon.ico")) return;
      consoleProblems.push(`${message.text()} (${message.location().url})`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
  });

  const createResponse = await request.post("/api/workflows");
  const workflow = await createResponse.json();
  const workflowName = `Checkout flow ${workflow.id.slice(0, 8)}`;
  workflow.name = workflowName;
  workflow.steps = [{
    id: crypto.randomUUID(),
    order: 0,
    name: "Open checkout",
    enabled: true,
    page: { id: "manual", url: "" },
    metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
    type: "navigate",
    payload: { url: "https://example.com/checkout" },
  }];
  const saveResponse = await request.put(`/api/workflows/${workflow.id}`, {
    data: { workflow, expectedRevision: workflow.revision },
  });
  expect(saveResponse.status()).toBe(200);

  await page.goto("/automations");

  const allWorkflows = page.getByRole("button", { name: "Select All workflows folder" });
  await expect(allWorkflows).toHaveAttribute("aria-pressed", "true");
  await expect(allWorkflows).toContainText("All workflows");

  const workflowPane = page.getByRole("region", { name: "All workflows workflows" });
  const workflowRow = workflowPane.getByRole("row", { name: new RegExp(workflowName) });
  await expect(workflowRow).toContainText("1 step");
  await expect(workflowPane.getByRole("button", { name: "Run folder" })).toBeDisabled();
  await expect(workflowPane.getByRole("button", { name: "Add task" })).toBeDisabled();
  await expect(workflowRow.getByRole("button")).toHaveCount(0);
  await expect(workflowRow.getByRole("link")).toHaveCount(0);
  const completedRuns = page.getByRole("region", { name: "Completed runs" });
  await expect(completedRuns.getByRole("article")).toHaveCount(1);
  await expect(completedRuns.getByText("Demo · Not a real run")).toBeVisible();
  await expect(completedRuns.getByRole("img", { name: "Diffusion cat sample evidence" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(failedResources).toEqual([]);
  expect(consoleProblems).toEqual([]);
});

test("runs two folder workflows through one stubbed background batch", async ({ page, request }) => {
  const consoleProblems: string[] = [];
  const failedResources: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.location().url.endsWith("/favicon.ico")) return;
      consoleProblems.push(`${message.text()} (${message.location().url})`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
  });
  const first = await createCompleteWorkflow(request, `POC first ${crypto.randomUUID().slice(0, 8)}`);
  const second = await createCompleteWorkflow(request, `POC second ${crypto.randomUUID().slice(0, 8)}`);
  const batchId = crypto.randomUUID();
  let createCount = 0;
  let pollCount = 0;

  await page.route("**/api/run-artifacts/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/webp", body: WEBP_BODY });
  });

  await page.route("**/api/run-batches**", async (route) => {
    if (route.request().method() === "POST") {
      createCount += 1;
      await route.fulfill({ status: 202, json: { batchId, runCount: 2 } });
      return;
    }
    pollCount += 1;
    const terminal = pollCount > 1;
    await route.fulfill({
      status: 200,
      json: {
        batchId,
        runs: [first, second].map((workflow: { id: string }, index: number) => ({
          workflowId: workflow.id,
          status: terminal ? "completed" : index === 0 ? "running" : "queued",
          currentStep: terminal ? 1 : index === 0 ? 1 : 0,
          totalSteps: 1,
          ...(terminal ? {
            screenshot: {
              url: `/api/run-artifacts/${ARTIFACT_IDS[index]}`,
              width: 480,
              height: 300,
            },
          } : {}),
        })),
      },
    });
  });

  await page.goto("/automations");
  await expect(page.getByText(first.name)).toBeVisible();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "Folder name" }).fill("POC batch");
  await page.getByRole("button", { name: "Create folder" }).click();

  for (const workflow of [first, second]) {
    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByRole("combobox", { name: "Inbox task" }).selectOption(workflow.id);
    await page.getByRole("button", { name: "Add task to POC batch" }).click();
  }

  await page.getByRole("button", { name: "Run folder" }).click();
  await expect(page.getByText("Running · Step 1 of 1")).toBeVisible();
  await expect(page.getByText("Queued")).toBeVisible();
  const completedRuns = page.getByRole("region", { name: "Completed runs" });
  const completedCards = completedRuns.getByRole("article");
  await expect(completedCards).toHaveCount(3, { timeout: 3_000 });
  await expect(completedRuns).toContainText(first.name);
  await expect(completedRuns).toContainText(second.name);
  await expect(completedCards.nth(2)).toHaveAccessibleName("Cat evidence demo: Demo · Not a real run");
  const firstCompletedRun = completedRuns.getByRole("article").filter({ hasText: first.name });
  const evidenceToggle = firstCompletedRun.getByRole("button", {
    name: new RegExp(`evidence for ${first.name}$`),
  });
  const evidenceImage = firstCompletedRun.getByRole("img", {
    name: `Run evidence for ${first.name}`,
  });
  await expect(evidenceToggle).toHaveAttribute("aria-expanded", "true");
  await expect(evidenceImage).toBeVisible();
  await expect.poll(() => evidenceImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);

  await evidenceToggle.focus();
  await page.keyboard.press("Enter");
  await expect(evidenceToggle).toHaveAccessibleName(`Show evidence for ${first.name}`);
  await expect(evidenceToggle).toHaveAttribute("aria-expanded", "false");
  await expect(evidenceImage).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(evidenceToggle).toHaveAccessibleName(`Hide evidence for ${first.name}`);
  await expect(evidenceImage).toBeVisible();

  const demoCard = completedCards.nth(2);
  const demoToggle = demoCard.getByRole("button", { name: /evidence for Cat evidence demo$/ });
  const demoImage = demoCard.getByRole("img", { name: "Diffusion cat sample evidence" });
  await expect(demoImage).toBeVisible();
  await demoToggle.click();
  await expect(demoToggle).toHaveAccessibleName("Show evidence for Cat evidence demo");
  await expect(demoImage).toHaveCount(0);
  await demoToggle.click();
  await expect(demoImage).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(createCount).toBe(1);
  expect(failedResources).toEqual([]);
  expect(consoleProblems).toEqual([]);
});
