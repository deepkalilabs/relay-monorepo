# Relay

Relay is a multi-project monorepo containing the Browser Memory Recorder frontend and
the Relay persistence and automation backend. A private root npm workspace and its
single root lockfile coordinate every Node project without changing application or
deployment ownership.

## Projects

| Project | Purpose | Documentation |
| --- | --- | --- |
| [`apps/browser-recorder/`](apps/browser-recorder/) | Next.js application, local BFF, recorder WebSocket, and interactive replay | [`apps/browser-recorder/README.md`](apps/browser-recorder/README.md) |
| [`apps/relay-api/`](apps/relay-api/) | FastAPI persistence API and authenticated automation gateway | [`apps/relay-api/README.md`](apps/relay-api/README.md) |
| [`apps/automation-service-browserbase/`](apps/automation-service-browserbase/) | Private Browserbase execution service | [`apps/automation-service-browserbase/README.md`](apps/automation-service-browserbase/README.md) |

The root Node workspace owns installation, locking, cross-project builds, and
verification. Run `npm ci` only from the repository root; app and package directories
do not own Node lockfiles. Python remains independently managed under
`apps/relay-api/`.

The shared replay input contract lives in
[`packages/workflow-contract/`](packages/workflow-contract/), and provider-neutral
Playwright phases live in [`packages/replay-core/`](packages/replay-core/). Both are
consumed through the root workspace. Automation-core delegates execution to replay-core
from its root-owned package.

Install and verify all current Node workspaces:

```bash
nvm use
npm ci
npm run typecheck
npm run test:automation
npm run test:changed
npm run test:tooling
npm run verify:locks
```

Build both deployment images from the repository root:

```bash
docker build -f apps/relay-api/Dockerfile -t relay-api .
docker build -f apps/automation-service-browserbase/Dockerfile -t relay-automation .
```

The `development` Railway environment is defined project-wide in
[`/.railway/railway.ts`](.railway/railway.ts). It provisions the recorder, Relay API,
private Browserbase automation service, PostgreSQL, and workflow bucket from the
protected `development` branch. See [the Railway runbook](.railway/README.md) for the
plan, apply, and smoke-test workflow.

## Repository agent workflow

Read the root [`AGENTS.md`](AGENTS.md) and then the nearest project guide before making
changes. Repository-wide Codex, hook, Ralph, ADR-gate, and code-intelligence support is
owned by [`.codex/`](.codex/), [`.githooks/`](.githooks/), [`.ralphex/`](.ralphex/), and
[`tooling/`](tooling/).

From the repository root:

```bash
uv sync --directory tooling/agent-code-intel
npm run hooks:install
npm run ralph:plan -- "add a small feature"
npm run ralph:run -- docs/plans/active/<slug>.md
npm run adr:review -- --none --reason "Routine change; no architectural decision."
```

Active plans, archived plans, handoffs, and the workflow specifications are indexed in
[`docs/README.md`](docs/README.md). Runtime-generated agent state is ignored and must not
be used as durable project context.

## Quick start

Start the frontend:

```bash
npm ci
cp apps/browser-recorder/.env.example apps/browser-recorder/.env.local
npm run dev --workspace browser-memory-recorder
```

Start the persistence API:

```bash
cd apps/relay-api
cp .env.example .env
uv sync --extra dev
docker compose up -d --wait postgres
uv run alembic upgrade head
uv run uvicorn relay_backend.main:app --reload --no-access-log
```

The Browserbase automation libraries live under [`packages/`](packages/), and the
deployable execution service lives under
[`apps/automation-service-browserbase/`](apps/automation-service-browserbase/).
Automation-core preserves its fail-fast public facade and privacy-safe results while
delegating provider-neutral behavior to the shared replay engine. The frontend keeps
its interactive state machine and delegates the same provider-neutral phases to
replay-core.

Recorder scripts may run through its root workspace or from `apps/browser-recorder/`
after the root install. API commands use `apps/relay-api/` as their working directory.
Both Docker images use the repository root as their build context so they can consume
sibling packages and contracts.

## Contributing

Read [`AGENTS.md`](AGENTS.md) and the nearest nested guide before changing a project.
Keep the root `package-lock.json` as the only Node lockfile and use semver ranges for
local `@relay/*` workspace dependencies. The fast project-specific commands remain
available, while the complete repository gate runs from the root after PostgreSQL is
ready:

```bash
docker compose -f apps/relay-api/compose.yaml up -d --wait postgres
npm run verify:all
```

Use `npm run verify:recorder`, `npm run verify:api`, or
`npm run verify:automation` for an owning-project gate, and `npm run verify:locks` to
check root-only Node lockfile ownership.

## Repository decisions

Application documentation remains within its owning directory, while repository-wide
plans and agent workflows live under [`docs/`](docs/). The decision to adopt the current
layout is recorded in
[`apps/browser-recorder/docs/decisions/0019-use-a-multi-project-monorepo.md`](apps/browser-recorder/docs/decisions/0019-use-a-multi-project-monorepo.md).
The additive workspace migration is recorded in
[`apps/browser-recorder/docs/decisions/0021-introduce-root-node-workspace-incrementally.md`](apps/browser-recorder/docs/decisions/0021-introduce-root-node-workspace-incrementally.md).
The shared replay input and canonical schema `1.4` decision is recorded in
[`apps/browser-recorder/docs/decisions/0022-share-replay-input-and-use-schema-1-4.md`](apps/browser-recorder/docs/decisions/0022-share-replay-input-and-use-schema-1-4.md).
The shared replay execution boundary is recorded in
[`apps/browser-recorder/docs/decisions/0023-share-replay-execution-primitives.md`](apps/browser-recorder/docs/decisions/0023-share-replay-execution-primitives.md).
The approved three-increment repository and agent-tooling normalization is recorded in
[`apps/browser-recorder/docs/decisions/0024-normalize-monorepo-layout-and-agent-tooling.md`](apps/browser-recorder/docs/decisions/0024-normalize-monorepo-layout-and-agent-tooling.md)
and tracked by
[`docs/plans/active/relay-monorepo-refactor.md`](docs/plans/active/relay-monorepo-refactor.md).
The targetless page-text assertion contract and privacy-preserving frame scan are recorded in
[`apps/browser-recorder/docs/decisions/0025-add-page-text-scan-assertions.md`](apps/browser-recorder/docs/decisions/0025-add-page-text-scan-assertions.md).
