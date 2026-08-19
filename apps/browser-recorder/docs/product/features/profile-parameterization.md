# Feature Spec: Profile-Parameterized Workflow Runs

- Status: Approved
- Reference: parameter workspace screenshot supplied 2026-07-29
- Last updated: 2026-07-29

## Objective

Let a user decide where each workflow input gets its value, see the value that would be used with a selected profile, save that configuration, and start a validated run.

The Library parameter workspace should answer four questions without opening the workflow editor:

1. Which workflow steps accept input?
2. Where will each input value come from?
3. What value will the selected profile resolve to?
4. Is the workflow ready to run?

## Approved Product Decisions

- The supplied screenshot is authoritative for interaction hierarchy, not for its illustrative profile vocabulary.
- Version one maps only to fields already stored by profile schema `1.1`: full name, email address, country/region, and ZIP code.
- Version one parameterizes `fill` steps. Other step types remain unchanged until their formatting and option-matching rules are specified.
- A missing mapped profile value blocks the run and never falls back silently to the recorded value.
- “Ask when run” values are entered during run preflight and are never persisted.
- Clicking **Run workflow** uses the existing workflow-editor replay surface; it does not create a second Library-owned replay runtime.
- Resolved previews for sensitive steps show masked values while retaining their resolved or missing status.
- The application remains local, single-user, and desktop-only at widths of 1024px and above.

## User Experience

### Select a workflow and profile

The existing Library list and browser preview remain. The selected workflow’s full details load behind the summary view.

The Parameters header contains:

- a profile picker showing saved profile name and readiness;
- **Auto-map fields**, which proposes mappings without saving them; and
- help text: “Choose where each input gets its value.”

Selecting a profile updates resolved previews in memory. The profile ID and values are not copied into the workflow file.

### Configure parameter sources

Each workflow step appears once in sequence order. Rows use four columns at wide widths:

1. **Parameter** — step number and user-facing step name.
2. **Value source** — one of the modes below.
3. **Value / mapping** — the control appropriate to the mode.
4. **Resolved preview** — the value that would be used, or a specific blocking state.

Supported source modes:

| Source | Stored with workflow | Value / mapping control | Resolution |
|---|---:|---|---|
| Profile field | Stable profile field ID | Profile field picker | Value from the selected profile |
| Recorded value | Source marker only | Read-only recorded payload | Original step payload |
| Fixed value | Source marker and literal | Editable text input | Stored fixed literal |
| Ask when run | Source marker only | “Required at run time” status | Value entered during preflight |
| No input required | Nothing | No control | Non-parameterizable step |

Changing away from **Recorded value** must not overwrite the original step payload. Returning to **Recorded value** restores the recorded payload.

### Auto-map

**Auto-map fields** proposes profile-field mappings by comparing normalized step names and target labels with the supported field vocabulary.

- Auto-map changes the local draft only.
- Recorded-value rows are eligible for replacement; profile, fixed, and runtime choices are preserved.
- Ambiguous or low-confidence matches remain unchanged.
- The user must save the resulting configuration.

### Resolved preview and completeness

Resolved previews update when the profile, source, mapping, or fixed value changes:

- resolved values show text plus a success icon;
- missing profile data names the missing field;
- an empty fixed value says “Enter a value”;
- ask-at-run says “Required at run time” and is counted as incomplete until run preflight;
- non-input steps show an em dash.

The footer shows “N of M required inputs configured.” **Run workflow** remains disabled when a saved configuration has unresolved profile or fixed values. Ask-at-run rows may proceed to preflight, where every requested value becomes required.

### Save and run

**Save** writes parameter bindings through the existing revision-protected workflow boundary. On conflict, unchanged bindings rebase automatically over the latest workflow. Same-row overlaps require an explicit **Use saved** or **Keep mine** choice before retrying.

**Run workflow**:

1. saves dirty mappings;
2. validates the selected profile and every enabled parameterized step;
3. navigates to the existing workflow editor/replay surface with the selected workflow/profile IDs; profile-less runs may use a value-free run marker;
4. requests ask-at-run values in a focus-trapped preflight dialog;
5. creates an in-memory resolved workflow; and
6. opens a Browserbase session only after confirmation succeeds.

The resolved workflow is ephemeral. Profile and ask-at-run values must not be written to workflow files or replay diagnostics.

Opening a profile-bound workflow directly in the editor does not silently use recorded values. Replay is blocked with a link to choose a profile in the Library. Workflows that use only recorded, fixed, or runtime sources remain directly replayable.

## Domain Contract

Canonical workflow schema `1.2` introduces a required binding on eligible steps:

```ts
type ProfileFieldId =
  | "identity.fullName"
  | "identity.email"
  | "location.countryRegion"
  | "location.postalCode";

type ParameterBinding =
  | { source: "recorded" }
  | { source: "fixed"; value: string }
  | { source: "profile"; field: ProfileFieldId }
  | { source: "runtime" };

type FillStep = ElementWorkflowStepBase & {
  type: "fill";
  payload: { value: string };
  parameterBinding: ParameterBinding;
};
```

Rules:

- schema `1.0` and `1.1` workflows containing `fill` steps are rejected instead of receiving an implicit binding;
- non-fill schema `1.0` and `1.1` workflows continue to normalize at read boundaries;
- canonical schema `1.2` workflows require `parameterBinding` on every `fill` step;
- bindings are permitted only on `fill` steps in version one;
- the recorded payload remains canonical and immutable from the parameter workspace;
- fixed literals are bounded to 10,000 characters and validated at the workflow schema boundary;
- profile values and runtime values never appear in `ParameterBinding`.

ADR 0006 records the binding schema and trust boundary. ADR 0013 supersedes its legacy-fill migration decision.

## Architecture and Data Flow

```text
Workflow summary ──select──> full workflow + revision
                                   │
Profile summaries ──select──> full profile
                                   │
                                   ▼
                         local parameter draft
                         │       │         │
                      preview  auto-map   save
                         │                  │
                         │          workflow repository
                         ▼
                  run preflight dialog
                         │
                  ephemeral resolver
                         │
                         ▼
                 existing replay runtime
```

The resolver lives beside the shared workflow contract so both the Library and route-owned editor composition can use it without crossing feature boundaries. Auto-map remains Library-owned. The server/replay engine continues to receive an ordinary validated workflow whose step payloads already contain resolved values.

## Failure and Empty States

- No saved profiles: profile mappings are unavailable; link to **New profile**.
- Draft profile: allow selection, but mark missing referenced fields inline.
- Deleted profile: clear the selection and block profile-mapped rows.
- Profile load failure: retain workflow edits, clear resolved previews, and offer retry.
- Workflow save conflict: safely rebase non-overlapping bindings and require row-level resolution for overlaps.
- Workflow changed after Library load: refresh full details before save/run.
- No parameterizable steps: show “This workflow has no inputs to configure”; Save is hidden and Run remains available.
- Runtime prompt cancelled: return to preflight without starting a browser session.

## Non-goals

- Adding phone, city, state, or split-name fields to profiles.
- Free-form expressions, templates, transformations, or conditional logic.
- Parameterizing select/date/navigation steps in version one.
- Persisting the selected profile or remembering it per workflow/device.
- Secret management, credential injection, remote storage, or profile sharing.
- Including profile values in Library summary responses, workflow files, URLs, or diagnostics.

## Tech Stack and Commands

- Next.js/React/TypeScript client UI
- Zod shared contracts
- Revision-protected JSON filesystem repositories
- Vitest and Testing Library
- Playwright and axe

```bash
npm run test:changed
npm run typecheck
npm run lint
npx playwright test tests/e2e/library.spec.ts tests/e2e/workspace.spec.ts
npm run build
```

Do not run `npm test` or the full Playwright suite unless explicitly requested.

## Code Style

Model source modes as a discriminated union and keep resolution exhaustive:

```ts
function resolveParameter(
  binding: ParameterBinding,
  recordedValue: string,
  context: ParameterContext,
): Resolution {
  switch (binding.source) {
    case "recorded":
      return { status: "resolved", value: recordedValue };
    case "fixed":
      return binding.value
        ? { status: "resolved", value: binding.value }
        : { status: "missing", reason: "Enter a value." };
    case "profile":
      return resolveProfileField(context.profile, binding.field);
    case "runtime":
      return resolveRuntimeValue(context.runtimeValues, context.stepId);
  }
}
```

## Project Structure

```text
src/shared/contracts/
  Versioned workflow bindings and stable profile field IDs
src/shared/contracts/workflow/
  Pure parameter resolution shared by Library and editor composition
src/features/workflow-library/
  Profile/workflow loading, auto-map, parameter workspace, save, and run handoff
src/features/replay/
  Runtime-value preflight and existing replay confirmation
tests/
  Contract, resolver, client, component, replay, and targeted browser coverage
docs/decisions/
  Accepted schema and privacy-boundary decision
```

## Testing Strategy

- Contract tests cover schema compatibility, binding eligibility, bounded fixed values, and rejection of embedded profile values.
- Resolver tests cover every source mode, missing/draft profiles, runtime values, disabled steps, and immutability.
- Repository/API/client tests prove revisioned saves and that Library summaries remain value-free.
- Component tests cover full-detail loading, profile selection, auto-map, row controls, previews, completeness, dirty state, and conflicts.
- Replay tests prove resolution occurs before `replay.start` and no browser session starts on incomplete input.
- Targeted Playwright tests cover the screenshot flow, keyboard order, axe, save/reload, run preflight, and 1024px overflow.

## Boundaries

- **Always:** resolve before session creation, preserve recorded payloads, validate all untrusted data, redact profile/runtime values from diagnostics, and run `npm run test:changed`.
- **Ask first:** expand the profile vocabulary, parameterize another step type, add transformations, remember profile selection, or change the replay protocol.
- **Never:** persist profile/runtime values in workflow mappings, expose them in summary APIs or URLs, start Browserbase before preflight succeeds, add dependencies without approval, or bypass revision checks.

## Success Criteria

- The Library matches the supplied hierarchy: profile controls, four-column parameter matrix, resolved preview, completeness footer, Save, and Run.
- A saved binding survives reload while the original recorded value remains intact.
- Selecting different profiles updates previews without modifying the workflow.
- Auto-map never overwrites an explicit choice or saves automatically.
- Fixed values persist; ask-at-run values do not.
- Missing required data blocks Browserbase session creation and identifies the affected row.
- A completed preflight produces an ephemeral workflow with resolved payloads.
- Profile and runtime values are absent from workflow files, URLs, and replay diagnostics.
- Existing schema `1.0`/`1.1` workflows load only when they contain no fill steps; legacy fills require conversion to schema `1.2` or newer.
- Fixed and runtime inputs enforce the 10,000-character interaction bound.
- Sensitive resolved previews mask their values without hiding resolution status.
- The layout has no horizontal overflow at 1024×768 and passes axe/keyboard checks.

Implementation remains gated on the contract tests and schema work described in the implementation plan.
