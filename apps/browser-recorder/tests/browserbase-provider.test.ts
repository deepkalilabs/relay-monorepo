import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserbaseProvider } from "@/server/infrastructure/browser/browserbase";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  debug: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@browserbasehq/sdk", () => ({
  Browserbase: class {
    sessions = sdk;
  },
}));

describe("BrowserbaseProvider", () => {
  beforeEach(() => {
    sdk.create.mockReset();
    sdk.debug.mockReset();
    sdk.update.mockReset();
  });

  it("enables residential proxies and automatic CAPTCHA solving for Browserbase sessions", async () => {
    sdk.create.mockResolvedValue({ id: "session", connectUrl: "ws://example.com" });
    const provider = new BrowserbaseProvider("api-key", "project");

    await provider.createSession({ timeoutSeconds: 120, region: "us-west-2" });

    expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({
      proxies: true,
      browserSettings: expect.objectContaining({
        recordSession: false,
        logSession: false,
        solveCaptchas: true,
      }),
    }));
  });
});
