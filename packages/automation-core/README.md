# @relay/automation-core

Private TypeScript compatibility facade for sequential background execution of Relay
workflow documents. Provider-neutral Playwright phases come from `@relay/replay-core`.
The caller owns the browser and
passes an existing Playwright `Page`; this package does not create browser sessions,
persist runs, or expose a service API.

See the root [`NAVIGATION.md`](../../NAVIGATION.md) for the complete dependency graph
and change-routing map.

## Usage

```ts
import { AutomationRunner, preflightAutomation } from "@relay/automation-core";
import type { Page } from "playwright-core";

export async function runWorkflow(page: Page, document: unknown, signal?: AbortSignal) {
  const automation = preflightAutomation(document);
  const runner = new AutomationRunner(page, {
    signal,
    stepTimeoutMs: 60_000,
    onEvent: (event) => {
      // Forward privacy-safe lifecycle events to the caller's transport or monitor.
      console.info(event.type);
    },
  });

  return runner.run(automation);
}
```

`preflightAutomation(document, startStepId?)` validates the shared executable contract,
rejects duplicate step IDs and empty enabled ranges, selects the starting index, and
chooses a bootstrap URL when the first enabled step is not a navigation. The executable
boundary requires a version string but deliberately treats its value as opaque.

`AutomationRunner` executes the selected range in workflow array order. It skips
disabled steps and redundant recorded option clicks, stops at the first failure, and
returns a `completed`, `failed`, or `cancelled` result. Its event and result diagnostics
contain step IDs, phases, locator kinds, and generic reasons only; they exclude action
payloads, target values, locator values, URLs, workflow bodies, and source session IDs.
Locator resolution also verifies recorded tag and input-type fingerprints before using
a unique visible match. Fill steps recorded against a combobox clear and type
sequentially to preserve the input-event behavior expected by autocomplete controls;
ordinary fills and date inputs continue to use Playwright's direct `fill()` action.

Assertion steps are evaluated once after the preceding action has settled.
`visible` requires one uniquely resolved visible target. `text_contains` applies
case-insensitive, whitespace-normalized containment to the target's visible text.
`group_exists` scans a bounded set of visible structural candidates and applies the
shared contract's repeated-group similarity rules without exposing captured text.
`page_text_contains` snapshots the main frame and attached nested frames, skips hidden
frame trees, and passes when one visible frame contains the normalized phrase. It does
not combine partial phrases across frames, and observed page text never enters events,
results, or diagnostics.
Assertions emit the `asserting` phase, do not settle afterward, and return only fixed
privacy-safe failure diagnostics.

`AutomationRunnerOptions.stepTimeoutMs` controls navigation, locator, action, and wait
deadlines. It defaults to 15 seconds; remote consumers can select a longer deadline.

## Development

Requires Node.js 24 or newer. Run these commands from the repository root so the shared
workflow contract and replay core are installed and built before automation-core.

```bash
npm ci
npm run build --workspace @relay/workflow-contract
npm run build --workspace @relay/replay-core
npm run typecheck --workspace @relay/automation-core
npm test --workspace @relay/automation-core
npm run build --workspace @relay/automation-core
npm pack --dry-run --workspace @relay/automation-core
```

`@relay/replay-core` owns target/frame resolution, canonical step actions, settling, and
waits. `src/execution.ts` remains the privacy-safe compatibility adapter used by the
existing runner and tests.

## Source map

- `src/index.ts` is the supported package export surface.
- `src/workflow.ts`, `src/target-resolution.ts`, and `src/step-actions.ts` preserve the
  existing automation-facing API while delegating shared behavior to workflow-contract
  and replay-core.
- `src/preflight.ts` translates executable preflight into the background runner shape.
- `src/execution.ts` maps replay phases and structured failures to privacy-safe
  automation attempts.
- `src/runner.ts` owns fail-fast step sequencing, events, skips, cancellation, and
  terminal results.
- `src/execution-errors.ts` owns background-safe error and phase projections.

Browser Recorder does not depend on automation-core; both runners consume replay-core
without sharing interactive and fail-fast orchestration policy.

## Deliberate boundaries

This package does not own Browserbase lifecycle, browser creation, queues, schedules,
HTTP or WebSocket APIs, authentication, persistence, retries, recording, interactive
pause/skip/take-control behavior, or monitoring infrastructure. Consumers may map its
events and results onto those facilities without coupling them into the automation
core.
