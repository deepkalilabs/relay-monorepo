import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("Next.js configuration", () => {
  it("anchors Turbopack to the root Node workspace", () => {
    expect(nextConfig.turbopack?.root).toBe(path.resolve(__dirname, "../../.."));
  });
});
