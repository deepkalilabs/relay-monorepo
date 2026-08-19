import type { Profile, ProfileFieldId } from "@/shared/contracts/profile";
import {
  MAX_PARAMETER_VALUE_LENGTH,
  type Workflow,
  type WorkflowStep,
} from "./domain";

export type ParameterResolution =
  | { status: "resolved"; value: string }
  | { status: "missing-fixed" }
  | { status: "missing-profile"; field: ProfileFieldId }
  | { status: "runtime-required" }
  | { status: "invalid-runtime" };

export interface WorkflowParameterContext {
  profile?: Profile | null;
  runtimeValues?: Record<string, string>;
  startStepId?: string;
}

export interface WorkflowParameterResult {
  resolutions: Record<string, ParameterResolution>;
  requiredCount: number;
  configuredCount: number;
  canEnterPreflight: boolean;
  ready: boolean;
  resolvedWorkflow?: Workflow;
}

function profileValue(profile: Profile | null | undefined, field: ProfileFieldId): string {
  if (!profile) return "";
  switch (field) {
    case "identity.fullName":
      return profile.identity.fullName;
    case "identity.email":
      return profile.identity.email;
    case "location.countryRegion":
      return profile.location.countryRegion;
    case "location.postalCode":
      return profile.location.postalCode;
  }
}

function resolveStep(
  step: Extract<WorkflowStep, { type: "fill" }>,
  context: WorkflowParameterContext,
): ParameterResolution {
  switch (step.parameterBinding.source) {
    case "recorded":
      return { status: "resolved", value: step.payload.value };
    case "fixed":
      return step.parameterBinding.value.length
        ? { status: "resolved", value: step.parameterBinding.value }
        : { status: "missing-fixed" };
    case "profile": {
      const value = profileValue(context.profile, step.parameterBinding.field);
      return value.length
        ? { status: "resolved", value }
        : { status: "missing-profile", field: step.parameterBinding.field };
    }
    case "runtime": {
      const value = context.runtimeValues?.[step.id] ?? "";
      if (!value.length) return { status: "runtime-required" };
      if (value.length > MAX_PARAMETER_VALUE_LENGTH) return { status: "invalid-runtime" };
      return { status: "resolved", value };
    }
  }
}

export function resolveWorkflowParameters(
  workflow: Workflow,
  context: WorkflowParameterContext = {},
): WorkflowParameterResult {
  const startIndex = context.startStepId
    ? workflow.steps.findIndex((step) => step.id === context.startStepId)
    : 0;
  if (startIndex < 0) throw new Error("The selected replay step is no longer in this workflow.");

  const resolutions: Record<string, ParameterResolution> = {};
  for (const step of workflow.steps.slice(startIndex)) {
    if (!step.enabled || step.type !== "fill") continue;
    resolutions[step.id] = resolveStep(step, context);
  }

  const values = Object.values(resolutions);
  const configuredCount = values.filter((resolution) => resolution.status === "resolved").length;
  const blocking = values.some((resolution) => (
    resolution.status === "missing-fixed"
    || resolution.status === "missing-profile"
    || resolution.status === "invalid-runtime"
  ));
  const ready = values.every((resolution) => resolution.status === "resolved");

  const result: WorkflowParameterResult = {
    resolutions,
    requiredCount: values.length,
    configuredCount,
    canEnterPreflight: !blocking,
    ready,
  };
  if (!ready) return result;

  return {
    ...result,
    resolvedWorkflow: {
      ...workflow,
      source: { ...workflow.source },
      steps: workflow.steps.map((step, index) => {
        const resolution = index >= startIndex ? resolutions[step.id] : undefined;
        if (step.type !== "fill" || resolution?.status !== "resolved") return step;
        return {
          ...step,
          payload: { value: resolution.value },
          parameterBinding: step.parameterBinding.source === "fixed"
            ? { ...step.parameterBinding }
            : step.parameterBinding,
        };
      }),
    },
  };
}
