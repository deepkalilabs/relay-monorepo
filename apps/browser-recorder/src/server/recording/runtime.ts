import type { Browser, BrowserContext, Frame, Page } from "playwright-core";
import type { WebSocket } from "ws";
import { z } from "zod";
import { RecordedActionSchema, type RecordedAction } from "@/shared/contracts/recording/recorded-action";
import type { ServerMessage, SequencedServerMessage } from "@/shared/contracts/protocol";
import type { BrowserProvider } from "@/server/infrastructure/browser/types";
import { RECORDER_BINDING, RECORDER_SCRIPT } from "./injected";
import { ActionDeduplicator } from "./deduplicate";
import {
  locatorCandidatesForTarget,
  MAX_ASSERTION_TEXT_LENGTH,
  type ElementTarget,
  type ViewportPosition,
  type Workflow,
} from "@/shared/contracts/workflow/domain";
import {
  ElementTargetSchema,
  orderLocatorCandidates,
  RepeatedGroupTemplateSchema,
  ViewportPositionSchema,
} from "@/shared/contracts/workflow/schema";
import { preflightReplay, ReplayEngine } from "@/server/replay/engine";

interface PageState {
  id: string;
  page: Page;
  index: number;
  captchaStartedAt: number | null;
  captchaLockActive: boolean;
  captchaLockGeneration: number;
  captchaLockTimer: NodeJS.Timeout | null;
}

const CAPTCHA_LOCK_TIMEOUT_MS = 45_000;
const CAPTCHA_SOLVING_STARTED_MESSAGES = new Set([
  "browserbase-solving-started",
  "browser-solving-started",
]);
const CAPTCHA_SOLVING_FINISHED_MESSAGES = new Set([
  "browserbase-solving-finished",
  "browser-solving-completed",
]);
const CAPTCHA_SOLVING_MESSAGE_PATTERN = /^browser(?:base)?-solving-/;
type CaptchaLogAction =
  | "observed_start"
  | "observed_finish"
  | "incomplete_observation"
  | "unrecognized_event"
  | "lock_timed_out"
  | "lock_continued"
  | "lock_cancelled";

const DatePickerBrowserEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("date-picker.request"),
    selector: z.string().min(1),
    name: z.string().min(1),
  target: ElementTargetSchema,
    value: z.string(),
    min: z.string(),
    max: z.string(),
    position: ViewportPositionSchema,
    rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  }),
  z.object({ type: z.literal("date-picker.dismiss") }),
]);

const SelectPickerBrowserEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("select-picker.request"),
    selector: z.string().min(1),
    name: z.string().min(1),
  target: ElementTargetSchema,
    value: z.string(),
    options: z.array(z.object({
      value: z.string(),
      label: z.string(),
      disabled: z.boolean(),
    })),
    sensitive: z.boolean(),
    position: ViewportPositionSchema,
    rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  }),
  z.object({ type: z.literal("select-picker.dismiss") }),
]);

const AssertionPickerBrowserEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assertion-picker.selected"),
    requestId: z.string().uuid(),
    name: z.string().min(1),
    text: z.string().max(MAX_ASSERTION_TEXT_LENGTH),
    target: ElementTargetSchema,
    position: ViewportPositionSchema,
  }),
  z.object({
    type: z.literal("assertion-picker.group-selected"),
    requestId: z.string().uuid(),
    name: z.string().min(1),
    groupTarget: RepeatedGroupTemplateSchema,
    position: ViewportPositionSchema,
  }),
  z.object({ type: z.literal("assertion-picker.cancelled"), requestId: z.string().uuid() }),
]);

interface PendingDatePicker {
  requestId: string;
  pageState: PageState;
  frame: Frame;
  selector: string;
  name: string;
  target: ElementTarget;
  position: ViewportPosition;
  min: string;
  max: string;
}

interface PendingSelectPicker {
  requestId: string;
  pageState: PageState;
  frame: Frame;
  selector: string;
  name: string;
  target: ElementTarget;
  position: ViewportPosition;
  sensitive: boolean;
}

const AUTOMATICALLY_RECORDABLE_ACTION_TYPES: ReadonlySet<RecordedAction["type"]> = new Set([
  "click",
  "fill",
  "keypress",
  "select",
  "set_date",
]);

export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter a web address to navigate.");
  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  const hasUnsupportedScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) && !hasHttpScheme && !/^[^/:]+:\d+(?:[/?#]|$)/.test(trimmed);
  if (hasUnsupportedScheme) throw new Error("Use an HTTP or HTTPS web address.");
  const candidate = hasHttpScheme ? trimmed : `https://${trimmed}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an HTTP or HTTPS web address.");
  }
  return url.toString();
}

export function isAutomaticallyRecordableAction(action: RecordedAction): boolean {
  return AUTOMATICALLY_RECORDABLE_ACTION_TYPES.has(action.type);
}

export function isRecordableNavigationUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidDateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export class RecordingRuntime {
  socket: WebSocket | null = null;
  graceTimer: NodeJS.Timeout | null = null;
  readonly buffer: SequencedServerMessage[] = [];
  sequence: number;
  sessionId: string | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages = new Map<Page, PageState>();
  private activePageId: string | null = null;
  private readonly deduplicator = new ActionDeduplicator();
  private pendingDatePicker: PendingDatePicker | null = null;
  private pendingSelectPicker: PendingSelectPicker | null = null;
  private pendingAssertionPick: { requestId: string; pageState: PageState } | null = null;
  private nativeSelects = false;
  private mode: "recording" | "replay" | null = null;
  private recordingReady = false;
  private startUrlSource: "observed" | "requested" | null = null;
  private hasRecordedAction = false;
  private replayEngine: ReplayEngine | null = null;
  private replayMeta: { runId: string; totalSteps: number } | null = null;
  private replayTask: Promise<void> | null = null;
  private replayStopRequested = false;
  private released = false;

  constructor(
    readonly clientId: string,
    private readonly provider: BrowserProvider,
    private readonly onReleased: () => void,
    startingSequence = 0,
  ) {
    this.sequence = startingSequence;
  }

  attach(socket: WebSocket, lastSequence: number): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.socket = socket;
    const earliest = this.buffer[0]?.sequence ?? this.sequence;
    if (lastSequence < earliest - 1) this.sendDirect({ type: "buffer.gap", earliestSequence: earliest });
    for (const item of this.buffer) {
      if (item.sequence > lastSequence) socket.send(JSON.stringify(item));
    }
  }

  detach(): void {
    this.socket = null;
    if (this.graceTimer || this.released) return;
    this.graceTimer = setTimeout(() => void this.release(), 15_000);
  }

  emit(message: ServerMessage): void {
    const envelope: SequencedServerMessage = { sequence: ++this.sequence, message };
    this.buffer.push(envelope);
    if (this.buffer.length > 1_000) this.buffer.shift();
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(envelope));
  }

  private sendDirect(message: ServerMessage): void {
    this.emit(message);
  }

  private async installRecorder(context: BrowserContext): Promise<void> {
    await context.exposeBinding(RECORDER_BINDING, async ({ page, frame }, raw: unknown) => {
      const state = this.pages.get(page);
      if (!state || state.id !== this.activePageId) return;
      if (this.isCaptchaLocked(state)) return;
      const dateEvent = DatePickerBrowserEventSchema.safeParse(raw);
      if (dateEvent.success) {
        await this.handleDatePickerBrowserEvent(state, frame, dateEvent.data);
        return;
      }
      const selectEvent = SelectPickerBrowserEventSchema.safeParse(raw);
      if (selectEvent.success) {
        await this.handleSelectPickerBrowserEvent(state, frame, selectEvent.data);
        return;
      }
      const assertionEvent = AssertionPickerBrowserEventSchema.safeParse(raw);
      if (assertionEvent.success) {
        await this.handleAssertionPickerBrowserEvent(state, assertionEvent.data);
        return;
      }
      const parsed = RecordedActionSchema.omit({ page: true, recordedAt: true }).safeParse(raw);
      if (!parsed.success) return;
      await this.forwardAction({
        ...parsed.data,
        page: { id: state.id, url: page.url(), title: await page.title().catch(() => undefined) },
        recordedAt: new Date().toISOString(),
      });
    });
    await context.addInitScript({ content: RECORDER_SCRIPT });
  }

  private async applyNativeSelectsToFrame(frame: Frame): Promise<void> {
    if (typeof frame.evaluate !== "function") return;
    const enabled = this.nativeSelects;
    await frame.evaluate((enabled) => {
      const recorderWindow = window as Window & {
        __browserMemoryNativeSelects?: boolean;
        __browserMemorySetNativeSelects?: (value: boolean) => void;
      };
      if (typeof recorderWindow.__browserMemorySetNativeSelects === "function") {
        recorderWindow.__browserMemorySetNativeSelects(enabled);
      } else {
        recorderWindow.__browserMemoryNativeSelects = enabled;
      }
    }, enabled).catch(() => undefined);
    if (enabled !== this.nativeSelects) await this.applyNativeSelectsToFrame(frame);
  }

  private async applyCaptchaLockToFrame(frame: Frame, locked: boolean): Promise<void> {
    if (typeof frame.evaluate !== "function") return;
    await frame.evaluate((locked) => {
      const recorderWindow = window as Window & {
        __browserMemoryCaptchaLocked?: boolean;
        __browserMemorySetCaptchaLocked?: (value: boolean) => void;
      };
      if (typeof recorderWindow.__browserMemorySetCaptchaLocked === "function") {
        recorderWindow.__browserMemorySetCaptchaLocked(locked);
      } else {
        recorderWindow.__browserMemoryCaptchaLocked = locked;
      }
    }, locked).catch(() => undefined);
  }

  private applyCaptchaLockToPage(state: PageState, locked: boolean): void {
    void Promise.all(this.pageFrames(state.page).map((frame) => this.applyCaptchaLockToFrame(frame, locked)));
  }

  private async applyAssertionPickerToFrame(frame: Frame, requestId: string | null): Promise<void> {
    if (typeof frame.evaluate !== "function") return;
    await frame.evaluate((nextRequestId) => {
      const recorderWindow = window as Window & {
        __browserMemorySetAssertionPicker?: (requestId: string | null) => void;
      };
      recorderWindow.__browserMemorySetAssertionPicker?.(nextRequestId);
    }, requestId).catch(() => undefined);
  }

  private applyAssertionPickerToPage(state: PageState, requestId: string | null): void {
    void Promise.all(this.pageFrames(state.page).map((frame) => this.applyAssertionPickerToFrame(frame, requestId)));
  }

  private pageFrames(page: Page): Frame[] {
    const frames = typeof page.frames === "function" ? page.frames() : [];
    return frames.length ? frames : [page.mainFrame()];
  }

  async setNativeSelects(enabled: boolean): Promise<void> {
    if (this.activePageCaptchaLocked()) return;
    this.nativeSelects = enabled;
    if (enabled && this.pendingSelectPicker) {
      this.dismissSelectPickersForPage(this.pendingSelectPicker.pageState);
    }
    await Promise.all(
      [...this.pages.keys()].flatMap((page) => this.pageFrames(page)).map((frame) => this.applyNativeSelectsToFrame(frame)),
    );
  }

  async start(options: { timeoutSeconds: number; region: "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1" }): Promise<void> {
    if (this.sessionId) return;
    this.emit({ type: "session.status", status: "starting" });
    this.mode = "recording";
    this.recordingReady = false;
    this.startUrlSource = null;
    this.hasRecordedAction = false;
    try {
      const created = await this.provider.createSession(options);
      this.sessionId = created.id;
      const connected = await this.provider.connect(created.id);
      this.browser = connected.browser;
      this.context = connected.context;
      await this.installRecorder(this.context);

      for (const [index, page] of this.context.pages().entries()) await this.registerPage(page, index, index === 0, true);
      this.context.on("page", (page) => void this.registerPage(page, this.pages.size, false, true));

      const liveView = await this.provider.getLiveView(created.id, 0);
      const first = [...this.pages.values()][0];
      if (!first) throw new Error("Browserbase opened without a page.");
      this.activePageId = first.id;
      this.emit({ type: "session.started", sessionId: created.id, liveViewUrl: liveView.liveViewUrl, pageId: first.id });
      this.recordingReady = true;
      for (const state of this.pages.values()) {
        if (state.captchaStartedAt !== null) this.startCaptchaLock(state);
      }
      this.forwardStartUrl(first);
      await this.emitPageState(first);
      this.emit({ type: "session.status", status: "recording" });
    } catch (error) {
      const failedSessionId = this.sessionId;
      this.clearCaptchaLocks("session_released");
      this.logIncompleteCaptchaObservations("session_released");
      this.sessionId = null;
      await this.browser?.close().catch(() => undefined);
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this.activePageId = null;
      this.mode = null;
      this.recordingReady = false;
      this.startUrlSource = null;
      this.hasRecordedAction = false;
      if (failedSessionId) await this.provider.releaseSession(failedSessionId);
      throw error;
    }
  }

  private async registerPage(page: Page, index: number, active: boolean, installRecorder: boolean): Promise<void> {
    const state: PageState = {
      id: crypto.randomUUID(),
      page,
      index,
      captchaStartedAt: null,
      captchaLockActive: false,
      captchaLockGeneration: 0,
      captchaLockTimer: null,
    };
    this.pages.set(page, state);
    if (active || !this.activePageId) this.activePageId = state.id;

    page.on("console", (message) => this.handleCaptchaConsoleMessage(state, message.text()));
    page.on("framenavigated", (frame) => {
      void this.applyNativeSelectsToFrame(frame);
      void this.applyCaptchaLockToFrame(frame, this.isCaptchaLocked(state));
      if (frame !== page.mainFrame() || state.id !== this.activePageId) return;
      this.cancelAssertionPickForPage(state);
      void this.emitPageState(state);
      this.dismissDatePickersForPage(state);
      this.dismissSelectPickersForPage(state);
      this.forwardStartUrl(state);
    });
    page.on("domcontentloaded", () => {
      if (state.id !== this.activePageId) return;
      void this.emitPageState(state);
    });
    page.on("close", () => {
      this.dismissDatePickersForPage(state);
      this.dismissSelectPickersForPage(state);
      this.cancelAssertionPickForPage(state);
      this.clearCaptchaLock(state, "cancelled", "page_closed");
      this.logIncompleteCaptchaObservation(state, "page_closed");
      this.pages.delete(page);
      if (this.activePageId === state.id) this.activePageId = [...this.pages.values()][0]?.id ?? null;
    });

    if (installRecorder) await page.evaluate(RECORDER_SCRIPT).catch(() => undefined);
    await Promise.all(this.pageFrames(page).map((frame) => this.applyNativeSelectsToFrame(frame)));
    if (!active && this.sessionId) {
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      this.emit({
        type: "popup.detected",
        pageId: state.id,
        title: await page.title().catch(() => "New tab"),
        url: page.url(),
      });
    }
  }

  private logCaptcha(
    state: PageState,
    action: CaptchaLogAction,
    details: {
      rawMessage?: string;
      elapsedMs?: number;
      reason?: "page_closed" | "session_released";
      restarted?: boolean;
      startObserved?: boolean;
    } = {},
  ): void {
    console.info(`[captcha] ${JSON.stringify({
      sessionId: this.sessionId,
      pageId: state.id,
      mode: this.mode,
      action,
      ...details,
    })}`);
  }

  private logIncompleteCaptchaObservation(state: PageState, reason: "page_closed" | "session_released"): void {
    if (state.captchaStartedAt === null) return;
    this.logCaptcha(state, "incomplete_observation", {
      elapsedMs: Math.max(0, Date.now() - state.captchaStartedAt),
      reason,
    });
    state.captchaStartedAt = null;
  }

  private logIncompleteCaptchaObservations(reason: "session_released"): void {
    for (const state of this.pages.values()) this.logIncompleteCaptchaObservation(state, reason);
  }

  private isCaptchaLocked(state: PageState): boolean {
    return this.mode === "recording" && this.recordingReady && state.captchaLockActive;
  }

  private activePageCaptchaLocked(): boolean {
    const state = [...this.pages.values()].find((candidate) => candidate.id === this.activePageId);
    return Boolean(state && this.isCaptchaLocked(state));
  }

  private startCaptchaLock(state: PageState): void {
    if (this.mode !== "recording" || !this.recordingReady) return;
    if (state.captchaLockTimer) clearTimeout(state.captchaLockTimer);
    state.captchaLockActive = true;
    const generation = ++state.captchaLockGeneration;
    this.dismissDatePickersForPage(state);
    this.dismissSelectPickersForPage(state);
    this.cancelAssertionPickForPage(state);
    this.applyCaptchaLockToPage(state, true);
    state.captchaLockTimer = setTimeout(() => {
      if (!state.captchaLockActive || state.captchaLockGeneration !== generation) return;
      this.clearCaptchaLock(state, "timed_out");
      this.logCaptcha(state, "lock_timed_out", {
        elapsedMs: state.captchaStartedAt === null ? undefined : Math.max(0, Date.now() - state.captchaStartedAt),
      });
    }, CAPTCHA_LOCK_TIMEOUT_MS);
    this.emit({ type: "captcha.status", pageId: state.id, status: "solving" });
  }

  private clearCaptchaLock(
    state: PageState,
    status: "solved" | "timed_out" | "continued" | "cancelled",
    reason?: "page_closed" | "session_released",
  ): boolean {
    if (!state.captchaLockActive) return false;
    if (state.captchaLockTimer) clearTimeout(state.captchaLockTimer);
    state.captchaLockTimer = null;
    state.captchaLockActive = false;
    state.captchaLockGeneration += 1;
    this.applyCaptchaLockToPage(state, false);
    this.emit({ type: "captcha.status", pageId: state.id, status });
    if (status === "continued") {
      this.logCaptcha(state, "lock_continued", {
        elapsedMs: state.captchaStartedAt === null ? undefined : Math.max(0, Date.now() - state.captchaStartedAt),
      });
    } else if (status === "cancelled") {
      this.logCaptcha(state, "lock_cancelled", {
        elapsedMs: state.captchaStartedAt === null ? undefined : Math.max(0, Date.now() - state.captchaStartedAt),
        reason,
      });
    }
    return true;
  }

  private clearCaptchaLocks(reason: "session_released"): void {
    for (const state of this.pages.values()) this.clearCaptchaLock(state, "cancelled", reason);
  }

  private handleCaptchaConsoleMessage(state: PageState, text: string): void {
    const message = text.trim();
    const started = CAPTCHA_SOLVING_STARTED_MESSAGES.has(message);
    const finished = CAPTCHA_SOLVING_FINISHED_MESSAGES.has(message);
    if (!started && !finished) {
      if (CAPTCHA_SOLVING_MESSAGE_PATTERN.test(message)) {
        this.logCaptcha(state, "unrecognized_event", { rawMessage: message });
      }
      return;
    }
    if (started) {
      const previousStartedAt = state.captchaStartedAt;
      const restarted = previousStartedAt !== null;
      const elapsedMs = previousStartedAt !== null
        ? Math.max(0, Date.now() - previousStartedAt)
        : undefined;
      state.captchaStartedAt = Date.now();
      this.logCaptcha(state, "observed_start", {
        rawMessage: message,
        elapsedMs,
        restarted: restarted || undefined,
      });
      this.startCaptchaLock(state);
      return;
    }
    const startedAt = state.captchaStartedAt;
    const startObserved = startedAt !== null;
    const elapsedMs = startedAt !== null
      ? Math.max(0, Date.now() - startedAt)
      : undefined;
    this.logCaptcha(state, "observed_finish", {
      rawMessage: message,
      elapsedMs,
      startObserved,
    });
    state.captchaStartedAt = null;
    this.clearCaptchaLock(state, "solved");
  }

  continueAfterCaptcha(pageId: string): void {
    const state = [...this.pages.values()].find((candidate) => candidate.id === pageId);
    if (!state || state.id !== this.activePageId || !this.isCaptchaLocked(state)) return;
    this.clearCaptchaLock(state, "continued");
  }

  private dismissDatePickersForPage(state: PageState): void {
    if (this.pendingDatePicker?.pageState !== state) return;
    const { requestId } = this.pendingDatePicker;
    this.pendingDatePicker = null;
    this.emit({ type: "date.picker.closed", requestId });
  }

  private dismissSelectPickersForPage(state: PageState): void {
    if (this.pendingSelectPicker?.pageState !== state) return;
    const { requestId } = this.pendingSelectPicker;
    this.pendingSelectPicker = null;
    this.emit({ type: "select.picker.closed", requestId });
  }

  async startAssertionPick(requestId: string): Promise<void> {
    if (this.mode !== "recording" || !this.recordingReady) {
      this.emit({ type: "assertion.pick.cancelled", requestId });
      return;
    }
    const pageState = this.activePage();
    if (this.isCaptchaLocked(pageState)) {
      this.emit({ type: "assertion.pick.cancelled", requestId });
      return;
    }
    if (this.pendingAssertionPick) this.cancelAssertionPick(this.pendingAssertionPick.requestId);
    this.dismissDatePickersForPage(pageState);
    this.dismissSelectPickersForPage(pageState);
    this.pendingAssertionPick = { requestId, pageState };
    this.applyAssertionPickerToPage(pageState, requestId);
  }

  cancelAssertionPick(requestId: string): void {
    const pending = this.pendingAssertionPick;
    if (!pending || pending.requestId !== requestId) return;
    this.pendingAssertionPick = null;
    this.applyAssertionPickerToPage(pending.pageState, null);
    this.emit({ type: "assertion.pick.cancelled", requestId });
  }

  private cancelAssertionPickForPage(pageState: PageState): void {
    if (this.pendingAssertionPick?.pageState === pageState) {
      this.cancelAssertionPick(this.pendingAssertionPick.requestId);
    }
  }

  private async handleAssertionPickerBrowserEvent(
    state: PageState,
    event: z.infer<typeof AssertionPickerBrowserEventSchema>,
  ): Promise<void> {
    const pending = this.pendingAssertionPick;
    if (!pending || pending.requestId !== event.requestId || pending.pageState !== state) return;
    if (event.type === "assertion-picker.cancelled") {
      this.cancelAssertionPick(event.requestId);
      return;
    }
    this.pendingAssertionPick = null;
    this.applyAssertionPickerToPage(state, null);
    if (event.type === "assertion-picker.group-selected") {
      this.emit({
        type: "assertion.pick.groupSelected",
        requestId: event.requestId,
        name: event.name,
        groupTarget: event.groupTarget,
        position: event.position,
        page: {
          id: state.id,
          url: state.page.url(),
          title: await state.page.title().catch(() => undefined),
        },
      });
      return;
    }
    this.emit({
      type: "assertion.pick.selected",
      requestId: event.requestId,
      name: event.name,
      text: event.text,
      target: {
        ...event.target,
        candidates: orderLocatorCandidates(locatorCandidatesForTarget(event.target)),
      },
      position: event.position,
      page: {
        id: state.id,
        url: state.page.url(),
        title: await state.page.title().catch(() => undefined),
      },
    });
  }

  private async handleDatePickerBrowserEvent(
    state: PageState,
    frame: Frame,
    event: z.infer<typeof DatePickerBrowserEventSchema>,
  ): Promise<void> {
    if (this.isCaptchaLocked(state)) return;
    if (event.type === "date-picker.dismiss") {
      this.dismissDatePickersForPage(state);
      return;
    }

    this.dismissDatePickersForPage(state);
    this.dismissSelectPickersForPage(state);
    const requestId = crypto.randomUUID();
    const locator = frame.locator(event.selector);
    const box = await locator.boundingBox().catch(() => null) ?? event.rect;
    const viewport = await state.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const pending: PendingDatePicker = {
      requestId,
      pageState: state,
      frame,
      selector: event.selector,
      name: event.name,
      target: event.target,
      position: event.position,
      min: event.min,
      max: event.max,
    };
    this.pendingDatePicker = pending;
    this.emit({
      type: "date.picker.open",
      requestId,
      value: event.value,
      min: event.min,
      max: event.max,
      rect: box,
      viewport,
    });
  }

  async selectDate(requestId: string, value: string): Promise<void> {
    const pending = this.pendingDatePicker;
    if (!pending || pending.requestId !== requestId) return;
    this.pendingDatePicker = null;
    this.emit({ type: "date.picker.closed", requestId });

    if (!isValidDateValue(value)) {
      throw new Error("Choose a valid calendar date.");
    }
    if (isValidDateValue(pending.min) && value < pending.min) throw new Error(`Choose a date on or after ${pending.min}.`);
    if (isValidDateValue(pending.max) && value > pending.max) throw new Error(`Choose a date on or before ${pending.max}.`);
    if (pending.pageState.id !== this.activePageId || pending.pageState.page.isClosed()) return;

    const locator = pending.frame.locator(pending.selector);
    await locator.fill(value);
    await locator.dispatchEvent("input");
    await locator.dispatchEvent("change");
    await this.forwardAction({
      type: "set_date",
      name: pending.name,
      target: pending.target,
      position: pending.position,
      payload: { value },
      sensitive: false,
      page: {
        id: pending.pageState.id,
        url: pending.pageState.page.url(),
        title: await pending.pageState.page.title().catch(() => undefined),
      },
      recordedAt: new Date().toISOString(),
    });
  }

  dismissDatePicker(requestId: string): void {
    if (this.pendingDatePicker?.requestId !== requestId) return;
    this.pendingDatePicker = null;
    this.emit({ type: "date.picker.closed", requestId });
  }

  private async handleSelectPickerBrowserEvent(
    state: PageState,
    frame: Frame,
    event: z.infer<typeof SelectPickerBrowserEventSchema>,
  ): Promise<void> {
    if (this.isCaptchaLocked(state)) return;
    if (event.type === "select-picker.dismiss") {
      this.dismissSelectPickersForPage(state);
      return;
    }
    if (this.nativeSelects) {
      this.dismissSelectPickersForPage(state);
      return;
    }

    this.dismissDatePickersForPage(state);
    this.dismissSelectPickersForPage(state);
    const requestId = crypto.randomUUID();
    const locator = frame.locator(event.selector);
    const box = await locator.boundingBox().catch(() => null) ?? event.rect;
    const viewport = await state.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    this.pendingSelectPicker = {
      requestId,
      pageState: state,
      frame,
      selector: event.selector,
      name: event.name,
      target: event.target,
      position: event.position,
      sensitive: event.sensitive,
    };
    this.emit({
      type: "select.picker.open",
      requestId,
      name: event.name,
      value: event.value,
      options: event.options,
      rect: box,
      viewport,
    });
  }

  async selectPickerOption(requestId: string, value: string): Promise<void> {
    const pending = this.pendingSelectPicker;
    if (!pending || pending.requestId !== requestId) return;
    this.pendingSelectPicker = null;
    this.emit({ type: "select.picker.closed", requestId });
    if (pending.pageState.id !== this.activePageId || pending.pageState.page.isClosed()) return;

    const locator = pending.frame.locator(pending.selector);
    const option = await locator.evaluate((element, requestedValue) => {
      if (!(element instanceof HTMLSelectElement) || element.multiple || element.size > 1) return null;
      const match = [...element.options].find((candidate) => candidate.value === requestedValue);
      if (!match) return null;
      return {
        label: String(match.label || match.textContent || "").replace(/\s+/g, " ").trim(),
        disabled: match.disabled || (match.parentElement instanceof HTMLOptGroupElement && match.parentElement.disabled),
      };
    }, value);
    if (!option) throw new Error("The selected option is no longer available.");
    if (option.disabled) throw new Error("The selected option is disabled.");

    await pending.frame.evaluate(() => {
      (window as Window & { __browserMemorySuppressSelectChange?: boolean }).__browserMemorySuppressSelectChange = true;
    });
    try {
      const selected = await locator.selectOption({ value });
      if (!selected.includes(value)) throw new Error("The browser did not apply the selected option.");
    } finally {
      await pending.frame.evaluate(() => {
        (window as Window & { __browserMemorySuppressSelectChange?: boolean }).__browserMemorySuppressSelectChange = false;
      }).catch(() => undefined);
    }
    await locator.focus().catch(() => undefined);

    await this.forwardAction({
      type: "select",
      name: pending.name,
      target: pending.target,
      position: pending.position,
      payload: { value, ...(option.label ? { label: option.label } : {}) },
      sensitive: pending.sensitive,
      page: {
        id: pending.pageState.id,
        url: pending.pageState.page.url(),
        title: await pending.pageState.page.title().catch(() => undefined),
      },
      recordedAt: new Date().toISOString(),
    });
  }

  dismissSelectPicker(requestId: string): void {
    if (this.pendingSelectPicker?.requestId !== requestId) return;
    const pending = this.pendingSelectPicker;
    this.pendingSelectPicker = null;
    this.emit({ type: "select.picker.closed", requestId });
    if (pending.pageState.id !== this.activePageId || pending.pageState.page.isClosed()) return;
    void pending.frame.locator(pending.selector).focus().catch(() => undefined);
  }

  private async forwardAction(action: RecordedAction): Promise<void> {
    if (this.mode !== "recording" || !this.recordingReady) return;
    const state = [...this.pages.values()].find((candidate) => candidate.id === action.page.id);
    if (state && this.isCaptchaLocked(state)) return;
    if (!isAutomaticallyRecordableAction(action)) return;
    if (!this.startUrlSource) {
      if (!this.forwardStartUrlDescriptor(action.page)) return;
    }
    const normalized = action.target
      ? {
          ...action,
          target: {
            ...action.target,
            candidates: orderLocatorCandidates(locatorCandidatesForTarget(action.target)),
          },
        }
      : action;
    if (!this.deduplicator.shouldForward(normalized)) return;
    this.emit({ type: "recorded.action", action: normalized });
    this.hasRecordedAction = true;
  }

  private forwardStartUrl(state: PageState): boolean {
    return this.forwardStartUrlDescriptor({ id: state.id, url: state.page.url() });
  }

  private forwardStartUrlDescriptor(page: RecordedAction["page"], source: "observed" | "requested" = "observed"): boolean {
    if (this.mode !== "recording" || !this.recordingReady) return false;
    if (this.startUrlSource === "requested") return true;
    if (this.startUrlSource === "observed" && (source === "observed" || this.hasRecordedAction)) return true;
    if (!isRecordableNavigationUrl(page.url)) return false;
    this.emit({ type: "recording.startUrl", url: page.url });
    this.startUrlSource = source;
    return true;
  }

  private async emitPageState(state: PageState): Promise<void> {
    this.emit({
      type: "browser.page",
      pageId: state.id,
      title: await state.page.title().catch(() => "Browser"),
      url: state.page.url(),
    });
  }

  private activePage(): PageState {
    const state = [...this.pages.values()].find((candidate) => candidate.id === this.activePageId);
    if (!state) throw new Error("The active browser page is not available.");
    return state;
  }

  private async runNavigation(operation: (page: Page) => Promise<unknown>): Promise<void> {
    try {
      const state = this.activePage();
      if (this.isCaptchaLocked(state)) return;
      await operation(state.page);
      await this.emitPageState(state);
    } catch (error) {
      this.emit({
        type: "browser.navigation.error",
        message: error instanceof Error ? error.message : "The browser could not complete that navigation.",
      });
    }
  }

  async navigate(url: string): Promise<void> {
    let normalized: string;
    try {
      normalized = normalizeBrowserUrl(url);
    } catch (error) {
      this.emit({
        type: "browser.navigation.error",
        message: error instanceof Error ? error.message : "Enter a valid web address.",
      });
      return;
    }
    if (this.activePageCaptchaLocked()) return;
    if (this.mode === "recording" && this.recordingReady) {
      const state = this.activePage();
      this.forwardStartUrlDescriptor({ id: state.id, url: normalized }, "requested");
    }
    await this.runNavigation((page) => page.goto(normalized, { waitUntil: "domcontentloaded", timeout: 30_000 }));
  }

  async goBack(): Promise<void> {
    await this.runNavigation((page) => page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }));
  }

  async goForward(): Promise<void> {
    await this.runNavigation((page) => page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 }));
  }

  async reload(): Promise<void> {
    await this.runNavigation((page) => page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }));
  }

  async switchPage(pageId: string): Promise<void> {
    if (!this.sessionId) return;
    if (this.activePageCaptchaLocked()) return;
    const state = [...this.pages.values()].find((candidate) => candidate.id === pageId);
    if (!state) throw new Error("That browser tab is no longer open.");
    const previous = [...this.pages.values()].find((candidate) => candidate.id === this.activePageId);
    if (previous) {
      this.dismissDatePickersForPage(previous);
      this.dismissSelectPickersForPage(previous);
      this.cancelAssertionPickForPage(previous);
    }
    this.activePageId = pageId;
    const liveView = await this.provider.getLiveView(this.sessionId, state.index);
    this.emit({ type: "popup.switched", pageId, liveViewUrl: liveView.liveViewUrl });
    await this.emitPageState(state);
  }

  async startReplay(
    workflow: Workflow,
    startStepId: string | undefined,
    options: { timeoutSeconds: number; region: "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1" },
  ): Promise<void> {
    if (this.activePageCaptchaLocked()) return;
    if (this.replayEngine || this.mode === "replay") throw new Error("A replay is already running.");
    if (this.pendingAssertionPick) this.cancelAssertionPick(this.pendingAssertionPick.requestId);
    const preflight = preflightReplay(workflow, startStepId);
    const runId = crypto.randomUUID();
    const existingSessionId = this.sessionId;
    this.mode = "replay";
    this.recordingReady = false;
    this.replayStopRequested = false;
    this.replayMeta = { runId, totalSteps: preflight.totalSteps };
    this.emit({ type: "replay.status", runId, status: "preparing", totalSteps: preflight.totalSteps });
    try {
      this.clearCaptchaLocks("session_released");
      this.logIncompleteCaptchaObservations("session_released");
      this.sessionId = null;
      await this.browser?.close().catch(() => undefined);
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this.activePageId = null;
      this.pendingDatePicker = null;
      this.pendingSelectPicker = null;
      this.pendingAssertionPick = null;
      this.startUrlSource = null;
      this.hasRecordedAction = false;
      if (existingSessionId) await this.provider.releaseSession(existingSessionId);

      const created = await this.provider.createSession(options);
      this.sessionId = created.id;
      const connected = await this.provider.connect(created.id);
      this.browser = connected.browser;
      this.context = connected.context;
      await this.installRecorder(this.context);
      for (const [index, page] of this.context.pages().entries()) await this.registerPage(page, index, index === 0, true);
      this.context.on("page", (page) => void this.registerPage(page, this.pages.size, false, true));
      this.startUrlSource = "requested";
      this.hasRecordedAction = workflow.steps.length > 0;

      if (!this.sessionId) throw new Error("The recorder browser session is not available.");
      const active = this.activePageId ? this.activePage() : [...this.pages.values()][0];
      if (!active) throw new Error("Browserbase opened without a page.");
      this.activePageId = active.id;
      const liveView = await this.provider.getLiveView(this.sessionId, active.index);
      this.emit({
        type: "replay.started",
        runId,
        sessionId: this.sessionId,
        liveViewUrl: liveView.liveViewUrl,
        pageId: active.id,
        totalSteps: preflight.totalSteps,
      });
      await this.emitPageState(active);
      this.replayEngine = new ReplayEngine(runId, active.page, preflight, (message) => this.emit(message));
      const replayTask = this.replayEngine.run();
      this.replayTask = replayTask;
      void replayTask.then(() => {
        if (!this.replayStopRequested) this.returnToRecording(runId);
      }).catch((error) => {
        if (!this.replayMeta || this.replayMeta.runId !== runId) return;
        this.emit({ type: "replay.status", runId, status: "stopped", totalSteps: preflight.totalSteps });
        this.emit({
          type: "server.error",
          code: "REPLAY_ERROR",
          message: error instanceof Error ? error.message : "Replay could not continue.",
          recoverable: true,
        });
        this.returnToRecording(runId);
      });
    } catch (error) {
      const failedSessionId = this.sessionId;
      this.clearCaptchaLocks("session_released");
      this.logIncompleteCaptchaObservations("session_released");
      this.sessionId = null;
      await this.browser?.close().catch(() => undefined);
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this.activePageId = null;
      this.pendingDatePicker = null;
      this.pendingSelectPicker = null;
      this.pendingAssertionPick = null;
      this.mode = null;
      this.startUrlSource = null;
      this.hasRecordedAction = false;
      if (failedSessionId) await this.provider.releaseSession(failedSessionId);
      this.replayEngine = null;
      this.replayMeta = null;
      this.replayTask = null;
      throw error;
    }
  }

  private returnToRecording(runId: string): void {
    if (this.released || !this.sessionId || this.replayMeta?.runId !== runId) return;
    this.mode = "recording";
    this.recordingReady = true;
    this.replayEngine = null;
    this.replayMeta = null;
    this.replayTask = null;
    this.replayStopRequested = false;
    this.emit({ type: "session.status", status: "recording" });
  }

  pauseReplay(): void { this.replayEngine?.pause(); }
  resumeReplay(): void { this.replayEngine?.resume(); }
  retryReplay(): void { this.replayEngine?.retry(); }
  skipReplay(): void { this.replayEngine?.skip(); }
  takeControlOfReplay(): void { this.replayEngine?.takeControl(); }

  async stopReplay(): Promise<void> {
    const replayMeta = this.replayMeta;
    const replayTask = this.replayTask;
    if (!replayMeta || !this.replayEngine) return;
    this.replayStopRequested = true;
    this.emit({ type: "replay.status", runId: replayMeta.runId, status: "stopping", totalSteps: replayMeta.totalSteps });
    this.replayEngine.stop();
    await replayTask?.catch(() => undefined);
    if (this.released || this.replayMeta?.runId !== replayMeta.runId) return;
    this.emit({ type: "replay.status", runId: replayMeta.runId, status: "stopped", totalSteps: replayMeta.totalSteps });
    this.returnToRecording(replayMeta.runId);
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    const replayMeta = this.replayMeta;
    if (replayMeta) {
      this.emit({ type: "replay.status", runId: replayMeta.runId, status: "stopping", totalSteps: replayMeta.totalSteps });
    }
    this.emit({ type: "session.status", status: "stopping" });
    this.replayStopRequested = true;
    this.replayEngine?.stop();
    const sessionId = this.sessionId;
    this.pendingDatePicker = null;
    this.pendingSelectPicker = null;
    if (this.pendingAssertionPick) this.cancelAssertionPick(this.pendingAssertionPick.requestId);
    this.clearCaptchaLocks("session_released");
    this.logIncompleteCaptchaObservations("session_released");
    this.sessionId = null;
    await this.browser?.close().catch(() => undefined);
    if (sessionId) await this.provider.releaseSession(sessionId);
    if (replayMeta) {
      this.emit({ type: "replay.status", runId: replayMeta.runId, status: "stopped", totalSteps: replayMeta.totalSteps });
    }
    this.emit({ type: "session.status", status: "stopped" });
    this.mode = null;
    this.recordingReady = false;
    this.startUrlSource = null;
    this.hasRecordedAction = false;
    this.replayEngine = null;
    this.replayMeta = null;
    this.replayTask = null;
    this.replayStopRequested = false;
    this.onReleased();
  }
}
