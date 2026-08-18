# Relay

Relay is a multi-project monorepo containing the Browser Memory Recorder frontend and
the Relay persistence and automation backend. A private root npm workspace coordinates
their current Node projects without changing application or deployment ownership.

## Projects

| Project | Purpose | Documentation |
| --- | --- | --- |
| [`frontend/`](frontend/) | Next.js application, local BFF, recorder WebSocket, and interactive replay | [`frontend/README.md`](frontend/README.md) |
| [`backend/`](backend/) | FastAPI persistence API and the existing Browserbase automation packages | [`backend/README.md`](backend/README.md) |

The root Node workspace provides cross-project build and verification commands. Use it
for Node commands in a full repository checkout. During the incremental migration,
project lockfiles remain available to deployment contexts that receive only their
owning project directory. Python remains independently managed under `backend/`.

Install and verify all current Node workspaces:

```bash
nvm use
npm ci
npm run typecheck
npm run test:automation
npm run test:changed
```

## Quick start

Start the frontend:

```bash
cd frontend
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

The backend's Browserbase automation libraries and service remain under
[`backend/packages/`](backend/packages/). They are not root workspaces and have not been
extracted or consolidated as part of the monorepo move.

Build and deployment services must use `frontend/` or `backend/` as their working/root
directory so each project's existing configuration and relative paths remain valid.

## Repository decisions

Project documentation remains within its owning directory. The decision to adopt this
layout is recorded in
[`frontend/docs/decisions/0019-use-a-multi-project-monorepo.md`](frontend/docs/decisions/0019-use-a-multi-project-monorepo.md).
The additive workspace migration is recorded in
[`frontend/docs/decisions/0021-introduce-root-node-workspace-incrementally.md`](frontend/docs/decisions/0021-introduce-root-node-workspace-incrementally.md).
