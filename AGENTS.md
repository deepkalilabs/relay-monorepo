# Relay monorepo agent guide

This file is the repository-wide authority for Git safety, architectural review,
project routing, and verification. The repository is being normalized in the
merge-gated sequence recorded by
[`frontend/docs/decisions/0024-normalize-monorepo-layout-and-agent-tooling.md`](frontend/docs/decisions/0024-normalize-monorepo-layout-and-agent-tooling.md).
Until those moves land, treat the current paths below as the ownership boundaries.

## Read before changing files

- Recorder work under `frontend/`: read [`frontend/AGENTS.md`](frontend/AGENTS.md).
- API or backend-owned automation work under `backend/`: read
  [`backend/AGENTS.md`](backend/AGENTS.md).
- Shared root workspace or repository tooling work: follow this guide and also read
  every nested guide whose project is affected.

The nearest nested `AGENTS.md` adds project-specific constraints. It does not replace
the repository-wide policy in this file.

## Repository boundaries

- Keep recorder code, tests, documentation, and deployment files in `frontend/` until
  the approved application move.
- Keep API dependency management, migrations, contracts, automation packages,
  documentation, and deployment files in `backend/` until their approved moves.
- Keep repository-wide agent configuration, hooks, orchestration, and code-intelligence
  support under `.codex/`, `.githooks/`, `.ralphex/`, and `tooling/` at the root.
- Use the root Node workspace for cross-project orchestration. Retain project lockfiles
  and project-local deployment commands until the lockfile-consolidation PR.
- Do not extract or consolidate backend automation libraries as part of unrelated work.
- Keep accepted architectural decisions in their current owning decision directory
  until an approved move. Never edit or discard an accepted ADR; supersede it.
- Do not introduce application behavior, public API, OpenAPI, package export, CLI,
  environment-variable, port, or runtime-command changes during the layout refactor.

## Git authorization and safety

- Do not commit, push, rewrite history, merge, or create a pull request unless the user
  explicitly authorizes that action. Authorization for one action does not imply
  authorization for a different action.
- Autonomous-plan authorization covers only task-scoped commits in its isolated branch
  or worktree. `npm run ralph:run -- docs/plans/<path>.md` additionally authorizes that
  process to make non-force pushes only to its exact generated `codex/<slug>` branch.
  It never authorizes merging, rebasing, squashing, amending, force-pushing, or opening
  a pull request.
- Never bypass Git hooks with `--no-verify` or an equivalent mechanism.
- Before every authorized non-deletion branch push, inspect the complete committed
  branch diff and record the result with the root `npm run adr:review` command.
- Merging is always a human action unless the user separately and explicitly authorizes
  it.

## ADR review policy

An ADR is required when the branch introduces or changes an expensive-to-reverse choice
in persistence, public contracts, security, dependencies, deployment, runtime, service
boundaries, module boundaries, or ownership. Routine fixes, tests, formatting,
documentation corrections, mechanical refactors, and lockfile churn normally do not
need a new ADR.

For an architectural branch, write sequential ADRs in the current owning decision
directory and record every added ADR before push:

```sh
npm run adr:review -- \
  --adr frontend/docs/decisions/0024-normalize-monorepo-layout-and-agent-tooling.md \
  --reason "Records the reviewed repository ownership and layout decision."
```

For a routine branch with no architectural decision:

```sh
npm run adr:review -- --none --reason "Routine change; no architectural decision."
```

The review marker applies only to the reviewed local commit, comparison base, remote
branch, and expected remote tip. Any new commit or target change requires another
review. Install the tracked hook after cloning with `npm run hooks:install`.

## Verification routing

- Root tooling: `npm run test:tooling` plus the affected root command.
- Root Node workspace: `npm run typecheck` and the affected root test command.
- Recorder: run `npm run test:changed` from `frontend/`; if Vitest finds no affected
  tests, report that result instead of substituting the full suite.
- Backend API and backend-owned automation: run the checks in `backend/AGENTS.md`.
- Cross-project work: run every applicable project check.

Use the narrow checks during development and the complete checks required by the active
plan before an authorized push.
