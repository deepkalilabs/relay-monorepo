# Shared Replay Engine Migration

## Objective

Create one provider-neutral replay engine used by both the frontend interactive runner
and the backend fail-fast runner. The engine owns workflow validation and shared
Playwright behavior, but it does not combine either product's orchestration,
Browserbase lifecycle, transports, persistence, or deployment units.

The shared workflow contract is a prerequisite and input boundary for the replay engine,
not the migration's final outcome.

The migration has six focused increments. Package relocation remains planned, but it
is a later mechanical follow-up and does not block behavior sharing.

## Current status

- [x] Increment 1: introduce the root Node workspace.
- [x] Increment 2: remove Railway-specific deployment ownership.
- [x] Increment 3: establish the replay input and canonical schema 1.4 across applications.
- [x] Increment 4: switch automation-core to the replay input contract.
- [ ] Increment 5: extract the shared replay engine and preserve the headless facade.
- [ ] Increment 6: switch frontend replay to the shared engine.

Increment 2 is complete in commit `7c0e054`. Increment 3 is complete on
`codex/shared-replay-input`. Increment 4 is complete. Increment 5 has not started.

## Simplifying decisions

1. Use schema version `1.4` for all new canonical writes. Keep compatibility readers for
   versions `1.0` through `1.3`; do not require a bulk stored-document migration.
2. Treat document shape, not the version label alone, as the capability boundary.
3. Keep `backend/packages/automation-core` in place during behavior migration. It remains
   the compatibility facade used by the worker and service.
4. Add two focused root packages that form one shared replay-engine architecture:
   `workflow-contract` defines engine inputs and `replay-core` executes them.
5. Update the automation Docker build when automation-core first consumes a root package;
   do not create a separate Docker-only increment.
6. Use direct typed functions for replay phases. Do not add a strategy/plugin framework.
7. Retain project lockfiles and transitional root overrides during this migration.
8. Relocate automation-core afterward as a mechanical, separately reviewed follow-up.

## Boundaries that must remain separate

- The frontend owns pause, resume, retry, skip, stop, manual takeover, phase-progress
  recovery, and `ServerMessage` mapping.
- Automation-core owns fail-fast orchestration, `AbortSignal`, privacy-safe diagnostics,
  transport-neutral events, and terminal results.
- Browserbase provisioning, screenshots, Fastify/FastAPI, queues, batches,
  authentication, persistence, recording, React state, and WebSocket protocols remain
  outside shared packages.
- A retry after a successful action must not repeat that action when settling or waiting
  fails afterward.
- Background results and logs must never expose workflow payloads, selectors, URLs,
  parameter values, assertion text, session IDs, artifact IDs, or provider errors.

## Working rules

1. Finish, review, and commit one increment before beginning the next.
2. Add replacements before deleting current implementations.
3. Preserve public runner behavior while moving ownership.
4. Preserve accepted ADRs; supersede them with new records when decisions change.
5. Do not commit, merge, push, or create a pull request without the authorization
   required by the repository guides.

## Increment 1: Root workspace

Status: Complete on `main` in commit `801e054`.

The additive root npm workspace coordinates the frontend and existing automation
packages without moving them or deleting project lockfiles. ADR 0021 records the
decision.

## Increment 2: Provider-neutral deployment ownership

Status: Complete in commit `7c0e054`.

Remove checked-in Railway configuration and active Railway instructions. Keep the
existing private S3-compatible storage and trusted-private-network security boundaries.
Preserve accepted ADRs as history and add backend ADR 0015 to supersede their
vendor-specific deployment portions.

Verification:

- affected backend API tests and Ruff checks;
- frontend changed-test check;
- root typecheck and production build;
- documentation-reference and Git-diff checks.

Suggested commit: `Remove Railway deployment ownership`.

## Increment 3: Replay input and canonical schema 1.4

Status: Complete.

Establish the input boundary required by the shared replay engine. Add
`packages/workflow-contract` and make it the authoritative TypeScript definition of a
workflow that the engine can execute. Move the current frontend domain types, strict
schemas, locator ordering, repeated-group model, profile field IDs, compatibility
readers, and conformance fixtures into it. Keep frontend modules as temporary
compatibility re-exports.

Expose three explicit validation boundaries:

- the canonical schema accepts version `1.4` and the complete current action/assertion
  union;
- the frontend compatibility reader accepts versions `1.0` through `1.3`, including
  assertion-capable `1.2` documents previously emitted by the frontend, and normalizes
  only in memory to `1.4`;
- the executable schema accepts any string version label while enforcing the same
  executable structure, preserving backend ADR 0012.

Generate and check in a JSON Schema artifact for cross-language conformance. Add a
frontend ADR after ADR 0021 that records the shared replay-engine architecture, input
contract, schema policy, and replay-core boundary.

Switch frontend canonical creation, explicit saves, and exports to schema `1.4`. Expand
the Python Pydantic models and persistence OpenAPI schema to accept the complete `1.4`
action/assertion union while retaining read compatibility for stored `1.2` documents.
New backend drafts and explicit saves write `1.4`; reading an existing document does not
rewrite its stored object. Do not change revisions, idempotency, object keys, summaries,
authentication, routes, or automation execution.

Verification:

- shared contract tests and fixture generation check;
- frontend contract, import, serialization, and repository tests;
- frontend changed tests, typecheck, and production build;
- backend model, service, controller, privacy, OpenAPI, lint, and formatting checks;
- root typecheck and build.

Suggested commit: `Share replay input with schema 1.4`.

## Increment 4: Automation-core input convergence

Status: Complete.

Replace automation-core's duplicate workflow model with `@relay/workflow-contract`.
Use the executable validation boundary so schema labels remain opaque to headless
execution. Add the missing repeated-group assertion behavior and shared fixture tests.

Keep automation-core's package location, public exports, runner facade, event/result
shapes, cancellation behavior, privacy filtering, worker, and service unchanged.

Because automation-core now consumes a root package, update `Dockerfile.automation` to
build from the repository root in this same increment. Do not move automation-core.

Verification:

- automation-core contract, assertion, execution, cancellation, and privacy tests;
- worker and service tests, typechecks, and builds;
- automation Docker image build from the root context;
- root typecheck and automation tests.

Suggested commit: `Use the replay input contract for automation`.

## Increment 5: Shared replay engine and headless adoption

Add `packages/replay-core`, the provider-neutral execution layer of the shared replay
engine. Extract phase operations for preflight, frame and target resolution,
positioning, actions and assertions, automatic settling, explicit waits, and redundant
option-click classification.

Every potentially blocking operation accepts cancellation and timeout inputs. The API
exposes phase-level progress so callers can resume after an action without repeating it.
Do not put runner event formats, recovery policy, Browserbase lifecycle, or transport
behavior in replay-core.

Make automation-core delegate to replay-core while preserving its existing public facade
and fail-fast behavior. Delete only backend primitive implementations proven unused.

Verification:

- shared primitive and conformance tests for every current step kind;
- locator, frame, positioning, settling, wait, timeout, and cancellation tests;
- automation-core facade, worker, service, and privacy tests;
- root typecheck, automation tests, build, and Docker build.

Suggested commit: `Extract the shared replay engine`.

## Increment 6: Frontend replay-engine adoption

Keep `ReplayEngine` as the interactive state machine, but replace its duplicated
Playwright primitives with replay-core phase calls. Preserve pause, resume, retry, skip,
stop, manual takeover, frontend diagnostics, and `ServerMessage` behavior.

Prove that recovery resumes at the failed phase and never repeats an action that already
succeeded. Remove frontend primitive implementations only after their replacements pass
the existing recovery tests.

Verification:

- frontend replay, phase-progress, recovery, protocol, and privacy tests;
- shared cross-consumer fixtures produce the same locator, frame, action, assertion,
  settling, and wait semantics;
- frontend changed tests, typecheck, production build, and a local replay smoke test;
- root typecheck, automation tests, and build.

Suggested commit: `Use the shared replay engine in frontend`.

## Deferred follow-up: Relocate automation-core

After Increment 6 is stable, mechanically move
`backend/packages/automation-core` to `packages/automation-core`. Update workspace,
consumer, Docker, lockfile, and documentation paths together. Preserve source and tests
byte-for-byte where practical so Git records a rename.

This relocation remains wanted, but it is deliberately outside the behavior migration.
It must not introduce new APIs, execution behavior, schema changes, dependency upgrades,
or lockfile consolidation.

Verification:

- inspect Git rename detection and the complete diff;
- root install, typecheck, automation tests, and build;
- worker/service checks and automation Docker build.

Suggested commit: `Relocate automation core`.

## Final completion criteria

- frontend, automation-core, and Python persistence agree on shared conformance fixtures;
- both runners use the shared replay engine for provider-neutral Playwright behavior;
- frontend recovery and background privacy boundaries remain unchanged;
- canonical writes use schema `1.4`, while existing `1.2` documents remain readable
  without a bulk migration;
- duplicate contract and replay implementations are removed only after adoption;
- relocation remains separately reviewable and may land after the behavior migration.
