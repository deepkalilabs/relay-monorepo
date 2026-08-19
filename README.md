# Relay

Relay is a multi-project monorepo containing the Browser Memory Recorder frontend and
the Relay persistence and automation backend. A private root npm workspace coordinates
their current Node projects without changing application or deployment ownership.

## Projects

| Project | Purpose | Documentation |
| --- | --- | --- |
| [`apps/browser-recorder/`](apps/browser-recorder/) | Next.js application, local BFF, recorder WebSocket, and interactive replay | [`apps/browser-recorder/README.md`](apps/browser-recorder/README.md) |
| [`backend/`](backend/) | FastAPI persistence API and the existing Browserbase automation packages | [`backend/README.md`](backend/README.md) |

The root Node workspace provides cross-project build and verification commands. Use it
for Node commands in a full repository checkout. During the incremental migration,
project lockfiles remain available to deployment contexts that receive only their
owning project directory. Python remains independently managed under `backend/`.

The shared replay input contract lives in
[`packages/workflow-contract/`](packages/workflow-contract/), and provider-neutral
Playwright phases live in [`packages/replay-core/`](packages/replay-core/). Both are
consumed through the root workspace. Automation-core delegates execution to replay-core
while remaining physically owned by `backend/` during the incremental migration.

Install and verify all current Node workspaces:

```bash
nvm use
npm ci
npm run typecheck
npm run test:automation
npm run test:changed
npm run test:tooling
```

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
cd apps/browser-recorder
npm install
cp .env.example .env.local
npm run dev
```

Start the persistence API:

```bash
cd backend
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

Local recorder and backend commands use `apps/browser-recorder/` or `backend/` as their
working directory. Both Docker images now use the repository root as their build context
so they can consume sibling packages and contracts.

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
