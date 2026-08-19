import { describe, expect, it } from "vitest";
import {
  autoMapParameters,
  rebaseParameterBindings,
} from "@/features/workflow-library";
import type { Profile } from "@/shared/contracts/profile";
import type { FillStep, Workflow } from "@/shared/contracts/workflow";
import {
  resolveWorkflowParameters,
} from "@/shared/contracts/workflow/parameters";
import { createWorkflow } from "@/shared/contracts/workflow/schema";

const recordedAt = "2026-07-29T12:00:00.000Z";

function fill(
  id: string,
  name: string,
  binding: FillStep["parameterBinding"],
  value = `recorded-${id}`,
): FillStep {
  return {
    id,
    order: 0,
    name,
    enabled: true,
    type: "fill",
    page: { id: "page-1", url: "https://example.com" },
    target: {
      name,
      candidates: [{ kind: "label", value: name, exact: true }],
    },
    payload: { value },
    parameterBinding: binding,
    metadata: { recordedAt, origin: "recorded", sensitive: false },
  };
}

function parameterWorkflow(...steps: FillStep[]): Workflow {
  const workflow = createWorkflow("session-1");
  workflow.steps = steps.map((step, order) => ({ ...step, order }));
  return workflow;
}

const profile: Profile = {
  schemaVersion: "1.1",
  id: "8a290bc7-a58d-44ca-9009-24b531126aef",
  name: "Ready profile",
  identity: {
    fullName: "Alex Morgan",
    email: "alex@example.com",
  },
  location: {
    countryRegion: "United States",
    postalCode: "94107",
  },
  status: "ready",
  revision: 1,
  createdAt: recordedAt,
  updatedAt: recordedAt,
};

describe("workflow parameter resolution", () => {
  it("resolves recorded, fixed, profile, and runtime sources into an ephemeral workflow", () => {
    const source = parameterWorkflow(
      fill("recorded", "Recorded", { source: "recorded" }),
      fill("fixed", "Fixed", { source: "fixed", value: "Fixed Person" }),
      fill("profile", "Email", { source: "profile", field: "identity.email" }),
      fill("runtime", "Reference", { source: "runtime" }),
    );
    const before = structuredClone(source);

    const result = resolveWorkflowParameters(source, {
      profile,
      runtimeValues: { runtime: "RUN-42" },
    });

    expect(result).toMatchObject({
      requiredCount: 4,
      configuredCount: 4,
      canEnterPreflight: true,
      ready: true,
    });
    expect(result.resolutions).toMatchObject({
      recorded: { status: "resolved", value: "recorded-recorded" },
      fixed: { status: "resolved", value: "Fixed Person" },
      profile: { status: "resolved", value: "alex@example.com" },
      runtime: { status: "resolved", value: "RUN-42" },
    });
    expect(result.resolvedWorkflow?.steps.map((step) => (
      step.type === "fill" ? step.payload.value : ""
    ))).toEqual(["recorded-recorded", "Fixed Person", "alex@example.com", "RUN-42"]);
    expect(source).toEqual(before);
  });

  it("reports ordinary missing inputs without throwing", () => {
    const source = parameterWorkflow(
      fill("fixed", "Fixed", { source: "fixed", value: "" }),
      fill("profile", "Postal code", { source: "profile", field: "location.postalCode" }),
      fill("runtime", "Reference", { source: "runtime" }),
    );
    const draftProfile = {
      ...profile,
      location: { ...profile.location, postalCode: "" },
      status: "draft" as const,
    };

    const result = resolveWorkflowParameters(source, { profile: draftProfile });

    expect(result.resolutions).toEqual({
      fixed: { status: "missing-fixed" },
      profile: {
        status: "missing-profile",
        field: "location.postalCode",
      },
      runtime: { status: "runtime-required" },
    });
    expect(result).toMatchObject({
      requiredCount: 3,
      configuredCount: 0,
      canEnterPreflight: false,
      ready: false,
    });
    expect(result.resolvedWorkflow).toBeUndefined();
  });

  it("ignores disabled and pre-range inputs", () => {
    const before = fill("before", "Before", { source: "fixed", value: "" });
    const start = fill("start", "Start", { source: "recorded" });
    const disabled = { ...fill("disabled", "Disabled", { source: "fixed", value: "" }), enabled: false };
    const source = parameterWorkflow(before, start, disabled);

    const result = resolveWorkflowParameters(source, { startStepId: "start" });

    expect(result.requiredCount).toBe(1);
    expect(result.configuredCount).toBe(1);
    expect(result.resolutions).toEqual({
      start: { status: "resolved", value: "recorded-start" },
    });
    expect(result.ready).toBe(true);
  });

  it("rejects oversized runtime input without copying it into the workflow", () => {
    const source = parameterWorkflow(fill("runtime", "Reference", { source: "runtime" }));
    const result = resolveWorkflowParameters(source, {
      runtimeValues: { runtime: "a".repeat(10_001) },
    });

    expect(result.resolutions.runtime).toEqual({ status: "invalid-runtime" });
    expect(result.resolvedWorkflow).toBeUndefined();
  });
});

describe("workflow parameter auto-map", () => {
  it("maps unique whole-token aliases on recorded rows", () => {
    const source = parameterWorkflow(
      fill("name", "Enter your full name", { source: "recorded" }),
      fill("email", "Contact", { source: "recorded" }),
      fill("postal", "Shipping postcode", { source: "recorded" }),
    );
    const emailStep = source.steps[1];
    if (emailStep?.type === "fill") {
      emailStep.target = {
        ...emailStep.target,
        name: "Email address",
      };
    }

    const mapped = autoMapParameters(source);

    expect(mapped.steps.map((step) => step.type === "fill" ? step.parameterBinding : null)).toEqual([
      { source: "profile", field: "identity.fullName" },
      { source: "profile", field: "identity.email" },
      { source: "profile", field: "location.postalCode" },
    ]);
  });

  it("preserves non-recorded choices and ambiguous recorded rows", () => {
    const source = parameterWorkflow(
      fill("fixed", "Email", { source: "fixed", value: "fixed@example.com" }),
      fill("runtime", "Postal code", { source: "runtime" }),
      fill("ambiguous", "Email and postal code", { source: "recorded" }),
    );

    const mapped = autoMapParameters(source);

    expect(mapped.steps.map((step) => step.type === "fill" ? step.parameterBinding : null)).toEqual([
      { source: "fixed", value: "fixed@example.com" },
      { source: "runtime" },
      { source: "recorded" },
    ]);
    expect(mapped).not.toBe(source);
  });

  it("does not treat structural selectors as accessible target labels", () => {
    const source = parameterWorkflow(fill("selector", "Contact detail", { source: "recorded" }));
    const step = source.steps[0];
    if (step?.type === "fill") {
      step.target = {
        candidates: [
          { kind: "testId", value: "email", exact: true },
          { kind: "css", value: "#email", exact: true },
        ],
      };
    }

    expect(autoMapParameters(source).steps[0]).toMatchObject({
      parameterBinding: { source: "recorded" },
    });
  });
});

describe("parameter binding conflict rebase", () => {
  it("preserves unrelated remote changes and reapplies non-overlapping local bindings", () => {
    const base = parameterWorkflow(
      fill("name", "Full name", { source: "recorded" }),
      fill("email", "Email", { source: "recorded" }),
    );
    const local = structuredClone(base);
    const latest = structuredClone(base);
    local.steps[0] = {
      ...(local.steps[0] as FillStep),
      parameterBinding: { source: "profile", field: "identity.fullName" },
    } as FillStep;
    latest.name = "Renamed remotely";
    latest.revision = 2;
    latest.steps[1] = {
      ...(latest.steps[1] as FillStep),
      parameterBinding: { source: "profile", field: "identity.email" },
    } as FillStep;

    const rebased = rebaseParameterBindings(base, local, latest);

    expect(rebased.conflicts).toEqual([]);
    expect(rebased.workflow.name).toBe("Renamed remotely");
    expect(rebased.workflow.revision).toBe(2);
    expect(rebased.workflow.steps.map((step) => step.type === "fill" ? step.parameterBinding : null)).toEqual([
      { source: "profile", field: "identity.fullName" },
      { source: "profile", field: "identity.email" },
    ]);
  });

  it("reports true same-row overlaps without overwriting the saved binding", () => {
    const base = parameterWorkflow(fill("email", "Email", { source: "recorded" }));
    const local = structuredClone(base);
    const latest = structuredClone(base);
    local.steps[0] = {
      ...(local.steps[0] as FillStep),
      parameterBinding: { source: "profile", field: "identity.email" },
    } as FillStep;
    latest.steps[0] = {
      ...(latest.steps[0] as FillStep),
      parameterBinding: { source: "runtime" },
    } as FillStep;

    const rebased = rebaseParameterBindings(base, local, latest);

    expect(rebased.workflow.steps[0]).toMatchObject({
      parameterBinding: { source: "runtime" },
    });
    expect(rebased.conflicts).toEqual([{
      stepId: "email",
      local: { source: "profile", field: "identity.email" },
      saved: { source: "runtime" },
    }]);
  });

  it("preserves a remote step deletion instead of creating an unresolvable row conflict", () => {
    const base = parameterWorkflow(fill("email", "Email", { source: "recorded" }));
    const local = structuredClone(base);
    local.steps[0] = {
      ...(local.steps[0] as FillStep),
      parameterBinding: { source: "profile", field: "identity.email" },
    } as FillStep;
    const latest = { ...structuredClone(base), revision: 2, steps: [] };

    const rebased = rebaseParameterBindings(base, local, latest);

    expect(rebased.workflow.steps).toEqual([]);
    expect(rebased.conflicts).toEqual([]);
  });
});
