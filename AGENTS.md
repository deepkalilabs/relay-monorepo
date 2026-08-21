# Relay monorepo agent guide

This file is the repository-wide authority for Git safety, architectural review,
project routing, and verification. The repository layout is governed by
[`apps/browser-recorder/docs/decisions/0024-normalize-monorepo-layout-and-agent-tooling.md`](apps/browser-recorder/docs/decisions/0024-normalize-monorepo-layout-and-agent-tooling.md).

## Read before changing files

- Read [`NAVIGATION.md`](NAVIGATION.md) for the current ownership graph, runtime flows,
  entry points, and sources-of-truth order.
- Recorder work under `apps/browser-recorder/`: read [`apps/browser-recorder/AGENTS.md`](apps/browser-recorder/AGENTS.md).
- API work under `apps/relay-api/`: read
  [`apps/relay-api/AGENTS.md`](apps/relay-api/AGENTS.md).
- Browserbase execution-service work under `apps/automation-service-browserbase/`: read
  [`apps/automation-service-browserbase/AGENTS.md`](apps/automation-service-browserbase/AGENTS.md).
- Shared root workspace or repository tooling work: follow this guide and also read
  every nested guide whose project is affected.

The nearest nested `AGENTS.md` adds project-specific constraints. It does not replace
the repository-wide policy in this file.

## Repository boundaries

- Keep recorder code, tests, documentation, and deployment files in
  `apps/browser-recorder/`.
- Keep API dependency management, migrations, contracts, documentation, and deployment
  files in `apps/relay-api/`.
- Keep the Browserbase execution service in `apps/automation-service-browserbase/` and
  shared libraries in their owning root `packages/` directories.
- Keep repository-wide agent configuration, hooks, and repository tooling under
  `.codex/`, `.githooks/`, and `tooling/` at the root.
- Run Node installation only from the repository root with `npm ci`. The root
  `package-lock.json` is the only Node lockfile; use workspace commands instead of
  adding project-local lockfiles or install flows.
- Do not merge application and shared-package ownership as part of unrelated work.
- Keep accepted architectural decisions in their current owning decision directory
  until an approved move. Never edit or discard an accepted ADR; supersede it.
- Do not introduce application behavior, public API, OpenAPI, package export, CLI,
  environment-variable, port, or runtime-command changes during the layout refactor.

## Git authorization and safety

- Do not commit, push, rewrite history, merge, or create a pull request unless the user
  explicitly authorizes that action. Authorization for one action does not imply
  authorization for a different action.
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
  --adr apps/browser-recorder/docs/decisions/0025-example-decision.md \
  --reason "Records the reviewed architectural decision."
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
- Root-only installation and lockfile ownership: `npm run verify:locks`.
- Recorder: run `npm run test:changed` from `apps/browser-recorder/`; if Vitest finds no
  affected tests, report that result instead of substituting the full suite.
- Automation service: run the checks in
  `apps/automation-service-browserbase/AGENTS.md`.
- API and API-owned integration checks: run the checks in `apps/relay-api/AGENTS.md`.
- Cross-project work: run every applicable project check.

Use the narrow checks during development and the complete checks required by the active
plan before an authorized push.
