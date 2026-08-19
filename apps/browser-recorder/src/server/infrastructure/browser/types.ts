import type { Browser, BrowserContext } from "playwright-core";

export interface BrowserSessionOptions {
  timeoutSeconds: number;
  region: "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1";
}

export interface CreatedBrowserSession {
  id: string;
  connectUrl: string;
}

export interface ConnectedBrowser {
  browser: Browser;
  context: BrowserContext;
}

export interface LiveViewPage {
  id: string;
  title: string;
  url: string;
  liveViewUrl: string;
}

export interface BrowserProvider {
  createSession(options: BrowserSessionOptions): Promise<CreatedBrowserSession>;
  connect(sessionId: string): Promise<ConnectedBrowser>;
  getLiveView(sessionId: string, pageIndex?: number): Promise<LiveViewPage>;
  releaseSession(sessionId: string): Promise<void>;
}
