# ADR 0021: Introduce a root Node workspace incrementally

- Status: Accepted
- Date: 2026-08-17

## Context

The frontend and three backend automation packages use the same Node runtime and several
shared dependencies, but each currently installs and locks dependencies independently.
Planned contract and automation-engine sharing needs one reliable local build graph.
Changing package locations, dependency ownership, deployment roots, and application
behavior in the same step would make failures difficult to isolate or roll back.

## Decision

Introduce a private root npm workspace as an additive orchestration layer. It includes
the frontend and the three automation packages at their existing locations and provides
root commands for ordered builds, automation tests, changed frontend tests, and type
checking.

During this first migration increment, retain every project package manifest and
lockfile, keep automation packages under `backend/packages`, and leave Docker, Railway,
and application imports unchanged. In a full checkout, npm resolves to the root
workspace. Project-isolated deployment contexts can continue using their existing
lockfiles and commands while the root workspace is verified. Root overrides preserve
direct versions already selected by the consumer lockfiles where npm would otherwise
upgrade a caret range while combining the graphs. The overrides are transitional
compatibility constraints, not dependency upgrades.

Later increments may move shared packages and adopt the root lockfile as the sole Node
lock only after their consumers and deployment configurations migrate together. Those
increments must remain independently buildable and rollback-friendly.

This decision supersedes ADR 0019 only where it forbids a root Node manifest or
workspace. ADR 0019's application ownership, documentation, package-location, and
deployment boundaries remain accepted until a later decision explicitly changes them.

## Alternatives Considered

### Move packages and delete project lockfiles immediately

Rejected because it couples repository structure, dependency resolution, deployment,
and runtime refactoring into one cutover.

### Keep all Node projects permanently independent

Rejected because shared TypeScript contracts and execution code need a reproducible
cross-project dependency graph.

### Publish private packages before sharing code

Rejected for the current single-repository proof of concept because registry publishing
adds release and credential management without improving local atomicity.

## Consequences

- Developers can install and verify all current Node projects from the repository root.
- Existing project-isolated deployment builds continue to work during migration.
- Lockfiles are temporarily duplicated and must be kept until the owning consumer moves
  to root-only installation in a later verified increment.
- This increment changes orchestration only; it does not move code or change behavior.
