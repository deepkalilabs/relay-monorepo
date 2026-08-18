#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const VERSION = 2;
const ZERO_OID = "0".repeat(40);
const ADR_FILENAME_PATTERN = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: options.binary ? undefined : "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (options.allowFailure) return result;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `git ${args.join(" ")} failed`);
  }
  return options.binary ? result.stdout : result.stdout.trim();
}

function optionalGit(args) {
  const result = git(args, { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]);
}

function adrDirectory() {
  const nested = "frontend/docs/decisions";
  return existsSync(join(repoRoot(), nested)) ? nested : "docs/decisions";
}

function adrNumber(path, directory = adrDirectory()) {
  if (!path.startsWith(`${directory}/`)) return null;
  return ADR_FILENAME_PATTERN.exec(path.slice(directory.length + 1));
}

function stateRoot() {
  return git([
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "adr-gate",
  ]);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactCommit(input) {
  return git(["rev-parse", "--verify", "--end-of-options", `${input}^{commit}`]);
}

function parseNameStatus(buffer) {
  const fields = buffer.toString("utf8").split("\0");
  const entries = [];
  for (let index = 0; index < fields.length - 1; index += 2) {
    entries.push({ status: fields[index], path: fields[index + 1] });
  }
  return entries;
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function normalizeRepoPath(input) {
  const root = repoRoot();
  const absolute = resolve(root, input);
  const normalized = relative(root, absolute).split(sep).join("/");
  if (
    normalized === "" ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Path must be inside the repository: ${input}`);
  }
  return normalized;
}

function topLevelPathspec(path) {
  return `:(top)${path}`;
}

function normalizeRemoteRef(input) {
  const normalized = input.startsWith("refs/")
    ? input
    : `refs/heads/${input}`;
  if (!normalized.startsWith("refs/heads/")) {
    throw new Error(`ADR reviews target branches, not ${normalized}.`);
  }
  return normalized;
}

function reviewPath(remoteName, remoteRef) {
  return join(
    stateRoot(),
    "push-reviews",
    `${sha256(`${remoteName}\0${remoteRef}`)}.json`,
  );
}

function diffEntries(fromOid, toOid, paths = []) {
  return parseNameStatus(
    git(
      [
        "diff",
        "--name-status",
        "--no-renames",
        "-z",
        fromOid,
        toOid,
        "--",
        ...paths.map(topLevelPathspec),
      ],
      { binary: true },
    ),
  );
}

function branchState(baseOid, localOid) {
  const mergeBase = git(["merge-base", baseOid, localOid]);
  const diff = git(
    [
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-renames",
      mergeBase,
      localOid,
      "--",
    ],
    { binary: true },
  );
  return {
    mergeBase,
    diffSha256: sha256(diff),
    entries: diffEntries(mergeBase, localOid),
  };
}

function immutableAdrError(paths) {
  return new Error(
    `Accepted ADRs are immutable; supersede them with a new ADR instead: ${paths.join(", ")}`,
  );
}

function assertAcceptedAdrsUnchanged(state) {
  const directory = adrDirectory();
  const changed = state.entries
    .filter(
      (entry) =>
        entry.path.startsWith(`${directory}/`) && entry.status !== "A",
    )
    .map((entry) => entry.path);
  if (changed.length > 0) throw immutableAdrError(changed);
}

function assertRemoteAdrsPreserved(remoteOid, localOid) {
  if (remoteOid === ZERO_OID) return;
  const changed = diffEntries(remoteOid, localOid, [adrDirectory()])
    .filter((entry) => entry.status !== "A")
    .map((entry) => entry.path);
  if (changed.length > 0) throw immutableAdrError(changed);
}

function addedAdrPaths(state) {
  const directory = adrDirectory();
  return state.entries
    .filter(
      (entry) =>
        entry.status === "A" && entry.path.startsWith(`${directory}/`),
    )
    .map((entry) => {
      if (!adrNumber(entry.path, directory)) {
        throw new Error(
          `ADR path must match ${directory}/000N-lowercase-slug.md: ${entry.path}`,
        );
      }
      return entry.path;
    })
    .sort();
}

function trackedAdrNumbersAt(commit) {
  const directory = adrDirectory();
  const output = git([
    "ls-tree",
    "-r",
    "--full-tree",
    "--name-only",
    commit,
    "--",
    topLevelPathspec(directory),
  ]);
  if (!output) return [];
  return output
    .split("\n")
    .map((path) => adrNumber(path, directory))
    .filter(Boolean)
    .map((match) => Number(match[1]));
}

function validateAdrOutcome(paths, state) {
  const normalized = [...new Set(paths.map(normalizeRepoPath))].sort();
  if (normalized.length !== paths.length) {
    throw new Error("Duplicate --adr path.");
  }
  const added = addedAdrPaths(state);
  if (
    normalized.length !== added.length ||
    normalized.some((path, index) => path !== added[index])
  ) {
    throw new Error(
      `Every added ADR must be passed with --adr. Added ADRs: ${
        added.join(", ") || "none"
      }.`,
    );
  }

  const expectedStart =
    trackedAdrNumbersAt(state.mergeBase).reduce(
      (maximum, number) => Math.max(maximum, number),
      0,
    ) + 1;
  normalized
    .map((path) => Number(adrNumber(path)[1]))
    .sort((left, right) => left - right)
    .forEach((number, index) => {
      if (number !== expectedStart + index) {
        throw new Error(
          `ADR numbering must be contiguous from ${String(expectedStart).padStart(4, "0")}.`,
        );
      }
    });
  return normalized;
}

function validateReviewOutcome(options, state) {
  assertAcceptedAdrsUnchanged(state);
  const added = addedAdrPaths(state);
  if (options.none) {
    if (added.length > 0) {
      throw new Error(
        `The branch adds ADR files; use --adr for every added ADR: ${added.join(", ")}`,
      );
    }
    return [];
  }
  return validateAdrOutcome(options.adr, state);
}

function configValue(key) {
  return optionalGit(["config", "--get", key]);
}

function currentBranch() {
  const localRef = optionalGit(["symbolic-ref", "--quiet", "HEAD"]);
  if (!localRef?.startsWith("refs/heads/")) {
    throw new Error("ADR review requires a checked-out local branch.");
  }
  return {
    localRef,
    shortName: localRef.slice("refs/heads/".length),
  };
}

function resolveRemoteName(explicit, branchName) {
  return (
    explicit ||
    configValue(`branch.${branchName}.pushRemote`) ||
    configValue("remote.pushDefault") ||
    configValue(`branch.${branchName}.remote`) ||
    "origin"
  );
}

function remoteTrackingRef(remoteName, remoteRef) {
  return `refs/remotes/${remoteName}/${remoteRef.slice("refs/heads/".length)}`;
}

function resolveDefaultBase(remoteName) {
  const symbolic = optionalGit([
    "symbolic-ref",
    "--quiet",
    `refs/remotes/${remoteName}/HEAD`,
  ]);
  if (symbolic && optionalGit(["rev-parse", "--verify", symbolic])) {
    return symbolic;
  }
  for (const candidate of [
    `refs/remotes/${remoteName}/main`,
    `refs/remotes/${remoteName}/master`,
  ]) {
    if (optionalGit(["rev-parse", "--verify", candidate])) return candidate;
  }
  return null;
}

function resolveReviewTarget(options) {
  const branch = currentBranch();
  const remoteName = resolveRemoteName(options.remote, branch.shortName);
  const remoteRef = normalizeRemoteRef(options.remoteRef || branch.localRef);
  const trackingRef = remoteTrackingRef(remoteName, remoteRef);
  const trackedRemoteOid = optionalGit([
    "rev-parse",
    "--verify",
    `${trackingRef}^{commit}`,
  ]);
  const expectedRemoteOid = trackedRemoteOid || ZERO_OID;
  const baseRef =
    options.base ||
    (trackedRemoteOid ? trackingRef : resolveDefaultBase(remoteName));
  if (!baseRef) {
    throw new Error(
      `Cannot resolve a comparison base for new ${remoteRef}; pass --base <ref>.`,
    );
  }
  return {
    localRef: branch.localRef,
    localOid: exactCommit("HEAD"),
    remoteName,
    remoteRef,
    expectedRemoteOid,
    baseRef,
    baseOid: exactCommit(baseRef),
  };
}

function parseReviewOptions(args) {
  const parsed = {
    none: false,
    reason: null,
    adr: [],
    base: null,
    remote: null,
    remoteRef: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--none") parsed.none = true;
    else if (flag === "--reason") parsed.reason = args[++index];
    else if (flag === "--adr") parsed.adr.push(args[++index]);
    else if (flag === "--base") parsed.base = args[++index];
    else if (flag === "--remote") parsed.remote = args[++index];
    else if (flag === "--remote-ref") parsed.remoteRef = args[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!parsed.reason?.trim()) throw new Error("--reason must be non-empty.");
  if (
    parsed.adr.includes(undefined) ||
    parsed.base === undefined ||
    parsed.remote === undefined ||
    parsed.remoteRef === undefined
  ) {
    throw new Error("Missing argument value.");
  }
  if (parsed.none === (parsed.adr.length > 0)) {
    throw new Error("Choose exactly one outcome: --none or one or more --adr.");
  }
  return parsed;
}

function review(args) {
  const options = parseReviewOptions(args);
  const target = resolveReviewTarget(options);
  const state = branchState(target.baseOid, target.localOid);
  assertRemoteAdrsPreserved(target.expectedRemoteOid, target.localOid);
  const adrPaths = validateReviewOutcome(options, state);
  const marker = {
    version: VERSION,
    outcome: options.none ? "none" : "adr",
    reason: options.reason.trim(),
    adrPaths,
    ...target,
    mergeBase: state.mergeBase,
    diffSha256: state.diffSha256,
    reviewedAt: new Date().toISOString(),
  };
  atomicJson(reviewPath(target.remoteName, target.remoteRef), marker);
  console.log(
    `ADR push review recorded (${marker.outcome}) for ${target.remoteName}:${target.remoteRef} ` +
      `at ${target.localOid.slice(0, 12)} against ${target.baseRef}.`,
  );
}

function validatePushReview(remoteName, remoteRef, localOid, remoteOid) {
  const marker = readJson(reviewPath(remoteName, remoteRef));
  if (!marker || marker.version !== VERSION) {
    throw new Error(
      `No ADR push review exists for ${remoteName}:${remoteRef}. ` +
        'Run "npm run adr:review -- --none --reason \\"...\\"" or review added ADRs.',
    );
  }
  if (
    marker.remoteName !== remoteName ||
    marker.remoteRef !== remoteRef ||
    !["none", "adr"].includes(marker.outcome) ||
    !Array.isArray(marker.adrPaths)
  ) {
    throw new Error("The ADR push review marker is invalid. Review the branch again.");
  }
  if (marker.localOid !== localOid) {
    throw new Error(
      `The local branch changed after ADR review. Review the branch again before pushing ${remoteRef}.`,
    );
  }
  if (marker.expectedRemoteOid !== remoteOid) {
    throw new Error(
      `The remote branch changed after ADR review. Fetch ${remoteName}, then review the branch again.`,
    );
  }
  const state = branchState(marker.baseOid, localOid);
  if (
    marker.mergeBase !== state.mergeBase ||
    marker.diffSha256 !== state.diffSha256
  ) {
    throw new Error(
      `The reviewed committed diff changed. Review the branch again before pushing ${remoteRef}.`,
    );
  }
  assertRemoteAdrsPreserved(remoteOid, localOid);
  validateReviewOutcome(
    { none: marker.outcome === "none", adr: marker.adrPaths },
    state,
  );
}

function prePush(remoteName) {
  if (!remoteName) throw new Error("pre-push requires the remote name.");
  const input = readFileSync(0, "utf8").trim();
  if (!input) return;
  for (const line of input.split("\n")) {
    const [localRef, localOid, remoteRef, remoteOid] = line.trim().split(/\s+/);
    if (!localRef || !localOid || !remoteRef || !remoteOid) {
      throw new Error(`Invalid pre-push update line: ${line}`);
    }
    if (localOid === ZERO_OID || !remoteRef.startsWith("refs/heads/")) continue;
    validatePushReview(remoteName, remoteRef, localOid, remoteOid);
    console.log(
      `ADR push review verified for ${remoteName}:${remoteRef} at ${localOid.slice(0, 12)}.`,
    );
  }
}

function shellTokens(command) {
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;
  const flush = () => {
    if (token) tokens.push(token);
    token = "";
  };
  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      flush();
      if (character === "\n") tokens.push(";");
    } else if (";&|()".includes(character)) {
      flush();
      tokens.push(character);
    } else {
      token += character;
    }
  }
  flush();
  return tokens;
}

function gitInvocations(tokens) {
  const invocations = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== "git") continue;
    let cursor = index + 1;
    while (cursor < tokens.length && tokens[cursor].startsWith("-")) {
      if (["-C", "-c", "--git-dir", "--work-tree"].includes(tokens[cursor])) {
        cursor += 2;
      } else {
        cursor += 1;
      }
    }
    const end = tokens.findIndex(
      (value, tokenIndex) =>
        tokenIndex > cursor && ";&|()".includes(value),
    );
    invocations.push({
      subcommand: tokens[cursor],
      args: tokens.slice(cursor + 1, end === -1 ? tokens.length : end),
    });
  }
  return invocations;
}

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

function codexPreTool() {
  const text = readFileSync(0, "utf8");
  const input = text ? JSON.parse(text) : {};
  const command = input.tool_input?.command ?? input.tool_input?.cmd;
  if (typeof command !== "string") return;
  const pushes = gitInvocations(shellTokens(command)).filter(
    ({ subcommand }) => subcommand === "push",
  );
  const bypassed = pushes.some(({ args }) =>
    args.some(
      (argument) =>
        argument === "--no-verify" ||
        argument === "-n" ||
        (/^-[A-Za-z]+$/.test(argument) && argument.includes("n")),
    ),
  );
  if (bypassed) {
    deny(
      "Git push must run the repository pre-push ADR gate; --no-verify is forbidden.",
    );
  }
}

function install() {
  const root = repoRoot();
  const hooksPath = ".githooks";
  chmodSync(join(root, hooksPath, "pre-push"), 0o755);
  git(["config", "--local", "core.hooksPath", hooksPath], { cwd: root });
  console.log(
    `Installed repository pre-push ADR hook via core.hooksPath=${hooksPath}`,
  );
}

function usage() {
  throw new Error(
    "Usage: adr-gate.mjs <install|review|pre-push|codex-pre-tool>",
  );
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "install") install();
  else if (command === "review") review(args);
  else if (command === "pre-push") prePush(args[0]);
  else if (command === "codex-pre-tool") codexPreTool();
  else usage();
} catch (error) {
  console.error(`ADR gate: ${error.message}`);
  process.exitCode = 1;
}
