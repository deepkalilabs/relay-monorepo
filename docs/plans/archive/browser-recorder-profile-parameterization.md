# Implementation Plan: Profile-Parameterized Workflow Runs

- Status: Approved
- Product spec: `docs/product/features/profile-parameterization.md`
- Visual reference: parameter workspace screenshot supplied 2026-07-29

## Outcome

Replace the Library’s hard-coded parameter preview with the functional workspace shown in the reference: selected-profile resolution, per-step source modes, auto-map, completeness feedback, revisioned save, and validated handoff to the existing replay surface.

The work is ordered by dependency. Contract and privacy decisions land first; UI work starts only after stable domain and resolver boundaries exist.

## Reference Translation

The reference contributes these product requirements:

- **Parameters** becomes the dominant control surface beneath the workflow preview.
- The selected profile sits in the section header, not in a separate run modal.
- Each row exposes **Parameter**, **Value source**, **Value / mapping**, and **Resolved preview**.
- Source modes are Profile field, Recorded value, Fixed value, Ask when run, and No input required.
- A footer summarizes configuration completeness and owns Save/Run actions.
- Errors are inline and row-specific; successfully resolved rows have a non-color status indicator.

The sample profile vocabulary in the image is not copied wholesale. Current profile fields define the first supported mapping vocabulary.

## Dependency Graph

```text
ADR + contract
      │
      ├── shared resolver + Library auto-map
      │       │
      │       ├── persistence/API/client
      │       │        │
      │       │        └── Library workspace UI
      │       │                 │
      │       └─────────────────┤
      │                         ▼
      └────────────────── run preflight/handoff
                                │
                                ▼
                       targeted browser verification
```

## Stage 1: Record the architectural decisions

ADR 0006 records:

- the workflow schema version and parameter-binding representation;
- backward normalization to Recorded value;
- the stable profile-field vocabulary;
- the privacy boundary that stores references but never resolved profile/runtime values; and
- the decision to resolve to an ephemeral ordinary workflow before the existing replay engine.

Checkpoint: ADR 0006 explicitly addresses compatibility with workflow schema `1.0`/`1.1` and the exact staged diff is reviewed before any authorized commit.

## Stage 2: Add binding and resolution contracts test-first

Move the canonical workflow contract to schema `1.2` with a required `parameterBinding` on `fill` steps, normalize schema `1.0`/`1.1` workflows to explicit Recorded-value bindings, and add stable profile field IDs. Fixed values are persisted with a 10,000-character maximum. Implement pure helpers for:

- determining whether a step is parameterizable;
- reading the recorded payload;
- resolving recorded, fixed, profile, and runtime sources;
- reporting structured missing/invalid states;
- resolving a complete workflow without mutating its saved form; and
- calculating configured/required counts.

Resolution should return structured results, not throw for ordinary missing-input states. Schema violations still fail at the boundary.

Checkpoint: contract and resolver tests prove exhaustive source handling, immutability, compatibility, bounds, and privacy.

## Stage 3: Add deterministic auto-map

Create a small, pure matcher using normalized step name plus target label/accessibility metadata. It returns a suggestion only above an explicit confidence threshold.

Rules:

- Recorded-value bindings are candidates;
- profile/fixed/runtime choices are preserved;
- ambiguous matches remain unchanged;
- v1 field vocabulary is limited to the existing profile schema; and
- suggestions are local until Save.

Checkpoint: table-driven tests cover positive, negative, ambiguous, and preserve-existing cases.

## Stage 4: Load and save full workflow details from Library

Keep summary responses value-free. On selection, request the full workflow through the existing item endpoint and track:

- persisted workflow/revision;
- editable binding draft;
- loading/failure state;
- dirty state; and
- revision conflict state.

Add save support to the workflow-library client or a feature-neutral shared client; do not import a UI component from workflow-editor.

Checkpoint: API/client/component tests show values do not enter list responses and conflicts cannot overwrite newer revisions.

## Stage 5: Load profiles on demand

Load profile summaries for the header picker and fetch full details only for the selected ID. Keep selected profile state ephemeral.

States:

- loading profiles;
- no profiles with a link to create one;
- ready/draft status in the picker;
- selected profile detail failure with retry; and
- selected profile deleted after list load.

Checkpoint: component tests prove selection updates resolution without changing the workflow draft or URL-encoding any profile value.

## Stage 6: Build the parameter workspace

Extract `WorkflowParameters` from `RecordingDetails` and implement the reference hierarchy.

Suggested component boundary:

```text
RecordingDetails
├── MockBrowserPreview
└── WorkflowParameters
    ├── ParameterToolbar
    ├── ParameterMatrix
    │   └── ParameterRow
    └── ParameterFooter
```

Use native table markup at wide widths only if it can retain proper label associations and reflow at 1024px; otherwise use a semantic list of fieldsets with visually aligned column headers. Do not apply conflicting table roles to form labels.

Row behavior:

- source selection swaps the Value / mapping control;
- profile mode selects a supported field;
- recorded mode shows the immutable recorded payload;
- fixed mode edits a bounded literal;
- runtime mode shows the preflight requirement;
- non-input steps show one unavailable state;
- resolved preview is derived, never copied into draft state.

Checkpoint: component tests cover every row mode, accessible names, dirty state, auto-map, completeness, Save enablement, and the selected-profile preview.

## Stage 7: Match the reference responsively

Preserve the application’s current palette and typography while adopting the reference’s density and hierarchy.

### Token direction

- Canvas: `#FCFDFF`
- Surface: `#FFFFFF`
- Muted surface: `#F6F8FB`
- Ink: `#111827`
- Secondary ink: `#526176`
- Primary: reuse `--primary`
- Success/warning: reuse existing semantic tokens or add feature-local accessible values

### Layout

- At 1200px+, render the four aligned columns and footer action bar.
- At 1024–1199px, keep the parameter identity full-width and arrange source, mapping, and preview below without page overflow.
- Keep the desktop guard below 1024px.
- Allow the details pane, not the whole page, to scroll.

### Signature

The memorable element is the live **Resolved preview** column: it behaves like a lightweight preflight trace, with explicit resolved/missing/runtime states rather than decorative badges.

Checkpoint: screenshots at 1440×900 and 1024×768 preserve the reference hierarchy, focus indicators are visible, and reduced-motion/contrast requirements pass.

## Stage 8: Add save conflict and failure handling

Connect Save to the existing revision-protected workflow boundary. Preserve local edits on ordinary failures. For `409` conflicts, fetch the latest workflow and apply a three-way binding rebase. Preserve unrelated remote changes, reapply non-overlapping local bindings, and require **Use saved** or **Keep mine** for same-row overlaps before another save.

Run stays disabled while dirty data is saving, after an unresolved conflict, or while required fixed/profile values are missing.

Checkpoint: tests cover success announcement, failure preservation, conflict reload, and Run gating.

## Stage 9: Add run preflight and replay handoff

Reuse the existing editor/replay surface:

1. Save dirty bindings.
2. Validate the selected profile and binding configuration.
3. Navigate with workflow/profile IDs only; profile-less runs may use a value-free run marker.
4. Load current workflow/profile data again at the replay boundary.
5. Collect runtime values in the existing accessible modal system.
6. Resolve an ephemeral workflow.
7. Send the resolved ordinary workflow through `replay.start`.

Never place profile/runtime values in search params, persisted workflow objects, or diagnostics. Do not create Browserbase until all preflight input is valid and the existing run confirmation is accepted.

If a profile-bound workflow is opened directly without a profile ID, block replay with a link to the Library. Do not fall back to its recorded payload.

Checkpoint: replay tests prove incomplete input sends no `replay.start` message and creates no session; successful resolution changes only the ephemeral payload.

## Stage 10: Browser verification and final review

Add targeted Library and workspace browser journeys:

- select profile and observe preview changes;
- auto-map, manually override, save, reload;
- fixed and recorded modes;
- ask-at-run preflight cancellation and completion;
- missing draft-profile field blocks run;
- no-input workflow remains runnable;
- 1024px overflow;
- keyboard-only operation and axe; and
- absence of sensitive values in visible diagnostics/network URLs.

Run code-quality review before merge. If implementation is authorized later, use `npm run test:changed` throughout and do not run the full suite without explicit permission.

## Planned Files

```text
docs/decisions/0006-profile-parameter-bindings.md
docs/product/features/profile-parameterization.md
src/shared/contracts/workflow/domain.ts
src/shared/contracts/workflow/schema.ts
src/shared/contracts/profile/field.ts
src/shared/contracts/workflow/parameters.ts
src/features/workflow-library/model/autoMapParameters.ts
src/features/workflow-library/model/rebaseParameterBindings.ts
src/features/workflow-library/api/workflowLibraryClient.ts
src/features/workflow-library/components/RecordingDetails.tsx
src/features/workflow-library/components/WorkflowParameters.tsx
src/features/workflow-library/components/WorkflowParameters.module.css
src/features/replay/components/RunWorkflowDialog.tsx
src/app/(product)/workflows/[workflowId]/edit/_hooks/useWorkspaceController.ts
tests/workflow-contract.test.ts
tests/workflow-parameters.test.ts
tests/library-screen.test.tsx
tests/replay.test.ts
tests/e2e/library.spec.ts
tests/e2e/workspace.spec.ts
```

Exact file placement may be tightened during implementation, but shared resolution logic must not live inside a screen component.

## Commands

```bash
npm run test:changed
npm run typecheck
npm run lint
npx playwright test tests/e2e/library.spec.ts tests/e2e/workspace.spec.ts
npm run build
```

Do not run `npm test` or another full test suite unless explicitly requested.

## Risks and Mitigations

- **Sensitive data leakage:** resolve only in memory; assert workflow files, URLs, summaries, and diagnostics never contain selected values.
- **Schema migration damage:** normalize absent bindings to Recorded value and preserve original payloads; cover both legacy schema versions.
- **Stale revisions:** re-fetch before run and block unresolved conflicts.
- **Incorrect auto-map:** require deterministic high-confidence matches and never overwrite explicit choices.
- **Profile expansion by accident:** use only existing `1.1` fields; treat screenshot sample fields as illustrative.
- **Replay coupling:** keep the engine unaware of parameter bindings by resolving before `replay.start`.
- **1024px density:** switch to a stacked row layout inside the details pane rather than shrinking text/controls.
- **Ask-at-run interruption:** collect all values before session creation and preserve user input while validation errors are corrected.

## Verification Gates

1. Spec and product decisions approved.
2. ADR accepted.
3. Contract/resolver tests green.
4. Persistence/API tests green.
5. Library component tests green.
6. Replay preflight tests green.
7. Targeted Playwright journeys green at both supported widths.
8. Typecheck, lint, build, and final multi-axis review green.

## Approved Decisions

1. Version one parameterizes only `fill` steps.
2. Missing profile fields block the run rather than silently using the recorded value.
3. Library runs hand off to the existing editor/replay surface.
4. Sensitive resolved previews retain status and mask their values.

ADR 0006 records the schema and privacy direction. Contract implementation begins with the failing tests in Task 3.
