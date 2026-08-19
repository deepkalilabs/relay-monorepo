// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertActivePlan,
  assertGeneratedBranch,
  expectedBranch,
  parseIncrements,
  ralphexPlanArgs,
  ralphexRunArgs,
  resolveProjectPlan,
  renderIncrementPlan,
} from "../ralph/ralph-loop.mjs";

const masterPlan = `# Add export

## Context

Keep the first version intentionally small.

### Increment 1: Export one workflow

- [ ] Add the export command
- [ ] Run npm run test:changed

### Increment 2: Document the command

- [ ] Add operator documentation
`;

describe("Ralph loop controls", () => {
  it("keeps plans under the repository docs path", () => {
    expect(
      resolveProjectPlan(
        "/workspace/relay",
        "/workspace/relay",
        "docs/plans/active/add-export.md",
      ),
    ).toEqual({
      absolute: "/workspace/relay/docs/plans/active/add-export.md",
      local: "docs/plans/active/add-export.md",
      projectLocal: "docs/plans/active/add-export.md",
    });
  });

  it("runs only named active plans", () => {
    expect(() =>
      assertActivePlan("docs/plans/active/add-export.md"),
    ).not.toThrow();
    expect(() =>
      assertActivePlan("docs/plans/archive/add-export.md"),
    ).toThrow("docs/plans/active");
    expect(() =>
      assertActivePlan("docs/handoffs/add-export.md"),
    ).toThrow("docs/plans/active");
  });

  it("derives a generated feature branch from the plan name", () => {
    expect(expectedBranch("docs/plans/active/Add Export.md")).toBe(
      "codex/add-export",
    );
  });

  it("rejects every branch outside the generated plan branch", () => {
    expect(() =>
      assertGeneratedBranch("main", "codex/add-export"),
    ).toThrow("refusing to operate");
    expect(() =>
      assertGeneratedBranch("codex/another-plan", "codex/add-export"),
    ).toThrow("refusing to operate");
    expect(() =>
      assertGeneratedBranch("codex/add-export", "codex/add-export"),
    ).not.toThrow();
  });

  it("renders only the selected increment as a Ralphex task", () => {
    const increments = parseIncrements(masterPlan);

    expect(increments).toHaveLength(2);
    expect(increments[0]?.title).toBe("Export one workflow");
    expect(renderIncrementPlan(masterPlan, increments[0]!)).toContain(
      "### Task 1: Export one workflow",
    );
    expect(renderIncrementPlan(masterPlan, increments[0]!)).not.toContain(
      "Document the command",
    );
  });

  it("uses Codex for interactive plan creation", () => {
    expect(ralphexPlanArgs("add CSV workflow export")).toEqual([
      "--codex",
      "--plan",
      "add CSV workflow export",
    ]);
  });

  it("uses Codex for task and native review execution", () => {
    const args = ralphexRunArgs(
      "codex/add-export",
      "abc123",
      "/private/increment-1.md",
    );

    expect(args).toContain("--codex");
    expect(args).not.toContain("--max-external-iterations");
    expect(args).not.toContain("--review-patience");
  });
});
