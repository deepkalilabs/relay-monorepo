# Relay

Relay is a multi-project monorepo containing the Browser Memory Recorder frontend and
the Relay persistence and automation backend. The projects intentionally retain
independent dependency management, commands, documentation, and deployment boundaries.

## Projects

| Project | Purpose | Documentation |
| --- | --- | --- |
| [`frontend/`](frontend/) | Next.js application, local BFF, recorder WebSocket, and interactive replay | [`frontend/README.md`](frontend/README.md) |
| [`backend/`](backend/) | FastAPI persistence API and the existing Browserbase automation packages | [`backend/README.md`](backend/README.md) |

There is no root Node or Python package. Run package-manager commands from the project
that owns them.

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

Railway deploys both projects from their isolated `frontend/` and `backend/` roots.
Project-level infrastructure is declared in [`.railway/railway.ts`](.railway/railway.ts)
after importing the existing `development` environment. Follow the guarded adoption and
rollout procedure in [`backend/DEPLOY.md`](backend/DEPLOY.md); do not run
`railway config apply` as part of ordinary repository verification.

## Repository decisions

Project documentation remains within its owning directory. The decision to adopt this
layout is recorded in
[`frontend/docs/decisions/0019-use-a-multi-project-monorepo.md`](frontend/docs/decisions/0019-use-a-multi-project-monorepo.md).
Repository-wide decisions continue the frontend ADR sequence. Railway deployment IaC is
recorded in
[`frontend/docs/decisions/0021-manage-development-railway-infrastructure-as-code.md`](frontend/docs/decisions/0021-manage-development-railway-infrastructure-as-code.md).
