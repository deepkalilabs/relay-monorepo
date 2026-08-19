import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/conformance.json" with { type: "json" };
import {
  CompatibleWorkflowSchema,
  ExecutableWorkflowSchema,
  WorkflowSchema,
  orderLocatorCandidates,
  repeatedGroupSimilarity,
  type PageTextContainsAssertionStep,
  type RepeatedGroupTemplate,
} from "../src/index.js";

const timestamp = "2026-07-29T12:00:00.000Z";

function groupTemplate(tokens = ["0:article:article", "1:header:"]): RepeatedGroupTemplate {
  return {
    version: 1,
    algorithm: "structural-token-v1",
    root: { tagName: "article", role: "article", sharedClasses: ["profile-card"] },
    structureTokens: tokens,
    capturedMatchCount: 2,
  };
}

function workflow(schemaVersion: string) {
  return {
    schemaVersion,
    id: "4a3f63dd-c98b-4b3a-b452-5f2aa76022cf",
    name: "Shared replay input",
    status: "complete",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: timestamp,
    source: {
      provider: "browserbase",
      sessionId: "session-1",
      startUrl: "https://example.com",
    },
    steps: [{
      id: "assert-group",
      order: 0,
      name: "Profiles exist",
      enabled: true,
      page: { id: "page-1", url: "https://example.com" },
      groupTarget: groupTemplate(),
      expectation: { kind: "group_exists" },
      metadata: { recordedAt: timestamp, origin: "manual", sensitive: false },
      type: "assertion",
    }],
  };
}

describe("shared replay input contract", () => {
  it("uses schema 1.5 for the complete canonical step union", () => {
    expect(WorkflowSchema.parse(workflow("1.5"))).toMatchObject({ schemaVersion: "1.5" });
  });

  it("normalizes supported historical frontend documents only at the compatibility boundary", () => {
    expect(CompatibleWorkflowSchema.parse(workflow("1.2"))).toMatchObject({ schemaVersion: "1.5" });
    expect(CompatibleWorkflowSchema.parse(workflow("1.4"))).toMatchObject({ schemaVersion: "1.5" });
  });

  it("accepts only a targetless page-text assertion shape", () => {
    const step: PageTextContainsAssertionStep = {
      id: "assert-page-text",
      order: 0,
      name: "John Snow exists",
      enabled: true,
      page: { id: "page-1", url: "https://example.com" },
      expectation: { kind: "page_text_contains", expected: "John Snow" },
      metadata: { recordedAt: timestamp, origin: "manual", sensitive: false },
      type: "assertion",
    };

    expect(WorkflowSchema.safeParse({ ...workflow("1.5"), steps: [step] }).success).toBe(true);
    for (const forbidden of [
      { target: { selector: "body" } },
      { groupTarget: groupTemplate() },
      { position: { x: 0, y: 0 } },
      { waitAfter: { delayMs: 1 } },
    ]) {
      expect(WorkflowSchema.safeParse({
        ...workflow("1.5"),
        steps: [{ ...step, ...forbidden }],
      }).success).toBe(false);
    }
  });

  it("treats the version label as opaque at the executable boundary", () => {
    expect(ExecutableWorkflowSchema.parse(workflow("future-recorder-version"))).toMatchObject({
      schemaVersion: "future-recorder-version",
    });
  });

  it("keeps canonical and executable documents strict", () => {
    expect(WorkflowSchema.safeParse({ ...workflow("1.5"), unexpected: true }).success).toBe(false);
    expect(ExecutableWorkflowSchema.safeParse({ ...workflow("future"), unexpected: true }).success).toBe(false);
  });

  it("owns deterministic locator ordering and repeated-group matching", () => {
    expect(orderLocatorCandidates([
      { kind: "xpath", value: "//button", exact: true },
      { kind: "testId", value: "save", exact: true },
      { kind: "role", value: "button", exact: true },
    ]).map(({ kind }) => kind)).toEqual(["testId", "role", "xpath"]);

    expect(repeatedGroupSimilarity(
      groupTemplate(["a", "b", "c", "d", "e", "f", "g"]),
      groupTemplate(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]),
    )).toEqual({ score: 0.7, matches: true });
  });
});

type JsonContainer = Record<string, unknown> | unknown[];

function fixtureDocument(mutations: Array<{ path: Array<string | number>; value: unknown }>): unknown {
  const document = structuredClone(fixtures.baseDocument) as JsonContainer;
  for (const mutation of mutations) {
    let target = document;
    for (const segment of mutation.path.slice(0, -1)) {
      target = target[segment as never] as JsonContainer;
    }
    target[mutation.path.at(-1) as never] = mutation.value as never;
  }
  return document;
}

describe("shared conformance fixtures", () => {
  it.each(fixtures.cases)("matches every TypeScript boundary for $name", ({ mutations, expected }) => {
    const document = fixtureDocument(mutations);
    const canonical = WorkflowSchema.safeParse(document);
    const compatible = CompatibleWorkflowSchema.safeParse(document);
    const executable = ExecutableWorkflowSchema.safeParse(document);

    expect(canonical.success).toBe(expected.canonical);
    expect(compatible.success).toBe(expected.compatible);
    expect(executable.success).toBe(expected.executable);
    expect(compatible.success ? compatible.data.schemaVersion : null).toBe(expected.normalizedVersion);
  });
});
