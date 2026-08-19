# Browser Memory Recorder Refactor Plan

## Purpose

This plan applies the frontend engineering inspection checklist to the current repository. It is intentionally behavior-preserving: the recorder, workflow editor, Browserbase Live View, replay controls, import/export format, and WebSocket protocol should continue to work throughout the refactor.

The repository has a solid base. TypeScript strict mode is enabled, the application has a documented setup path, workflow data is modeled explicitly, untrusted inputs are validated with Zod, dependencies are locked with `package-lock.json`, and the test suite covers important recorder and replay behavior. The main refactor opportunity is to turn the existing informal boundaries into enforceable ones and reduce the amount of application behavior coordinated by a few large files.

## Current status

Phase 1 is complete. Phase 1.1–1.3 were merged in [PR #2](https://github.com/boblancer/relay/pull/2), and Phase 1.4 subsequently placed route composition, feature behavior, shared contracts, UI primitives, and server adapters under explicit owners. Import direction remains enforced by ESLint.

Verification after Phase 1.1–1.3:

- Type-check: passed.
- Lint: passed with zero warnings.
- Unit/component tests: 107 passed across 11 files.
- Production build: passed.
- Local Playwright E2E: 25 passed; the paid Browserbase smoke test was skipped as designed.

The completed work preserved workflow schema `1.0`, WebSocket messages, user workflows, accessible names, focus behavior, and visual layout.

## Inspection snapshot

### What is already strong

- `tsconfig.json` enables `strict`, `noEmit`, and `isolatedModules`.
- `package.json` exposes `dev`, `build`, `typecheck`, `lint`, `test`, and E2E commands.
- `README.md` documents Node, npm, environment setup, the custom server, security constraints, and the verification loop.
- Secrets are read by the Node server; no `NEXT_PUBLIC_` Browserbase credential was found.
- Workflow concepts have explicit domain types in `src/shared/contracts/workflow/domain.ts`.
- Zod validates workflow imports, exports, recorded actions, and WebSocket messages.
- The workflow reducer keeps step order, selection, dirty state, deletion recovery, and timestamps together.
- UI state such as panel sizing and overlays is local rather than application-global.
- Server provider access is behind `BrowserProvider`.
- Tests cover reducer behavior, schema/import behavior, session event handling, UI state, accessibility, recorder injection, navigation, replay recovery, and the Browserbase adapter.

### Original verification baseline

- Type-check: passed.
- Lint: passed with zero warnings.
- Unit/component tests: 99 passed.
- Local Playwright E2E: 22 passed; the paid Browserbase smoke test was skipped as designed.
- Production build: not conclusively verified. A development process was using `.next`, and a later build attempt was interrupted before completion.

These original results remain a historical baseline, not permission to weaken tests during later extraction.

### Main findings

| Priority | Status              | Area                              | Current evidence                                                                                                                                                                         | Remaining consequence                                                                                               |
| -------- | ------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| P1       | Resolved in PR #2   | Application composition           | `src/app/page.tsx` renders the app-owned workspace, and `useWorkspaceController` exposes grouped browser, recorder, replay, workflow, layout, and dialog models/actions.                 | None for ownership; further render-tree decomposition remains Phase 3 work.                                         |
| P1       | Resolved in PR #2   | Cross-feature imports             | Browser, recorder, replay, and workflow expose public `index.ts` APIs. ESLint rejects deep cross-feature imports and lower-layer imports from `app`.                                    | Continue extending features through their public APIs.                                                              |
| P1       | Open                | Session state ownership           | `useRecorderSession.ts` still coordinates many independent state values, server messages, timers, commands, derived display state, and reset logic.                                    | Valid state combinations remain implicit, and duplicated transition logic can drift.                               |
| P1       | Partially addressed | Oversized coordinators            | Workspace policy moved into `useWorkspaceController`, and `BrowserPanel` now uses grouped props and slots; the workspace and browser render trees still need the Phase 3 component split. | Focused presentation units and controller tests are still needed.                                                   |
| P1       | Open                | Unsafe editor updates             | `StepEditor.tsx` still casts partially updated objects to `WorkflowStep`.                                                                                                               | The discriminated union remains bypassed at the user-edit boundary.                                                 |
| P2       | Resolved            | Protocol cohesion                 | Client messages, server messages, and shared protocol types now have separate modules under `src/shared/contracts/protocol`.                                                          | Message families have explicit ownership while retaining one public contract entry point.                           |
| P2       | Open                | Server orchestration              | `RecordingRuntime` still owns session lifecycle, pages, recorder installation, CAPTCHA state, pickers, navigation, replay coordination, sequencing, and cleanup.                        | Server behavior remains expensive to understand and risky to change.                                                |
| P2       | Open                | Replay engine cohesion            | `engine.ts` still combines preflight, frame/locator resolution, action execution, settling, wait conditions, recovery, and run orchestration.                                         | Replay policies cannot yet be tested or changed independently.                                                      |
| P2       | Open                | Injected recorder maintainability | `injected.ts` remains a large raw script string.                                                                                                                                         | Logic inside the string receives less direct TypeScript, lint, and modularity support than normal source files.     |
| P2       | Open                | Test organization                 | Several test files remain large, including navigation, component, replay, and recorder-fixture suites.                                                                                  | Coverage is strong, but ownership and failure localization will worsen as features grow.                            |

## Target dependency model

Use `app` as the composition boundary and make feature APIs explicit:

```text
app
 ├── recorder
 ├── browser
 ├── workflow
 └── replay
       ↓
shared contracts and utilities
       ↓
design-system primitives
```

Server code may depend on shared contracts and server adapters, but client features must not import server modules.

Recommended target structure:

```text
src/
  app/
    (product)/
      workflows/[workflowId]/edit/
        _components/
        _hooks/
        _styles/
    (test-support)/
      fixture/
    _styles/

  features/
    browser/
      components/
      model/
      index.ts
    recorder/
      components/
      model/
        session.reducer.ts
        session.selectors.ts
        session.types.ts
        useRecorderSession.ts
      transport/
        useRecorderSocket.ts
      index.ts
    replay/
      components/
      model/
      index.ts
    workflow-editor/
      components/
      model/
        workflow.reducer.ts
        workflow.commands.ts
      api/
      import-export/
        exportWorkflow.ts
      index.ts
    workflow-library/

  shared/
    contracts/
      protocol/
      recording/
      workflow/
    ui/

  server/
    infrastructure/
    recording/
    replay/
    workflows/
```

This is a destination, not a request for one large file-moving change. Move code only when a boundary has an API and tests.

## Refactor principles

1. Keep each pull request behavior-preserving unless it is explicitly labeled as a product change.
2. Prefer extraction behind an existing interface over a repository-wide rewrite.
3. Preserve the workflow JSON schema version and WebSocket message behavior.
4. Store source state once and calculate display state through selectors.
5. Model lifecycle transitions with discriminated actions rather than coordinated setter calls.
6. Keep Browserbase and Playwright types at adapter boundaries.
7. Add an enforceable dependency rule before relying on the new folder structure.
8. Keep the application usable and the baseline test suites passing after every phase.

## Phased implementation

## Phase 1 — Establish application and feature boundaries (completed)

### 1.1 Move workspace composition into `app` — Completed

**Status:** Completed and merged in PR #2.

- Moved `RecorderWorkspace`, `WorkspaceNavbar`, and `useWorkspacePanels` out of `features/recorder`; they now live in private folders beneath the workflow editor route.
- Added `useWorkspaceController` as the owner of workflow state, session effects, derived locks, import/export policy, replay requests, dialogs, and intent handling.
- Exposed grouped browser, recorder, replay, workflow, layout, and dialog models/actions instead of leaking the broad recorder session into composition.
- Kept `src/app/page.tsx` as the route entry and changed it to render the app-owned workspace.
- Left recorder controls and `useRecorderSession` inside `features/recorder`.

Acceptance criteria:

- [x] Recorder code no longer imports workflow or browser feature internals.
- [x] Removing replay UI does not require editing recorder model code.
- [x] The workspace component primarily composes feature views and maps controller groups to props.

### 1.2 Add feature public APIs — Completed

**Status:** Completed and merged in PR #2.

- Added narrow public `index.ts` entry points for browser, recorder, replay, and workflow.
- Converted imports outside each feature to `@/features/<feature>` and kept same-feature imports relative.
- Updated tests to consume public feature APIs.
- Added ESLint restrictions that prevent deep cross-feature imports, imports from lower layers into `app`, and client imports from `server`.
- Preserved the root-layout exception required for global feature CSS imports.
- Removed old deep-path modules after consumers migrated; no compatibility re-exports were added.

Acceptance criteria:

- [x] Dependency direction is mechanically checked by ESLint.
- [x] Circular feature dependencies are absent.
- [x] Shared folders did not receive displaced feature code.

### 1.3 Remove browser-to-recorder and browser-to-replay coupling — Completed

**Status:** Completed and merged in PR #2.

- Added browser-owned page, popup, date-picker, and select-picker state types under `features/browser/model`.
- Replaced the broad scalar `BrowserPanel` contract with grouped `BrowserViewModel` and `BrowserActions` interfaces.
- Added `toolbar`, `emptyActions`, and `contentOverlay` composition slots plus generic empty-state and alert contracts.
- Moved navigation availability, preparation/reconnection flags, error wording, empty-state wording, and recorder/replay composition into the app workspace.
- Added replay-owned `ReplayFailurePanel` presentation and replay styles.
- Preserved Live View focus restoration, CAPTCHA locking, picker behavior, navigation, popup handling, and existing accessible names.

Acceptance criteria:

- [x] `features/browser` imports neither `features/recorder` nor `features/replay`.
- [x] Browser rendering is tested through grouped browser models/actions and explicit slots.
- [x] Recorder and replay controls can change without editing browser internals.

### 1.4 Put files under their actual owners — Completed

**Status:** Completed.

- Moved recorder transport, presentation types, selectors, and recorded-action conversion under `features/recorder`.
- Moved replay result presentation types under `features/replay`.
- Moved workflow reducer, client API, and browser export behavior under `features/workflow-editor`.
- Moved workflow, recording, and protocol contracts into client/server-safe shared packages.
- Split protocol schemas by client message, server message, and common protocol types.
- Moved workspace composition into private folders beneath the workflow editor route.
- Moved shared UI primitives and server infrastructure adapters under explicit owners.

Acceptance criteria:

- [x] Every non-shared module has an obvious product owner.
- [x] Contract modules contain no React, DOM, Node, Browserbase, or Playwright dependency.

## Phase 2 — Make state transitions explicit

### 2.1 Replace coordinated recorder setters with a reducer

Create a pure recorder-session reducer that consumes normalized actions:

```ts
type RecorderSessionAction =
  | { type: "transport.changed"; status: TransportStatus }
  | { type: "recording.start-requested" }
  | { type: "recording.started"; session: RecordingSession }
  | { type: "recording.stopped" }
  | { type: "browser.page-changed"; page: BrowserPage }
  | { type: "browser.navigation-failed"; message: string }
  | { type: "picker.opened"; picker: BrowserPicker }
  | { type: "captcha.changed"; pageId: string; status: CaptchaStatus }
  | { type: "replay.started"; replay: ReplayRun }
  | { type: "replay.step-changed"; result: ReplayStepResult }
  | { type: "replay.finished"; status: ReplayCompletion }
  | { type: "session.failed"; context: ErrorContext; message: string };
```

- Normalize each `ServerMessage` into one reducer action before it reaches state.
- Move pure transition logic and selectors out of the hook.
- Keep timers, sockets, focus management, and message sending in effects/adapters.
- Model session mode explicitly instead of inferring it from overlapping recording and replay statuses.
- Derive `displayStatus`, `displayError`, locks, button availability, and active replay result through selectors.
- Consolidate repeated session-reset behavior into reducer transitions.

Acceptance criteria:

- The reducer is deterministic and has transition-table tests.
- Impossible combinations are unrepresentable or rejected.
- `useRecorderSession` coordinates adapters and exposes commands; it does not contain a monolithic message switch plus many setter calls.

### 2.2 Normalize browser page, picker, and CAPTCHA state

- Use one active-page source of truth.
- Store per-page CAPTCHA information with page/session state rather than coordinating `activePageId`, `browserPage`, and a separate status map from the view.
- Represent date and select pickers as one discriminated `BrowserPicker` union.
- Keep transient completion notices separate from persistent session state.

Acceptance criteria:

- Switching pages clears or restores page-scoped overlays through one transition.
- Components cannot render both picker kinds at once.
- Active-page identity is not duplicated across independent state values.

### 2.3 Consolidate workspace overlay state

Replace `manualOpen`, `runDialogOpen`, `confirmation`, `pendingImport`, and `pendingReplayStartId` with one discriminated overlay state:

```ts
type WorkspaceOverlay =
  | { type: "none" }
  | { type: "manual-step" }
  | { type: "run-workflow"; startStepId?: string }
  | { type: "confirm-new" }
  | { type: "confirm-sensitive-export" }
  | { type: "confirm-import"; workflow: Workflow };
```

Acceptance criteria:

- Mutually exclusive dialogs cannot be open simultaneously.
- CAPTCHA locking closes overlays with one action.
- Pending data is owned by the overlay that requires it.

### 2.4 Keep workflow edits type-safe

- Add workflow commands for variant-safe edits: rename, enable, change payload, change target, change position, and change wait condition.
- Narrow on `step.type` before editing variant payloads.
- Stop casting arbitrary object spreads to `WorkflowStep`.
- Decide explicitly whether invalid intermediate form drafts are allowed:
  - if allowed, keep draft strings in editor-local form state and commit valid values;
  - if not allowed, reject the edit and show an inline validation message.

Acceptance criteria:

- `StepEditor` contains no `as WorkflowStep` casts.
- Reducer tests prove edits preserve the step discriminant and required payload.
- Export validation remains a final safety boundary, not the first place invalid editor state is discovered.

## Phase 3 — Split components by responsibility

### 3.1 Reduce `RecorderWorkspace`

Extract app-owned pieces:

- `WorkspaceLayout` for the three-panel shell and resizers.
- `WorkflowDialogs` for manual, run, import, new-workflow, and sensitive-export flows.
- `UndoStepToast` for deletion recovery.
- `useWorkspaceController` for orchestration and policy.

Keep feature components focused on rendering and intent callbacks.

Acceptance criteria:

- The workspace render tree is readable without tracing business logic.
- Import, export, replay-start, and new-recording flows have focused controller tests.

### 3.2 Reduce `BrowserPanel`

Extract:

- `BrowserChrome` and `BrowserAddress`.
- `LiveViewFrame`.
- `BrowserEmptyState`.
- `CaptchaOverlay`.
- `BrowserConnectionNotice`.
- browser-owned picker overlay host.

Use a small view-model prop instead of dozens of unrelated scalar props:

```ts
interface BrowserViewModel {
  page: BrowserPage | null;
  liveViewUrl: string | null;
  availability: BrowserAvailability;
  navigation: NavigationState;
  picker: BrowserPicker | null;
}
```

Acceptance criteria:

- Subcomponents have one clear rendering responsibility.
- Availability policy is computed outside JSX.
- Focus effects remain close to the element they control.

### 3.3 Split `StepEditor` into variant-aware sections

- `StepSummaryFields`.
- `StepPayloadEditor`, with a typed editor per action family.
- `TargetEditor`.
- `ViewportPositionEditor`.
- `ReplayWaitEditor`.
- `ReplayResultPanel`.

Acceptance criteria:

- Each action type exposes only valid fields.
- Target-less navigation steps do not pass through target update code.
- Wait and locator editors can be tested independently.

### 3.4 Remove duplicated navigation actions

- Extract shared import/export/replay action controls used by expanded and collapsed navbar variants.
- Preserve intent-based APIs such as `onImport`, `onExport`, and `onReplay`.
- Keep native `<button>`, `<input type="file">`, `<form>`, and `<select>` elements.

Acceptance criteria:

- Collapsed and expanded layouts share behavior without duplicating event code.
- Existing keyboard and accessibility coverage continues to pass.

## Phase 4 — Decompose protocol and server runtime

This phase follows the frontend state work because the new client boundaries reveal the protocol seams that should be preserved.

### 4.1 Split the protocol by message family

Create schemas for:

- transport envelope and sequencing;
- session lifecycle;
- browser navigation/page events;
- picker commands/events;
- CAPTCHA events;
- replay commands/status/results;
- recorded actions.

Compose these into the exported client and server unions.

Acceptance criteria:

- Existing wire messages remain compatible.
- Each message family has focused schema tests.
- Client features import only the contract family they consume.

### 4.2 Replace the server command chain with handlers

- Move custom Next/HTTP/WebSocket setup into server composition modules.
- Replace the long `if/else` command dispatch in `server.ts` with an exhaustive handler or switch that delegates by domain.
- Type the Next request handler directly and remove the `as never` bridge.
- Keep connection authentication/configuration and runtime lookup at the transport boundary.

Acceptance criteria:

- `server.ts` is an entry point, not the application implementation.
- Adding one command does not require editing unrelated command branches.
- Invalid-message handling and sequencing behavior are unchanged.

### 4.3 Split `RecordingRuntime` into collaborators

Extract behind narrow interfaces:

- `SessionLifecycle` for provider connect/release and disconnect grace periods.
- `PageRegistry` for active page, popup registration, frames, and page events.
- `RecorderInstaller` and `ActionForwarder`.
- `CaptchaCoordinator`.
- `PickerCoordinator`.
- `NavigationController`.
- `ReplayCoordinator`.
- `SequencedMessageBuffer`.

Keep `RecordingRuntime` temporarily as a facade so WebSocket handling and tests can migrate incrementally.

Acceptance criteria:

- The runtime facade delegates instead of owning every subsystem.
- Each collaborator has isolated lifecycle and cleanup tests.
- Release remains idempotent and clears all timers/listeners.

### 4.4 Split replay policy from orchestration

Extract:

- `preflightReplay`.
- frame resolution.
- locator candidate resolution.
- step execution.
- automatic network/DOM settling.
- explicit wait conditions.
- recovery state machine.

Inject clock/sleep behavior into settling and recovery tests instead of relying on real timers where practical.

Acceptance criteria:

- Locator resolution can change without touching run recovery.
- Settling policy has deterministic tests.
- The run orchestrator reads as a sequence of domain operations.

### 4.5 Convert the injected recorder into normal modules

- Move recorder logic into typed source modules grouped by event capture, target description, accessible naming, picker interception, navigation, and emission.
- Bundle those modules into the injected browser script during development/build.
- Keep the generated artifact out of hand-edited source.
- Run unit tests against pure helpers and E2E against the bundled script.

Acceptance criteria:

- Injected source is type-checked and linted as ordinary TypeScript.
- The runtime installs one generated script with unchanged browser behavior.
- Recorder fixture tests remain the compatibility suite.

## Phase 5 — Align tests with ownership

### 5.1 Co-locate focused unit tests

- Put reducer, selector, schema, and component tests beside their owners or mirror the feature structure under `tests/unit`.
- Split large suites by behavior:
  - navigation lifecycle;
  - page/popup management;
  - picker behavior;
  - CAPTCHA behavior;
  - replay locators;
  - replay settling;
  - replay recovery;
  - workflow editor components.

### 5.2 Add architecture tests

- Add an import-boundary check to CI.
- Add protocol compatibility fixtures for representative schema `1.0` workflows and WebSocket messages.
- Add an environment-config test matrix.
- Add reducer transition tests for every server event and user command.

### 5.3 Preserve E2E scope

- Keep local fixture-based E2E deterministic and free.
- Keep the paid Browserbase smoke test explicit and separately authorized.
- Continue accessibility scanning and minimum-width layout checks.

Acceptance criteria:

- Test filenames reveal feature ownership.
- A failing test points to one subsystem.
- Refactors can be performed without weakening protocol, recorder, replay, or accessibility coverage.

## Suggested implementation sequence

Completed in PR #2:

1. [x] Move workspace composition into `app`, add feature public APIs, and enforce import boundaries.
2. [x] Make `BrowserPanel` browser-only through grouped models/actions and app-composed recorder/replay slots.

Continue with focused pull requests:

1. Complete Phase 1.4 ownership moves for the recorder socket, remaining session types, workflow reducer, workflow contracts, and persistence adapters.
2. Add a pure recorder-session reducer and selectors.
3. Normalize browser page, picker, and CAPTCHA state.
4. Replace coordinated workspace dialog state with one overlay union.
5. Add type-safe workflow edit commands and split `StepEditor`.
6. Split the workspace and `BrowserPanel` render trees into focused subcomponents; app-composed recorder/replay controls are already complete.
7. Split protocol schemas without wire changes.
8. Extract the server entry point and command router.
9. Decompose `RecordingRuntime` into collaborators.
10. Decompose replay engine policies.
11. Convert the injected recorder to typed, bundled source.
12. Align test-suite files with feature ownership.

Each later pull request should include only the tests and file moves needed for that seam. Avoid combining repository-wide renames, formatting, state redesign, and behavior changes.

## Completion checklist

### Architecture

- [x] `app` owns cross-feature composition.
- [x] Every feature exposes a small public API.
- [x] Feature internals are not imported across boundaries.
- [ ] Shared contracts are framework- and vendor-independent.
- [x] Browserbase and Playwright remain behind server adapters.
- [x] Import direction is automatically enforced.

### Components

- [ ] Workspace, browser panel, and step editor are split into focused units.
- [x] `BrowserPanel` receives grouped view models, intent callbacks, and composition slots.
- [x] Recorder and replay controls are not hard-coded inside browser presentation.
- [x] Native accessible elements and current focus behavior are preserved.

### State and data flow

- [ ] Recorder lifecycle is represented by explicit reducer actions.
- [ ] Active page and picker state each have one source of truth.
- [ ] Workspace dialogs use one discriminated overlay state.
- [ ] Display locks and statuses are derived with selectors.
- [ ] Workflow edits do not bypass the discriminated union with casts.
- [ ] Timers, sockets, browser messages, downloads, and focus changes are isolated effects.

### Maintainability

- [ ] Protocol message families are independently owned and tested.
- [ ] Recording runtime and replay policies are decomposed behind interfaces.
- [ ] Injected browser code is normal typed source before bundling.
- [ ] Tests are organized by feature and behavior.
- [x] Workflow schema `1.0` and existing wire behavior remain compatible.

## Deliberate non-goals

- Do not introduce a global state library solely to replace reducers.
- Do not add server-state tooling while workflows intentionally live only in the current tab.
- Do not add routing or URL state without a shareable navigation requirement.
- Do not change workflow persistence, authentication, collaboration, branching, or other documented MVP boundaries as part of this refactor.
- Do not redesign the visual system while changing ownership and state flow.
- Do not change the paid Browserbase execution policy.

## Expected outcome

After these phases, a new engineer should be able to locate a behavior by product domain, understand legal session transitions from a reducer, change one feature through its public API, verify the repository with one command, and remove a feature without editing unrelated internals. The refactor should improve change safety without changing the product users already have.
