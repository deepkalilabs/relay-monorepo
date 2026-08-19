# Browser recorder agent guide

The root [`AGENTS.md`](../../AGENTS.md) is authoritative for Git safety, ADR review,
repository-wide tooling, and cross-project verification. Read it before this guide.

## Ownership and boundaries

- `src/`, `app/`, `public/`, `tests/`, `scripts/`, `server.ts`, and the recorder's Next.js
  configuration belong to the browser recorder.
- Keep recorder behavior, browser protocol handling, stored data formats, environment
  variables, ports, and deployment commands stable during repository-layout work.
- Shared workflow and replay contracts come from the root workspaces. Do not duplicate
  them inside the recorder or change their public exports as part of unrelated work.
- Recorder-specific documentation remains owned here until its approved move. Accepted
  ADRs are immutable; add a later ADR that explicitly supersedes an earlier decision.
- Repository-wide agent configuration, hooks, Ralph orchestration, and code-intelligence
  tooling belong at the repository root, not in this project.

## Verification

During implementation and review, run from this directory:

```sh
npm run test:changed
```

Do not substitute the full frontend suite unless the user or an approved plan requires
it. If Vitest finds no affected tests, report that result. Run `npm run typecheck`,
`npm run lint`, and `npm run build` when the change or active plan calls for them.
