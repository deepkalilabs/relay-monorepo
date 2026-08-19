import { expect, test, type Frame } from "@playwright/test";
import { RECORDER_SCRIPT } from "../../src/server/recording/injected";
import { applyPositionBefore, preflightReplay, ReplayEngine } from "../../src/server/replay/engine";
import type { ServerMessage } from "../../src/shared/contracts/protocol";
import type { ElementAssertionStep, GroupExistsAssertionStep, RepeatedGroupTemplate, WorkflowStep } from "../../src/shared/contracts/workflow/domain";
import { createWorkflow } from "../../src/shared/contracts/workflow/schema";

test("records Enter after a completed fill without recording its synthetic submit click", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  const email = page.getByLabel("Email");
  await email.fill("person@example.com");
  await email.press("Enter");

  await expect(page.getByRole("status")).toHaveText("Submitted");
  await expect.poll(() => actions.map((action) => action.type)).toEqual(["fill", "keypress"]);
  expect(actions[0]).toMatchObject({
    type: "fill",
    name: "Email",
    payload: { value: "person@example.com" },
  });
  expect(actions[1]).toMatchObject({
    type: "keypress",
    name: "Email",
    payload: { key: "Enter", modifiers: [] },
    position: { x: 0, y: 0 },
  });
  expect((actions[1].target as { candidates: Array<{ kind: string }> }).candidates[0].kind).toBe("testId");
  expect(actions.some((action) => action.type === "click")).toBe(false);
});

test("assertion picking captures target evidence without activating or recording the click", async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (event: Record<string, unknown>) => { events.push(event); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
  await page.evaluate((id) => {
    (window as Window & { __browserMemorySetAssertionPicker?: (requestId: string | null) => void })
      .__browserMemorySetAssertionPicker?.(id);
  }, requestId);
  const button = page.getByRole("button", { name: "Open details" });
  await button.evaluate((element) => {
    const label = element.textContent ?? "";
    const nested = document.createElement("span");
    nested.textContent = label;
    element.replaceChildren(nested);
  });
  await button.hover();
  await expect(button).toHaveCSS("outline-style", "solid");
  await button.click();

  await expect(page).not.toHaveURL(/view=details/);
  await expect.poll(() => events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "assertion-picker.selected",
    requestId,
    name: "Open details",
    text: "Open details",
    position: { x: 0, y: 0 },
    target: { candidates: expect.arrayContaining([expect.objectContaining({ kind: "role", value: "button", name: "Open details" })]) },
  });
  expect(events.some((event) => event.type === "click")).toBe(false);
});

test("assertion picker is one viewport-safe floating overlay", async ({ page }) => {
  await page.exposeFunction("__browserMemoryEmit", () => undefined);
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.setViewportSize({ width: 360, height: 480 });
  await page.goto("/fixture");

  const layoutWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.evaluate(() => {
    (window as Window & { __browserMemorySetAssertionPicker?: (requestId: string | null) => void })
      .__browserMemorySetAssertionPicker?.("c7daf0b9-d92a-44db-9967-db33d1516976");
  });

  const panel = page.locator("[data-browser-memory-assertion-ui]");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveCSS("position", "fixed");
  await expect(panel).toHaveCSS("top", "16px");
  await expect(panel).toHaveCSS("right", "16px");
  await expect(panel.getByRole("heading", { name: "Select an element" })).toBeVisible();
  await expect(panel.getByText("Hover to preview repeated structural groups, or click an unmatched element to select it exactly.")).toBeVisible();

  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(layoutWidth);
});

test("assertion picker lets the user choose a repeated structural group", async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (event: Record<string, unknown>) => { events.push(event); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = `
      <article role="article" class="profile-card result"><header>Alice</header><section>Seattle</section><footer><button type="button">Open Alice</button></footer></article>
      <article role="article" class="profile-card result"><header>Bob</header><section>Portland</section><section>Optional detail</section><footer><button type="button">Open Bob</button></footer></article>
      <aside><header>Unrelated</header><p>Different structure</p></aside>
    `;
    document.body.append(host);
    document.body.addEventListener("click", () => document.body.dataset.siteClicks = String(Number(document.body.dataset.siteClicks ?? 0) + 1));
  });

  const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
  await page.evaluate((id) => {
    (window as Window & { __browserMemorySetAssertionPicker?: (requestId: string | null) => void })
      .__browserMemorySetAssertionPicker?.(id);
  }, requestId);

  await page.locator(".profile-card header").first().hover();
  const panel = page.locator("[data-browser-memory-assertion-ui]");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("width", "320px");
  await expect(panel.getByRole("heading", { name: "Repeated group found" })).toBeVisible();
  await expect(panel.getByText("2 matching containers")).toBeVisible();
  await expect(panel.getByRole("button", { name: /article group, 2 matches/i })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Use matched group" })).toBeDisabled();
  await expect(panel.locator("details")).not.toHaveAttribute("open", "");
  await expect(page.locator(".profile-card")).toHaveCount(2);
  for (const card of await page.locator(".profile-card").all()) {
    await expect(card).toHaveCSS("outline-style", "solid");
    await expect(card).toHaveCSS("outline-color", "rgb(40, 91, 214)");
  }

  await panel.getByRole("button", { name: /article group, 2 matches/i }).focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/group selected/i)).toBeVisible();
  await expect.poll(() => events).toHaveLength(0);
  await panel.getByRole("button", { name: "Continue picking" }).click();
  await expect(panel.getByRole("heading", { name: "Select an element" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Use matched group" })).toHaveCount(0);
  await page.locator("aside header").hover();
  await expect(panel.getByRole("button", { name: /article group/i })).toHaveCount(0);

  await page.locator(".profile-card header").first().hover();
  await page.locator(".profile-card header").first().click();
  await expect.poll(() => events).toHaveLength(0);
  await expect(panel.getByText(/group selected/i)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Use matched group" })).toBeEnabled();

  await page.locator("aside header").hover();
  await expect(panel.getByRole("button", { name: /article group, 2 matches/i })).toBeVisible();
  await expect(panel.getByText(/group selected/i)).toBeVisible();

  await page.locator(".profile-card").last().evaluate((element) => element.remove());
  await expect(panel.getByRole("button", { name: "Use matched group" })).toBeDisabled();
  await expect(panel.getByText(/fewer than two visible members/i)).toBeVisible();

  await page.evaluate(() => {
    for (const name of ["Restored", "Inserted"]) {
      const card = document.createElement("article");
      card.className = "profile-card result";
      card.setAttribute("role", "article");
      card.innerHTML = `<header>${name}</header><section>Different place</section><footer><button type="button">Different action</button></footer>`;
      document.querySelector(".profile-card")?.parentElement?.append(card);
    }
  });
  await expect(panel.getByRole("button", { name: /article group, 3 matches/i })).toBeVisible();
  await page.locator(".profile-card").last().evaluate((element) => element.remove());
  await expect(panel.getByRole("button", { name: /article group, 2 matches/i })).toBeVisible();

  await panel.getByText("Template JSON").click();
  const templateJson = await panel.locator("pre").textContent();
  expect(templateJson).not.toMatch(/Alice|Bob|Seattle|Portland|identity|member/i);
  await panel.getByRole("button", { name: "Use matched group" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "assertion-picker.group-selected",
    requestId,
    groupTarget: {
      version: 1,
      algorithm: "structural-token-v1",
      root: { tagName: "article", role: "article", sharedClasses: ["profile-card", "result"] },
      capturedMatchCount: 2,
    },
  });
  expect(events[0]).not.toHaveProperty("target");
  expect(await page.locator("body").getAttribute("data-site-clicks")).toBeNull();
  await expect(panel).toHaveCount(0);
  for (const card of await page.locator(".profile-card").all()) await expect(card).not.toHaveCSS("outline-style", "solid");
});

test("a frozen group can deliberately fall back to the exact seed element", async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (event: Record<string, unknown>) => { events.push(event); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = `
      <article class="result"><header>Alice</header><section>One</section></article>
      <article class="result"><header>Bob</header><section>Two</section></article>
    `;
    document.body.append(host);
    document.body.addEventListener("click", () => document.body.dataset.siteClicks = "activated");
  });
  const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
  await page.evaluate((id) => {
    (window as Window & { __browserMemorySetAssertionPicker?: (requestId: string | null) => void })
      .__browserMemorySetAssertionPicker?.(id);
  }, requestId);

  const seed = page.locator(".result header").first();
  await seed.hover();
  await seed.click();
  const panel = page.locator("[data-browser-memory-assertion-ui]");
  await expect(panel.getByText(/group selected/i)).toBeVisible();
  await panel.getByRole("button", { name: "Use exact element instead" }).click();

  await expect.poll(() => events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "assertion-picker.selected",
    requestId,
    name: "Alice",
    text: "Alice",
    target: { tagName: "header" },
  });
  expect(await page.locator("body").getAttribute("data-site-clicks")).toBeNull();
  await expect(panel).toHaveCount(0);
});

test("assertion picking captures visible text only", async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (event: Record<string, unknown>) => { events.push(event); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const button = document.createElement("button");
    const hidden = document.createElement("span");
    button.type = "button";
    button.setAttribute("aria-label", "Empty status");
    button.dataset.testid = "empty-status";
    button.style.width = "40px";
    button.style.height = "40px";
    hidden.hidden = true;
    hidden.textContent = "Hidden secret";
    button.append(hidden);
    document.body.append(button);
  });

  const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
  await page.evaluate((id) => {
    (window as Window & { __browserMemorySetAssertionPicker?: (requestId: string | null) => void })
      .__browserMemorySetAssertionPicker?.(id);
  }, requestId);
  await page.getByTestId("empty-status").click();

  await expect.poll(() => events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "assertion-picker.selected", requestId, name: "Empty status", text: "" });
});

test("assertion picking cancels with Escape and restores the hovered element", async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (event: Record<string, unknown>) => { events.push(event); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
  await page.evaluate((id) => {
    (window as Window & { __browserMemorySetAssertionPicker?: (requestId: string | null) => void })
      .__browserMemorySetAssertionPicker?.(id);
  }, requestId);
  const button = page.getByRole("button", { name: "Open details" });
  await button.hover();
  await page.keyboard.press("Escape");

  await expect.poll(() => events).toEqual([{ type: "assertion-picker.cancelled", requestId }]);
  await expect(button).not.toHaveCSS("outline-style", "solid");
  await expect(page.locator("[data-browser-memory-assertion-ui]")).toHaveCount(0);
});

test("assertion picking captures child-frame target and viewport context", async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (event: Record<string, unknown>) => { events.push(event); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  const requestId = "c7daf0b9-d92a-44db-9967-db33d1516976";
  await Promise.all(page.frames().map((frame) => frame.evaluate((id) => {
    (window as Window & { __browserMemorySetAssertionPicker?: (requestId: string | null) => void })
      .__browserMemorySetAssertionPicker?.(id);
  }, requestId)));
  const panelIsVisible = (frame: Frame) => frame.locator("[data-browser-memory-assertion-ui]").isVisible().catch(() => false);
  expect((await Promise.all(page.frames().map(panelIsVisible))).filter(Boolean)).toHaveLength(1);

  const paymentFrame = page.frames().find((frame) => frame.url().includes("/fixture/frame"));
  expect(paymentFrame).toBeDefined();
  const pay = page.frameLocator('iframe[title="Payment frame"]').getByRole("button", { name: "Pay" });
  await pay.hover();
  await expect.poll(async () => ({
    main: await panelIsVisible(page.mainFrame()),
    child: paymentFrame ? await panelIsVisible(paymentFrame) : false,
  })).toEqual({ main: false, child: true });
  await pay.click();

  await expect.poll(() => events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "assertion-picker.selected",
    requestId,
    name: "Pay",
    target: { frameUrl: expect.stringContaining("/fixture/frame") },
    position: { frameUrl: expect.stringContaining("/fixture/frame") },
  });
});

test("assertion replay passes both checks and exposes mismatch recovery", async ({ page }) => {
  await page.goto("/fixture");
  const recordedAt = new Date().toISOString();
  const assertion = (expectation: ElementAssertionStep["expectation"]): ElementAssertionStep => ({
    id: crypto.randomUUID(),
    order: 0,
    name: "Open details assertion",
    enabled: true,
    page: { id: "page", url: page.url() },
    target: { candidates: [{ kind: "role", value: "button", name: "Open details", exact: true }] },
    expectation,
    metadata: { recordedAt, origin: "manual", sensitive: false },
    type: "assertion",
  });
  const workflow = createWorkflow();
  workflow.source.startUrl = page.url();
  workflow.steps = [
    assertion({ kind: "visible" }),
    { ...assertion({ kind: "text_contains", expected: "OPEN details" }), order: 1 },
  ];
  const successMessages: ServerMessage[] = [];
  const successEngine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflow), (message) => successMessages.push(message));

  await successEngine.run();
  expect(successMessages.filter((message) => message.type === "replay.step" && message.status === "passed")).toHaveLength(2);

  const mismatchWorkflow = createWorkflow();
  mismatchWorkflow.source.startUrl = page.url();
  mismatchWorkflow.steps = [assertion({ kind: "text_contains", expected: "Unavailable" })];
  const mismatchMessages: ServerMessage[] = [];
  const mismatchEngine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(mismatchWorkflow), (message) => mismatchMessages.push(message));
  const mismatchRun = mismatchEngine.run();
  await expect.poll(() => mismatchMessages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true);
  mismatchEngine.skip();
  await mismatchRun;

  expect(mismatchMessages).toContainEqual(expect.objectContaining({
    type: "replay.step",
    status: "failed",
    phase: "asserting",
    diagnostic: expect.objectContaining({
      message: 'Expected text to contain "unavailable", but observed "open details".',
    }),
  }));
});

test("repeated-group assertion follows structural matches instead of a particular card", async ({ page }) => {
  await page.goto("/fixture");
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const state = sessionStorage.getItem("repeated-group-test-state") ?? "two";
      const host = document.createElement("div");
      host.id = "dynamic-results";
      const card = (name: string, optional = "") => `<article role="article" class="profile-card"><header>${name}</header><section>Changed place</section>${optional}<footer>Open</footer></article>`;
      if (state === "broad") host.innerHTML = Array.from({ length: 501 }, (_, index) => card(String(index))).join("");
      else if (state === "changed") host.innerHTML = `<article role="article" class="profile-card"><div><nav><button>New shape</button></nav></div></article>`;
      else if (state === "two" || state === "three") host.innerHTML = [card("Alice"), card("Bob", "<section>Optional detail</section>"), ...(state === "three" ? [card("Inserted")] : [])].join("");
      else host.innerHTML = `<article role="article" class="profile-card" ${state === "hidden" ? "style=\"display:none\"" : ""}><header>Completely different person</header><section>Portland</section><footer>Open</footer></article>`;
      document.body.append(host);
    });
  });

  const groupTarget: RepeatedGroupTemplate = {
    version: 1,
    algorithm: "structural-token-v1",
    root: { tagName: "article", role: "article", sharedClasses: ["profile-card"] },
    structureTokens: ["0:article:article", "1:footer:", "1:header:", "1:section:"],
    capturedMatchCount: 2,
  };
  const assertion = (): GroupExistsAssertionStep => ({
    id: crypto.randomUUID(),
    order: 0,
    name: "Profile card group exists",
    enabled: true,
    page: { id: "page", url: page.url() },
    groupTarget,
    expectation: { kind: "group_exists" },
    metadata: { recordedAt: new Date().toISOString(), origin: "manual", sensitive: false },
    type: "assertion",
  });

  const run = async (step = assertion()) => {
    const workflow = createWorkflow();
    workflow.steps = [step];
    const messages: ServerMessage[] = [];
    const engine = new ReplayEngine(crypto.randomUUID(), page, preflightReplay(workflow), (message) => messages.push(message));
    const running = engine.run();
    return { engine, messages, running };
  };

  const first = await run();
  await first.running;
  expect(first.messages).toContainEqual(expect.objectContaining({
    type: "replay.step",
    status: "passed",
    locatorKind: "structural-group",
  }));

  await page.evaluate(() => sessionStorage.setItem("repeated-group-test-state", "three"));
  const inserted = await run();
  await inserted.running;
  expect(inserted.messages).toContainEqual(expect.objectContaining({ type: "replay.step", status: "passed" }));

  await page.evaluate(() => sessionStorage.setItem("repeated-group-test-state", "one"));
  const dynamic = await run();
  await dynamic.running;
  expect(dynamic.messages).toContainEqual(expect.objectContaining({ type: "replay.step", status: "passed" }));

  await page.evaluate(() => sessionStorage.setItem("repeated-group-test-state", "hidden"));
  const missing = await run();
  await expect.poll(() => missing.messages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true);
  missing.engine.skip();
  await missing.running;
  expect(missing.messages).toContainEqual(expect.objectContaining({
    type: "replay.step",
    status: "failed",
    phase: "asserting",
    diagnostic: expect.objectContaining({
      message: expect.stringMatching(/no visible structural group matched/i),
      attemptedLocators: expect.arrayContaining([
        expect.objectContaining({ kind: "structural-group", reason: expect.stringMatching(/captured 2/i) }),
      ]),
    }),
  }));

  await page.evaluate(() => sessionStorage.setItem("repeated-group-test-state", "changed"));
  const changed = await run();
  await expect.poll(() => changed.messages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true);
  changed.engine.skip();
  await changed.running;

  await page.evaluate(() => sessionStorage.setItem("repeated-group-test-state", "one"));
  const wrongFrame = await run({ ...assertion(), groupTarget: { ...groupTarget, frameUrl: "https://example.com/missing-frame" } });
  await expect.poll(() => wrongFrame.messages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true);
  wrongFrame.engine.skip();
  await wrongFrame.running;
  expect(wrongFrame.messages).toContainEqual(expect.objectContaining({
    type: "replay.step",
    diagnostic: expect.objectContaining({ attemptedLocators: [{ kind: "structural-group", reason: expect.stringMatching(/zero matches.*captured 2.*highest similarities: none.*frame/im) }] }),
  }));

  await page.evaluate(() => sessionStorage.setItem("repeated-group-test-state", "broad"));
  const broad = await run();
  await expect.poll(() => broad.messages.some((message) => message.type === "replay.step" && message.status === "failed")).toBe(true);
  broad.engine.skip();
  await broad.running;
  expect(broad.messages).toContainEqual(expect.objectContaining({
    type: "replay.step",
    diagnostic: expect.objectContaining({ message: expect.stringMatching(/excessively broad/i) }),
  }));
});

test("records Enter on semantic controls while preserving their activation", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  const openDetails = page.getByRole("button", { name: "Open details" });
  await openDetails.focus();
  await openDetails.press("Enter");

  await expect(page).toHaveURL(/view=details/);
  await expect.poll(() => actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    type: "keypress",
    name: "Open details",
    payload: { key: "Enter", modifiers: [] },
  });
});

test("records Enter modifiers in replay order", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  const email = page.getByLabel("Email");
  await email.focus();
  await email.press("Control+Shift+Enter");

  await expect.poll(() => actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    type: "keypress",
    name: "Email",
    payload: { key: "Enter", modifiers: ["Control", "Shift"] },
  });
});

test("ignores Enter used for multiline text, native pickers, composition, or key repeat", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  await page.evaluate(() => {
    const textarea = document.createElement("textarea");
    const editor = document.createElement("div");
    const genericFocusable = document.createElement("div");
    const repeatButton = document.createElement("button");
    editor.contentEditable = "true";
    genericFocusable.tabIndex = 0;
    repeatButton.type = "button";
    document.body.append(textarea, editor, genericFocusable, repeatButton);

    const enter = (target: Element, init: KeyboardEventInit = {}) => {
      target.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        composed: true,
        key: "Enter",
        ...init,
      }));
    };

    enter(textarea);
    enter(editor);
    enter(genericFocusable);
    enter(document.querySelector("select[name='plan']")!);
    enter(document.querySelector("input[type='date']")!);
    enter(document.querySelector("input[name='email']")!, { isComposing: true });
    enter(repeatButton, { repeat: true });
    repeatButton.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 0 }));
  });

  await page.waitForTimeout(50);
  expect(actions).toHaveLength(0);
});

test("injected recorder captures completed fills, native selects, and semantic control clicks", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.getByLabel("Email").fill("person@example.com");

  await page.waitForTimeout(450);
  expect(actions).toHaveLength(0);

  await page.getByLabel("Password").fill("secret-value");
  await page.getByLabel("Plan").click();
  await page.getByLabel("Plan").selectOption("pro");
  await page.getByLabel("Accept terms").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Open details" }).click();
  await page.getByRole("button", { name: "Input action" }).click();
  await page.getByRole("button", { name: "Role action" }).click();
  await page.getByRole("link", { name: "Fixture help" }).click();
  await page.keyboard.press("Control");
  await page.waitForTimeout(50);

  expect(actions.map((action) => action.type)).toEqual(["fill", "fill", "select-picker.request", "select", "click", "click", "click", "click", "click", "click"]);
  const emailFill = actions.find((action) => action.type === "fill" && (action.payload as { value?: string })?.value === "person@example.com");
  expect((emailFill?.target as { candidates: Array<{ kind: string }> }).candidates[0].kind).toBe("testId");
  const passwordFill = actions.find((action) => action.type === "fill" && (action.payload as { value?: string })?.value === "secret-value");
  expect(passwordFill?.sensitive).toBe(true);
  const planRequest = actions.find((action) => action.type === "select-picker.request" && action.name === "Plan");
  expect((planRequest?.target as { tagName?: string }).tagName).toBe("select");
  expect((planRequest?.target as { candidates: Array<{ kind: string; value: string; name?: string }> }).candidates[0]).toMatchObject({ kind: "role", value: "combobox", name: "Plan" });
  const planSelect = actions.find((action) => action.type === "select");
  expect(planSelect).toMatchObject({ name: "Plan", payload: { value: "pro", label: "Professional" } });
  expect((planSelect?.target as { candidates: Array<{ kind: string; value: string; name?: string }> }).candidates[0]).toMatchObject({ kind: "role", value: "combobox", name: "Plan" });
  expect((actions.find((action) => action.name === "Continue")?.target as { frameUrl?: string }).frameUrl).toBeUndefined();
  expect(actions.some((action) => action.name === "Accept terms")).toBe(true);
  expect(actions.some((action) => action.name === "Continue")).toBe(true);
  expect(actions.at(-1)?.name).toBe("Fixture help");
});

test("opens application pickers for consecutive native selects without recording click actions", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  for (const name of ["Plan", "Construction type", "Roof material"]) {
    await page.getByLabel(name).click();
  }
  await expect.poll(() => actions.filter((action) => action.type === "select-picker.request").length).toBe(3);
  const requests = actions.filter((action) => action.type === "select-picker.request");
  expect(requests.map((action) => action.name)).toEqual(["Plan", "Construction type", "Roof material"]);
  expect(actions.some((action) => action.type === "click" && (action.target as { tagName?: string })?.tagName === "select")).toBe(false);
  expect(requests.at(-1)?.options).toEqual([
    { value: "metal", label: "Metal", disabled: false },
    { value: "composition", label: "Composition", disabled: false },
    { value: "wood", label: "Wood", disabled: true },
  ]);

  actions.length = 0;
  await page.getByLabel("Regions").selectOption(["west", "east"]);
  expect(actions).toHaveLength(0);
});

test("uses website-native dropdowns without picker or click noise", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    (window as Window & { __browserMemorySetNativeSelects?: (enabled: boolean) => void })
      .__browserMemorySetNativeSelects?.(true);
  });

  await page.getByLabel("Plan").click();
  await page.getByLabel("Plan").selectOption("pro");
  await expect.poll(() => actions.filter((action) => action.type === "select").length).toBe(1);

  expect(actions.some((action) => action.type === "select-picker.request")).toBe(false);
  expect(actions.some((action) => action.type === "click" && (action.target as { tagName?: string })?.tagName === "select")).toBe(false);
  expect(actions.find((action) => action.type === "select")).toMatchObject({
    name: "Plan",
    payload: { value: "pro", label: "Professional" },
  });
});

test("collapses an option-like click followed by a matching native select change", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const select = document.createElement("select");
    select.id = "state";
    select.setAttribute("aria-label", "State");
    select.innerHTML = '<option value="">Choose</option><option value="IL">Illinois</option>';

    const option = document.createElement("div");
    option.dataset.testid = "state-option";
    option.setAttribute("role", "option");
    option.tabIndex = 0;
    option.textContent = "Illinois";
    option.addEventListener("click", () => {
      select.value = "IL";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    document.body.append(select, option);
  });

  await page.getByTestId("state-option").click();
  await expect.poll(() => actions.length).toBe(1);

  expect(actions[0]).toMatchObject({
    type: "select",
    name: "State",
    payload: { value: "IL", label: "Illinois" },
  });
});

test("flushes a custom option click when no native select change follows", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const option = document.createElement("div");
    option.setAttribute("role", "menuitemradio");
    option.tabIndex = 0;
    option.textContent = "Custom Illinois";
    document.body.append(option);
  });

  await page.getByRole("menuitemradio", { name: "Custom Illinois" }).click();
  await expect.poll(() => actions.length).toBe(1);

  expect(actions[0]).toMatchObject({ type: "click", name: "Custom Illinois" });
});

test("records frame URLs only for child-frame actions", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  await page.getByRole("button", { name: "Continue" }).click();
  await page.frameLocator('iframe[title="Payment frame"]').getByRole("button", { name: "Pay" }).click();

  expect((actions[0].target as { frameUrl?: string }).frameUrl).toBeUndefined();
  expect((actions[1].target as { frameUrl?: string }).frameUrl).toContain("/fixture/frame");
  expect((actions[0].position as { frameUrl?: string }).frameUrl).toBeUndefined();
  expect((actions[1].position as { frameUrl?: string }).frameUrl).toContain("/fixture/frame");
});

test("captures semantic navigation and delegated content targets without field-focus noise", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  await page.getByLabel("Email").click();
  await page.getByText("Quotes menu", { exact: true }).click();
  await page.getByText("Delegated content action", { exact: true }).click();

  expect(actions.map((action) => action.type)).toEqual(["click", "click"]);
  expect(actions.map((action) => action.name)).toEqual(["Quotes menu", "Delegated content action"]);
  expect((actions[0].target as { candidates: Array<{ kind: string; value: string }> }).candidates[0]).toMatchObject({ kind: "role", value: "menuitem" });
  expect(await page.getByTestId("delegated-clicks").textContent()).toContain("2");
});

test("captures fields and confirmation clicks inside an event-blocking popup component", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    for (const eventName of ["input", "focusout", "click"]) {
      window.addEventListener(eventName, (event) => event.stopPropagation(), true);
    }
    const popup = document.createElement("address-confirmation");
    const shadow = popup.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <section role="dialog" aria-label="Confirm address">
        <label>Street address <input name="street" /></label>
        <button type="button">Confirm</button>
      </section>
    `;
    document.body.append(popup);
  });

  await page.getByLabel("Street address").fill("123 Main Street");
  await page.getByRole("button", { name: "Confirm" }).click();

  expect(actions.map((action) => action.type)).toEqual(["fill", "click"]);
  expect(actions[0]).toMatchObject({
    type: "fill",
    name: "Street address",
    payload: { value: "123 Main Street" },
  });
  expect(actions[1]).toMatchObject({ type: "click", name: "Confirm" });
});

test("emits a navigation-link click before the page unloads", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  await page.getByRole("link", { name: "Open linked page" }).click();
  await page.waitForURL(/view=linked/);

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ type: "click", name: "Open linked page" });
});

test("completed fills preserve an intentionally cleared value", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  const email = page.getByLabel("Email");
  await email.focus();
  await page.getByRole("button", { name: "Input action" }).click();
  expect(actions.map((action) => action.type)).toEqual(["click"]);

  await email.fill("remove-me@example.com");
  await email.clear();
  await page.getByRole("button", { name: "Open details" }).click();

  expect(actions.map((action) => action.type)).toEqual(["click", "fill", "click"]);
  expect((actions[1]?.payload as { value?: string })?.value).toBe("");
});

test("native date clicks request the custom picker without recording a fill", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");

  await page.getByLabel("Appointment date").click();

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    type: "date-picker.request",
    name: "Appointment date",
    value: "2026-07-21",
    min: "2026-07-01",
    max: "2026-08-31",
  });
  expect((actions[0].target as { inputType?: string }).inputType).toBe("date");
  expect(actions[0].position).toEqual({ x: 0, y: 0 });
});

test("falls back to lowercase element names when targets have no accessible name", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.dataset.testid = "unnamed-input";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.testid = "unnamed-button";
    button.style.width = "40px";
    button.style.height = "24px";
    document.body.append(input, button);
  });

  await page.getByTestId("unnamed-input").fill("value");
  await page.getByTestId("unnamed-button").click();

  expect(actions.map((action) => ({ type: action.type, name: action.name }))).toEqual([
    { type: "fill", name: "input" },
    { type: "click", name: "button" },
  ]);
});

test("names field actions from semantic labels before nearby visible text", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const section = document.createElement("section");
    section.innerHTML = `
      <style>
        .naming-case { width: 260px; display: grid; gap: 4px; margin: 24px 0; }
        .naming-case input, .naming-case textarea, .naming-case select { width: 240px; min-height: 28px; }
        .structural-name .input-wrapper { margin-top: 24px; }
      </style>
      <div class="naming-case">
        <div>Account email</div>
        <input data-testid="inferred-input" placeholder="Email placeholder" />
      </div>
      <div class="naming-case structural-name">
        <label>First name <span>*</span></label>
        <div class="input-wrapper">
          <input data-testid="structural-input" formcontrolname="firstName" placeholder="First name placeholder" />
        </div>
        <p class="field-error">First name is required</p>
      </div>
      <div class="naming-case">
        <label for="semantic-input">Visible email *</label>
        <div>Wrong nearby text</div>
        <input id="semantic-input" data-testid="semantic-input" aria-label="ARIA email" />
      </div>
      <div class="naming-case">
        <span id="account-reference">Referenced account</span>
        <div>Wrong nearby text</div>
        <input data-testid="labelledby-input" aria-labelledby="account-reference" aria-label="ARIA fallback" />
      </div>
      <div class="naming-case structural-name">
        <label>Wrong structural label</label>
        <div class="input-wrapper"><input data-testid="aria-input" aria-label="ARIA field" /></div>
      </div>
      <div class="naming-case">
        <div>Notes</div>
        <textarea data-testid="inferred-textarea"></textarea>
      </div>
      <div class="naming-case">
        <div>Preferred plan</div>
        <select data-testid="inferred-select"><option value="free">Free</option><option value="pro">Pro</option></select>
      </div>
      <div class="naming-case">
        <div>Start date</div>
        <input data-testid="inferred-date" type="date" value="2026-07-22" />
      </div>
      <div class="naming-case">
        <div>Subscribe</div>
        <input data-testid="inferred-checkbox" type="checkbox" />
      </div>
      <button type="button" data-testid="finish-fields">Finish fields</button>
    `;
    document.body.append(section);
  });

  await page.getByTestId("inferred-input").fill("person@example.com");
  await page.getByTestId("structural-input").fill("Jamie");
  await page.getByTestId("semantic-input").fill("billing@example.com");
  await page.getByTestId("labelledby-input").fill("account@example.com");
  await page.getByTestId("aria-input").fill("search");
  await page.getByTestId("inferred-textarea").fill("Remember this");
  await page.getByTestId("inferred-select").selectOption("pro");
  await page.getByTestId("inferred-date").click();
  await page.getByTestId("inferred-checkbox").click();
  await page.getByTestId("finish-fields").click();

  const actionFor = (testId: string) => actions.find((action) => {
    const candidates = (action.target as { candidates?: Array<{ kind: string; value: string; name?: string }> } | undefined)?.candidates ?? [];
    return candidates.some((candidate) => candidate.kind === "testId" && candidate.value === testId);
  });
  await expect.poll(() => Boolean(actionFor("inferred-checkbox"))).toBe(true);

  expect(actionFor("inferred-input")?.name).toBe("Account email");
  expect(actionFor("structural-input")?.name).toBe("First name");
  expect(actionFor("semantic-input")?.name).toBe("Visible email");
  expect(actionFor("labelledby-input")?.name).toBe("Referenced account");
  expect(actionFor("aria-input")?.name).toBe("ARIA field");
  expect(actionFor("inferred-textarea")?.name).toBe("Notes");
  expect(actionFor("inferred-select")).toMatchObject({ type: "select", name: "Preferred plan" });
  expect(actionFor("inferred-date")).toMatchObject({ type: "date-picker.request", name: "Start date" });
  expect(actionFor("inferred-checkbox")).toMatchObject({ type: "click", name: "Subscribe" });

  const inferredCandidates = (actionFor("inferred-input")?.target as { candidates: Array<{ kind: string; value: string; name?: string }> }).candidates;
  expect(inferredCandidates).not.toContainEqual(expect.objectContaining({ kind: "label", value: "Account email" }));
  expect(inferredCandidates).toContainEqual(expect.objectContaining({ kind: "role", name: "Email placeholder" }));

  const structuralCandidates = (actionFor("structural-input")?.target as { candidates: Array<{ kind: string; value: string; name?: string }> }).candidates;
  expect(structuralCandidates).not.toContainEqual(expect.objectContaining({ kind: "label", value: "First name" }));
  expect(structuralCandidates).toContainEqual(expect.objectContaining({ kind: "role", name: "First name placeholder" }));
  expect((actionFor("semantic-input")?.target as { candidates: Array<{ kind: string; value: string }> }).candidates)
    .toContainEqual(expect.objectContaining({ kind: "label", value: "Visible email *" }));
});

test("falls back through field hints and humanized identity attributes", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const section = document.createElement("section");
    section.innerHTML = `
      <input data-testid="hint-name" placeholder="Placeholder wins" autocomplete="given-name" name="ignoredName" />
      <input data-testid="title-name" title="Title wins" name="ignoredTitleName" />
      <input data-testid="autocomplete-name" autocomplete="section-blue shipping given-name" name="ignoredName" />
      <input data-testid="standard-name" name="policyHolderEmail" />
      <input data-testid="id-name" id="mailing_address" />
      <input data-testid="angular-name" formcontrolname="effective-date" />
      <input data-testid="opaque-id" id="mat-input-17" />
      <button type="button" data-testid="finish-identities">Finish identity fields</button>
    `;
    document.body.append(section);
  });

  for (const testId of ["hint-name", "title-name", "autocomplete-name", "standard-name", "id-name", "angular-name", "opaque-id"]) {
    await page.getByTestId(testId).fill("value");
  }
  await page.getByTestId("finish-identities").click();

  const nameFor = (testId: string) => actions.find((action) => {
    const candidates = (action.target as { candidates?: Array<{ kind: string; value: string }> } | undefined)?.candidates ?? [];
    return candidates.some((candidate) => candidate.kind === "testId" && candidate.value === testId);
  })?.name;
  await expect.poll(() => nameFor("opaque-id")).toBe("input");

  expect(nameFor("hint-name")).toBe("Placeholder wins");
  expect(nameFor("title-name")).toBe("Title wins");
  expect(nameFor("autocomplete-name")).toBe("Given name");
  expect(nameFor("standard-name")).toBe("Policy holder email");
  expect(nameFor("id-name")).toBe("Mailing address");
  expect(nameFor("angular-name")).toBe("Effective date");
  expect(nameFor("opaque-id")).toBe("input");

  const standardNameCandidates = (actions.find((action) => action.name === "Policy holder email")?.target as {
    candidates: Array<{ kind: string; value: string; name?: string }>;
  }).candidates;
  expect(standardNameCandidates).not.toContainEqual(expect.objectContaining({ value: "Policy holder email" }));
});

test("rejects unsafe visual label candidates and preserves field fallbacks", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    const section = document.createElement("section");
    section.innerHTML = `
      <style>
        .rejection-case { width: 280px; display: grid; gap: 4px; margin: 24px 0; }
        .rejection-case input { width: 240px; min-height: 28px; }
        .distant-label { margin-bottom: 20px; }
        .structural-rejection-label { margin-bottom: 24px; }
        .side-label { display: grid; grid-template-columns: 100px 160px; align-items: center; }
        .side-label input { width: 150px; }
      </style>
      <div class="rejection-case">
        <div class="distant-label">Distant text</div>
        <input data-testid="distant-input" placeholder="Distant placeholder" />
      </div>
      <div class="rejection-case side-label">
        <div>Side text</div>
        <input data-testid="side-input" placeholder="Side placeholder" />
      </div>
      <div class="rejection-case">
        <div aria-hidden="true">Hidden text</div>
        <input data-testid="hidden-input" placeholder="Hidden placeholder" />
      </div>
      <div class="rejection-case">
        <button type="button">Interactive text</button>
        <input data-testid="interactive-input" placeholder="Interactive placeholder" />
      </div>
      <div class="rejection-case">
        <small class="field-help">Helper text</small>
        <input data-testid="helper-input" placeholder="Helper placeholder" />
      </div>
      <div class="rejection-case">
        <label class="structural-rejection-label">Ambiguous label</label>
        <div><input data-testid="ambiguous-input" placeholder="Ambiguous placeholder" /><input aria-label="Second field" /></div>
      </div>
      <input id="other-control" aria-label="Other control" />
      <div class="rejection-case">
        <label class="structural-rejection-label" for="other-control">Other control label</label>
        <div><input data-testid="other-associated-input" placeholder="Association placeholder" /></div>
      </div>
      <div class="rejection-case">
        <label class="structural-rejection-label" hidden>Hidden label</label>
        <div><input data-testid="hidden-label-input" placeholder="Hidden label placeholder" /></div>
      </div>
      <div class="rejection-case">
        <div><input data-testid="following-label-input" placeholder="Following placeholder" /></div>
        <label>Following label</label>
      </div>
      <div class="rejection-case">
        <label class="structural-rejection-label">Interactive <a href="#">link</a></label>
        <div><input data-testid="interactive-label-input" placeholder="Interactive label placeholder" /></div>
      </div>
      <div class="rejection-case">
        <label class="structural-rejection-label field-error">Validation label</label>
        <div><input data-testid="error-label-input" placeholder="Error label placeholder" /></div>
      </div>
      <button type="button" data-testid="finish-rejections">Finish rejection fields</button>
    `;
    document.body.append(section);
  });

  for (const testId of [
    "distant-input", "side-input", "hidden-input", "interactive-input", "helper-input", "ambiguous-input",
    "other-associated-input", "hidden-label-input", "following-label-input", "interactive-label-input", "error-label-input",
  ]) {
    await page.getByTestId(testId).fill("value");
  }
  await page.getByTestId("finish-rejections").click();

  const nameFor = (testId: string) => actions.find((action) => {
    const candidates = (action.target as { candidates?: Array<{ kind: string; value: string }> } | undefined)?.candidates ?? [];
    return candidates.some((candidate) => candidate.kind === "testId" && candidate.value === testId);
  })?.name;
  await expect.poll(() => nameFor("helper-input")).toBe("Helper placeholder");

  expect(nameFor("distant-input")).toBe("Distant placeholder");
  expect(nameFor("side-input")).toBe("Side placeholder");
  expect(nameFor("hidden-input")).toBe("Hidden placeholder");
  expect(nameFor("interactive-input")).toBe("Interactive placeholder");
  expect(nameFor("helper-input")).toBe("Helper placeholder");
  expect(nameFor("ambiguous-input")).toBe("Ambiguous placeholder");
  expect(nameFor("other-associated-input")).toBe("Association placeholder");
  expect(nameFor("hidden-label-input")).toBe("Hidden label placeholder");
  expect(nameFor("following-label-input")).toBe("Following placeholder");
  expect(nameFor("interactive-label-input")).toBe("Interactive label placeholder");
  expect(nameFor("error-label-input")).toBe("Error label placeholder");
});

test("captures the absolute viewport position only when an action is emitted", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__browserMemoryEmit", (action: Record<string, unknown>) => { actions.push(action); });
  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.goto("/fixture");
  await page.evaluate(() => {
    document.body.style.minHeight = "3000px";
    window.scrollTo(0, 480);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(480);
  expect(actions).toHaveLength(0);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Continue"));
    button?.click();
  });

  await expect.poll(() => actions.length).toBe(1);
  expect(actions[0].position).toEqual({ x: 0, y: 480 });
});

test("replay corrects residual offsets, tolerates clamping, and remains idempotent", async ({ page }) => {
  await page.goto("/fixture");
  await page.evaluate(() => {
    document.body.style.minHeight = "3000px";
    document.documentElement.style.scrollBehavior = "smooth";
    window.scrollTo(0, 0);
    const scopedWindow = window as Window & { positionScrollAttempts?: number };
    const nativeScrollTo = window.scrollTo.bind(window);
    window.scrollTo = ((options: ScrollToOptions) => {
      scopedWindow.positionScrollAttempts = (scopedWindow.positionScrollAttempts ?? 0) + 1;
      const requestedTop = options.top ?? window.scrollY;
      nativeScrollTo({
        ...options,
        top: scopedWindow.positionScrollAttempts < 3 ? requestedTop - 10 : requestedTop,
        behavior: "instant",
      });
    }) as typeof window.scrollTo;
  });
  const step = {
    id: "position",
    order: 0,
    name: "Position",
    enabled: true,
    type: "click",
    page: { id: "page", url: page.url() },
    target: { candidates: [{ kind: "testId", value: "continue", exact: true }] },
    position: { x: 0, y: 480 },
    metadata: { recordedAt: new Date().toISOString(), origin: "recorded", sensitive: false },
  } satisfies WorkflowStep;

  await applyPositionBefore(page, step);
  expect(await page.evaluate(() => window.scrollY)).toBe(480);
  expect(await page.evaluate(() => (window as Window & { positionScrollAttempts?: number }).positionScrollAttempts)).toBe(3);

  await applyPositionBefore(page, step);
  expect(await page.evaluate(() => window.scrollY)).toBe(480);
  expect(await page.evaluate(() => (window as Window & { positionScrollAttempts?: number }).positionScrollAttempts)).toBe(4);

  await expect(applyPositionBefore(page, { ...step, position: { x: 0, y: 100_000 } })).resolves.toBeUndefined();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(100_000);
});
