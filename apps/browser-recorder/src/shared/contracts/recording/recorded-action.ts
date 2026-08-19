import { z } from "zod";
import {
  ElementTargetSchema,
  ViewportPositionSchema,
} from "@/shared/contracts/workflow/schema";

export const RecordedActionSchema = z.object({
  type: z.enum([
    "navigate",
    "click",
    "fill",
    "set_date",
    "select",
    "check",
    "uncheck",
    "keypress",
    "submit",
  ]),
  name: z.string().min(1),
  target: ElementTargetSchema.optional(),
  position: ViewportPositionSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  sensitive: z.boolean().default(false),
  page: z.object({
    id: z.string(),
    url: z.string(),
    title: z.string().optional(),
  }),
  recordedAt: z.string().datetime(),
});

export type RecordedAction = z.infer<typeof RecordedActionSchema>;

export function isSensitiveInput(inputType?: string, autocomplete?: string): boolean {
  const combined = `${inputType ?? ""} ${autocomplete ?? ""}`.toLowerCase();
  return /(password|current-password|new-password|one-time-code|cc-|credit|card|token|secret)/.test(
    combined,
  );
}
