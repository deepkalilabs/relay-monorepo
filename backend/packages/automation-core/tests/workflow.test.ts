import { describe, expect, it } from "vitest";
import conformance from "../../../../packages/workflow-contract/fixtures/conformance.json" with { type: "json" };
import { WorkflowSchema } from "../src/index.js";
import { locatorCandidatesForTarget, orderLocatorCandidates } from "../src/workflow.js";
import { clickStep, workflowWith } from "./fixtures.js";

type JsonContainer = Record<string, unknown> | unknown[];

function conformanceDocument(
  mutations: Array<{ path: Array<string | number>; value: unknown }>,
): unknown {
  const document = structuredClone(conformance.baseDocument) as JsonContainer;
  for (const mutation of mutations) {
    let target = document;
    for (const segment of mutation.path.slice(0, -1)) {
      target = target[segment as never] as JsonContainer;
    }
    target[mutation.path.at(-1) as never] = mutation.value as never;
  }
  return document;
}

describe("executable workflow contract", () => {
  it("accepts a strict executable action workflow", () => {
    expect(WorkflowSchema.parse(workflowWith([clickStep()]))).toEqual(workflowWith([clickStep()]));
  });

  it("defaults locator exactness and accepts any declared schema version", () => {
    const input = {
      ...workflowWith([clickStep()]),
      steps: [
        {
          ...clickStep(),
          target: { candidates: [{ kind: "testId" as const, value: "continue" }] },
        },
      ],
    };

    const parsed = WorkflowSchema.parse(input);
    expect(parsed.steps[0]?.target?.candidates).toEqual([
      { kind: "testId", value: "continue", exact: true },
    ]);
    expect(WorkflowSchema.parse({ ...input, schemaVersion: "1.1" }).schemaVersion).toBe("1.1");
    expect(WorkflowSchema.parse({ ...input, schemaVersion: "1.4" }).schemaVersion).toBe("1.4");
  });

  it("rejects non-UUID workflow IDs and unexpected properties", () => {
    expect(() => WorkflowSchema.parse({ ...workflowWith([clickStep()]), id: "workflow" })).toThrow();
    expect(() => WorkflowSchema.parse({ ...workflowWith([clickStep()]), unexpected: true })).toThrow();
  });

  it("accepts RFC 3339 timestamps with numeric offsets", () => {
    const workflow = workflowWith([clickStep()]);
    workflow.createdAt = "2026-07-31T13:00:00+01:00";
    workflow.updatedAt = "2026-07-31T13:05:00+01:00";
    workflow.finishedAt = "2026-07-31T13:05:00+01:00";
    workflow.steps[0]!.metadata.recordedAt = "2026-07-31T13:01:00+01:00";

    expect(WorkflowSchema.parse(workflow)).toEqual(workflow);
  });

  it("accepts assertions independently of the declared schema version", () => {
    const assertion = {
      ...clickStep(),
      type: "assertion" as const,
      expectation: { kind: "text_contains" as const, expected: "Ready for review" },
    };
    const workflow = { ...workflowWith([]), steps: [assertion] };

    expect(WorkflowSchema.parse(workflow)).toEqual(workflow);
    expect(WorkflowSchema.parse({ ...workflow, schemaVersion: "1.2" }).schemaVersion).toBe("1.2");
  });

  it("rejects blank, oversized, and action-only fields on assertions", () => {
    const assertion = {
      ...clickStep(),
      type: "assertion" as const,
      expectation: { kind: "text_contains" as const, expected: "Ready" },
    };
    const workflow = { ...workflowWith([]), steps: [assertion] };

    expect(() =>
      WorkflowSchema.parse({
        ...workflow,
        steps: [{ ...assertion, expectation: { kind: "text_contains", expected: "   " } }],
      }),
    ).toThrow();
    expect(() =>
      WorkflowSchema.parse({
        ...workflow,
        steps: [
          { ...assertion, expectation: { kind: "text_contains", expected: "a".repeat(1_001) } },
        ],
      }),
    ).toThrow();
    expect(() =>
      WorkflowSchema.parse({ ...workflow, steps: [{ ...assertion, waitAfter: { delayMs: 1 } }] }),
    ).toThrow();
  });
});

describe("shared executable conformance", () => {
  it.each(conformance.cases)("matches the executable result for $name", ({ mutations, expected }) => {
    expect(WorkflowSchema.safeParse(conformanceDocument(mutations)).success).toBe(
      expected.executable,
    );
  });
});

describe("locator candidates", () => {
  it("expands concise targets, removes duplicates, and orders semantic candidates first", () => {
    const candidates = locatorCandidatesForTarget({
      selector: "#continue",
      role: "button",
      name: "Continue",
      text: "Continue",
      candidates: [
        { kind: "css", value: "#continue", exact: true },
        { kind: "testId", value: "continue", exact: true },
      ],
    });

    expect(orderLocatorCandidates(candidates).map(({ kind }) => kind)).toEqual([
      "testId",
      "role",
      "text",
      "css",
    ]);
  });
});
