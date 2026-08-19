import { expect, test } from "@playwright/test";
import { preflightReplay, ReplayEngine } from "../../src/server/replay/engine";
import { createWorkflow } from "../../src/shared/contracts/workflow/schema";
import type { ServerMessage } from "../../src/shared/contracts/protocol";

test("combobox replay preserves text on controls that reject bulk fills", async ({ page }) => {
  const address = "9320 S Clifton Park Ave";
  const documentUrl = `data:text/html,${encodeURIComponent(`
    <!doctype html>
    <label for="location">Location</label>
    <input id="location" role="combobox" aria-label="Location" />
    <script>
      window.comboboxKeydowns = [];
      const input = document.querySelector("#location");
      input.addEventListener("keydown", (event) => window.comboboxKeydowns.push(event.key));
      input.addEventListener("input", () => {
        if (window.comboboxKeydowns.length === 0) setTimeout(() => { input.value = ""; }, 0);
      });
    </script>
  `)}`;
  const workflow = createWorkflow("natural-combobox-fill");
  const recordedAt = new Date().toISOString();
  workflow.steps = [
    {
      id: "navigate",
      order: 0,
      name: "Open fixture",
      enabled: true,
      page: { id: "page", url: documentUrl },
      metadata: { recordedAt, origin: "recorded", sensitive: false },
      type: "navigate",
      payload: { url: documentUrl },
    },
    {
      id: "fill",
      order: 1,
      name: "Location",
      enabled: true,
      page: { id: "page", url: documentUrl },
      target: {
        tagName: "input",
        inputType: "text",
        candidates: [{ kind: "role", value: "combobox", name: "Location", exact: true }],
      },
      metadata: { recordedAt, origin: "recorded", sensitive: false },
      type: "fill",
      payload: { value: address },
      parameterBinding: { source: "recorded" },
    },
  ];
  const messages: ServerMessage[] = [];
  const engine = new ReplayEngine(
    crypto.randomUUID(),
    page,
    preflightReplay(workflow),
    (message) => messages.push(message),
  );

  await engine.run();

  await expect(page.getByRole("combobox", { name: "Location" })).toHaveValue(address);
  const keydowns = await page.evaluate(() => (
    window as Window & { comboboxKeydowns?: string[] }
  ).comboboxKeydowns ?? []);
  expect(keydowns).toContain("Backspace");
  expect(keydowns.some((key) => key === "Control" || key === "Meta")).toBe(true);
  expect(messages.at(-1)).toMatchObject({ type: "replay.status", status: "completed" });
});
