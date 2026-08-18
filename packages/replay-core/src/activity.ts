import type { Page, Request } from "playwright-core";

export interface ReplayActivityTracker {
  readonly networkTracked: boolean;
  markActivity(): void;
  networkIsQuiet(quietMs: number): boolean;
  dispose(): void;
}

class PageActivityTracker implements ReplayActivityTracker {
  private readonly activeRequests = new Set<Request>();
  private lastNetworkActivity = 0;
  readonly networkTracked: boolean;

  private readonly onRequest = (request: Request): void => {
    if (["eventsource", "websocket"].includes(request.resourceType())) return;
    this.activeRequests.add(request);
    this.lastNetworkActivity = Date.now();
  };

  private readonly onRequestDone = (request: Request): void => {
    if (!this.activeRequests.delete(request)) return;
    this.lastNetworkActivity = Date.now();
  };

  constructor(private readonly page: Page) {
    const events = page as unknown as {
      on?: (event: string, listener: (request: Request) => void) => void;
      off?: (event: string, listener: (request: Request) => void) => void;
    };
    this.networkTracked = typeof events.on === "function" && typeof events.off === "function";
    if (!this.networkTracked) return;
    events.on!("request", this.onRequest);
    events.on!("requestfinished", this.onRequestDone);
    events.on!("requestfailed", this.onRequestDone);
  }

  markActivity(): void {
    this.lastNetworkActivity = Date.now();
  }

  networkIsQuiet(quietMs: number): boolean {
    return !this.networkTracked || (
      this.activeRequests.size === 0 && Date.now() - this.lastNetworkActivity >= quietMs
    );
  }

  dispose(): void {
    if (!this.networkTracked) return;
    this.page.off("request", this.onRequest);
    this.page.off("requestfinished", this.onRequestDone);
    this.page.off("requestfailed", this.onRequestDone);
    this.activeRequests.clear();
  }
}

export function createReplayActivityTracker(page: Page): ReplayActivityTracker {
  return new PageActivityTracker(page);
}
