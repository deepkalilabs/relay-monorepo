"use client";

import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type ResizablePanel = "timeline" | "inspector";

export const panelLimits = {
  timeline: { min: 240, max: 360 },
  inspector: { min: 320, max: 480 },
} as const;

export function clampPanelWidth(panel: ResizablePanel, width: number): number {
  const limits = panelLimits[panel];
  return Math.min(limits.max, Math.max(limits.min, width));
}

export function keyboardPanelWidth(
  panel: ResizablePanel,
  width: number,
  key: "ArrowLeft" | "ArrowRight",
): number {
  const direction = key === "ArrowRight" ? 1 : -1;
  return clampPanelWidth(panel, width + direction * 16 * (panel === "timeline" ? 1 : -1));
}

interface WorkspacePanelOptions {
  selectedStepId: string | null;
  overlayOpen: boolean;
}

export function useWorkspacePanels({ selectedStepId, overlayOpen }: WorkspacePanelOptions) {
  const [timelineWidth, setTimelineWidth] = useState(280);
  const [inspectorWidth, setInspectorWidth] = useState(360);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);

  useEffect(() => {
    const compactWorkspace = matchMedia("(min-width: 1024px) and (max-width: 1439px)");
    const syncEmptyInspector = () => {
      if (!selectedStepId) setInspectorCollapsed(compactWorkspace.matches);
    };

    syncEmptyInspector();
    compactWorkspace.addEventListener("change", syncEmptyInspector);
    return () => compactWorkspace.removeEventListener("change", syncEmptyInspector);
  }, [selectedStepId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape"
        || inspectorCollapsed
        || overlayOpen
        || !matchMedia("(min-width: 1024px) and (max-width: 1439px)").matches
      ) {
        return;
      }
      setInspectorCollapsed(true);
      if (selectedStepId) {
        requestAnimationFrame(() => document.getElementById(`workflow-step-${selectedStepId}`)?.focus());
      }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [inspectorCollapsed, overlayOpen, selectedStepId]);

  const collapseTimeline = () => {
    setTimelineCollapsed(true);
    requestAnimationFrame(() => document.getElementById("timeline-expand")?.focus());
  };
  const collapseInspector = () => {
    setInspectorCollapsed(true);
    requestAnimationFrame(() => document.getElementById("inspector-expand")?.focus());
  };
  const expandTimeline = () => {
    setTimelineCollapsed(false);
    requestAnimationFrame(() => document.getElementById("timeline-collapse")?.focus());
  };
  const expandInspector = () => {
    setInspectorCollapsed(false);
    requestAnimationFrame(() => document.getElementById("inspector-collapse")?.focus());
  };

  const beginPanelResize = (panel: ResizablePanel, event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === "timeline" ? timelineWidth : inspectorWidth;
    const setWidth = panel === "timeline" ? setTimelineWidth : setInspectorWidth;
    document.body.classList.add("resizing-panels");
    const move = (moveEvent: PointerEvent) => {
      const delta = panel === "timeline" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      setWidth(clampPanelWidth(panel, startWidth + delta));
    };
    const end = () => {
      document.body.classList.remove("resizing-panels");
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  };

  const resizePanelWithKeyboard = (panel: ResizablePanel, event: ReactKeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const key = event.key;
    if (panel === "timeline") setTimelineWidth((width) => keyboardPanelWidth(panel, width, key));
    else setInspectorWidth((width) => keyboardPanelWidth(panel, width, key));
  };

  return {
    beginPanelResize,
    collapseInspector,
    collapseTimeline,
    expandInspector,
    expandTimeline,
    inspectorCollapsed,
    inspectorWidth,
    panelLimits,
    resizePanelWithKeyboard,
    setInspectorCollapsed,
    timelineCollapsed,
    timelineWidth,
  };
}
