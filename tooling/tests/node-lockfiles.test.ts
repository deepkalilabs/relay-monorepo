// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const verificationScript = join(
  projectRoot,
  "tooling",
  "repository",
  "verify-node-lockfiles.mjs",
);
const temporaryRoots: string[] = [];

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "relay-node-lockfiles-"));
  temporaryRoots.push(root);
  const result = spawnSync("git", ["init", "--initial-branch=main"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return root;
}

function track(repo: string, path: string): void {
  const absolutePath = join(repo, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, "{}\n");
  const result = spawnSync("git", ["add", path], {
    cwd: repo,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
}

function verify(repo: string) {
  return spawnSync(process.execPath, [verificationScript], {
    cwd: repo,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Node lockfile verification", () => {
  it("accepts exactly one root lockfile", () => {
    const repo = createRepository();
    track(repo, "package-lock.json");

    const result = verify(repo);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("package-lock.json");
  });

  it("rejects a nested tracked lockfile", () => {
    const repo = createRepository();
    track(repo, "package-lock.json");
    track(repo, "apps/example/package-lock.json");

    const result = verify(repo);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("apps/example/package-lock.json");
  });

  it("rejects a missing root lockfile", () => {
    const repo = createRepository();

    const result = verify(repo);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exactly package-lock.json");
  });
});
