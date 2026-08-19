# ADR 0024: Normalize monorepo layout and agent tooling

- Status: Accepted
- Date: 2026-08-18

## Context

Repository consolidation began with two self-contained `frontend/` and `backend/`
projects. Later increments introduced a root npm workspace, root-owned shared replay
packages, and cross-project verification. The physical layout no longer communicates
the resulting ownership graph:

- `frontend/` contains a deployable recorder application plus repository-wide Codex,
  Ralphex, Git-hook, ADR-gate, and Python code-intelligence tooling;
- `backend/` contains the deployable Python API, a deployable Node automation service,
  and reusable Node automation packages; and
- reusable Node packages are split between `packages/` and `backend/packages/` with
  relative `file:` dependencies and multiple transitional lockfiles.

This makes root-started agent configuration incomplete, gives repository policy to one
application, and obscures which directories are deployable applications versus reusable
packages. The change must preserve application behavior, public package names, API
contracts, environment interfaces, and rollback-friendly delivery.

## Decision

Normalize the repository through three merge-gated pull requests:

1. Move repository-wide agent configuration, Ralphex orchestration, hooks, ADR
   enforcement, plans, and code-intelligence tooling to the repository root or
   `tooling/`. Root `AGENTS.md` owns shared policy and routes agents to nested guides.
2. Place deployable units under `apps/` and reusable Node libraries under `packages/`:
   `apps/browser-recorder`, `apps/relay-api`,
   `apps/automation-service-browserbase`, `packages/workflow-contract`,
   `packages/replay-core`, `packages/automation-core`, and
   `packages/automation-worker-browserbase`.
3. Complete the root npm workspace transition with one root Node lockfile, standard
   version ranges between workspaces, root-context Node deployments, and explicit root
   verification commands. Python applications and tooling retain independent `uv`
   environments and lockfiles.

Keep package names, exports, CLI binary names, checked-in OpenAPI content, environment
variable names, ports, and runtime behavior unchanged. Do not adopt another monorepo
task runner or package manager as part of this refactor.

Accepted historical ADR contents remain immutable. Mechanical path moves must preserve
their Git blob contents, and a root index will continue to link historical decisions
from their owning applications. Future repository-wide decisions live under root
`docs/decisions/`; application-specific decisions remain with their applications.

Each pull request must remain buildable and revertable. It receives its own committed
diff review, verification, ADR-gate record, non-force push, and human merge before the
next branch is created.

This decision supersedes ADR 0019's top-level `frontend/` and `backend/` layout and ADR
0021's transitional package-location and Node-lockfile ownership. It preserves their
single-repository, application-ownership, incremental-migration, and deployment-safety
rationale.

## Alternatives Considered

### Retain the two imported project directories

Rejected because shared packages and repository-wide tooling already cross those
boundaries. Keeping the imported layout would make directory names increasingly
misleading and preserve application ownership of repository policy.

### Move only agent tooling

Rejected because it would correct Codex discovery but leave deployable applications and
reusable packages interleaved under `backend/`.

### Adopt Nx, Turborepo, pnpm, or another orchestrator during the move

Rejected because the current npm workspace already represents the dependency graph.
Adding a task runner or changing package managers would mix tool selection with a
mechanical ownership refactor and make rollback harder.

### Complete every move in one pull request

Rejected because agent policy, physical paths, installation, and deployment each have
different failure modes. Three merge-gated changes provide useful verification and
rollback boundaries.

## Consequences

- Repository-wide agent configuration is active for sessions started at the root.
- Directory placement communicates deployable versus reusable ownership.
- Node installation and locking eventually have one authoritative root.
- Existing deployment roots and relative paths must change in coordinated increments.
- Historical decision locations remain part of repository history and navigation.
- The refactor requires broad path-only diffs but no application behavior changes.
