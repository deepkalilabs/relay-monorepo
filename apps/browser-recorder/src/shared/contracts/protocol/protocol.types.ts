import { z } from "zod";
import type { ElementTarget, PageDescriptor, RepeatedGroupTemplate, ViewportPosition } from "@/shared/contracts/workflow/domain";

export const PickerRequestIdSchema = z.string().uuid();

export const ReplayStatusSchema = z.enum([
  "idle",
  "preparing",
  "running",
  "pausing",
  "paused",
  "manual",
  "completed",
  "stopping",
  "stopped",
]);

export const ReplayStepStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "skipped",
]);

export const ReplayPhaseSchema = z.enum([
  "acting",
  "asserting",
  "settling",
  "waiting",
]);

export const CaptchaStatusSchema = z.enum([
  "solving",
  "solved",
  "timed_out",
  "continued",
  "cancelled",
]);

export const ReplayDiagnosticSchema = z.object({
  message: z.string(),
  attemptedLocators: z.array(z.object({ kind: z.string(), reason: z.string() })),
});

export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;
export type ReplayStepStatus = z.infer<typeof ReplayStepStatusSchema>;
export type ReplayPhase = z.infer<typeof ReplayPhaseSchema>;
export type ReplayDiagnostic = z.infer<typeof ReplayDiagnosticSchema>;
export type CaptchaStatus = z.infer<typeof CaptchaStatusSchema>;

export interface ReplayStepResultState {
  status: ReplayStepStatus;
  phase?: ReplayPhase;
  durationMs?: number;
  locatorKind?: string;
  diagnostic?: ReplayDiagnostic;
}

export interface BrowserPageState {
  pageId: string;
  title: string;
  url: string;
}

export interface PopupState {
  pageId: string;
  title: string;
  url: string;
}

export interface DatePickerState {
  requestId: string;
  value: string;
  min: string;
  max: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}

export interface SelectPickerState {
  requestId: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string; disabled: boolean }>;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}

export type AssertionPickState =
  | { status: "picking"; requestId: string }
  | {
      status: "selected";
      kind: "element";
      requestId: string;
      name: string;
      text: string;
      target: ElementTarget;
      position: ViewportPosition;
      page: PageDescriptor;
    }
  | {
      status: "selected";
      kind: "group";
      requestId: string;
      name: string;
      groupTarget: RepeatedGroupTemplate;
      position: ViewportPosition;
      page: PageDescriptor;
    };
