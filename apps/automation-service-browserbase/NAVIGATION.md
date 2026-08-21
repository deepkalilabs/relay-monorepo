# Browserbase automation service navigation

This is the detailed map for the private Browserbase execution service. Read the root
[`AGENTS.md`](../../AGENTS.md), root [`NAVIGATION.md`](../../NAVIGATION.md), and this
project's [`AGENTS.md`](AGENTS.md) before changing files. Use [`README.md`](README.md)
for setup, API examples, configuration, and operational commands.

## Purpose and boundary

`@relay/automation-service-browserbase` is a private Fastify process that exposes the
Browserbase worker through direct streaming runs, process-local batches, temporary
thumbnail access, health checks, and an opt-in local Inngest adapter.

The service owns HTTP validation and projection, shared process capacity, cancellation,
shutdown, in-memory batch retention, and local thumbnail capability storage. It does
not own workflow persistence, authentication, durable run history, scheduling, retries,
browser actions, or workflow schema definitions.

## Sources of truth and reading order

Resolve discrepancies in this order:

1. [`openapi.yaml`](openapi.yaml) for the wire contract.
2. Runtime code under [`src/`](src/).
3. Executable behavior under [`tests/`](tests/).
4. Accepted execution-boundary rationale in
   [`apps/relay-api/docs/decisions/`](../relay-api/docs/decisions/) and shared-package
   decisions linked from the root navigation guide.
5. This guide and the README.

For a first pass, read:

1. [`src/main.ts`](src/main.ts) for process startup, safe failures, signals, and shutdown.
2. [`src/config.ts`](src/config.ts) for environment validation and safe defaults.
3. [`src/app.ts`](src/app.ts) for Fastify construction, direct/batch routes, shared
   capacity, logging projections, and shutdown coordination.
4. [`src/batches/batch-coordinator.ts`](src/batches/batch-coordinator.ts) for FIFO queue,
   retention, progress, and terminal snapshot behavior.
5. [`src/artifacts.ts`](src/artifacts.ts) for bounded WebP storage and temporary access.
6. [`src/inngest.ts`](src/inngest.ts) for the loopback-only local adapter.
7. [`packages/automation-worker-browserbase/`](../../packages/automation-worker-browserbase/)
   for provider lifecycle and [`tests/`](tests/) for contract examples.

## Runtime architecture

```text
Relay API on trusted private network
        |
        | unauthenticated private HTTP
        v
Fastify routes in src/app.ts
        |
        +--> direct NDJSON run --------+
        |                              |
        +--> FIFO in-memory batch -----+--> shared capacity gate
        |                              |          |
        +--> local Inngest adapter ----+          v
        |                          Browserbase worker
        |                                  |
        +--> artifact capability           v
                                      automation-core
                                           |
                                           v
                                       replay-core
                                           |
                                           v
                                     workflow-contract
```

All direct, batch, and Inngest work shares one configured process-wide run limit.
Direct and Inngest requests receive immediate capacity rejection; accepted batch work
waits in FIFO order. The service never queries Relay persistence and cannot reconstruct
lost process-local state.

## File ownership

| Path | Responsibility |
| --- | --- |
| [`src/main.ts`](src/main.ts) | Loads configuration, starts Fastify, emits fixed safe lifecycle records, and coordinates signal shutdown. |
| [`src/config.ts`](src/config.ts) | Validates listener, capacity, timeout, Browserbase, screenshot, and private-network configuration. |
| [`src/app.ts`](src/app.ts) | Builds routes, validates requests, streams direct events, maps worker outcomes, enforces shared capacity, and owns service shutdown. |
| [`src/batches/batch-coordinator.ts`](src/batches/batch-coordinator.ts) | Queues one-to-ten-run batches, schedules FIFO work, tracks safe progress, and expires bounded terminal state. |
| [`src/artifacts.ts`](src/artifacts.ts) | Converts/saves bounded screenshots and enforces opaque allowlisted access without logging capabilities. |
| [`src/inngest.ts`](src/inngest.ts) | Registers the opt-in local event function and projects a safe terminal result. |
| [`openapi.yaml`](openapi.yaml) | Authoritative direct, batch, artifact, health, request, response, and privacy contract. |
| [`tests/`](tests/) | Proves API, capacity, lifecycle, cancellation, batch, artifact, configuration, Inngest, and worker-integration behavior. |

## Execution paths

### Direct run

1. `POST /v1/run` validates media types, size, envelope, and workflow preflight before
   creating a paid Browserbase session.
2. The service reserves shared capacity and creates a worker with cancellation and
   timeout signals.
3. It returns NDJSON progress and heartbeats followed by exactly one terminal outcome.
4. A caller disconnect or process shutdown aborts the worker and releases capacity.
5. There is no result lookup or reconnection; callers must not retry automatically.

### Process-local batch

1. `POST /v1/batches` accepts one to ten complete workflows and optionally a caller
   supplied UUID used for stable Relay correlation.
2. The coordinator queues workflows FIFO and starts them when shared capacity permits.
3. `GET /v1/batches/{batchId}` returns safe progress and terminal projections only.
4. Terminal batches expire after one hour and the process retains at most 100 batches.
5. Restart loses all queue and polling state. Relay, not this service, owns durable run
   records and recovery policy.

### Screenshot artifacts

1. The worker may return one best-effort terminal PNG before Browserbase cleanup.
2. The service converts it to a bounded WebP and stores it under an opaque UUID name.
3. An in-memory allowlist grants one-hour access through `/v1/artifacts/{artifactId}`.
4. Restart or expiry removes API access but does not delete the local file. Relay may
   copy evidence into its own durable private store through the authenticated gateway.

### Local Inngest adapter

When `INNGEST_DEV=1`, the service registers `/api/inngest` on the existing loopback
listener. It shares the same worker, capacity, timeout, cancellation, and safe outcome
projection. It is a local POC, not production scheduling or durable orchestration, and
does not capture terminal screenshots.

## Dependency boundaries

- [`@relay/automation-worker-browserbase`](../../packages/automation-worker-browserbase/README.md)
  owns Browserbase session creation, connection, parameter resolution, cleanup, and
  optional terminal screenshot capture.
- [`@relay/automation-core`](../../packages/automation-core/README.md) owns fail-fast
  sequencing and privacy-safe background events/results.
- [`@relay/replay-core`](../../packages/replay-core/README.md) owns provider-neutral
  Playwright phases.
- [`@relay/workflow-contract`](../../packages/workflow-contract/README.md) owns the
  executable document shape.
- [`apps/relay-api/`](../relay-api/) owns authentication, workflow lookup, durable run
  state, durable evidence, and the public gateway.

Do not move any of those responsibilities into this transport process. In particular,
do not add PostgreSQL, public authentication, workflow lookup, automatic run retries,
or durable queue semantics here.

## Where to make common changes

| Change | Start here | Also inspect or update |
| --- | --- | --- |
| Route or response shape | `openapi.yaml` | `src/app.ts`, tests, Relay gateway/client, ADR assessment |
| Request size/media validation | `src/app.ts` | OpenAPI error responses and app tests |
| Capacity or shutdown behavior | `src/app.ts` | Batch coordinator, lifecycle/integration tests |
| FIFO, retention, or progress | Batch coordinator | OpenAPI semantics, batch/app tests, Relay tracker expectations |
| Screenshot conversion/access | `src/artifacts.ts` | Artifact routes/tests, Relay evidence copying, security boundaries |
| Listener or environment option | `src/config.ts` | README table, config tests, deployment configuration |
| Worker lifecycle or Browserbase option | Automation worker package | Worker tests and service dependency construction |
| Browser action/assertion | Replay-core | Automation-core and recorder consumers |
| Workflow field | Workflow-contract | Both OpenAPI contracts, Python models, conformance fixtures |
| Inngest POC behavior | `src/inngest.ts` | Loopback guard, app registration, Inngest tests |

## Invariants to preserve

- The default listener is loopback. A non-loopback listener must remain private and
  satisfy the explicit screenshot/private-network and Inngest guards.
- The service has no caller authentication and is never safe for public exposure.
- Request and general Fastify logging remain disabled. Safe records exclude workflow
  bodies, values, URLs, targets, credentials, provider IDs, raw errors, artifact IDs,
  artifact URLs, and local paths.
- Direct streams contain exactly one terminal outcome; disconnect and shutdown cancel
  work and release capacity.
- Direct, batch, and Inngest execution share one process-wide capacity limit.
- Batch submission and direct execution are not automatically retried because browser
  actions can have external side effects.
- Batch state and artifact capabilities remain process-local and bounded. Persistent
  image files are not durable API state.
- Provider-neutral execution stays in shared packages; this app owns transport and
  process lifecycle only.

## Testing and verification

- `app.test.ts` covers route validation, streaming, projections, and safe failures.
- `batches.test.ts` covers FIFO scheduling, shared capacity, progress, retention, and
  shutdown.
- artifact tests cover bounded conversion, storage, capability access, and expiry.
- lifecycle/config/Inngest tests cover process rules and safe configuration failures.
- integration tests use fake worker/Playwright dependencies and do not create paid
  Browserbase sessions.
- `browserbase.smoke.test.ts` is explicitly opt-in and paid.

Run the commands in [`AGENTS.md`](AGENTS.md) from the repository root. Validate this
service's OpenAPI file from `apps/relay-api/` because that app owns the Python validator
environment.
