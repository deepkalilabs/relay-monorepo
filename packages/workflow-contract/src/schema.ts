import { z } from "zod";
import { profileFieldIds } from "./profile-field.js";
import {
  locatorCandidatesForTarget,
  locatorKinds,
  MAX_ASSERTION_TEXT_LENGTH,
  MAX_PARAMETER_VALUE_LENGTH,
  type ElementTarget,
  type ExecutableWorkflow,
  type LocatorCandidate,
  type ParameterBinding,
  type RepeatedGroupTemplate,
  type ReplayWait,
  type ViewportPosition,
  type Workflow,
  type WorkflowStep,
} from "./domain.js";

export const LocatorCandidateSchema = z.object({
  kind: z.enum(locatorKinds),
  value: z.string().min(1),
  name: z.string().optional(),
  exact: z.boolean().default(true),
  unique: z.boolean().optional(),
}).strict() satisfies z.ZodType<LocatorCandidate>;

export const ElementTargetSchema = z.object({
  selector: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  tagName: z.string().optional(),
  inputType: z.string().optional(),
  frameUrl: z.string().optional(),
  candidates: z.array(LocatorCandidateSchema).optional(),
}).strict() satisfies z.ZodType<ElementTarget>;

/** @deprecated Use ElementTargetSchema for new code. */
export const TargetDescriptorSchema = ElementTargetSchema;

export const ReplayWaitSchema = z.object({
  delayMs: z.number().int().min(0).max(30_000).optional(),
  condition: z.object({
    state: z.enum(["visible", "hidden"]),
    target: ElementTargetSchema.refine(
      (target) => locatorCandidatesForTarget(target).length > 0,
      "Replay wait conditions need at least one locator.",
    ),
  }).strict().optional(),
}).strict().refine(
  (wait) => (wait.delayMs ?? 0) > 0 || Boolean(wait.condition),
  "Configure a delay or element condition for this replay wait.",
) satisfies z.ZodType<ReplayWait>;

const PageDescriptorSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  title: z.string().optional(),
}).strict();

const StepMetadataSchema = z.object({
  recordedAt: z.string().datetime({ offset: true }),
  origin: z.enum(["recorded", "manual"]),
  sensitive: z.boolean(),
}).strict();

export const ViewportPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  frameUrl: z.string().optional(),
}).strict() satisfies z.ZodType<ViewportPosition>;

export const RepeatedGroupTemplateSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("structural-token-v1"),
  frameUrl: z.string().optional(),
  root: z.object({
    tagName: z.string().trim().min(1).regex(/\S/),
    role: z.string().trim().min(1).regex(/\S/).optional(),
    sharedClasses: z.array(z.string().trim().min(1).regex(/\S/)),
  }).strict(),
  structureTokens: z.array(z.string().trim().min(1).regex(/\S/)).min(1),
  capturedMatchCount: z.number().int().min(2),
}).strict() satisfies z.ZodType<RepeatedGroupTemplate>;

const StepBase = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  name: z.string().trim().min(1, "Give this step a name."),
  enabled: z.boolean(),
  page: PageDescriptorSchema,
  target: ElementTargetSchema.optional(),
  position: ViewportPositionSchema.optional(),
  metadata: StepMetadataSchema,
});

const ActionStepBase = StepBase.extend({
  waitAfter: ReplayWaitSchema.optional(),
});

const ElementStepBase = StepBase.extend({
  target: ElementTargetSchema.refine(
    (target) => locatorCandidatesForTarget(target).length > 0,
    "Element steps need at least one locator.",
  ),
});

const ElementActionStepBase = ElementStepBase.extend({
  waitAfter: ReplayWaitSchema.optional(),
});

export const ParameterBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("recorded") }).strict(),
  z.object({
    source: z.literal("fixed"),
    value: z.string().max(MAX_PARAMETER_VALUE_LENGTH),
  }).strict(),
  z.object({
    source: z.literal("profile"),
    field: z.enum(profileFieldIds),
  }).strict(),
  z.object({ source: z.literal("runtime") }).strict(),
]) satisfies z.ZodType<ParameterBinding>;

const NavigateStepSchema = ActionStepBase.extend({
  type: z.literal("navigate"),
  payload: z.object({ url: z.string().min(1, "Enter a destination URL.") }).strict(),
}).strict();

const ClickStepSchema = ElementActionStepBase.extend({
  type: z.literal("click"),
  payload: z.object({}).strict().optional(),
}).strict();

const FillStepSchema = ElementActionStepBase.extend({
  type: z.literal("fill"),
  payload: z.object({ value: z.string() }).strict(),
  parameterBinding: ParameterBindingSchema,
}).strict();

const SetDateStepSchema = ElementActionStepBase.extend({
  type: z.literal("set_date"),
  payload: z.object({ value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD for dates.") }).strict(),
}).strict();

const SelectStepSchema = ElementActionStepBase.extend({
  type: z.literal("select"),
  payload: z.object({ value: z.string(), label: z.string().optional() }).strict(),
}).strict();

const CheckStepSchema = ElementActionStepBase.extend({
  type: z.literal("check"),
  payload: z.object({}).strict().optional(),
}).strict();

const UncheckStepSchema = ElementActionStepBase.extend({
  type: z.literal("uncheck"),
  payload: z.object({}).strict().optional(),
}).strict();

const KeypressStepSchema = ElementActionStepBase.extend({
  type: z.literal("keypress"),
  payload: z.object({
    key: z.string().min(1, "Enter a key."),
    modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])),
  }).strict(),
}).strict();

const SubmitStepSchema = ElementActionStepBase.extend({
  type: z.literal("submit"),
  payload: z.object({}).strict().optional(),
}).strict();

const ElementAssertionExpectationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visible") }).strict(),
  z.object({
    kind: z.literal("text_contains"),
    expected: z.string()
      .max(MAX_ASSERTION_TEXT_LENGTH)
      .regex(/\S/, "Enter text to match."),
  }).strict(),
]);

const LegacyElementAssertionStepSchema = ElementStepBase.extend({
  type: z.literal("assertion"),
  expectation: ElementAssertionExpectationSchema,
}).strict();

const AssertionStepSchema = StepBase.extend({
  type: z.literal("assertion"),
  groupTarget: RepeatedGroupTemplateSchema.optional(),
  expectation: z.discriminatedUnion("kind", [
    ...ElementAssertionExpectationSchema.options,
    z.object({ kind: z.literal("group_exists") }).strict(),
  ]),
}).strict().superRefine((step, context) => {
  if (step.expectation.kind === "group_exists") {
    if (!step.groupTarget) {
      context.addIssue({ code: "custom", path: ["groupTarget"], message: "Group assertions need a structural template." });
    }
    if (step.target) {
      context.addIssue({ code: "custom", path: ["target"], message: "Group assertions cannot use an element target." });
    }
    return;
  }
  if (!step.target || locatorCandidatesForTarget(step.target).length === 0) {
    context.addIssue({ code: "custom", path: ["target"], message: "Element assertions need at least one locator." });
  }
  if (step.groupTarget) {
    context.addIssue({ code: "custom", path: ["groupTarget"], message: "Element assertions cannot use a group template." });
  }
});

export const WorkflowStepSchema = z.discriminatedUnion("type", [
  NavigateStepSchema,
  ClickStepSchema,
  FillStepSchema,
  SetDateStepSchema,
  SelectStepSchema,
  CheckStepSchema,
  UncheckStepSchema,
  KeypressStepSchema,
  SubmitStepSchema,
  AssertionStepSchema,
]) as unknown as z.ZodType<WorkflowStep>;

const LegacyWorkflowStepSchema = z.discriminatedUnion("type", [
  NavigateStepSchema,
  ClickStepSchema,
  SetDateStepSchema,
  SelectStepSchema,
  CheckStepSchema,
  UncheckStepSchema,
  KeypressStepSchema,
  SubmitStepSchema,
]);

const SchemaV13WorkflowStepSchema = z.discriminatedUnion("type", [
  NavigateStepSchema,
  ClickStepSchema,
  FillStepSchema,
  SetDateStepSchema,
  SelectStepSchema,
  CheckStepSchema,
  UncheckStepSchema,
  KeypressStepSchema,
  SubmitStepSchema,
  LegacyElementAssertionStepSchema,
]);

const WorkflowDocumentBase = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Give this workflow a name."),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  source: z.object({
    provider: z.literal("browserbase"),
    sessionId: z.string(),
    startUrl: z.string().optional(),
  }).strict(),
});

const RevisionedWorkflowDocumentBase = WorkflowDocumentBase.extend({
  status: z.enum(["draft", "complete"]),
  revision: z.number().int().positive(),
  finishedAt: z.string().datetime({ offset: true }).optional(),
});

export const WorkflowSchema = RevisionedWorkflowDocumentBase.extend({
  schemaVersion: z.literal("1.4"),
  steps: z.array(WorkflowStepSchema),
}).strict() satisfies z.ZodType<Workflow>;

export const ExecutableWorkflowSchema = RevisionedWorkflowDocumentBase.extend({
  schemaVersion: z.string(),
  steps: z.array(WorkflowStepSchema),
}).strict() satisfies z.ZodType<ExecutableWorkflow>;

const LegacyWorkflowSchema = WorkflowDocumentBase.extend({
  schemaVersion: z.literal("1.0"),
  steps: z.array(LegacyWorkflowStepSchema),
}).strict();

const PreviousWorkflowSchema = RevisionedWorkflowDocumentBase.extend({
  schemaVersion: z.literal("1.1"),
  steps: z.array(LegacyWorkflowStepSchema),
}).strict();

const SchemaV12WorkflowSchema = RevisionedWorkflowDocumentBase.extend({
  schemaVersion: z.literal("1.2"),
  steps: z.array(WorkflowStepSchema),
}).strict();

const SchemaV13WorkflowSchema = RevisionedWorkflowDocumentBase.extend({
  schemaVersion: z.literal("1.3"),
  steps: z.array(SchemaV13WorkflowStepSchema),
}).strict();

export const CompatibleWorkflowSchema = z.discriminatedUnion(
  "schemaVersion",
  [WorkflowSchema, SchemaV13WorkflowSchema, SchemaV12WorkflowSchema, PreviousWorkflowSchema, LegacyWorkflowSchema],
).transform(
  (workflow): Workflow => {
    if (workflow.schemaVersion === "1.4") return workflow;
    if (workflow.schemaVersion === "1.3" || workflow.schemaVersion === "1.2" || workflow.schemaVersion === "1.1") {
      return { ...workflow, schemaVersion: "1.4" };
    }
    return {
      ...workflow,
      schemaVersion: "1.4",
      status: "complete",
      revision: 1,
      finishedAt: workflow.updatedAt,
    };
  },
);

const locatorPriority = new Map(locatorKinds.map((kind, index) => [kind, index]));

export function orderLocatorCandidates(candidates: LocatorCandidate[]): LocatorCandidate[] {
  return [...candidates].sort(
    (left, right) => (locatorPriority.get(left.kind) ?? 99) - (locatorPriority.get(right.kind) ?? 99),
  );
}

export function createWorkflow(sessionId = ""): Workflow {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.4",
    id: crypto.randomUUID(),
    name: "Untitled recording",
    status: "draft",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    source: { provider: "browserbase", sessionId },
    steps: [],
  };
}
