# Spec: Supervised incremental coding loop

## Objective

Turn one approved master plan into small, independently reviewed publications.
The operator supervises the run and retains control over pull requests and
merges; the loop owns only its generated feature branch.

## Commands and plan format

```bash
npm run ralph:plan -- "<goal>"
npm run ralph:run -- docs/plans/active/<slug>.md
```

Runnable master plans live under `docs/plans/active/` and use ordered
`### Increment N: title` sections. Every increment contains a few automatable
checkboxes, including focused verification and `npm run test:changed`.
Completed plans move to `docs/plans/archive/`; handoff documents live under
`docs/handoffs/` and are never executable plans.

`ralph:run` derives `codex/<slug>`, creates a private one-task plan for the next
increment, and invokes Ralphex with the previously published commit as its review
base. The master plan is not rewritten as execution state; progress lives under
Git's private state directory.

## Increment boundary

For each increment the loop:

1. Starts one persistent localhost code-intelligence service.
2. Lets Codex implement and commit the selected increment.
3. Runs Ralphex's native Codex multi-agent review/fix passes.
4. Runs `npm run test:changed` and requires a clean worktree.
5. Records the exact ADR review for the checkpoint-to-HEAD diff.
6. Pushes `HEAD` only to the exact generated feature branch.
7. Verifies the remote tip, records progress, and selects the next increment.

It stops on a failed command, dirty tree, divergence, changed remote tip, or
push-gate rejection. It never merges, rebases, squashes, amends, force-pushes,
creates a pull request, or pushes another branch.

## Code-intelligence boundary

The project-scoped MCP endpoint is `http://127.0.0.1:8765/mcp` and is registered
for trusted Codex sessions in `.codex/config.toml`. It starts one TypeScript
SolidLSP process for the complete run and exposes read-only definition,
reference, hover, symbol, and diagnostic calls. ast-grep supports JavaScript,
JSX, TypeScript, TSX, and Python files. Every file argument must resolve inside
the repository and result counts are bounded.

## Minimal verification

- ADR-gate integration tests cover exact, stale-local, and stale-remote reviews.
- Loop unit tests cover generated-branch confinement and single-increment plans.
- A code-intelligence smoke test imports both libraries and answers an ast-grep
  query.
- Normal recorder verification uses only `npm run test:changed`; full-suite and
  broad end-to-end matrices require separate operator direction.
