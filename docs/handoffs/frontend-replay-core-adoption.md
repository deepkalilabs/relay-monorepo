# Increment 6: Frontend Replay-Core Adoption

## Status

Implemented and merged to `main` by pull request 9 from
`codex/frontend-replay-core-adoption`.

ADR 0023 records the shared replay execution ownership boundary. ADR 0022 remains the
authoritative shared input and schema decision.

Merged commit: `8da699b` (`Use the shared replay engine in frontend`).

## Objective

Keep `ReplayEngine` as the frontend's interactive orchestration state machine while
replacing its provider-neutral Playwright implementations with phase-level operations
from `@relay/replay-core`.

The completed runner must preserve pause, resume, retry, skip, stop, manual takeover,
diagnostics, timing defaults, replay progress, and every existing `ServerMessage`
shape. A failure in settling, delay, or condition waiting must be retryable without
executing an action that already succeeded.

## Established ownership boundary

`@relay/replay-core` owns:

- executable preflight and bootstrap navigation;
- frame and target resolution, locator ordering, and fingerprint checks;
- recorded-position restoration;
- actions and assertions;
- request and DOM activity tracking;
- automatic settling, explicit delays, and stable visible/hidden waits;
- operation timeouts and `AbortSignal` cancellation; and
- redundant option-click classification.

The frontend continues to own:

- `ReplayEngine` sequencing and phase checkpoints;
- pause and failure-recovery decisions;
- skip, stop, and manual-takeover controls;
- `replay.status` and `replay.step` messages;
- frontend-facing diagnostic wording;
- Browserbase session and page lifecycle; and
- WebSocket protocol, replay UI state, persistence, and transport.

Do not move runner policy into replay-core. Do not make automation-core depend on the
frontend. Do not relocate automation-core in this increment.

## Previous implementation

The duplicate implementation is concentrated in
`frontend/src/server/replay/engine.ts`. It previously owned preflight, locator and frame
resolution, positioning, every action and assertion, request/DOM settling, delay and
condition waits, cancellation polling, diagnostics, and the interactive state machine.

Existing callers import `ReplayEngine` and `preflightReplay` from that module. Tests
also import `applyPositionBefore`, `resolveTarget`, and `resolveTargetOnce`. Preserve
these exports as thin frontend adapters during the migration; do not force unrelated
callers or tests to import replay-core directly.

`frontend/src/server/replay/redundant-option-click.ts` duplicates the shared classifier
and can be removed after its frontend adapter or direct import is covered.

## Required implementation

### 1. Lock existing frontend behavior with adapter tests

Before deleting primitives, characterize the frontend-specific contract around the
shared calls:

- preflight error messages for duplicate IDs, missing start steps, empty ranges, and
  missing bootstrap URLs;
- diagnostic conversion for every structured locator, frame, fingerprint, assertion,
  settle, and wait failure;
- action and assertion phase reporting;
- the absence of post-assertion settling;
- pause before the next step, skip, stop, and manual takeover;
- retry from each failed phase; and
- activity-tracker disposal on completion, stop, and unexpected failure.

Keep existing real-browser coverage for combobox typing, assertion mismatch recovery,
repeated groups, child frames, and recorded positioning.

### 2. Add the frontend dependency and compatibility adapter

Add `@relay/replay-core` to `frontend/package.json` with the same root-package convention
used for `@relay/workflow-contract`. Update the frontend and root lockfiles without
consolidating or deleting project lockfiles.

Keep the public surface of `frontend/src/server/replay/engine.ts` stable. Its helper
exports should delegate to replay-core and translate structured core failures into the
existing frontend behavior. The frontend adapter, not replay-core, owns human-readable
messages and `ReplayDiagnostic` conversion.

Do not expose replay-core's `preflight` phase in `ServerMessage`; the frontend protocol
continues to expose only `acting`, `asserting`, `settling`, and `waiting`.

### 3. Migrate primitives in bounded slices

Use the shared operations in this order, running replay-core and frontend replay tests
after each slice:

1. redundant option-click classification and preflight;
2. frame/target resolution and recorded positioning;
3. action and assertion execution;
4. disposable page-activity tracking and automatic settling; and
5. explicit delay and condition waits.

Delete each frontend implementation only after its adapter tests pass. At completion,
`engine.ts` should contain orchestration, checkpoints, recovery, events, and diagnostic
translation—not provider-neutral DOM or Playwright algorithms.

### 4. Replace polling cancellation with one run signal

Create one `AbortController` per `ReplayEngine` run and pass its signal to every blocking
replay-core operation. `stop()` must abort that controller as well as resolve a pending
recovery decision. Treat core `cancelled` failures as a stopped run, not as recoverable
step failures.

Create one replay activity tracker after the page is available and dispose it in
`finally`. Bootstrap settling and step settling use that same run-owned tracker. Do not
allow its request listeners to survive the run. The shared settling implementation owns
its page-side DOM mutation state; do not duplicate or independently manage that state in
the frontend runner.

Pause remains cooperative between phases and steps. It must not abort an operation that
is already executing; stop must abort promptly.

### 5. Preserve phase checkpoints during recovery

Keep explicit per-step completion state. The intended recovery behavior is:

| Failed phase | Retry or resume repeats | Must not repeat |
| --- | --- | --- |
| `acting` | position and action | completed earlier steps |
| `asserting` | fresh assertion evaluation | completed earlier steps |
| `settling` | settling only | successful action |
| `waiting` during delay | unfinished delay phase | action and settling |
| `waiting` during condition | condition wait only | action, settling, and completed delay |

Mark a checkpoint complete only after its shared operation resolves. Preserve the
current equivalence of `retry` and `resume` while paused on a failure. Assertions begin
and end in `asserting`; they never enter `settling` or `waiting`.

The successful result must retain the locator kind returned by the action/assertion
phase even when later phases are retried.

### 6. Translate failures without changing the protocol

Map `ReplayCoreError.attempts` into the existing
`ReplayDiagnostic.attemptedLocators` array. Use deterministic frontend wording for
outcomes such as no match, multiple matches, hidden matches, fingerprint mismatch,
missing or ambiguous frames, broad repeated-group candidates, and structural mismatch.

Use `ReplayCoreError.detail` only to construct the existing interactive assertion
diagnostics:

- text mismatch: expected and observed normalized text;
- group mismatch: captured count and highest similarity percentages; and
- candidate limit: observed and maximum candidate counts.

That detail is intentionally available to the interactive frontend. Keep it inside the
existing replay message path; do not persist it, log it, add it to background automation
results, or change the automation-core privacy boundary. Never surface selectors or
URLs from structured core failures.

Do not forward raw Playwright or provider error messages. Core failure codes require a
fixed frontend message so diagnostics remain stable and do not leak implementation
details.

## Expected file scope

Primary changes:

- `frontend/package.json`
- `frontend/package-lock.json`
- root `package-lock.json`
- `frontend/src/server/replay/engine.ts`
- `frontend/src/server/replay/redundant-option-click.ts` (remove after adoption)
- `frontend/tests/replay.test.ts`
- `frontend/tests/e2e/replay-fill.spec.ts`
- relevant replay cases in `frontend/tests/e2e/recorder-fixture.spec.ts`
- shared replay documentation and this handoff's status

Touch protocol schemas, UI components, recording code, automation-core, worker/service
packages, or Python persistence only if a failing compatibility test proves it is
necessary. Such a change is a scope warning and must be explained before proceeding.

## Test plan

### Characterization and shared conformance

- Run `npm test --workspace @relay/replay-core` before frontend changes.
- Add frontend adapter tests for every `ReplayFailureCode` the frontend can receive.
- Reuse shared workflow fixtures for all action/assertion kinds, locator ordering,
  frames, fingerprints, positioning, redundant clicks, settling, delays, and stable
  visible/hidden waits.
- Add explicit phase-resumption tests that count action, settle, delay, and condition
  invocations.
- Add cancellation tests for bootstrap, action/assertion, settling, delay, condition
  wait, and paused recovery.

### Frontend verification

From `frontend/`:

```bash
npm run test:changed
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/replay-fill.spec.ts
```

Run the relevant recorder-fixture replay cases as a local browser smoke test when the
fixture server requirements are available. Do not substitute unit mocks for the final
combobox, child-frame, assertion, and position smoke coverage.

### Root and headless regression verification

From the repository root:

```bash
npm run typecheck
npm run test:automation
npm run build
```

The headless suite is required even though Increment 6 changes the frontend consumer:
both consumers must continue agreeing on the shared primitives.

Before an authorized push, inspect the complete committed branch diff and run the
frontend ADR review gate with ADR 0023 recorded as the shared replay execution
decision.

## Acceptance criteria

- `ReplayEngine` remains the interactive state machine and its caller-facing API is
  unchanged.
- All provider-neutral Playwright behavior used by the frontend delegates to
  `@relay/replay-core`.
- Existing `ServerMessage`, replay status, phase, duration, locator-kind, and diagnostic
  shapes are unchanged.
- Pause, resume, retry, skip, stop, and manual takeover behave as before.
- Retrying settling or waiting never repeats a successful action.
- Retrying an assertion performs a fresh assertion evaluation.
- Assertions never settle after evaluation.
- Stop cancels every blocking phase promptly and emits no recoverable failure for the
  cancellation.
- Activity tracking is disposed on every terminal path.
- Frontend diagnostics retain useful assertion observations without exposing selectors,
  URLs, raw provider errors, or changing headless privacy behavior.
- Frontend duplicate primitive implementations and the redundant-click module are
  removed after replacement coverage passes.
- Frontend changed tests, typecheck, production build, focused browser replay tests,
  root typecheck, root automation tests, and root build pass.

## Explicit non-goals

- relocating `backend/packages/automation-core`;
- changing workflow schema version `1.4` or compatibility readers;
- changing WebSocket or `ServerMessage` contracts;
- changing Browserbase lifecycle, session recovery, or transport;
- adding automatic recovery policy to replay-core;
- changing background automation result or error messages;
- dependency upgrades unrelated to replay-core adoption; or
- lockfile consolidation.
