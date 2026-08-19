import { z } from "zod";
import { CompatibleWorkflowSchema } from "@/shared/contracts/workflow/schema";
import { PickerRequestIdSchema } from "./protocol.types";

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("client.hello"),
    clientId: z.string().uuid(),
    lastSequence: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("session.start"), nativeSelects: z.boolean() }),
  z.object({ type: z.literal("session.restart"), nativeSelects: z.boolean() }),
  z.object({ type: z.literal("session.stop") }),
  z.object({ type: z.literal("popup.switch"), pageId: z.string() }),
  z.object({
    type: z.literal("browser.navigate"),
    url: z.string().trim().min(1).max(2_048),
  }),
  z.object({ type: z.literal("browser.back") }),
  z.object({ type: z.literal("browser.forward") }),
  z.object({ type: z.literal("browser.reload") }),
  z.object({
    type: z.literal("date.picker.select"),
    requestId: PickerRequestIdSchema,
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({ type: z.literal("date.picker.dismiss"), requestId: PickerRequestIdSchema }),
  z.object({
    type: z.literal("select.picker.select"),
    requestId: PickerRequestIdSchema,
    value: z.string(),
  }),
  z.object({ type: z.literal("select.picker.dismiss"), requestId: PickerRequestIdSchema }),
  z.object({ type: z.literal("select.native.set"), enabled: z.boolean() }),
  z.object({ type: z.literal("assertion.pick.start"), requestId: PickerRequestIdSchema }),
  z.object({ type: z.literal("assertion.pick.cancel"), requestId: PickerRequestIdSchema }),
  z.object({ type: z.literal("captcha.continue"), pageId: z.string().min(1) }),
  z.object({
    type: z.literal("replay.start"),
    workflow: CompatibleWorkflowSchema,
    startStepId: z.string().optional(),
    nativeSelects: z.boolean(),
  }),
  z.object({ type: z.literal("replay.pause") }),
  z.object({ type: z.literal("replay.resume") }),
  z.object({ type: z.literal("replay.retry") }),
  z.object({ type: z.literal("replay.skip") }),
  z.object({ type: z.literal("replay.takeControl") }),
  z.object({ type: z.literal("replay.stop") }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
