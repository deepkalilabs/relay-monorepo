import type { Frame, Page } from "playwright-core";
import {
  isGroupExistsAssertion,
  locatorCandidatesForTarget,
  repeatedGroupSimilarity,
  type GroupExistsAssertionStep,
  type RepeatedGroupTemplate,
  type WorkflowStep,
} from "@relay/workflow-contract";
import {
  ReplayCoreError,
  throwIfCancelled,
  type ReplayAttempt,
} from "./errors.js";
import {
  DEFAULT_STEP_TIMEOUT_MS,
  type ReplayOperationOptions,
} from "./timing.js";
import {
  resolveFrame,
  resolveTarget,
  resolveTargetOnce,
} from "./target-resolution.js";

export interface ReplayActionResult {
  locatorKind?: string;
  attempts: ReplayAttempt[];
}

export async function openInitialPage(
  page: Page,
  url: string,
  options: ReplayOperationOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  throwIfCancelled(options.signal, "acting");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    throwIfCancelled(options.signal, "acting");
  } catch (error) {
    if (error instanceof ReplayCoreError && error.code === "cancelled") throw error;
    throw new ReplayCoreError("bootstrap_failed", "acting");
  }
}

function normalizeAssertionText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

interface ObservedGroupCandidate {
  visible: boolean;
  root: RepeatedGroupTemplate["root"];
  structureTokens: string[];
}

async function evaluateGroupExistsAssertion(
  page: Page,
  step: GroupExistsAssertionStep,
  options: ReplayOperationOptions,
): Promise<ReplayActionResult> {
  throwIfCancelled(options.signal, "asserting");
  const frame: Frame = resolveFrame(page, step.groupTarget.frameUrl, step.page.url, "asserting");
  const observed = await frame.evaluate(({ rootTagName, rootRole, maximumCandidates }) => {
    const implicitRole = (element: Element): string | undefined => {
      const explicit = element.getAttribute("role")?.trim().toLowerCase();
      if (explicit) return explicit.split(/\s+/u)[0];
      const tagName = element.tagName.toLowerCase();
      if (tagName === "article") return "article";
      if (tagName === "button") return "button";
      if (tagName === "a" && element.hasAttribute("href")) return "link";
      if (tagName === "nav") return "navigation";
      if (tagName === "main") return "main";
      if (tagName === "form") return "form";
      if (tagName === "select") return element.hasAttribute("multiple") ? "listbox" : "combobox";
      if (tagName === "textarea") return "textbox";
      if (tagName === "input") {
        const type = (element.getAttribute("type") ?? "text").toLowerCase();
        if (["button", "submit", "reset", "image"].includes(type)) return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type !== "hidden") return "textbox";
      }
      return undefined;
    };
    const segment = (element: Element): string =>
      `${element.tagName.toLowerCase()}:${implicitRole(element) ?? ""}`;
    const describe = (root: Element) => {
      const tokens = new Set<string>([`0:${segment(root)}`]);
      let visitedDescendants = 0;
      const visit = (element: Element, depth: number, path: string[]) => {
        if (depth > 3 || visitedDescendants >= 150) return;
        for (const child of Array.from(element.children)) {
          if (visitedDescendants >= 150) break;
          visitedDescendants += 1;
          const childPath = [...path, segment(child)];
          tokens.add(`${depth}:${childPath.join(">")}`);
          visit(child, depth + 1, childPath);
        }
      };
      visit(root, 1, []);
      const styles = getComputedStyle(root);
      const rect = root.getBoundingClientRect();
      const role = implicitRole(root);
      return {
        visible:
          styles.display !== "none" &&
          styles.visibility !== "hidden" &&
          styles.visibility !== "collapse" &&
          Number(styles.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0,
        root: {
          tagName: root.tagName.toLowerCase(),
          ...(role ? { role } : {}),
          sharedClasses: Array.from(root.classList).sort(),
        },
        structureTokens: Array.from(tokens).sort(),
      };
    };
    const candidates = Array.from(document.getElementsByTagName(rootTagName)).filter(
      (candidate) => (implicitRole(candidate) ?? "") === rootRole,
    );
    if (candidates.length > maximumCandidates) {
      return { excessivelyBroad: true, candidateCount: candidates.length, candidates: [] };
    }
    return {
      excessivelyBroad: false,
      candidateCount: candidates.length,
      candidates: candidates.map(describe),
    };
  }, {
    rootTagName: step.groupTarget.root.tagName,
    rootRole: step.groupTarget.root.role ?? "",
    maximumCandidates: 500,
  });
  throwIfCancelled(options.signal, "asserting");

  if (observed.excessivelyBroad) {
    throw new ReplayCoreError(
      "assertion_failed",
      "asserting",
      [{ kind: "structural-group", outcome: "candidate_limit_exceeded", count: observed.candidateCount }],
      { kind: "group_candidate_limit", candidateCount: observed.candidateCount, maximumCandidates: 500 },
    );
  }
  const similarities = (observed.candidates as ObservedGroupCandidate[]).map((candidate) => ({
    ...repeatedGroupSimilarity(step.groupTarget, {
      version: 1,
      algorithm: "structural-token-v1",
      root: candidate.root,
      structureTokens: candidate.structureTokens,
      capturedMatchCount: 2,
    }),
    visible: candidate.visible,
  }));
  if (!similarities.some((candidate) => candidate.visible && candidate.matches)) {
    const highestSimilarities = similarities
      .map((candidate) => candidate.score)
      .sort((left, right) => right - left)
      .slice(0, 3);
    throw new ReplayCoreError(
      "assertion_failed",
      "asserting",
      [{ kind: "structural-group", outcome: "group_not_matched" }],
      { kind: "group_mismatch", capturedMatchCount: step.groupTarget.capturedMatchCount, highestSimilarities },
    );
  }
  return { locatorKind: "structural-group", attempts: [] };
}

export async function applyPositionBefore(
  page: Page,
  step: WorkflowStep,
  options: ReplayOperationOptions = {},
): Promise<void> {
  if (!step.position) return;
  throwIfCancelled(options.signal, "acting");
  const frame = resolveFrame(page, step.position.frameUrl, step.page.url, "acting");
  try {
    await frame.evaluate(async ({ x, y }) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        window.scrollTo({ left: x, top: y, behavior: "instant" as ScrollBehavior });
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        if (Math.abs(window.scrollX - x) <= 1 && Math.abs(window.scrollY - y) <= 1) break;
      }
    }, { x: step.position.x, y: step.position.y });
    throwIfCancelled(options.signal, "acting");
  } catch (error) {
    if (error instanceof ReplayCoreError) throw error;
    throw new ReplayCoreError("position_failed", "acting");
  }
}

export async function executeStepAction(
  page: Page,
  step: WorkflowStep,
  options: ReplayOperationOptions = {},
): Promise<ReplayActionResult> {
  const phase = step.type === "assertion" ? "asserting" : "acting";
  const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  try {
    if (!isGroupExistsAssertion(step)) await applyPositionBefore(page, step, options);
    throwIfCancelled(options.signal, phase);
    if (step.type === "navigate") {
      await page.goto(step.payload.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      throwIfCancelled(options.signal, phase);
      return { attempts: [] };
    }
    if (step.type === "assertion") {
      if (isGroupExistsAssertion(step)) return evaluateGroupExistsAssertion(page, step, options);
      const resolved = await resolveTargetOnce(page, step.target, step.page.url, {
        ...options,
        phase: "asserting",
      });
      if (step.expectation.kind === "text_contains") {
        const observed = normalizeAssertionText(await resolved.locator.innerText());
        const expected = normalizeAssertionText(step.expectation.expected);
        if (!observed.includes(expected)) {
          throw new ReplayCoreError(
            "assertion_failed",
            "asserting",
            resolved.attempts,
            { kind: "text_mismatch", expected, observed },
          );
        }
      }
      throwIfCancelled(options.signal, phase);
      return { locatorKind: resolved.kind, attempts: resolved.attempts };
    }

    const resolved = await resolveTarget(page, step.target, step.page.url, {
      ...options,
      phase: "acting",
    });
    const actionOptions = { timeout: timeoutMs };
    switch (step.type) {
      case "click":
        await resolved.locator.click(actionOptions);
        break;
      case "fill":
        if (locatorCandidatesForTarget(step.target).some(
          (candidate) => candidate.kind === "role" && candidate.value === "combobox",
        )) {
          await resolved.locator.focus(actionOptions);
          await resolved.locator.press("ControlOrMeta+A", actionOptions);
          await resolved.locator.press("Backspace", actionOptions);
          await resolved.locator.pressSequentially(step.payload.value, { ...actionOptions, delay: 20 });
        } else {
          await resolved.locator.fill(step.payload.value, actionOptions);
        }
        break;
      case "set_date":
        await resolved.locator.fill(step.payload.value, actionOptions);
        break;
      case "select":
        try {
          await resolved.locator.selectOption({ value: step.payload.value }, actionOptions);
        } catch (error) {
          if (!step.payload.label) throw error;
          await resolved.locator.selectOption({ label: step.payload.label }, actionOptions);
        }
        break;
      case "check":
        await resolved.locator.check(actionOptions);
        break;
      case "uncheck":
        await resolved.locator.uncheck(actionOptions);
        break;
      case "keypress":
        await resolved.locator.press([...step.payload.modifiers, step.payload.key].join("+"), actionOptions);
        break;
      case "submit": {
        const submitted = await resolved.locator.evaluate((element) => {
          if (element instanceof HTMLFormElement) {
            element.requestSubmit();
            return true;
          }
          const form = element instanceof HTMLElement ? element.closest("form") : null;
          if (form) form.requestSubmit();
          return Boolean(form);
        }, undefined, actionOptions);
        if (!submitted) throw new ReplayCoreError("action_failed", "acting");
        break;
      }
    }
    throwIfCancelled(options.signal, phase);
    return { locatorKind: resolved.kind, attempts: resolved.attempts };
  } catch (error) {
    if (error instanceof ReplayCoreError) {
      if (error.code === "cancelled" || error.code === "assertion_failed") throw error;
      throw new ReplayCoreError(
        step.type === "assertion" ? "assertion_failed" : "action_failed",
        phase,
        error.attempts,
        error.detail,
      );
    }
    throw new ReplayCoreError(
      step.type === "assertion" ? "assertion_failed" : "action_failed",
      phase,
    );
  }
}
