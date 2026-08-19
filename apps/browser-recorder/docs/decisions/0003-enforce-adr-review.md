# ADR 0003: Enforce ADR review before every commit

- Status: Accepted
- Date: 2026-07-28

## Context

Codex and human contributors can make architectural decisions while working through otherwise routine repository changes. Written guidance alone does not ensure that the exact staged change was reviewed, and Git commit hooks alone provide poor remediation context to an active Codex agent.

The repository needs a local, deterministic review gate without calling a model, generating documentation automatically, or storing review metadata in tracked files.

## Decision

Require every commit to have an ADR review marker bound to the current `HEAD` and exact staged index state. Architectural changes include one or more newly added ADRs; routine changes record a justified `none` outcome.

Use three cooperating layers:

- `AGENTS.md` defines the durable decision thresholds and commit workflow.
- Repository-local Codex `PreToolUse` and `Stop` command hooks provide early denial and one-pass remediation guidance.
- Tracked Git pre-commit and post-commit hooks enforce the marker and store commit audit records.

Keep transient reviews and audits beneath Git's resolved private path. Accepted ADRs are immutable; changed decisions receive a new, superseding ADR. A bypassed commit is never amended automatically: routine bypasses require explicit retroactive review, while architectural bypasses require a reviewed follow-up ADR.

## Consequences

- Human and Codex commits use the same fail-closed Git gate.
- Changing `HEAD` or staged content invalidates the current review.
- Contributors must install the tracked hooks and trust the Codex lifecycle hooks before relying on enforcement.
- Git hook bypasses cannot be prevented universally, but post-commit auditing makes them visible and requires explicit remediation.
- The gate adds no runtime dependency, model call, generated ADR, or automated commit.
