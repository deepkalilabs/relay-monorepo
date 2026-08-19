import { Browserbase } from "@browserbasehq/sdk";
import { expect, test } from "@playwright/test";
import { chromium } from "playwright-core";

test("real Browserbase session can connect, interact, and release", async () => {
  test.skip(process.env.BROWSERBASE_E2E !== "1", "Set BROWSERBASE_E2E=1 to run the paid smoke test.");
  const apiKey = process.env.BROWSERBASE_API_KEY;
  test.skip(!apiKey, "BROWSERBASE_API_KEY is required.");
  const client = new Browserbase({ apiKey: apiKey! });
  const session = await client.sessions.create({ keepAlive: true, timeout: 120 });
  try {
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const page = browser.contexts()[0].pages()[0];
    await page.goto("https://example.com");
    await expect(page.locator("h1")).toHaveText("Example Domain");
    const debug = await client.sessions.debug(session.id);
    expect(debug.debuggerUrl).toContain("http");
    expect(debug.debuggerFullscreenUrl).toContain("http");
    const embeddedUrl = new URL(debug.debuggerFullscreenUrl);
    embeddedUrl.searchParams.set("navbar", "false");
    expect(embeddedUrl.searchParams.get("navbar")).toBe("false");
    await browser.close();
  } finally {
    await client.sessions.update(session.id, { status: "REQUEST_RELEASE" });
  }
});
