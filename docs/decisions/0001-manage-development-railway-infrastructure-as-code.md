# ADR 0001: Manage the Railway development environment as code

- Status: Accepted
- Date: 2026-08-19

## Context

Relay is deployed as three cooperating processes: the browser recorder, the public
Relay API, and a private Browserbase automation service. The API also requires
PostgreSQL and private S3-compatible object storage. The normalized monorepo keeps all
three deployable applications under `apps/` and gives the two Node applications shared
root-workspace dependencies under `packages/`.

The Railway project already contains `production` and `preview` deployments configured
through older repositories and dashboard state. Its existing `development` environment
is empty. Recreating the desired development topology by hand would leave service
sources, monorepo build contexts, dependency references, and secret ownership outside
reviewable source control.

Railway offers experimental project-level TypeScript infrastructure as code. A
`.railway/railway.ts` program can declare services, databases, buckets, variables,
private references, health checks, and replicas, then preview and apply an environment
change set without a separate state file. The SDK is beta and can introduce breaking
changes, so the repository must pin its version and test the evaluated graph.

## Decision

Use `.railway/railway.ts` as the sole configuration owner for the existing empty
`development` environment in project `shimmering-hope`. The program rejects every other
environment and declares:

- `relay_frontend`, `relay-backend`, and `relay-automation` from
  `deepkalilabs/relay-monorepo` on the protected `development` branch;
- one `us-west2` replica for each process;
- Railway PostgreSQL named `Postgres`;
- a private `relay-workflows-development` bucket in `sjc`; and
- no application volumes.

PostgreSQL retains the Railway-managed storage intrinsic to the database service. The
automation service remains private and unauthenticated. The recorder and API receive
generated public domains as a one-time Railway platform operation because generated
Railway domains are intentionally not authored by the TypeScript DSL.

All Node builds use the repository root so the single root lockfile and shared packages
are available. The recorder uses Railpack with an IaC-owned build command. The API and
automation service use their root-context Dockerfiles. Service watch patterns include
the owning app, every shared package used by its image, and root manifests where
applicable.

Use Railway shared variables for `BROWSERBASE_API_KEY`, `RELAY_API_USERNAME`, and
`RELAY_API_PASSWORD`. IaC maps those references into the services that need them and
never stores their values in Git. The API receives typed PostgreSQL and bucket
references and reaches automation over Railway private networking. The recorder reaches
the API over private networking.

Run Alembic as the API's Railway pre-deploy command. The API image uses a normal `CMD`,
and its start script starts only Uvicorn. This ensures migrations finish before the new
deployment starts and allows Railway to override the container command for pre-deploy.

Pin the Railway TypeScript SDK in the root development dependencies. Evaluate the graph
in repository tooling tests and require an interactive, redacted `railway config plan`
before every apply. The first accepted plan contains five additions, no changes, and no
deletions. Applying to `production` or `preview` is outside this decision.

## Alternatives considered

### Configure services in the Railway dashboard

Rejected because dashboard-only configuration cannot reproduce the environment from a
reviewed branch and makes cross-service references and drift difficult to audit.

### Use service-level `railway.json` or `railway.toml`

Rejected because service-level configuration cannot own PostgreSQL, the bucket, shared
variables, or the complete project topology. Mixing service-level and project-level
configuration for the same service is also unsupported.

### Duplicate production into development

Rejected because production still references older repositories and contains historical
service variables. Copying it would reproduce drift and risk copying production secrets
or state into development.

### Add application volumes

Rejected because workflows persist in PostgreSQL and the private bucket. Automation
batch and screenshot capabilities are intentionally process-local, and recorder profile
persistence is outside this deployment scope. Only PostgreSQL needs managed persistent
storage.

### Apply the same graph to every Railway environment

Rejected for the initial adoption. `production` and `preview` already contain live
resources and require separate import, migration, and no-destruction reviews.

## Consequences

- Development infrastructure becomes reviewable, reproducible, and drift-detectable.
- The protected `development` branch is both the deployment source and the merge gate.
- Railway shared variables must exist before the first apply.
- Generated frontend and API domains remain a documented one-time operation.
- The beta Railway SDK becomes a pinned root tooling dependency and requires deliberate
  upgrades.
- Production and preview remain unmanaged by this graph until separately adopted.
