/**
 * The workflow domain contract shared by recording, editing, persistence, and
 * replay. Keep this module free of UI, transport, and validation dependencies.
 *
 * `schema.ts` is the runtime boundary for untrusted data. The types here are
 * the compile-time model used inside the application.
 */
import type { ProfileFieldId } from "./profile-field.js";

export const MAX_PARAMETER_VALUE_LENGTH = 10_000;
export const MAX_ASSERTION_TEXT_LENGTH = 1_000;

export type ParameterBinding =
  | { source: "recorded" }
  | { source: "fixed"; value: string }
  | { source: "profile"; field: ProfileFieldId }
  | { source: "runtime" };

export const locatorKinds = [
  "testId",
  "role",
  "accessibleName",
  "label",
  "text",
  "css",
  "xpath",
] as const;

export type LocatorKind = (typeof locatorKinds)[number];

export type LocatorCandidate = {
  kind: LocatorKind;
  value: string;
  name?: string;
  exact: boolean;
  unique?: boolean;
};

/**
 * A replayable description of an element.
 *
 * Candidates are ordered independently at record and replay boundaries so the
 * stored workflow does not depend on a single brittle selector.
 */
export type ElementTarget = {
  selector?: string;
  role?: string;
  name?: string;
  text?: string;
  tagName?: string;
  inputType?: string;
  frameUrl?: string;
  candidates?: LocatorCandidate[];
};

/** @deprecated Use ElementTarget for new code. */
export type TargetDescriptor = ElementTarget;

/**
 * Expands the concise element-target fields into the locator candidates used
 * by replay. Recorded workflows may already contain richer candidates.
 */
export function locatorCandidatesForTarget(target: ElementTarget): LocatorCandidate[] {
  const candidates = [...(target.candidates ?? [])];
  if (target.selector) {
    candidates.push({ kind: "css", value: target.selector, exact: true });
  }
  if (target.role) {
    candidates.push({ kind: "role", value: target.role, name: target.name, exact: true });
  } else if (target.name) {
    candidates.push({ kind: "accessibleName", value: target.name, exact: true });
  }
  if (target.text) {
    candidates.push({ kind: "text", value: target.text, exact: true });
  }

  return candidates.filter((candidate, index) =>
    candidates.findIndex((other) =>
      other.kind === candidate.kind &&
      other.value === candidate.value &&
      other.name === candidate.name
    ) === index
  );
}

export type PageDescriptor = {
  id: string;
  url: string;
  title?: string;
};

export type StepMetadata = {
  recordedAt: string;
  origin: "recorded" | "manual";
  sensitive: boolean;
};

export type ViewportPosition = {
  x: number;
  y: number;
  frameUrl?: string;
};

export type ReplayWait = {
  delayMs?: number;
  condition?: {
    state: "visible" | "hidden";
    target: ElementTarget;
  };
};

export type WorkflowStepBase = {
  id: string;
  order: number;
  name: string;
  enabled: boolean;
  page: PageDescriptor;
  position?: ViewportPosition;
  metadata: StepMetadata;
};

export type WorkflowActionStepBase = WorkflowStepBase & {
  waitAfter?: ReplayWait;
};

export type NavigateStep = WorkflowActionStepBase & {
  type: "navigate";
  target?: ElementTarget;
  payload: {
    url: string;
  };
};

export type ElementWorkflowStepBase = WorkflowStepBase & {
  target: ElementTarget;
};

export type ElementActionStepBase = ElementWorkflowStepBase & {
  waitAfter?: ReplayWait;
};

export type ClickStep = ElementActionStepBase & {
  type: "click";
  payload?: Record<string, never>;
};

export type FillStep = ElementActionStepBase & {
  type: "fill";
  payload: {
    value: string;
  };
  parameterBinding: ParameterBinding;
};

export type SelectStep = ElementActionStepBase & {
  type: "select";
  payload: {
    value: string;
    label?: string;
  };
};

export type SetDateStep = ElementActionStepBase & {
  type: "set_date";
  payload: {
    value: string;
  };
};

export type CheckStep = ElementActionStepBase & {
  type: "check";
  payload?: Record<string, never>;
};

export type UncheckStep = ElementActionStepBase & {
  type: "uncheck";
  payload?: Record<string, never>;
};

export type KeypressStep = ElementActionStepBase & {
  type: "keypress";
  payload: {
    key: string;
    modifiers: Array<"Alt" | "Control" | "Meta" | "Shift">;
  };
};

export type SubmitStep = ElementActionStepBase & {
  type: "submit";
  payload?: Record<string, never>;
};

export type AssertionExpectation =
  | { kind: "visible" }
  | { kind: "text_contains"; expected: string };

export type RepeatedGroupTemplate = {
  version: 1;
  algorithm: "structural-token-v1";
  frameUrl?: string;
  root: {
    tagName: string;
    role?: string;
    sharedClasses: string[];
  };
  structureTokens: string[];
  capturedMatchCount: number;
};

export type ElementAssertionStep = ElementWorkflowStepBase & {
  type: "assertion";
  expectation: AssertionExpectation;
  waitAfter?: never;
};

export type GroupExistsAssertionStep = WorkflowStepBase & {
  type: "assertion";
  groupTarget: RepeatedGroupTemplate;
  expectation: { kind: "group_exists" };
  target?: never;
  waitAfter?: never;
};

export type AssertionStep = ElementAssertionStep | GroupExistsAssertionStep;

export function isGroupExistsAssertion(step: WorkflowStep): step is GroupExistsAssertionStep {
  return step.type === "assertion" && step.expectation.kind === "group_exists";
}

export type ActionStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | SelectStep
  | SetDateStep
  | CheckStep
  | UncheckStep
  | KeypressStep
  | SubmitStep;

export type WorkflowStep = ActionStep | AssertionStep;

export type WorkflowActionType = ActionStep["type"];

export type WorkflowStatus = "draft" | "complete";

export type Workflow = {
  schemaVersion: "1.4";
  id: string;
  name: string;
  status: WorkflowStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  source: {
    provider: "browserbase";
    sessionId: string;
    startUrl?: string;
  };
  steps: WorkflowStep[];
};

export type ExecutableWorkflow = Omit<Workflow, "schemaVersion"> & {
  schemaVersion: string;
};
