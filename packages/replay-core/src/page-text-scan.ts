import type { Frame, Page } from "playwright-core";
import { throwIfCancelled } from "./errors.js";
import type { ReplayOperationOptions } from "./timing.js";

interface FrameSnapshot {
  frame: Frame;
  children: FrameSnapshot[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function snapshotFrameTree(frame: Frame): FrameSnapshot {
  let children: Frame[] = [];
  try {
    children = frame.childFrames();
  } catch {
    // A frame detached while the assertion snapshot was being captured.
  }
  return { frame, children: children.map(snapshotFrameTree) };
}

async function scanFrameTree(
  snapshot: FrameSnapshot,
  expected: string,
  options: ReplayOperationOptions,
  mainFrame: boolean,
): Promise<boolean> {
  throwIfCancelled(options.signal, "asserting");
  try {
    if (snapshot.frame.isDetached()) return false;
    if (!mainFrame) {
      const frameElement = await snapshot.frame.frameElement();
      if (!await frameElement.isVisible()) return false;
    }
  } catch {
    return false;
  }

  try {
    const matched = await snapshot.frame.evaluate((normalizedExpected) => {
      const observed = (document.body?.innerText ?? "")
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase();
      return observed.includes(normalizedExpected);
    }, expected);
    throwIfCancelled(options.signal, "asserting");
    if (matched) return true;
  } catch {
    throwIfCancelled(options.signal, "asserting");
  }

  for (const child of snapshot.children) {
    if (await scanFrameTree(child, expected, options, false)) return true;
  }
  return false;
}

export async function pageContainsText(
  page: Page,
  expected: string,
  options: ReplayOperationOptions = {},
): Promise<boolean> {
  throwIfCancelled(options.signal, "asserting");
  const snapshot = snapshotFrameTree(page.mainFrame());
  return scanFrameTree(snapshot, normalizeText(expected), options, true);
}
