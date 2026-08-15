# ADR 0020: Normalize workflows to backend schema 1.2

- Status: Accepted
- Date: 2026-08-14

## Context

The Relay backend persists canonical workflow schema `1.2`, while the frontend had advanced its local canonical version through `1.3` and `1.4` as assertion step families were added. A production change aligned new frontend documents with backend schema `1.2`, but it also removed schema `1.4` from the compatibility boundary. Existing local `1.4` workflow files then failed validation and were silently counted as skipped library records even though their step shapes remained supported.

The frontend OpenAPI handoff and contract tests also continued to describe `1.4` as canonical after runtime writes changed to `1.2`.

## Decision

Use schema `1.2` as the canonical frontend and backend write format. Keep the complete current workflow step union, including element and repeated-group assertions, in the canonical frontend schema.

Accept valid schema `1.4` documents at every frontend read boundary that uses `CompatibleWorkflowSchema`, including local files, imports, and remote workflow reads. Validate their complete assertion-capable step shape, then normalize only the in-memory `schemaVersion` to `1.2`. Do not rewrite a stored document until the user explicitly saves it.

Continue the existing compatibility behavior for supported schema `1.0`, `1.1`, and `1.3` documents. Keep rejecting legacy fill steps that ADR 0013 excludes.

Update the frontend cloud workflow OpenAPI handoff to describe canonical schema `1.2`. This decision supersedes the canonical-version and normalization targets in ADR 0012 and ADR 0016; their assertion models and replay semantics remain accepted.

## Alternatives Considered

- Restore schema `1.4` as the canonical write format. Rejected because it would reintroduce the frontend/backend contract mismatch.
- Rewrite existing `1.4` files in place. Rejected because loading a library must not mutate user data, and a failed migration could damage recoverable workflows.
- Treat schema versions as arbitrary metadata. Rejected because explicit versioned validation prevents unsupported document shapes from entering replay and persistence boundaries.

## Consequences

- Existing valid `1.4` workflows appear in the library again without file modification.
- New and explicitly saved workflows serialize as schema `1.2` for Relay backend compatibility.
- Schema `1.2` now identifies the frontend's complete current step union, so consumers must validate the document shape rather than infer supported step families from the version string alone.
- Future canonical-version changes must preserve readers for previously emitted versions and update tests, OpenAPI, and ADRs together.
