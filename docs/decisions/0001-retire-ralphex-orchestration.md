# ADR 0001: Retire Ralphex orchestration

- Status: Accepted
- Date: 2026-08-19
- Supersedes: ADR 0008, ADR 0010
- Amends: ADR 0024

## Context

ADRs 0008 and 0010 introduced a repository-owned Ralphex wrapper, a dedicated
read-only code-intelligence service, project MCP configuration, and narrowly scoped
authorization for the wrapper to commit and push incremental work. The repository no
longer uses this execution path. Keeping its commands, dependencies, configuration,
tests, and generated state would preserve an inactive maintenance and security surface.

ADR 0007's architectural-review gate remains useful independently of Ralphex. The
generic plan archive and handoff documents also remain useful repository history.

## Decision

Remove the Ralphex wrapper, prompts, project MCP registration, Python
code-intelligence service, dedicated tests, workflow documentation, npm commands, and
repository-local generated state.

Retire the wrapper-specific commit and push authorization. Repository changes again
require the explicit Git authorization and ADR-before-push review described by current
repository policy. Retain the ADR gate, generic planning directories, handoffs, and
Codex pre-tool hook.

Accepted historical ADRs remain immutable. References to Ralph or Ralphex in ADRs
0007, 0008, 0010, and 0024 describe historical context and are not active guidance.

## Alternatives Considered

- Keep the wrapper but stop documenting it. Rejected because unused executable code,
  dependencies, and project configuration would remain active maintenance surface.
- Keep the code-intelligence service as generic tooling. Rejected because it has no
  consumer outside the retired wrapper.
- Delete the superseded ADRs. Rejected because accepted decisions are immutable and
  remain necessary historical context.

## Consequences

- `npm run ralph:plan` and `npm run ralph:run` are no longer available.
- Codex no longer registers or starts the repository-local code-intelligence MCP
  service.
- The repository no longer grants automatic branch publication authority to an agent
  runner.
- Tooling verification covers only the retained repository tooling.
