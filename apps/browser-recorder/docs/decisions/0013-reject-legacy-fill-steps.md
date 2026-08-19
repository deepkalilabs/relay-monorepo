# ADR 0013: Reject legacy fill steps

- Status: Accepted
- Date: 2026-08-03

## Context

ADR 0006 kept schema `1.0` and `1.1` fill steps readable by maintaining a separate legacy fill shape and injecting `{ source: "recorded" }` during normalization. As the workflow contract added further step families and schema versions, that exception required duplicated step-schema definitions and migration logic at every compatibility boundary.

The application now prioritizes a smaller explicit contract over automatic migration for legacy fill steps. Schema `1.2` already represents fills with the required parameter binding, so it remains the oldest supported fill representation.

## Decision

Exclude `fill` from the schema `1.0` and `1.1` workflow-step unions. A workflow using either version and containing a fill step fails validation at workflow read boundaries, whether or not the step happens to include a parameter binding. Do not synthesize a binding for legacy fills.

Continue normalizing schema `1.0` and `1.1` workflows that contain only supported non-fill actions. Continue normalizing valid schema `1.2` workflows, including fills with explicit bindings, to canonical schema `1.3` in memory.

This decision supersedes only the legacy-fill compatibility decision in ADR 0006 and the blanket `1.0` through `1.2` readability statement in ADR 0012. Their remaining decisions stay in effect.

## Alternatives Considered

- Retain the implicit recorded-binding migration. Rejected because it preserves a second fill contract and version-specific transformation solely for obsolete data.
- Reject all schema `1.0` and `1.1` workflows. Rejected because non-fill workflows normalize without a special step representation or migration policy.
- Accept legacy fills only when they already include a binding. Rejected because those files still claim a schema version whose fill contract never included that field.

## Consequences

- Schema `1.0` and `1.1` workflows containing fills must be converted to schema `1.2` or newer before this application can load them.
- Non-fill legacy workflows and all valid schema `1.2` workflows retain lazy in-memory normalization to `1.3`.
- The workflow contract has one fill schema and no implicit parameter-binding migration.
- Import, repository, and replay-start boundaries consistently reject unsupported legacy fills through the shared compatibility schema.
