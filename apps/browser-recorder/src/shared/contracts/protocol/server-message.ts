import { z } from "zod";
import { RecordedActionSchema } from "@/shared/contracts/recording/recorded-action";
import { MAX_ASSERTION_TEXT_LENGTH } from "@/shared/contracts/workflow/domain";
import { ElementTargetSchema, RepeatedGroupTemplateSchema, ViewportPositionSchema } from "@/shared/contracts/workflow/schema";
import {
  CaptchaStatusSchema,
  PickerRequestIdSchema,
  ReplayDiagnosticSchema,
  ReplayPhaseSchema,
  ReplayStatusSchema,
  ReplayStepStatusSchema,
} from "./protocol.types";

export const SequencedServerMessageSchema = z.object({
  sequence: z.number().int().nonnegative(),
  message: z.discriminatedUnion("type", [
    z.object({ type: z.literal("server.ready"), configured: z.boolean() }),
    z.object({
      type: z.literal("session.started"),
      sessionId: z.string(),
      liveViewUrl: z.string(),
      pageId: z.string(),
    }),
    z.object({
      type: z.literal("session.status"),
      status: z.enum(["starting", "recording", "stopping", "stopped", "reconnecting"]),
    }),
    z.object({ type: z.literal("recording.startUrl"), url: z.string().url() }),
    z.object({ type: z.literal("recorded.action"), action: RecordedActionSchema }),
    z.object({
      type: z.literal("popup.detected"),
      pageId: z.string(),
      title: z.string(),
      url: z.string(),
    }),
    z.object({
      type: z.literal("popup.switched"),
      pageId: z.string(),
      liveViewUrl: z.string(),
    }),
    z.object({
      type: z.literal("browser.page"),
      pageId: z.string(),
      title: z.string(),
      url: z.string(),
    }),
    z.object({ type: z.literal("browser.navigation.error"), message: z.string() }),
    z.object({
      type: z.literal("date.picker.open"),
      requestId: PickerRequestIdSchema,
      value: z.string(),
      min: z.string(),
      max: z.string(),
      rect: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
      viewport: z.object({
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    }),
    z.object({ type: z.literal("date.picker.closed"), requestId: PickerRequestIdSchema }),
    z.object({
      type: z.literal("select.picker.open"),
      requestId: PickerRequestIdSchema,
      name: z.string().min(1),
      value: z.string(),
      options: z.array(z.object({
        value: z.string(),
        label: z.string(),
        disabled: z.boolean(),
      })),
      rect: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
      viewport: z.object({
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    }),
    z.object({ type: z.literal("select.picker.closed"), requestId: PickerRequestIdSchema }),
    z.object({
      type: z.literal("assertion.pick.selected"),
      requestId: PickerRequestIdSchema,
      name: z.string().min(1),
      text: z.string().max(MAX_ASSERTION_TEXT_LENGTH),
      target: ElementTargetSchema,
      position: ViewportPositionSchema,
      page: z.object({ id: z.string().min(1), url: z.string(), title: z.string().optional() }),
    }),
    z.object({
      type: z.literal("assertion.pick.groupSelected"),
      requestId: PickerRequestIdSchema,
      name: z.string().min(1),
      groupTarget: RepeatedGroupTemplateSchema,
      position: ViewportPositionSchema,
      page: z.object({ id: z.string().min(1), url: z.string(), title: z.string().optional() }),
    }),
    z.object({ type: z.literal("assertion.pick.cancelled"), requestId: PickerRequestIdSchema }),
    z.object({
      type: z.literal("captcha.status"),
      pageId: z.string(),
      status: CaptchaStatusSchema,
    }),
    z.object({
      type: z.literal("replay.started"),
      runId: z.string().uuid(),
      sessionId: z.string(),
      liveViewUrl: z.string(),
      pageId: z.string(),
      totalSteps: z.number().int().nonnegative(),
    }),
    z.object({
      type: z.literal("replay.status"),
      runId: z.string().uuid(),
      status: ReplayStatusSchema,
      currentStepId: z.string().optional(),
      currentIndex: z.number().int().nonnegative().optional(),
      totalSteps: z.number().int().nonnegative(),
    }),
    z.object({
      type: z.literal("replay.step"),
      runId: z.string().uuid(),
      stepId: z.string(),
      status: ReplayStepStatusSchema,
      phase: ReplayPhaseSchema.optional(),
      durationMs: z.number().nonnegative().optional(),
      locatorKind: z.string().optional(),
      diagnostic: ReplayDiagnosticSchema.optional(),
    }),
    z.object({ type: z.literal("buffer.gap"), earliestSequence: z.number().int() }),
    z.object({
      type: z.literal("server.error"),
      code: z.string(),
      message: z.string(),
      recoverable: z.boolean(),
    }),
  ]),
});

export type SequencedServerMessage = z.infer<typeof SequencedServerMessageSchema>;
export type ServerMessage = SequencedServerMessage["message"];
