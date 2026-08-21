# @relay/replay-core

Private provider-neutral Playwright primitives shared by Relay replay runners.

See the root [`NAVIGATION.md`](../../NAVIGATION.md) for the complete dependency graph
and change-routing map.

The package owns executable preflight, frame and target resolution, recorded position
restoration, actions and assertions, page activity tracking, automatic settling,
explicit delays and conditions, and redundant option-click classification. Operations
are exposed by phase so a caller can retry settling or waiting without repeating an
action that already succeeded.

Callers provide an existing Playwright `Page`, cancellation signals, and deadlines.
Failures use stable codes and structured attempts without locator or URL values.
Assertion observations required by the interactive product remain isolated in the
failure `detail`; background adapters must never forward that field.

Targetless `page_text_contains` assertions snapshot the attached frame tree once and
search each visible frame independently. Matching is case-insensitive substring
containment after whitespace collapse. Hidden frame trees are skipped, while detached
or uninspectable frames count as not found. Observed document text never leaves the
frame evaluation and is never returned in failure details; a miss uses only the stable
`page_text_missing` detail kind.

The package does not own runner sequencing, events, recovery policy, Browserbase
lifecycle, transport, persistence, screenshots, or user-facing diagnostics.

Automation-core consumes these operations behind its fail-fast facade. The frontend
`ReplayEngine` consumes them behind its interactive phase checkpoints and translates
structured failures into frontend-owned diagnostics.

## Source map

- `src/index.ts` is the supported package export surface.
- `src/preflight.ts` selects the executable range and bootstrap navigation.
- `src/target-resolution.ts` owns frame selection, locator construction, uniqueness,
  visibility, and recorded element fingerprint checks.
- `src/step-actions.ts` owns initial navigation, recorded position restoration,
  canonical actions, and assertions.
- `src/activity.ts` and `src/waits.ts` own request/DOM activity, automatic settling,
  explicit delays, and stable visibility conditions.
- `src/errors.ts` and `src/timing.ts` own structured failures, cancellation, attempts,
  deadlines, and safe defaults.

The package depends only on workflow-contract at runtime. It must remain independent of
Browserbase, React, runner sequencing, HTTP/WebSocket transports, persistence, and
product-specific diagnostics.

## Commands

Run from the repository root after installing the workspace once with `npm ci`:

```bash
npm run build --workspace @relay/workflow-contract
npm run typecheck --workspace @relay/replay-core
npm test --workspace @relay/replay-core
npm run build --workspace @relay/replay-core
```
