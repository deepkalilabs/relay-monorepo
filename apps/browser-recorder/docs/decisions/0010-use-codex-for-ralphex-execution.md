# ADR 0010: Use Codex for Ralphex execution

- Status: Accepted
- Date: 2026-07-30
- Amends: ADR 0008

## Context

ADR 0008 assigns Ralphex planning, implementation, and native reviews to Claude,
with Codex as an independent external reviewer. The local Claude OAuth session
can expire independently of the active Codex login and prevent plan creation
before any repository work starts.

Ralphex 1.6.1 provides a native `--codex` executor mode for plan creation, task
execution, review, and finalization. In that mode Ralphex intentionally skips its
separate external-review phase.

## Decision

Run both `ralph:plan` and `ralph:run` with Ralphex's `--codex` option. Codex
performs interactive planning, increment implementation, and Ralphex's native
multi-agent review/fix passes. Do not configure a second external review within
Ralphex because its Codex executor mode does not run that phase.

Keep the persistent read-only code-intelligence service, but register its
localhost HTTP endpoint in the trusted project Codex configuration at
`.codex/config.toml`. Remove the Claude-specific `.mcp.json` registration.

The wrapper continues to own deterministic changed-test verification, ADR
review, branch confinement, push, remote-tip verification, and progress state.
All publication and history-rewrite restrictions from ADR 0008 remain in force.

## Alternatives Considered

- Refresh Claude OAuth and keep the split executor/reviewer design. Rejected
  because the operator explicitly selected Codex as the execution provider.
- Use Codex for tasks but retain Claude for planning. Rejected because plan
  creation would retain the authentication dependency that caused the failure.
- Add a custom second Codex review script. Rejected because it would duplicate
  the same provider without restoring meaningful provider independence.

## Consequences

- Plan creation no longer depends on Claude authentication.
- One Codex login supplies every Ralphex agent phase.
- Native multi-agent review remains, but provider-independent external review is
  no longer part of the automated loop.
- The repository must be trusted for Codex to load its project MCP
  configuration.
