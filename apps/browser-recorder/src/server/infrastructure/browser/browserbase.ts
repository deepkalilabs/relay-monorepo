import { Browserbase } from "@browserbasehq/sdk";
import { chromium } from "playwright-core";
import type {
  BrowserProvider,
  BrowserSessionOptions,
  ConnectedBrowser,
  CreatedBrowserSession,
  LiveViewPage,
} from "./types";

export function hideLiveViewNavbar(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("navbar", "false");
  return url.toString();
}

interface BrowserbaseLiveViewLinks {
  debuggerFullscreenUrl: string;
  pages: Array<{ id: string; title: string; url: string; debuggerFullscreenUrl: string }>;
}

export function selectLiveViewPage(debug: BrowserbaseLiveViewLinks, pageIndex: number): LiveViewPage {
  const page = debug.pages[pageIndex];
  if (!page) {
    return {
      id: `page-${pageIndex}`,
      title: "Browser",
      url: "about:blank",
      liveViewUrl: hideLiveViewNavbar(debug.debuggerFullscreenUrl),
    };
  }
  return {
    id: page.id,
    title: page.title || "Browser",
    url: page.url,
    liveViewUrl: hideLiveViewNavbar(page.debuggerFullscreenUrl),
  };
}

export class BrowserbaseProvider implements BrowserProvider {
  private readonly client: Browserbase;
  private readonly connectUrls = new Map<string, string>();

  constructor(apiKey: string, private readonly projectId?: string) {
    this.client = new Browserbase({ apiKey });
  }

  async createSession(options: BrowserSessionOptions): Promise<CreatedBrowserSession> {
    const session = await this.client.sessions.create({
      keepAlive: true,
      projectId: this.projectId || undefined,
      proxies: true,
      region: options.region,
      timeout: options.timeoutSeconds,
      browserSettings: {
        viewport: { width: 1440, height: 900 },
        recordSession: false,
        logSession: false,
        solveCaptchas: true,
      },
      userMetadata: { product: "browser-memory-recorder", purpose: "interactive-recording" },
    });
    this.connectUrls.set(session.id, session.connectUrl);
    return { id: session.id, connectUrl: session.connectUrl };
  }

  async connect(sessionId: string): Promise<ConnectedBrowser> {
    const connectUrl = this.connectUrls.get(sessionId);
    if (!connectUrl) throw new Error("The Browserbase connection URL is no longer available.");
    const browser = await chromium.connectOverCDP(connectUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Browserbase did not return a browser context.");
    return { browser, context };
  }

  async getLiveView(sessionId: string, pageIndex = 0): Promise<LiveViewPage> {
    const debug = await this.client.sessions.debug(sessionId);
    return selectLiveViewPage(debug, pageIndex);
  }

  async releaseSession(sessionId: string): Promise<void> {
    this.connectUrls.delete(sessionId);
    try {
      await this.client.sessions.update(sessionId, { status: "REQUEST_RELEASE" });
    } catch {
      // Session cleanup is best effort; it may already have timed out or disconnected.
    }
  }
}
