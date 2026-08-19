import { describe, expect, it } from "vitest";
import type { RecordedAction } from "@/shared/contracts/recording/recorded-action";
import { ActionDeduplicator, actionFingerprint } from "@/server/recording/deduplicate";
import { RECORDER_SCRIPT } from "@/server/recording/injected";
import { isAutomaticallyRecordableAction, isValidDateValue } from "@/server/recording/runtime";

const action: RecordedAction = {
  type: "navigate", name: "Navigate", payload: { url: "https://example.com" }, sensitive: false,
  page: { id: "page", url: "https://example.com" }, recordedAt: new Date().toISOString(),
};

describe("recorder normalization", () => {
  it("deduplicates identical actions inside the 500ms window", () => {
    const deduplicator = new ActionDeduplicator();
    expect(deduplicator.shouldForward(action, 1_000)).toBe(true);
    expect(deduplicator.shouldForward(action, 1_200)).toBe(false);
    expect(deduplicator.shouldForward(action, 1_501)).toBe(true);
  });

  it("changes the fill fingerprint when the value changes", () => {
    const fill = { ...action, type: "fill" as const, payload: { value: "one" }, target: { candidates: [{ kind: "css" as const, value: "#email", exact: true }] } };
    expect(actionFingerprint(fill)).not.toBe(actionFingerprint({ ...fill, payload: { value: "two" } }));
  });

  it("deduplicates repeated selections without dropping different values", () => {
    const deduplicator = new ActionDeduplicator();
    const select: RecordedAction = {
      ...action,
      type: "select",
      name: "Plan",
      target: { candidates: [{ kind: "label", value: "Plan", exact: true }] },
      payload: { value: "free", label: "Free" },
    };
    expect(deduplicator.shouldForward(select, 1_000)).toBe(true);
    expect(deduplicator.shouldForward(select, 1_100)).toBe(false);
    expect(deduplicator.shouldForward({ ...select, payload: { value: "pro", label: "Professional" } }, 1_200)).toBe(true);
  });

  it("captures completed fields and semantic buttons only", () => {
    expect(RECORDER_SCRIPT).toContain("const dirtyFields = new Set()");
    expect(RECORDER_SCRIPT).toContain('window.addEventListener("focusout"');
    expect(RECORDER_SCRIPT).toContain("event.composedPath?.()");
    expect(RECORDER_SCRIPT).toContain("input[type='submit']");
    expect(RECORDER_SCRIPT).toContain('kind: "testId"');
    expect(RECORDER_SCRIPT).toContain('input[type="date"]');
    expect(RECORDER_SCRIPT).toContain('type: "date-picker.request"');
    expect(RECORDER_SCRIPT).toContain('window.addEventListener("change"');
    expect(RECORDER_SCRIPT).toContain('type: "select"');
    expect(RECORDER_SCRIPT).toContain("select.multiple");
    expect(RECORDER_SCRIPT).toContain("nativeSelectForInteraction");
    expect(RECORDER_SCRIPT).toContain("label?.control instanceof HTMLSelectElement");
    expect(RECORDER_SCRIPT).toContain('type: "select-picker.request"');
    expect(RECORDER_SCRIPT).toContain("__browserMemorySuppressSelectChange");
    expect(RECORDER_SCRIPT).toContain("__browserMemorySetNativeSelects");
    expect(RECORDER_SCRIPT).toContain("window.__browserMemoryNativeSelects");
    expect(RECORDER_SCRIPT).toContain("__browserMemorySetCaptchaLocked");
    expect(RECORDER_SCRIPT).toContain("if (window.__browserMemoryCaptchaLocked) return");
    expect(RECORDER_SCRIPT).toContain("position: viewportPosition()");
    expect(RECORDER_SCRIPT).not.toContain('type: "scroll.position"');
    expect(RECORDER_SCRIPT).toContain('window.addEventListener("scroll"');
    expect(RECORDER_SCRIPT).not.toContain('document.addEventListener("submit"');
    expect(RECORDER_SCRIPT).not.toContain('"pushState", "replaceState"');
  });

  it("allows fill, click, select, final semantic date, and keypress actions through the automatic recorder", () => {
    const withType = (type: RecordedAction["type"]): RecordedAction => ({ ...action, type });
    expect(isAutomaticallyRecordableAction(withType("fill"))).toBe(true);
    expect(isAutomaticallyRecordableAction(withType("click"))).toBe(true);
    expect(isAutomaticallyRecordableAction(withType("select"))).toBe(true);
    expect(isAutomaticallyRecordableAction(withType("set_date"))).toBe(true);
    expect(isAutomaticallyRecordableAction(withType("keypress"))).toBe(true);
    for (const type of ["navigate", "check", "uncheck", "submit"] as const) {
      expect(isAutomaticallyRecordableAction(withType(type))).toBe(false);
    }
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidDateValue("2026-07-21")).toBe(true);
    expect(isValidDateValue("2026-02-29")).toBe(false);
    expect(isValidDateValue("2024-02-29")).toBe(true);
  });
});
