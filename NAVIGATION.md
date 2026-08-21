# Relay repository navigation

This is the canonical onboarding map for the Relay monorepo. It explains which project
owns each responsibility, how runtime requests cross project boundaries, and where to
start a change. Read the root [`AGENTS.md`](AGENTS.md) for safety and verification rules,
then read the owning application's navigation and agent guides before editing files.

## Sources of truth

Resolve disagreements in this order:

1. Wire and document contracts: [`apps/relay-api/openapi.yaml`](apps/relay-api/openapi.yaml),
   [`apps/automation-service-browserbase/openapi.yaml`](apps/automation-service-browserbase/openapi.yaml),
   and [`packages/workflow-contract/`](packages/workflow-contract/).
2. Runtime code in the owning application or package.
3. Executable behavior in the owning tests.
4. Accepted ADRs in the owning decision directory.
5. Navigation guides and READMEs, which explain current structure and operation.
6. Archived plans, which are historical context and never override current contracts,
   code, tests, or accepted decisions.

Accepted ADRs are immutable. Supersede a decision with a later ADR instead of editing
or deleting the accepted record.

## Ownership map

| Project | Owns | Detailed map |
| --- | --- | --- |
| [`apps/browser-recorder/`](apps/browser-recorder/) | Next.js product UI, custom local server/BFF, Browserbase recording session, interactive replay, local/Relay workspace selection, and Automations UI | [`NAVIGATION.md`](apps/browser-recorder/NAVIGATION.md) |
| [`apps/relay-api/`](apps/relay-api/) | Authenticated FastAPI persistence API, namespaces, workflow revisions, durable run history, evidence storage, and the public automation gateway | [`NAVIGATION.md`](apps/relay-api/NAVIGATION.md) |
| [`apps/automation-service-browserbase/`](apps/automation-service-browserbase/) | Private Fastify execution transport, capacity, process-local batches, cancellation, and temporary thumbnails | [`NAVIGATION.md`](apps/automation-service-browserbase/NAVIGATION.md) |
| [`packages/workflow-contract/`](packages/workflow-contract/) | Canonical workflow schema 1.5, compatibility parsing, executable input validation, generated JSON Schema, and shared fixtures | [`README.md`](packages/workflow-contract/README.md) |
| [`packages/replay-core/`](packages/replay-core/) | Provider-neutral Playwright preflight, targeting, actions, assertions, settling, and waits | [`README.md`](packages/replay-core/README.md) |
| [`packages/automation-core/`](packages/automation-core/) | Privacy-safe, fail-fast background runner facade and sequencing | [`README.md`](packages/automation-core/README.md) |
| [`packages/automation-worker-browserbase/`](packages/automation-worker-browserbase/) | Browserbase session lifecycle, run parameter resolution, and the JSONL CLI | [`README.md`](packages/automation-worker-browserbase/README.md) |

Repository-wide Node installation, the single lockfile, hooks, ADR-gate tooling, and
cross-project commands are owned at the root. Python dependency management remains in
`apps/relay-api/`.

## Runtime flows

### Recording and interactive replay

```text
Browser Recorder React UI
        | same-origin HTTP + /ws
        v
Browser Recorder custom Node server
        | Browserbase SDK + Playwright CDP
        v
Fresh Browserbase session
        |
        +--> recording events --> editable workflow
        +--> interactive ReplayEngine --> @relay/replay-core
                                          |
                                          v
                                  @relay/workflow-contract
```

The recorder owns pause, retry, skip, stop, take-control, WebSocket messages, and UI
diagnostics. Replay-core owns provider-neutral browser phases; it does not own session
lifecycle or interactive policy.

### Persistence and durable background execution

```text
Automations UI
  | same-origin browser-safe requests
  v
Browser Recorder BFF
  | Relay HTTP Basic authentication
  v
Relay FastAPI
  | PostgreSQL metadata/history + private S3-compatible documents/evidence
  | trusted private HTTP
  v
Browserbase automation service
  | @relay/automation-worker-browserbase
  v
@relay/automation-core --> @relay/replay-core --> @relay/workflow-contract
```

Only Relay FastAPI is the authenticated public persistence and run-history boundary.
The Browserbase automation service is unauthenticated, must remain private, and keeps
its queue and temporary capabilities in process memory. Durable run state and evidence
belong to Relay, not the private execution service.

## Dependency direction

```text
workflow-contract
      |
      v
 replay-core
    /     \
   v       v
browser   automation-core
recorder        |
                v
 automation-worker-browserbase
                |
                v
 automation-service-browserbase

browser-recorder BFF <--> relay-api <--> automation-service-browserbase
```

Shared packages must not import applications. Provider-neutral packages must not gain
Browserbase, HTTP, persistence, React, or product-specific orchestration concerns.

## Entry points and reading order

| Area | Start here | Then inspect |
| --- | --- | --- |
| Recorder UI | `apps/browser-recorder/src/app/(product)/` | Owning feature public entry point and feature tests |
| Recorder server/BFF | `apps/browser-recorder/server.ts` | Router, repository/runtime capability, and matching tests |
| Interactive replay | `apps/browser-recorder/src/server/replay/engine.ts` | `packages/replay-core/` and replay tests |
| Relay API | `apps/relay-api/src/relay_backend/main.py` | OpenAPI, controller, service, repository/model, and API tests |
| Private execution service | `apps/automation-service-browserbase/src/main.ts` | `src/app.ts`, OpenAPI, worker, and service tests |
| Workflow shape | `packages/workflow-contract/src/index.ts` | Domain/schema sources, generated schema, and conformance fixtures |
| Browser phases | `packages/replay-core/src/index.ts` | Phase implementation and matching tests |
| Background runner | `packages/automation-core/src/index.ts` | Preflight, runner, execution adapter, and tests |
| Browserbase lifecycle | `packages/automation-worker-browserbase/src/index.ts` | Worker, preparation, CLI, and tests |

## Where to make common changes

| Change | Owning area | Also update or verify |
| --- | --- | --- |
| Add or change a product route | Browser Recorder `src/app` | Owning feature, navigation UI, component/E2E tests |
| Change recording or Browserbase session behavior | Browser Recorder server | WebSocket protocol contracts, runtime/provider tests, privacy rules |
| Change interactive replay policy | Browser Recorder `ReplayEngine` | Replay-core boundary, protocol/UI behavior, replay tests |
| Change provider-neutral browser behavior | `packages/replay-core` | Both recorder and automation consumers |
| Change workflow fields or validation | `packages/workflow-contract` | Generated schema, recorder compatibility, both OpenAPI contracts, Python models, conformance tests |
| Change persistence or namespace behavior | Relay API | Public OpenAPI, migrations/models/services/repositories, API tests, ADR assessment |
| Change durable run history or evidence | Relay API run stack | Recorder BFF projections, private service contract, privacy tests |
| Change private execution HTTP behavior | Automation service | Its OpenAPI, Relay gateway/client, service tests |
| Change background sequencing or diagnostics | `packages/automation-core` | Worker/service projections and privacy tests |
| Change Browserbase provisioning | Automation worker | Service configuration and worker lifecycle tests |
| Change workspace installation or repository tooling | Repository root | Root lockfile, workspace scripts, `npm run test:tooling`, and `npm run verify:locks` |

## Security and privacy boundaries

- Never log workflow bodies, targets, URLs, credentials, parameter values, recorded
  values, session identifiers, artifact identifiers, artifact URLs, or raw provider
  errors.
- Browserbase credentials remain server-side. Relay HTTP Basic credentials are used by
  the recorder BFF and never sent to browser code.
- The automation service defaults to loopback and may bind remotely only on explicitly
  trusted private networking. It is never a public API.
- Direct and batch creation requests are not automatically retried because browser
  actions may have external side effects.
- Relative screenshot URLs are sensitive capabilities. Browser clients retrieve them
  through the authenticated recorder/Relay path, never from the private service.
- Local workflow and profile files may contain secrets or personal data and require
  private filesystem handling.

## Verification routing

Use the commands required by [`AGENTS.md`](AGENTS.md). In summary:

- recorder changes: `npm run test:changed` from `apps/browser-recorder/`, plus the
  requested typecheck/lint/build checks;
- Relay API changes: the `uv` lock, Ruff, pytest, and OpenAPI checks in its guide;
- automation changes: root workspace typecheck, tests, builds, and package dry runs;
- root tooling changes: `npm run test:tooling` and the affected root command;
- lockfile or workspace changes: `npm run verify:locks`;
- cross-project changes: every applicable owning-project check.

Real Browserbase smoke tests are opt-in and paid. Do not substitute them for the normal
fake-provider test suites.
