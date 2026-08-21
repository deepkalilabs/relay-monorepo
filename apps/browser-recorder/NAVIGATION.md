# Browser Recorder navigation

This is the detailed map for engineers and agents changing Browser Memory Recorder.
Read the repository [`AGENTS.md`](../../AGENTS.md) and
[`NAVIGATION.md`](../../NAVIGATION.md), then this project's [`AGENTS.md`](AGENTS.md)
before editing files. Setup, environment variables, and commands remain in
[`README.md`](README.md).

## Purpose and boundary

Browser Recorder is a Next.js application with a custom Node server. It owns the
product UI, local browser-facing APIs, Browserbase recording sessions, interactive
replay policy, local workflow/profile persistence, Relay workspace selection, and the
Automations experience.

It does not own the canonical workflow contract, provider-neutral Playwright phases,
Relay persistence/authentication, durable server-side run history, or the private
Browserbase background-execution service.

## Sources of truth and reading order

Resolve discrepancies in this order:

1. Shared workflow types and validation in
   [`packages/workflow-contract/`](../../packages/workflow-contract/) and WebSocket/API
   schemas under [`src/shared/contracts/`](src/shared/contracts/).
2. Runtime behavior under [`src/`](src/) and [`server.ts`](server.ts).
3. Executable behavior under [`tests/`](tests/).
4. Accepted rationale under [`docs/decisions/`](docs/decisions/).
5. Product feature documentation under [`docs/product/`](docs/product/), this guide,
   and the README.
6. Root archived plans, which are historical and never override current behavior.

For a first code pass, read:

1. [`server.ts`](server.ts) for HTTP/WebSocket assembly and dependency wiring.
2. [`src/app/(product)/layout.tsx`](<src/app/(product)/layout.tsx>) for product shell
   composition and [`src/app/(product)/`](<src/app/(product)/>) for routes.
3. The owning feature's `index.ts` and feature-local model/components.
4. [`src/server/recording/runtime.ts`](src/server/recording/runtime.ts) for live session,
   recording, and interactive replay orchestration.
5. The matching server router and repository for persistence or background-run work.
6. The closest tests for executable examples and privacy boundaries.

## Application flow

```text
Next.js product route
        |
        v
route-private composition + feature public APIs
        |
        +--> same-origin HTTP --> custom server routers
        |                         | local files or Relay API
        |                         v
        |                    browser-safe response
        |
        +--> /ws --> RecordingRuntime --> BrowserbaseProvider
                     |                       |
                     |                       v
                     |                 Playwright CDP page
                     |
                     +--> recorder injection and sequenced events
                     +--> interactive ReplayEngine --> @relay/replay-core
```

The React client owns unsaved workflow edits. The server owns credentials, remote
browser lifecycle, local persistence adapters, Relay requests, and privacy-safe
projections. Complete workflow documents never cross to browser code merely to satisfy
a background execution request; the BFF loads them server-side.

## Product routes and features

| Route | Composition | Owning feature |
| --- | --- | --- |
| `/` | Product landing/redirect | `src/app/(product)/page.tsx` |
| `/library` | Saved workflow library, parameters, run dialog | `features/workflow-library` |
| `/profile` | Local profile CRUD | `features/profile` |
| `/automations` | Folder organization, durable run history, background execution | `features/automations` |
| `/workflows/{workflowId}/edit` | Browser, recorder, timeline, replay, workspace policy | Route-private `_components` and `_hooks`, composed from feature APIs |
| `/fixture` and `/fixture/frame` | Deterministic browser pages | Test support only |

Reusable client behavior is grouped by product feature. Each feature exports its
supported surface through `index.ts`; do not deep-import another feature's internals.
Route-private editor composition may combine browser, recorder, replay, and workflow
editor APIs without turning that composition into a shared feature.

## Server ownership

| Area | Responsibility |
| --- | --- |
| [`server.ts`](server.ts) | Builds the custom HTTP server, prepares Next.js, registers BFF routers and `/ws`, and owns process-level runtime instances. |
| [`src/server/recording/runtime.ts`](src/server/recording/runtime.ts) | Browser session/page lifecycle, recording injection, event sequencing, and interactive replay control. |
| [`src/server/infrastructure/browser/`](src/server/infrastructure/browser/) | Browserbase provider adapter, session configuration, and Playwright connection. |
| [`src/server/replay/engine.ts`](src/server/replay/engine.ts) | Frontend-specific interactive sequencing and failure recovery over replay-core phases. |
| [`src/server/workflows/`](src/server/workflows/) | Local/remote workflow repositories, browser-facing CRUD routes, and safe library projections. |
| [`src/server/profiles/`](src/server/profiles/) | Private local profile repository and browser-facing CRUD routes. |
| [`src/server/workspaces/`](src/server/workspaces/) | Lists and selects Local or Relay workflow workspaces. |
| [`src/server/automation/`](src/server/automation/) | Loads eligible workflows, calls authenticated Relay run APIs, and projects durable history/evidence to browser-safe shapes. |
| [`src/server/infrastructure/storage/`](src/server/infrastructure/storage/) | Selects local filesystem or Relay HTTP repositories for the active workspace. |

The recorder BFF is not a second persistence service. Local repositories own local
files; Relay repositories call the authenticated Relay API. Durable background runs
belong to Relay even though the recorder provides same-origin browser routes.

## Shared contracts and dependency direction

- [`@relay/workflow-contract`](../../packages/workflow-contract/README.md) owns canonical
  schema 1.5, compatibility parsing, target/assertion shapes, and executable validation.
- `src/shared/contracts/workflow/` provides recorder-compatible re-exports and owns
  recorder serialization, parameters, and library projections that are not shared.
- [`@relay/replay-core`](../../packages/replay-core/README.md) owns provider-neutral
  preflight, target/frame resolution, actions, assertions, settling, and waits.
- `src/server/replay/engine.ts` keeps pause/resume/retry/skip/stop/take-control policy,
  phase checkpoints, and recorder-facing diagnostics.
- `src/shared/contracts/protocol/` owns client-to-server and server-to-client WebSocket
  schemas. Update both sides and tests together.
- `src/shared/api/` owns browser-safe clients shared by product routes; it must not
  contain server credentials or import server implementations.

Dependencies flow from routes to feature public APIs, from features to shared contracts
and UI, and from the server to server capabilities and shared contracts. ESLint enforces
the most important client/server and cross-feature boundaries.

## Runtime paths

### Record and interactively replay

1. The browser client opens `/ws` and sends `client.hello` before session commands.
2. `server.ts` associates the client with one `RecordingRuntime`.
3. The runtime asks `BrowserbaseProvider` for a fresh session using the selected region
   and explicit proxy choice.
4. The runtime registers pages, installs the recorder script, and emits ordered protocol
   messages to the client.
5. Interactive replay builds frontend preflight over replay-core, then pauses at
   frontend-owned checkpoints for retry, skip, stop, or manual takeover.

Proxy use is opt-in per new or restarted session and is not inferred from unrelated
provider configuration. See
[`docs/product/features/browserbase-proxy-selection.md`](docs/product/features/browserbase-proxy-selection.md)
and the accepted decision linked from that feature document.

### Workspaces and persistence

1. The browser selects a Local or Relay workspace through `/api/workspaces`.
2. `repository-factory.ts` resolves the workspace to filesystem or authenticated Relay
   repository adapters.
3. Workflow routes return full documents only where editing requires them; library
   listings use safe projections.
4. Local workflow and profile repositories use revision checks and atomic replacement.
5. Relay remains authoritative for remote namespace ownership, revisions, and durable
   workflow/run data.

### Background runs

1. The Automations UI submits workflow IDs through same-origin BFF routes.
2. The server resolves the selected Relay namespace, loads complete eligible workflows,
   and sends Relay credentials only on the server-to-server request.
3. Relay creates durable run records and delegates execution to its private automation
   service.
4. The browser polls browser-safe durable snapshots/history through the BFF. Screenshot
   bytes are streamed through authenticated same-origin routes; opaque upstream
   capability URLs are never exposed as direct private-service origins.

Creation is not automatically retried because accepted browser actions may have
external side effects.

## Where to make common changes

| Change | Start here | Also inspect or update |
| --- | --- | --- |
| Product navigation or route | `src/app/(product)` | `shared/ui/navigation`, owning feature, component/E2E tests |
| Editor workspace composition | Editor route `_components`/`_hooks` | Feature public APIs and workspace tests |
| Recorder normalization | `features/recorder/model` | Shared recorded-action contract and recorder tests |
| Browser session option | Browser feature model/UI | Client protocol, runtime, provider adapter, session/provider tests |
| WebSocket command or event | `shared/contracts/protocol` | Runtime, client hook, protocol/component tests |
| Interactive replay policy | `server/replay/engine.ts` | Replay UI/protocol and replay phase tests |
| Provider-neutral action/assertion | `packages/replay-core` | Recorder adapter and automation-core consumer tests |
| Workflow schema field | `packages/workflow-contract` | Recorder serialization/import, both OpenAPI contracts, Python model/conformance tests |
| Local persistence behavior | Owning filesystem repository | HTTP router/client and repository tests |
| Relay workspace behavior | Storage repository factory/HTTP repository | Workspace API/client/provider tests and Relay contract |
| Background run or evidence UI | `features/automations` | Automation BFF router, shared run contract, Relay durable run API |
| Browser-facing BFF route | Owning `src/server/*/http-router.ts` | Browser client, safe error/response schema, router tests, `server.ts` registration |

## Invariants to preserve

- Browserbase and Relay credentials never enter client bundles, browser responses, or
  logs.
- WebSocket events remain sequenced and reconnectable through the existing hello and
  last-sequence protocol.
- Unsaved editor state remains client-owned and visible after save conflicts.
- Local writes retain revision checks, private handling, and atomic replacement.
- Background run creation is non-retrying and accepts only validated complete workflows
  permitted by the current parameter policy.
- Interactive replay recovery must not repeat an action that already succeeded when a
  later settle or wait phase fails.
- Workflow contents, targets, values, URLs, session IDs, credentials, and artifact
  capabilities remain outside logs and privacy-safe run projections.
- Feature internals remain private behind feature entry points; shared modules do not
  import application routes or server implementations.

## Testing map

- `tests/*api.test.ts` and repository tests cover browser-facing routes, remote adapters,
  validation, conflicts, and safe failures.
- recorder/session/browser tests cover protocol state, recording, provider options, and
  lifecycle cleanup.
- replay tests cover phase behavior, recovery, cancellation, assertions, and privacy.
- component and screen tests cover feature state and accessibility behavior.
- `tests/e2e/` covers product routes and deterministic fixture pages.
- `test:browserbase` is opt-in because it creates a paid remote session.

Run `npm run test:changed` from this directory for normal changes, as required by
[`AGENTS.md`](AGENTS.md). Report when Vitest finds no affected tests instead of
substituting the full suite.
