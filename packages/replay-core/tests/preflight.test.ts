import { describe, expect, it } from "vitest";
import { ReplayCoreError, preflightReplay } from "../src/index.js";
import { clickStep, navigateStep, workflowWith } from "./fixtures.js";

describe("preflightReplay", () => {
  it("selects a range and returns the recorded bootstrap URL", () => {
    const first = navigateStep(0);
    first.enabled = false;

    expect(preflightReplay(workflowWith([first, clickStep(1)]), "step-1")).toMatchObject({
      startIndex: 1,
      totalSteps: 1,
      bootstrapUrl: "https://example.com/start",
    });
  });

  it("does not bootstrap before an enabled navigation step", () => {
    expect(preflightReplay(workflowWith([navigateStep()])).bootstrapUrl).toBeUndefined();
  });

  it.each([
    ["duplicate_step_id", () => {
      const duplicate = clickStep(1);
      duplicate.id = "step-0";
      return workflowWith([clickStep(), duplicate]);
    }],
    ["empty_range", () => {
      const disabled = clickStep();
      disabled.enabled = false;
      return workflowWith([disabled]);
    }],
    ["missing_bootstrap_url", () => {
      const step = clickStep();
      step.page.url = "about:blank";
      const workflow = workflowWith([step]);
      delete workflow.source.startUrl;
      return workflow;
    }],
  ] as const)("returns the structured %s failure", (code, input) => {
    try {
      preflightReplay(input());
      throw new Error("Expected preflight to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayCoreError);
      expect(error).toMatchObject({ code, phase: "preflight", attempts: [] });
    }
  });

  it("returns a structured missing-start failure", () => {
    expect(() => preflightReplay(workflowWith([clickStep()]), "missing")).toThrow(
      expect.objectContaining({ code: "missing_start_step", phase: "preflight" }),
    );
  });
});
