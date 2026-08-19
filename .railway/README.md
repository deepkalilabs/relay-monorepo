# Railway development environment

[`railway.ts`](railway.ts) is the sole Railway configuration source for the
`development` environment in the `shimmering-hope` project. It creates five resources:

- `relay_frontend`, built with Railpack from the repository root;
- `relay-backend`, built from `apps/relay-api/Dockerfile`;
- private `relay-automation`, built from
  `apps/automation-service-browserbase/Dockerfile`;
- Railway PostgreSQL named `Postgres-development`, including Railway-managed database
  storage; and
- the private `relay-workflows-development` bucket in `sjc`.

No application volume is declared. All three services deploy one `us-west2` replica
from `deepkalilabs/relay-monorepo` on the protected `development` branch. The definition
refuses to evaluate for any other Railway environment.

## Prerequisites

Use Node 24, install once from the repository root, and authenticate the Railway CLI:

```bash
nvm use
npm ci
railway login
railway link --project 390725ff-1cf1-4a22-bd19-b4fab2dec4e0 --environment development
railway status --json
```

The status output must identify project `shimmering-hope` and environment
`development` before any plan or apply.

## Shared secrets

Create these environment-level shared variables before applying IaC:

```bash
railway variable set BROWSERBASE_API_KEY --stdin --skip-deploys
railway variable set RELAY_API_USERNAME --stdin --skip-deploys
railway variable set RELAY_API_PASSWORD --stdin --skip-deploys
```

Type each value on standard input, then send EOF, or pipe it from an approved secret
manager. Do not put secret values in command arguments, source files, plan output, or
documentation. The recorder and automation service share `BROWSERBASE_API_KEY`; the
recorder and API share the Relay Basic-auth credentials. `BROWSERBASE_PROJECT_ID` is
intentionally omitted because the current applications treat it as optional.

## Plan and apply

Run the repository test and a redacted Railway plan:

```bash
npm run test:tooling -- --run tooling/tests/railway-iac.test.ts
npm run railway:plan
```

For the initial empty environment, the accepted plan is exactly five additions and no
changes or deletions: three services, PostgreSQL, and the bucket. Stop if the plan
contains a deletion, a volume other than Railway-managed PostgreSQL storage, another
environment, another source branch, or literal secret values.

Apply only after reviewing the fresh plan:

```bash
railway config apply --runner node_modules/.bin/railway-iac-ts
```

Do not use `--yes` or `--confirm-destructive` for this rollout. After apply completes,
verify there is no drift:

```bash
npm run railway:drift
```

Exit `0` means the environment matches source. Exit `2` means changes remain.

## Public domains and smoke tests

Railway-generated domains are a one-time platform operation and are not committed in
the IaC graph. Generate domains only for the recorder and API:

```bash
railway domain --service relay_frontend --environment development --port 3000
railway domain --service relay-backend --environment development --port 8000
```

Do not generate a domain or TCP proxy for `relay-automation`. It is unauthenticated and
must remain reachable only over Railway private networking.

Complete the rollout by checking:

- the recorder domain returns HTTP `200` at `/`;
- the API domain returns HTTP `200` at `/docs`;
- `relay-automation` reports ready at `/health/ready` over the private network;
- the API can create and retrieve a namespace-scoped workflow, proving PostgreSQL and
  bucket access; and
- a recorder background run reaches a terminal result and proxies its screenshot
  through the authenticated API.
