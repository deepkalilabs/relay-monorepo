# Deploy the monorepo to Railway development

Railway project `shimmering-hope` manages its existing `development` environment as one
project-level graph in `../.railway/railway.ts`. The graph declares the public frontend,
public persistence API, private automation service, PostgreSQL, and workflow-document
bucket. Do not use this procedure to create a replacement project or environment.

The clean import on 2026-08-14 contained no development service, volume, or bucket
instances. Its first reviewed plan therefore adds development resources while leaving
the project's populated `production` and `preview` environments untouched. If a later
import is no longer empty, treat the imported names and state as authoritative.

The repository implementation does not authorize `railway config apply`. Applying the
graph is a separate, interactive rollout step after the repository changes reach
`main`.

## Safety invariants

- Import before editing. Preserve every imported project and resource name.
- Never rename, replace, detach, or recreate an imported PostgreSQL database, volume,
  or bucket during adoption.
- Keep existing Railway-generated domains for the frontend and API. Generated domains
  are intentionally omitted from IaC.
- Keep the automation service private and at one replica. It holds batch, capacity, and
  thumbnail-capability state in process memory.
- Keep the frontend at one replica because it holds process-local browser and recorder
  state.
- Never place a secret value in `.railway/railway.ts`, a plan log, or documentation.
- Stop if a plan proposes any unexpected service, database, volume, bucket, domain, or
  variable deletion.

See [`../frontend/docs/decisions/0021-manage-development-railway-infrastructure-as-code.md`](../frontend/docs/decisions/0021-manage-development-railway-infrastructure-as-code.md)
for the deployment ownership and migration decision.

## 1. Prepare Railway

Enable Railway **Priority Boarding**, install or upgrade the current Railway CLI, and
authenticate:

```bash
railway --version
railway login
```

Link this checkout to the existing project and select `development`:

```bash
railway link
railway environment development
railway status
```

Do not initialize a new Railway project.

## 2. Import the live graph

From the repository root, overwrite the local graph with the existing environment:

```bash
railway config pull --force
railway config plan --verbose
```

The unedited import must plan no changes. If it does not, resolve the import or Railway
CLI issue before refactoring. Keep imported resource names even when they differ from
the fallback service names in this repository's design.

## 3. Create shared variables

Create these shared variables in the Railway `development` environment without placing
their values in Git:

- `BROWSERBASE_API_KEY`
- `RELAY_API_USERNAME`
- `RELAY_API_PASSWORD`

If `BROWSERBASE_PROJECT_ID` already exists, make it shared as well. Do not introduce it
as a required variable when the development environment does not currently use it.

The graph maps the Relay credentials to the API's `BASIC_AUTH_USERNAME` and
`BASIC_AUTH_PASSWORD`. It references the Browserbase variables from the private
automation service.

## 4. Review the intended graph

The graph is organized into `Applications` and `Data` groups and defines three GitHub
services sourced from
`deepkalilabs/relay-monorepo` on `main`:

| Service | Build context | Deployment boundary |
| --- | --- | --- |
| `relay_frontend` | `frontend/`, Railpack | `npm start`, health `/`, one replica, public domain created during rollout |
| `relay-backend` | `backend/`, `Dockerfile.api` | pre-deploy `alembic upgrade head`, health `/health/ready`, one replica, public domain created during rollout |
| `relay-automation` | `backend/`, `Dockerfile.automation` | health `/health/ready`, one replica, private networking only |

The current development graph creates `Postgres` through Railway's database helper and
creates `workflow-documents` in `sjc`. If a future import contains either resource,
refactor the imported declarations without changing their names, placement, or volume.

Runtime references and fixed values are:

| Owner | Variable | Value source |
| --- | --- | --- |
| Frontend | `RELAY_API_BASE_URL` | `http://` plus the API private domain and port `8000` |
| Frontend | `RELAY_API_USERNAME`, `RELAY_API_PASSWORD` | Railway shared variables |
| API | `DATABASE_URL` | PostgreSQL `DATABASE_URL` output |
| API | `BUCKET`, `ENDPOINT`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION` | Bucket outputs |
| API | `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD` | Relay shared variables |
| API | `AUTOMATION_SERVICE_URL` | `http://` plus the automation private domain and port `8080` |
| API | `PORT` | `8000` |
| Automation | `BROWSERBASE_API_KEY` | Railway shared variable |
| Automation | `BROWSERBASE_PROJECT_ID` | Existing shared variable only, when present |
| Automation | `BROWSERBASE_REGION` | `us-west-2` |
| Automation | `PORT`, `AUTOMATION_HOST` | `8080`, `0.0.0.0` |
| Automation | `AUTOMATION_TRUST_PRIVATE_NETWORK`, `AUTOMATION_SCREENSHOTS` | `1`, `true` |

Private references avoid public service-to-service egress. The browser never resolves
these internal hostnames; the frontend's server process and API use them.

## 5. Plan the adoption

Remove `frontend/railway.toml` only after all of its settings are represented in the
project graph. If the frontend has a custom Railway config-file path, clear that field
in its service settings before planning.

Run:

```bash
railway config plan --verbose
```

Expected changes are limited to the GitHub source and monorepo roots, builders and
Dockerfile paths, watch patterns, variable references, runtime settings, health checks,
replica counts, and the API pre-deploy command. The migration must not delete or replace
any imported PostgreSQL instance, volume, bucket, generated public domain, or unexpected
service.

Do not use `--show-values`; plans redact variable values by default.

## 6. Apply after merge and separate authorization

After the repository changes are merged to `main`, run the interactive command from a
clean checkout only when live apply has been explicitly authorized:

```bash
railway config apply
```

Read the fresh plan that Railway produces immediately before applying. Do not use
non-interactive or destructive-confirmation flags for this adoption.

Then prove the environment has no drift:

```bash
railway config plan --detailed-exit-code
```

The command must exit `0`.

## 7. Deployment smoke tests

After deployment:

1. Generate Railway public domains for `relay_frontend` and `relay-backend` if this is
   the environment's first rollout. IaC intentionally omits generated domains.
2. Confirm the frontend `/` and API `/health/ready` return healthy responses after
   Alembic completes.
3. Confirm automation `/health/ready` succeeds over private networking and that the
   service has no public domain.
4. Confirm the API can query PostgreSQL and write/read a disposable object through the
   bucket configuration.
5. Confirm the frontend can list namespaces through its private API reference.
6. Send one safe synthetic batch through the public API and wait for a terminal state.
7. Fetch its relative `/v1/artifacts/{artifactId}` URL from the public API with Relay
   Basic authentication and confirm it returns `image/webp`; the unauthenticated request
   must return `401`.
8. Review logs for workflow bodies, screenshot bytes, artifact identifiers or URLs,
   credentials, and private service URLs; none may be present.

Neither Railway nor another proxy may retry automation POST requests.

## Local verification

From `backend/`:

```bash
bash -n scripts/start-api.sh
docker build -f Dockerfile.api -t relay-api .
docker build -f Dockerfile.automation -t relay-automation .
```

From `frontend/`, run the required frontend checks documented by the repository. From
the repository root, evaluate the IaC and run `railway config plan --verbose` once the
checkout is linked. Planning is read-only; applying is not part of repository
verification.
