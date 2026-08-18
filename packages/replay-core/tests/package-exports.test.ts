// @ts-expect-error Vitest supplies the Node runtime; replay-core intentionally omits Node types.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("workspace package exports", () => {
  it("loads replay-core and its workflow contract from a CommonJS server", () => {
    expect(() => require("@relay/workflow-contract")).not.toThrow();
    expect(() => require("@relay/replay-core")).not.toThrow();
  });
});
