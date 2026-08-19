import { describe, expect, it } from "vitest";
import { getDisplayError, getDisplayStatus } from "@/features/recorder";
import {
  clampPanelWidth,
  keyboardPanelWidth,
} from "@/app/(product)/workflows/[workflowId]/edit/_hooks/useWorkspacePanels";

describe("recorder presentation state", () => {
  it("maps reconnecting and offline transport states without changing the session state", () => {
    expect(getDisplayStatus("recording", "reconnecting")).toBe("reconnecting");
    expect(getDisplayStatus("recording", "offline")).toBe("error");
    expect(getDisplayStatus("stopped", "offline")).toBe("stopped");
    expect(getDisplayError("recording", "offline", null)).toMatch(/could not be restored/i);
    expect(getDisplayError("idle", "connected", "Existing error")).toBe("Existing error");
  });

  it("keeps pointer and keyboard resizing within each panel's existing limits", () => {
    expect(clampPanelWidth("timeline", 100)).toBe(240);
    expect(clampPanelWidth("inspector", 900)).toBe(480);
    expect(keyboardPanelWidth("timeline", 280, "ArrowRight")).toBe(296);
    expect(keyboardPanelWidth("inspector", 360, "ArrowRight")).toBe(344);
    expect(keyboardPanelWidth("inspector", 320, "ArrowRight")).toBe(320);
  });
});
