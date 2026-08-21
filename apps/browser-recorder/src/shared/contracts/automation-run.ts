import { z } from "zod";

export const BatchAcceptedSchema = z.object({
  batchId: z.uuid(),
  runCount: z.number().int().min(1).max(10),
}).strict();

export const AssertionResultSchema = z.object({
  stepId: z.string().min(1).max(200),
  stepIndex: z.number().int().nonnegative(),
  stepName: z.string().min(1).max(200),
  kind: z.enum(["visible", "text_contains", "group_exists", "page_text_contains"]),
  matched: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  failureCode: z.literal("assertion_failed").optional(),
}).strict();

export const RunnerFailureCodeSchema = z.enum([
  "invalid_workflow",
  "workflow_not_complete",
  "invalid_start_step",
  "no_enabled_steps",
  "missing_parameter",
  "invalid_parameter",
  "unused_parameter",
  "invalid_configuration",
  "browserbase_unavailable",
  "browser_unavailable",
  "automation_failed",
  "cancelled",
  "timed_out",
]);

export const RunFailureCodeSchema = z.enum([
  ...RunnerFailureCodeSchema.options,
  "submission_unknown",
  "submission_failed",
  "execution_lost",
]);

export const RunScreenshotSchema = z.object({
  url: z.string().refine((url) => {
    const temporary = url.match(/^\/api\/run-artifacts\/([^/]+)$/)?.[1];
    const durable = url.match(
      /^\/api\/namespaces\/[0-9a-fA-F-]{36}\/workflow-runs\/([^/]+)\/screenshot$/,
    )?.[1];
    return z.uuid().safeParse(temporary ?? durable).success;
  }),
  width: z.number().int().min(1).max(480),
  height: z.number().int().min(1).max(300),
}).strict();

export const BackgroundRunSchema = z.object({
  id: z.uuid(),
  workflowId: z.uuid(),
  workflowRevision: z.number().int().min(1).optional(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  currentStep: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  failedStepIndex: z.number().int().nonnegative().optional(),
  failureCode: RunFailureCodeSchema.optional(),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  assertionResults: z.array(AssertionResultSchema),
  error: z.string().optional(),
  screenshot: RunScreenshotSchema.optional(),
}).strict().refine((run) => (
  !run.screenshot || run.status === "completed" || run.status === "failed"
), "Only terminal runs may include screenshots.");

export const BatchSnapshotSchema = z.object({
  batchId: z.uuid(),
  runs: z.array(BackgroundRunSchema).min(1).max(10),
}).strict();

export const RunHistorySchema = z.object({
  runs: z.array(BackgroundRunSchema).max(50),
  nextCursor: z.string().min(1).optional(),
}).strict();

export type AssertionResult = z.infer<typeof AssertionResultSchema>;
export type BackgroundRun = z.infer<typeof BackgroundRunSchema>;
export type RunScreenshot = z.infer<typeof RunScreenshotSchema>;
