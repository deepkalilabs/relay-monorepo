# ADR 0008: Run a supervised incremental coding loop

- Status: Accepted
- Date: 2026-07-30
- Amends: ADR 0007

## Context

Ralphex can execute a complete multi-task plan and review the resulting branch,
but the desired local workflow publishes one small increment at a time. Every
increment needs fresh implementation context, native multi-agent review,
independent Codex review, and the ADR publication gate before the next increment
starts.

Fresh Claude sessions also need structural and semantic code navigation without
paying the language-server startup and indexing cost for every review pass.

ADR 0007 deliberately kept push authorization outside autonomous-plan startup.
For this manually supervised personal workflow, requiring a separate approval at
every successful increment would interrupt the loop without expanding human
review of the already approved plan.

## Decision

Add a repository-owned wrapper around host-native Ralphex. Master plans use
ordered `Increment` sections. The wrapper renders only the next increment as a
private Ralphex `Task`, reviews it against the previously published checkpoint,
and advances only after successful publication.

Claude performs planning, implementation, and Ralphex's native reviews. Codex
remains an independent external reviewer. Ralphex's best-effort finalizer stays
disabled; the wrapper owns the deterministic ADR-review and push sequence.

Starting `npm run ralph:run -- docs/plans/<slug>.md` explicitly authorizes
task-scoped commits and non-force pushes made by that process to exactly
`codex/<slug>`. It does not authorize any other branch, merge, pull request,
rebase, squash, amend, force-push, or hook bypass.

Run one localhost FastMCP service for the lifetime of the wrapper. It owns one
TypeScript SolidLSP instance and exposes only read-only semantic operations plus
bounded ast-grep search. Claude sessions connect through project-scoped MCP
configuration. Private progress, logs, generated one-task plans, and language
server cache remain under Git's private state directory.

## Alternatives Considered

- Run all Ralphex tasks before review. Rejected because findings would cover a
  larger batch and rollback would be less precise.
- Start SolidLSP separately for every Claude session. Rejected because repeated
  indexing makes short increments unnecessarily slow.
- Expose LSP rename or workspace-edit operations. Rejected because Claude already
  owns file mutation and a second edit path complicates review and recovery.
- Use Ralphex's default finalizer. Rejected because it may rebase and squash, and
  finalize failures are best-effort rather than a publication gate.
- Require a manual push after every increment. Rejected for this supervised
  personal loop because starting the approved plan supplies a narrower,
  auditable authorization.

## Consequences

- Each published increment has its own tests, reviews, ADR outcome, and remote
  checkpoint.
- Remote movement or local divergence fails closed and requires manual recovery.
- Host execution grants Claude broad local permissions; the Git boundary does not
  provide filesystem isolation.
- The operator must approve the project MCP server once and investigate unusual
  failures manually.
- Pull requests and merges remain human-controlled.
