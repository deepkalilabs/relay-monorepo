#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_INTEL_HOST = "127.0.0.1";
const CODE_INTEL_PORT = 8765;
const GENERATED_BRANCH_PREFIX = "codex/";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ADR_DIRECTORIES = [
  "docs/decisions",
  "frontend/docs/decisions",
  "backend/docs/decisions",
];

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(detail || `${commandName} ${args.join(" ")} failed`);
  }
  return result;
}

function git(args, options = {}) {
  return (command("git", args, options).stdout ?? "").trim();
}

function repositoryRoot() {
  return git(["rev-parse", "--show-toplevel"]);
}

export function resolveProjectPlan(repositoryRoot, projectRoot, input) {
  const absolute = resolve(projectRoot, input);
  const projectLocal = relative(projectRoot, absolute).split(sep).join("/");
  if (
    !projectLocal ||
    projectLocal === ".." ||
    projectLocal.startsWith("../")
  ) {
    throw new Error(`Path must be inside the repository: ${input}`);
  }
  const local = relative(repositoryRoot, absolute).split(sep).join("/");
  if (!local || local === ".." || local.startsWith("../")) {
    throw new Error(`Project must be inside the repository: ${projectRoot}`);
  }
  return { absolute, local, projectLocal };
}

function slugForPlan(planPath) {
  const stem = basename(planPath, extname(planPath));
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`Plan filename has no usable slug: ${planPath}`);
  return slug;
}

export function expectedBranch(planPath) {
  return `${GENERATED_BRANCH_PREFIX}${slugForPlan(planPath)}`;
}

export function assertGeneratedBranch(currentBranch, generatedBranch) {
  if (
    !generatedBranch.startsWith(GENERATED_BRANCH_PREFIX) ||
    currentBranch !== generatedBranch
  ) {
    throw new Error(
      `refusing to operate on ${currentBranch}; expected ${generatedBranch}`,
    );
  }
}

export function parseIncrements(content) {
  const heading = /^### Increment ([1-9][0-9]*):[ \t]+(.+)$/gm;
  const matches = [...content.matchAll(heading)];
  if (matches.length === 0) {
    throw new Error(
      "Plan must contain at least one `### Increment N: title` section.",
    );
  }

  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    const body = content.slice(start, end).trim();
    if (!/^- \[ \] /m.test(body)) {
      throw new Error(`Increment ${match[1]} has no unchecked task items.`);
    }
    return {
      number: Number(match[1]),
      title: match[2].trim(),
      body,
      sourceStart: match.index,
    };
  });
}

export function renderIncrementPlan(masterContent, increment) {
  const firstIncrement = parseIncrements(masterContent)[0];
  const context = masterContent
    .slice(0, firstIncrement.sourceStart)
    .trim()
    .replace(/^- \[ \] /gm, "- ");
  return `${context}

### Task ${increment.number}: ${increment.title}

${increment.body}
`;
}

function defaultBranch(root) {
  const symbolic = command(
    "git",
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { cwd: root, allowFailure: true },
  );
  if (symbolic.status === 0) return symbolic.stdout.trim().replace("origin/", "");
  for (const candidate of ["main", "master", "trunk"]) {
    if (
      command("git", ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], {
        cwd: root,
        allowFailure: true,
      }).status === 0
    ) {
      return candidate;
    }
  }
  throw new Error("Cannot determine the default branch.");
}

function currentBranch(root) {
  return git(["branch", "--show-current"], { cwd: root });
}

function localBranchExists(root, branch) {
  return (
    command("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: root,
      allowFailure: true,
    }).status === 0
  );
}

function dirtyPaths(root) {
  return git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: root,
  })
    .split("\0")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function ensureFeatureBranch(root, plan, branch) {
  const active = currentBranch(root);
  if (active === branch) {
    assertGeneratedBranch(active, branch);
    return;
  }

  const base = defaultBranch(root);
  if (active !== base) {
    throw new Error(
      `Start a new plan from ${base}, or resume it from ${branch}; currently on ${active}.`,
    );
  }

  const unrelated = dirtyPaths(root).filter((path) => path !== plan.local);
  if (unrelated.length > 0) {
    throw new Error(
      `Worktree must be clean before starting a plan. Unrelated changes: ${unrelated.join(", ")}`,
    );
  }

  if (localBranchExists(root, branch)) {
    git(["switch", branch], { cwd: root, stdio: "inherit" });
  } else {
    git(["switch", "-c", branch], { cwd: root, stdio: "inherit" });
  }

  if (dirtyPaths(root).includes(plan.local)) {
    git(["add", "--", plan.local], { cwd: root });
    git(["commit", "-m", `docs: approve ${slugForPlan(plan.local)} plan`], {
      cwd: root,
      stdio: "inherit",
    });
  }
}

function assertClean(root) {
  const paths = dirtyPaths(root);
  if (paths.length > 0) {
    throw new Error(`Worktree is not clean: ${paths.join(", ")}`);
  }
}

function gitStateDirectory(root, slug) {
  const gitPath = git(["rev-parse", "--git-path", `ralph-loop/${slug}`], {
    cwd: root,
  });
  return resolve(root, gitPath);
}

function readState(path) {
  if (!existsSync(path)) return { completed: 0 };
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (!Number.isInteger(state.completed) || state.completed < 0) {
    throw new Error(`Invalid Ralph progress state: ${path}`);
  }
  return state;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function remoteOid(root, branch) {
  const result = command(
    "git",
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    { cwd: root },
  ).stdout.trim();
  return result ? result.split(/\s+/)[0] : null;
}

function fetchCheckpoint(root, featureBranch) {
  const remoteFeature = remoteOid(root, featureBranch);
  if (remoteFeature) {
    git(
      [
        "fetch",
        "--no-tags",
        "origin",
        `refs/heads/${featureBranch}:refs/remotes/origin/${featureBranch}`,
      ],
      { cwd: root, stdio: "inherit" },
    );
    return remoteFeature;
  }

  const base = defaultBranch(root);
  git(
    [
      "fetch",
      "--no-tags",
      "origin",
      `refs/heads/${base}:refs/remotes/origin/${base}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  return git(["rev-parse", `refs/remotes/origin/${base}`], { cwd: root });
}

function addedAdrs(root, checkpoint) {
  const output = git(
    [
      "diff",
      "--name-status",
      "--no-renames",
      checkpoint,
      "HEAD",
      "--",
      ...ADR_DIRECTORIES,
    ],
    { cwd: root },
  );
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([status]) => status === "A")
    .map(([, path]) => path)
    .sort();
}

function reviewAdrBoundary(root, branch, checkpoint) {
  const adrs = addedAdrs(root, checkpoint);
  const args = [
    "run",
    "adr:review",
    "--",
    "--remote",
    "origin",
    "--remote-ref",
    branch,
    "--base",
    checkpoint,
  ];
  if (adrs.length === 0) {
    args.push(
      "--none",
      "--reason",
      "Ralphex's Codex reviews found no architectural decision requiring an ADR.",
    );
  } else {
    for (const adr of adrs) args.push("--adr", adr);
    args.push(
      "--reason",
      "Records the architectural decisions in this reviewed increment.",
    );
  }
  command("npm", args, { cwd: PROJECT_ROOT, stdio: "inherit" });
}

function waitForPort(host, port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, rejectPromise) => {
    const attempt = () => {
      if (child.exitCode !== null) {
        rejectPromise(
          new Error(
            `Code-intelligence service exited with ${child.exitCode} before startup.`,
          ),
        );
        return;
      }
      const socket = createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          rejectPromise(
            new Error(`Code-intelligence service did not start on ${host}:${port}.`),
          );
        } else {
          setTimeout(attempt, 500);
        }
      });
    };
    attempt();
  });
}

async function startCodeIntel(root, stateDirectory) {
  const codeIntelRoot = resolve(root, "tooling/agent-code-intel");
  const codeIntelScript = resolve(codeIntelRoot, "ralph_code_intel.py");
  if (!existsSync(codeIntelScript)) {
    throw new Error(`Missing code-intelligence service: ${codeIntelScript}`);
  }
  const uv = command("uv", ["--version"], { allowFailure: true });
  if (uv.status !== 0) {
    throw new Error("Missing uv. Install uv before starting the Ralph loop.");
  }

  mkdirSync(stateDirectory, { recursive: true });
  const logPath = resolve(stateDirectory, "code-intel.log");
  const logHandle = openSync(logPath, "a", 0o600);
  const child = spawn("uv", [
    "run",
    "--directory",
    codeIntelRoot,
    "python",
    codeIntelScript,
  ], {
    cwd: root,
    detached: false,
    env: {
      ...process.env,
      RALPH_REPO_ROOT: root,
      RALPH_STATE_DIR: stateDirectory,
      RALPH_MCP_PORT: String(CODE_INTEL_PORT),
    },
    stdio: ["ignore", logHandle, logHandle],
  });
  closeSync(logHandle);
  child.once("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(
        `Code-intelligence service exited with ${code}; inspect ${logPath}.\n`,
      );
    }
  });
  try {
    await waitForPort(CODE_INTEL_HOST, CODE_INTEL_PORT, 180_000, child);
    return child;
  } catch (error) {
    if (!child.killed) child.kill("SIGTERM");
    throw error;
  }
}

export function ralphexRunArgs(branch, checkpoint, planPath) {
  return [
    "--codex",
    "--branch",
    branch,
    "--base-ref",
    checkpoint,
    "--session-timeout",
    "45m",
    "--idle-timeout",
    "10m",
    planPath,
  ];
}

function verifyCheckpoint(root, checkpoint) {
  const mergeBase = git(["merge-base", checkpoint, "HEAD"], { cwd: root });
  if (mergeBase !== checkpoint) {
    throw new Error(
      "Feature branch diverged from its reviewed checkpoint; refusing to push.",
    );
  }
}

function pushIncrement(root, branch, checkpoint) {
  assertGeneratedBranch(currentBranch(root), branch);
  verifyCheckpoint(root, checkpoint);
  reviewAdrBoundary(root, branch, checkpoint);
  git(["push", "origin", `HEAD:refs/heads/${branch}`], {
    cwd: root,
    stdio: "inherit",
  });
  const local = git(["rev-parse", "HEAD"], { cwd: root });
  const published = remoteOid(root, branch);
  if (published !== local) {
    throw new Error("Push returned successfully but the remote tip differs from HEAD.");
  }
}

async function runPlan(planInput) {
  const root = repositoryRoot();
  const plan = resolveProjectPlan(root, PROJECT_ROOT, planInput);
  assertActivePlan(plan.projectLocal);
  if (!existsSync(plan.absolute)) {
    throw new Error(`Plan does not exist: ${plan.local}`);
  }

  const content = readFileSync(plan.absolute, "utf8");
  const increments = parseIncrements(content);
  const slug = slugForPlan(plan.projectLocal);
  const branch = expectedBranch(plan.projectLocal);
  ensureFeatureBranch(root, plan, branch);
  assertGeneratedBranch(currentBranch(root), branch);
  assertClean(root);

  const stateDirectory = gitStateDirectory(root, slug);
  const statePath = resolve(stateDirectory, "state.json");
  const state = readState(statePath);
  const codeIntel = await startCodeIntel(PROJECT_ROOT, stateDirectory);

  const stopCodeIntel = () => {
    if (!codeIntel.killed) codeIntel.kill("SIGTERM");
  };
  process.once("exit", stopCodeIntel);
  process.once("SIGINT", () => {
    stopCodeIntel();
    process.exitCode = 130;
  });
  process.once("SIGTERM", () => {
    stopCodeIntel();
    process.exitCode = 143;
  });

  try {
    for (let index = state.completed; index < increments.length; index += 1) {
      const checkpoint = fetchCheckpoint(root, branch);
      verifyCheckpoint(root, checkpoint);
      const incrementPlan = resolve(stateDirectory, `increment-${index + 1}.md`);
      writeFileSync(
        incrementPlan,
        renderIncrementPlan(content, increments[index]),
        { mode: 0o600 },
      );

      command("ralphex", ralphexRunArgs(branch, checkpoint, incrementPlan), {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
      });
      assertGeneratedBranch(currentBranch(root), branch);
      assertClean(root);
      command("npm", ["run", "test:changed"], {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
      });

      const expectedRemote = remoteOid(root, branch);
      if (expectedRemote && expectedRemote !== checkpoint) {
        throw new Error(
          `Remote ${branch} moved from ${checkpoint} to ${expectedRemote}; refusing to push.`,
        );
      }
      pushIncrement(root, branch, checkpoint);
      writeJsonAtomic(statePath, {
        completed: index + 1,
        branch,
        lastPublished: git(["rev-parse", "HEAD"], { cwd: root }),
      });
    }
  } finally {
    stopCodeIntel();
  }
}

export function assertActivePlan(planPath) {
  if (
    !planPath.startsWith("docs/plans/active/") ||
    extname(planPath) !== ".md"
  ) {
    throw new Error(
      "Runnable master plans must be Markdown files under docs/plans/active/.",
    );
  }
}

export function ralphexPlanArgs(description) {
  return ["--codex", "--plan", description];
}

function createPlan(description) {
  if (!description) {
    throw new Error('Usage: npm run ralph:plan -- "<goal>"');
  }
  command("ralphex", ralphexPlanArgs(description), {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "plan") {
    createPlan(args.join(" ").trim());
    return;
  }
  if (action === "run") {
    if (args.length !== 1) {
      throw new Error(
        "Usage: npm run ralph:run -- docs/plans/active/<slug>.md",
      );
    }
    await runPlan(args[0]);
    return;
  }
  throw new Error("Usage: ralph-loop.mjs <plan|run> [arguments]");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Ralph loop: ${error.message}\n`);
    process.exitCode = 1;
  });
}
