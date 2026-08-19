// @vitest-environment node

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const gateScript = join(
  projectRoot,
  "tooling",
  "repository",
  "adr-gate.mjs",
);
const prePushHook = join(projectRoot, ".githooks", "pre-push");
const zeroOid = "0".repeat(40);
const temporaryRoots: string[] = [];

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function execute(
  command: string,
  args: string[],
  cwd: string,
  input?: string,
): CommandResult {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", input });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function expectSuccess(result: CommandResult): void {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

function git(repo: string, ...args: string[]): string {
  const result = execute("git", args, repo);
  expectSuccess(result);
  return result.stdout.trim();
}

function writeRepoFile(repo: string, path: string, content: string): void {
  const absolute = join(repo, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function commitFile(
  repo: string,
  path: string,
  content: string,
  message: string,
): string {
  writeRepoFile(repo, path, content);
  git(repo, "add", path);
  git(repo, "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function runGate(
  repo: string,
  args: string[],
  input?: string,
): CommandResult {
  return execute(process.execPath, [gateScript, ...args], repo, input);
}

function pushLine(
  localOid: string,
  remoteOid = zeroOid,
  localRef = "refs/heads/feature",
  remoteRef = "refs/heads/feature",
): string {
  return `${localRef} ${localOid} ${remoteRef} ${remoteOid}\n`;
}

function createRepository(): {
  root: string;
  repo: string;
  remote: string;
} {
  const root = mkdtempSync(join(tmpdir(), "browser-replay-adr-gate-"));
  temporaryRoots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");

  mkdirSync(repo);
  expectSuccess(
    execute("git", ["init", "--bare", "--initial-branch=main", remote], root),
  );
  git(repo, "init", "--initial-branch=main");
  git(repo, "config", "user.name", "ADR Gate Test");
  git(repo, "config", "user.email", "adr-gate@example.test");
  writeRepoFile(repo, "README.md", "# Test repository\n");
  writeRepoFile(
    repo,
    "docs/decisions/0001-existing.md",
    "# ADR 0001: Existing decision\n",
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "--auto");
  git(repo, "switch", "-c", "feature");
  commitFile(repo, "feature.txt", "first\n", "add feature");
  return { root, repo, remote };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ADR pre-push gate", () => {
  it("reviews each owned ADR directory and installs the root hook", () => {
    const { repo } = createRepository();
    mkdirSync(join(repo, "frontend", "docs", "decisions"), { recursive: true });
    mkdirSync(join(repo, ".githooks"), { recursive: true });
    cpSync(prePushHook, join(repo, ".githooks", "pre-push"));
    commitFile(
      repo,
      "frontend/docs/decisions/0001-monorepo.md",
      "# ADR 0001: Nested frontend decision\n",
      "add nested decision",
    );

    expectSuccess(
      runGate(repo, [
        "review",
        "--adr",
        "frontend/docs/decisions/0001-monorepo.md",
        "--reason",
        "Records the nested project decision.",
      ]),
    );
    git(repo, "push", "-u", "origin", "feature");
    writeRepoFile(
      repo,
      "frontend/docs/decisions/0002-nested-execution.md",
      "# ADR 0002: Nested execution\n",
    );
    writeRepoFile(
      repo,
      "docs/decisions/0002-root-execution.md",
      "# ADR 0002: Root execution\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "-m", "add owned decisions");
    expectSuccess(
      runGate(join(repo, "frontend"), [
        "review",
        "--adr",
        "frontend/docs/decisions/0002-nested-execution.md",
        "--adr",
        "docs/decisions/0002-root-execution.md",
        "--reason",
        "Records decisions from both owning directories.",
      ]),
    );
    expectSuccess(runGate(repo, ["install"]));
    expect(git(repo, "config", "--get", "core.hooksPath")).toBe(".githooks");
  });

  it("accepts an exact routine branch review", () => {
    const { repo } = createRepository();
    expectSuccess(
      runGate(repo, [
        "review",
        "--none",
        "--reason",
        "Routine feature change.",
      ]),
    );
    const localOid = git(repo, "rev-parse", "HEAD");

    expectSuccess(
      runGate(
        repo,
        ["pre-push", "origin", "unused"],
        pushLine(localOid),
      ),
    );
  });

  it("rejects a review after the local branch advances", () => {
    const { repo } = createRepository();
    expectSuccess(
      runGate(repo, [
        "review",
        "--none",
        "--reason",
        "Routine feature change.",
      ]),
    );
    const advancedOid = commitFile(
      repo,
      "later.txt",
      "later\n",
      "advance branch",
    );

    const validation = runGate(
      repo,
      ["pre-push", "origin", "unused"],
      pushLine(advancedOid),
    );

    expect(validation.status).not.toBe(0);
    expect(`${validation.stdout}\n${validation.stderr}`).toContain(
      "Review the branch again",
    );
  });

  it("rejects a review when the remote target advanced", () => {
    const { root, repo, remote } = createRepository();
    git(repo, "push", "-u", "origin", "feature");
    commitFile(repo, "local.txt", "local\n", "local change");
    expectSuccess(
      runGate(repo, [
        "review",
        "--none",
        "--reason",
        "Routine feature change.",
      ]),
    );

    const other = join(root, "other");
    expectSuccess(execute("git", ["clone", remote, other], root));
    git(other, "config", "user.name", "Remote Test");
    git(other, "config", "user.email", "remote@example.test");
    git(other, "switch", "feature");
    const remoteOid = commitFile(
      other,
      "remote.txt",
      "remote\n",
      "remote advance",
    );
    git(other, "push", "origin", "feature");

    const validation = runGate(
      repo,
      ["pre-push", "origin", "unused"],
      pushLine(git(repo, "rev-parse", "HEAD"), remoteOid),
    );
    expect(validation.status).not.toBe(0);
    expect(`${validation.stdout}\n${validation.stderr}`).toContain(
      "remote branch changed",
    );
  });

  it("rejects a divergent update that drops an ADR from the remote tip", () => {
    const { root, repo, remote } = createRepository();
    git(repo, "push", "-u", "origin", "feature");
    commitFile(repo, "local.txt", "local\n", "local divergence");

    const other = join(root, "other");
    expectSuccess(execute("git", ["clone", remote, other], root));
    git(other, "config", "user.name", "Remote Test");
    git(other, "config", "user.email", "remote@example.test");
    git(other, "switch", "feature");
    commitFile(
      other,
      "docs/decisions/0002-remote-decision.md",
      "# ADR 0002: Remote decision\n",
      "record remote decision",
    );
    git(other, "push", "origin", "feature");
    git(repo, "fetch", "origin", "feature");

    const review = runGate(repo, [
      "review",
      "--none",
      "--reason",
      "Local change without the remote ADR.",
    ]);

    expect(review.status).not.toBe(0);
    expect(`${review.stdout}\n${review.stderr}`).toContain(
      "Accepted ADRs are immutable",
    );
  });

  it("requires every added ADR and rejects accepted ADR changes", () => {
    const { repo } = createRepository();
    commitFile(
      repo,
      "docs/decisions/0002-push-review.md",
      "# ADR 0002: Review before push\n",
      "record decision",
    );

    const missingAdr = runGate(repo, [
      "review",
      "--none",
      "--reason",
      "Incorrectly classified as routine.",
    ]);
    expect(missingAdr.status).not.toBe(0);
    expect(`${missingAdr.stdout}\n${missingAdr.stderr}`).toContain("added ADR");

    expectSuccess(
      runGate(repo, [
        "review",
        "--adr",
        "docs/decisions/0002-push-review.md",
        "--reason",
        "Records the push review boundary.",
      ]),
    );

    commitFile(
      repo,
      "docs/decisions/0001-existing.md",
      "# ADR 0001: Rewritten decision\n",
      "rewrite accepted ADR",
    );
    const changed = runGate(repo, [
      "review",
      "--adr",
      "docs/decisions/0002-push-review.md",
      "--reason",
      "Records the push review boundary.",
    ]);
    expect(changed.status).not.toBe(0);
    expect(`${changed.stdout}\n${changed.stderr}`).toContain(
      "Accepted ADRs are immutable",
    );
  });

  it("allows byte-identical ADR relocations and rejects changed moves", () => {
    const { repo } = createRepository();
    mkdirSync(join(repo, "apps", "browser-recorder", "docs", "decisions"), {
      recursive: true,
    });
    git(
      repo,
      "mv",
      "docs/decisions/0001-existing.md",
      "apps/browser-recorder/docs/decisions/0001-existing.md",
    );
    git(repo, "commit", "-m", "relocate accepted decision");

    expectSuccess(
      runGate(repo, [
        "review",
        "--none",
        "--reason",
        "Relocates an accepted ADR without changing its contents.",
      ]),
    );

    commitFile(
      repo,
      "apps/browser-recorder/docs/decisions/0001-existing.md",
      "# ADR 0001: Changed during relocation\n",
      "change relocated decision",
    );
    const changed = runGate(repo, [
      "review",
      "--none",
      "--reason",
      "Incorrectly changed an accepted ADR.",
    ]);

    expect(changed.status).not.toBe(0);
    expect(`${changed.stdout}\n${changed.stderr}`).toContain(
      "Accepted ADRs are immutable",
    );
  });

  it("allows remote branch deletion without a review", () => {
    const { repo } = createRepository();
    expectSuccess(
      runGate(
        repo,
        ["pre-push", "origin", "unused"],
        pushLine(
          zeroOid,
          git(repo, "rev-parse", "origin/main"),
          "(delete)",
          "refs/heads/obsolete",
        ),
      ),
    );
  });

  it("installs only an executable pre-push hook and leaves commits ungated", () => {
    expect(existsSync(prePushHook)).toBe(true);
    const { repo } = createRepository();
    mkdirSync(join(repo, ".githooks"), { recursive: true });
    mkdirSync(join(repo, "tooling", "repository"), { recursive: true });
    cpSync(prePushHook, join(repo, ".githooks", "pre-push"));
    cpSync(gateScript, join(repo, "tooling", "repository", "adr-gate.mjs"));

    expectSuccess(runGate(repo, ["install"]));
    expect(git(repo, "config", "--get", "core.hooksPath")).toBe(".githooks");
    const installedHook = join(repo, ".githooks", "pre-push");
    expect(readFileSync(installedHook).length).toBeGreaterThan(0);
    expect(statSync(installedHook).mode & 0o111).not.toBe(0);
    expect(() =>
      commitFile(repo, "after-install.txt", "commit\n", "commit without review"),
    ).not.toThrow();

    const unreviewedPush = execute(
      "git",
      ["push", "-u", "origin", "feature"],
      repo,
    );
    expect(unreviewedPush.status).not.toBe(0);
    expect(`${unreviewedPush.stdout}\n${unreviewedPush.stderr}`).toContain(
      "No ADR push review exists",
    );

    expectSuccess(
      runGate(repo, [
        "review",
        "--none",
        "--reason",
        "Routine feature change.",
      ]),
    );
    expectSuccess(execute("git", ["push", "-u", "origin", "feature"], repo));
  });

  it("denies Codex push commands that bypass hooks", () => {
    const { repo } = createRepository();
    const result = runGate(
      repo,
      ["codex-pre-tool"],
      JSON.stringify({
        tool_input: { cmd: "git push --no-verify origin feature" },
      }),
    );

    expectSuccess(result);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
  });
});
