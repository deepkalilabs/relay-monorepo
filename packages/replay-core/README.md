# @relay/replay-core

Private provider-neutral Playwright primitives shared by Relay replay runners.

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

## Commands

Run from the repository root after installing the workspace once with `npm ci`:

```bash
npm run build --workspace @relay/workflow-contract
npm run typecheck --workspace @relay/replay-core
npm test --workspace @relay/replay-core
npm run build --workspace @relay/replay-core
```
