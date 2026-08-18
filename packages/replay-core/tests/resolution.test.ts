import { describe, expect, it, vi } from "vitest";
import type { Frame, Locator, Page } from "playwright-core";
import type { WorkflowStep } from "@relay/workflow-contract";
import {
  ReplayCoreError,
  applyPositionBefore,
  isRedundantOptionClickBeforeSelect,
  resolveFrame,
  resolveTargetOnce,
} from "../src/index.js";

const target = { candidates: [{ kind: "testId" as const, value: "target", exact: true }] };

function targetPage() {
  const locator = {
    count: vi.fn(async () => 1),
    evaluate: vi.fn(async () => ({ tagName: "button" })),
    isVisible: vi.fn(async () => true),
  } as unknown as Locator;
  const frame = {
    evaluate: vi.fn(async () => undefined),
    getByTestId: vi.fn(() => locator),
    locator: vi.fn(() => locator),
    url: vi.fn(() => "https://example.com/form"),
  } as unknown as Frame;
  const page = {
    frames: vi.fn(() => [frame]),
    mainFrame: vi.fn(() => frame),
  } as unknown as Page;
  return { frame, locator, page };
}

describe("target and frame resolution", () => {
  it("matches exact and normalized child frames while rejecting ambiguity", () => {
    const main = { url: vi.fn(() => "https://example.com/form") } as unknown as Frame;
    const exact = { url: vi.fn(() => "https://widget.example/embed?token=one") } as unknown as Frame;
    const normalized = { url: vi.fn(() => "https://widget.example/embed?token=two") } as unknown as Frame;
    const page = {
      frames: vi.fn(() => [main, exact, normalized]),
      mainFrame: vi.fn(() => main),
    } as unknown as Page;

    expect(resolveFrame(page, exact.url())).toBe(exact);
    expect(() => resolveFrame(page, "https://widget.example/embed?token=recorded")).toThrow(
      expect.objectContaining({
        code: "frame_ambiguous_normalized",
        attempts: [expect.objectContaining({ outcome: "frame_ambiguous_normalized" })],
      }),
    );
  });

  it("returns structured attempts without locator values", async () => {
    const { locator, page } = targetPage();
    vi.mocked(locator.count).mockResolvedValue(2);

    const error = await resolveTargetOnce(page, {
      candidates: [{ kind: "css", value: "#private-selector", exact: true }],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ReplayCoreError);
    expect(error).toMatchObject({
      code: "target_unresolved",
      attempts: [{ kind: "css", outcome: "multiple_matches", count: 2 }],
    });
    expect(JSON.stringify(error)).not.toContain("private-selector");
  });

  it("rejects a locator that conflicts with the recorded fingerprint", async () => {
    const { page } = targetPage();

    await expect(resolveTargetOnce(page, {
      ...target,
      tagName: "input",
      inputType: "email",
    })).rejects.toMatchObject({
      attempts: [{
        kind: "testId",
        outcome: "fingerprint_mismatch",
        expectedTagName: "input",
        observedTagName: "button",
        expectedInputType: "email",
      }],
    });
  });

  it("restores the recorded position in its frame", async () => {
    const { frame, page } = targetPage();
    const step: WorkflowStep = {
      id: "step-1",
      order: 0,
      name: "Click",
      enabled: true,
      page: { id: "page", url: "https://example.com/form" },
      target,
      position: { x: 40, y: 120 },
      metadata: { recordedAt: "2026-07-31T12:00:00Z", origin: "recorded", sensitive: false },
      type: "click",
    };

    await applyPositionBefore(page, step);

    expect(frame.evaluate).toHaveBeenCalledWith(expect.any(Function), { x: 40, y: 120 });
  });
});

describe("redundant option click classification", () => {
  it("skips only an immediately followed matching semantic select", () => {
    const base = {
      enabled: true,
      page: { id: "page", url: "https://example.com/form" },
      metadata: { recordedAt: "2026-07-31T12:00:00Z", origin: "recorded" as const, sensitive: false },
    };
    const click: WorkflowStep = {
      ...base,
      id: "click",
      order: 0,
      name: "One",
      target: { candidates: [{ kind: "role", value: "option", name: "One", exact: true }] },
      type: "click",
    };
    const select: WorkflowStep = {
      ...base,
      id: "select",
      order: 1,
      name: "Select option",
      target: { candidates: [{ kind: "role", value: "combobox", exact: true }] },
      type: "select",
      payload: { value: "one", label: "One" },
    };

    expect(isRedundantOptionClickBeforeSelect(click, select)).toBe(true);
    expect(isRedundantOptionClickBeforeSelect({ ...click, waitAfter: { delayMs: 1 } }, select)).toBe(false);
  });
});
