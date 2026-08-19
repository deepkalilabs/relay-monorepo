# ADR 0023: Share replay execution primitives

- Status: Accepted
- Date: 2026-08-18

## Context

ADR 0022 made `@relay/workflow-contract` the authoritative replay input boundary, but
the frontend interactive runner and backend automation runner still duplicated
provider-neutral Playwright behavior. Keeping separate implementations for target and
frame resolution, positioning, actions, assertions, settling, and waits allowed the two
runners to drift even when they accepted the same workflow document.

The runners intentionally have different product policy. The frontend supports pause,
recovery, skip, and manual takeover through WebSocket messages, while automation-core
is fail-fast and emits privacy-safe background results. Combining those state machines
would couple unrelated protocols and recovery behavior.

## Decision

Use the private root package `@relay/replay-core` as the provider-neutral execution
layer shared by both runners. It owns executable preflight, frame and target resolution,
recorded-position restoration, actions and assertions, request and DOM activity
tracking, automatic settling, explicit delays and conditions, operation timeouts,
`AbortSignal` cancellation, and redundant option-click classification.

Expose those capabilities as phase-level operations. The operations return locator
kinds and structured failures without selector or URL values. Assertion observations
needed by interactive recovery may appear only in structured failure detail.

Keep orchestration in each consumer:

- frontend `ReplayEngine` owns phase checkpoints, pause, resume, retry, skip, stop,
  manual takeover, `ServerMessage` events, and human-readable diagnostic translation;
- automation-core owns fail-fast sequencing, transport-neutral events, background
  results, and its stricter privacy boundary; and
- Browserbase lifecycle, transport, persistence, and deployment remain outside
  replay-core.

The frontend creates one activity tracker and one abort controller per run. It reuses
the tracker for bootstrap and step settling, disposes it on every terminal path, and
retains explicit completion checkpoints so retrying settling or waiting never repeats a
successful action.

Keep the additive root workspace and project-local lockfiles selected by ADR 0021.
Adopting replay-core does not relocate automation-core or consolidate lockfiles.

This record extends ADR 0022 from shared replay input to shared replay execution. It
does not change ADR 0022's schema, compatibility-reader, or persistence decisions.

## Alternatives Considered

### Keep separate frontend and automation implementations

Rejected because conformance fixtures alone cannot prevent two copies of Playwright
algorithms from drifting as browser behavior and workflow steps evolve.

### Move interactive recovery policy into replay-core

Rejected because pause, manual takeover, WebSocket progress, and user-directed recovery
belong only to the frontend product. Sharing that policy would force the background
runner to depend on interactive concepts.

### Make automation-core the shared package

Rejected because automation-core owns fail-fast result and privacy policy in addition
to execution. Depending on it from the frontend would reverse the intended ownership
direction and expose backend-specific concepts.

### Relocate automation-core during adoption

Rejected because package relocation is mechanical and independently reversible. It is
not required to share behavior and remains a separate follow-up.

## Consequences

- Both runners execute the same provider-neutral replay primitives.
- Frontend retries can resume at settling, delay, or condition checkpoints without
  repeating a successful action.
- Stop cancellation reaches every blocking phase promptly through one run signal.
- Frontend diagnostics remain stable and useful without forwarding raw provider errors,
  selectors, or URLs.
- Changes to shared execution behavior must preserve both interactive and headless
  conformance and privacy tests.
- The frontend and root lockfiles both record the replay-core dependency while existing
  project lockfiles remain in place.
