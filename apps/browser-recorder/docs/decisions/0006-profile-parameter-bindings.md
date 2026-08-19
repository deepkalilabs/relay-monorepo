# ADR 0006: Parameterize workflow inputs with profile field references

- Status: Accepted
- Date: 2026-07-29

## Context

Recorded `fill` steps currently persist the value entered during recording. Reusing a workflow for another person or context requires editing that payload, even though local profiles already store a small set of reusable identity and location values.

The Library needs to save how each eligible input obtains its value without copying selected profile data or values requested at run time into workflow files. Existing workflow schema `1.0` and `1.1` files must remain readable, recorded payloads must remain intact, and the existing replay engine must not acquire profile-loading or parameter-resolution responsibilities.

ADR 0005 limits canonical profiles to full name, email address, country/region, and postal code. Parameterized workflow runs must use that vocabulary without expanding the profile schema.

## Decision

Introduce canonical workflow schema `1.2`. Every `fill` step in a canonical `1.2` workflow has a required `parameterBinding`:

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
```

Only `fill` steps are parameterizable in version one. Fixed literals are bounded and validated at the workflow schema boundary; the exact bound is part of the contract implementation.

The compatibility boundary normalizes schema `1.0` and `1.1` workflows to canonical `1.2` in memory. Each legacy `fill` step receives `{ source: "recorded" }`, and its original `payload.value` is preserved. Saving a normalized workflow writes schema `1.2` with explicit bindings.

Profile mappings store only a stable `ProfileFieldId`. Runtime bindings store only their source marker. Selected profile IDs are ephemeral run context and are not persisted with workflows. The Library navigates to the existing editor/replay surface with workflow and profile IDs only; resolved values never enter the URL.

Before replay starts, the client loads the current workflow and selected profile, collects any runtime values, validates every enabled parameterized step, and creates an ephemeral workflow whose payloads contain the resolved run values. A missing mapped profile value blocks the run; it does not fall back to the recorded payload. Browserbase session creation occurs only after preflight succeeds.

The existing `replay.start` message envelope and replay engine remain unchanged. The client sends the resolved, validated workflow through that message, and the engine continues to execute ordinary step payloads without loading profiles or interpreting parameter bindings.

Resolved profile and runtime values must not be written to workflow files, Library summary responses, URLs, or replay diagnostics. Sensitive steps retain resolved or missing status in the Library, but their resolved previews are masked.

## Alternatives Considered

- Copy resolved profile values into the workflow. Rejected because it duplicates personal data and makes one saved workflow profile-specific.
- Resolve bindings inside the server replay engine. Rejected because it expands the replay trust boundary and couples the engine to profile persistence.
- Fall back to the recorded value when mapped profile data is absent. Rejected because it can run with unintended personal data while appearing successful.
- Parameterize additional value-bearing step types immediately. Deferred until date formatting and select-option matching have explicit rules.

## Consequences

- Workflow writes move to schema `1.2`; schema `1.0` and `1.1` remain readable through normalization.
- Recorded values remain available and unchanged regardless of the selected binding.
- Workflow files may contain bounded fixed literals and stable profile field IDs, but never resolved profile or runtime values.
- Library and replay preflight can share a pure resolver while the replay engine remains parameter-unaware.
- A profile can be a persistable draft, but a run is blocked when any referenced field is missing.
- Adding profile fields, supporting another step type, or moving resolution across the replay boundary requires a new decision.
