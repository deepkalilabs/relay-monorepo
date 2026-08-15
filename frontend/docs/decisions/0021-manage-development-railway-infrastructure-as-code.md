# ADR-0021: Manage development Railway infrastructure as code

## Status

Accepted

## Date

2026-08-14

## Context

Relay deploys three GitHub services from one repository: the Next.js frontend, the
FastAPI persistence API, and the private Browserbase automation service. The API also
depends on PostgreSQL and a private Railway Storage Bucket. The Railway project already
contains the service identities and stateful resources in `production` and `preview`,
but the imported `development` environment contained no service, volume, or bucket
instances on 2026-08-14.

Service-level Config as Code cannot manage a service at the same time as Railway's
project-level TypeScript Infrastructure as Code. The existing `frontend/railway.toml`
therefore cannot remain once the frontend is represented in `.railway/railway.ts`.
Credentials must not be committed, and generated Railway domains are platform-managed
state that the IaC importer intentionally omits.

## Decision

Adopt Railway's project-level TypeScript IaC in `.railway/railway.ts` for the existing
`development` environment.

- Begin with `railway config pull --force` and preserve every imported project,
  service, database, volume, and bucket name. Never replace imported stateful resources.
  Because the current development import was empty, create its `Postgres` database and
  `workflow-documents` bucket without changing state in other environments.
- Keep `frontend` and both backend services rooted in their owning monorepo directories.
  Repository-root watch patterns limit deployments to files used by each service.
- Keep the frontend and API public, retain their existing generated Railway domains,
  and keep the automation service private. Generated Railway domains remain a one-time
  platform concern and are not declared in IaC.
- Use Railway private-domain references for frontend-to-API and API-to-automation
  traffic. Browser clients never receive a private Railway hostname; the frontend's
  server-side BFF uses it.
- Keep `BROWSERBASE_API_KEY`, `RELAY_API_USERNAME`, and `RELAY_API_PASSWORD` as Railway
  shared variables. Share `BROWSERBASE_PROJECT_ID` only when it already exists. The API
  maps the Relay credentials to `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD`.
- Reference PostgreSQL and bucket outputs rather than copying connection strings or S3
  credentials. Fixed non-secret runtime settings remain in IaC.
- Run `alembic upgrade head` as the API's Railway pre-deploy command. The API container
  starts only Uvicorn, and its Docker command remains overridable.
- Require a reviewed `railway config plan --verbose` before any separately authorized,
  interactive apply. Any unexpected deletion or replacement blocks rollout.

## Alternatives considered

### Keep configuring services in the Railway dashboard

This preserves current resources but leaves service roots, watch patterns, networking,
variables, and migration commands as undocumented mutable state. It does not provide a
reviewable project graph.

### Keep `frontend/railway.toml` beside project-level IaC

Railway rejects dual ownership of one service. Maintaining both would prevent a safe
plan and create ambiguity over which configuration controls frontend deployment.

### Create a new Railway project or environment

This avoids import complexity but would create another environment identity and make
future adoption ambiguous. The goal is to manage the existing development environment,
not replace it.

## Consequences

- Infrastructure changes become reviewable alongside application changes.
- Monorepo services keep independent build contexts and deploy only for relevant paths.
- Secret values remain owned by Railway rather than Git.
- The rollout has an explicit manual boundary: repository verification may plan, but
  applying live changes requires separate authorization.
- Adoption depends on Railway authentication and a clean import. A future non-empty
  import must be reconciled with live names before changing any resource declaration.
- Process-local frontend and automation state require one replica for each service.
