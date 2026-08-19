# Spec: Review architectural decisions before push

## Objective

Move ADR enforcement from every commit to the Git push boundary so autonomous
task loops can make small local commits. Every non-deletion branch push must have
a private review marker for either a justified `none` outcome or every ADR added
by the complete committed branch diff.

## Commands

```bash
npm run hooks:install
npm run adr:review -- --none --reason "Routine change; no architectural decision."
npm run adr:review -- \
  --adr docs/decisions/0007-example.md \
  --reason "Records the new repository boundary."

# Overrides for a new or unusual target:
npm run adr:review -- \
  --remote origin \
  --remote-ref refs/heads/example \
  --base origin/main \
  --none \
  --reason "Routine change; no architectural decision."
git push
```

## Structure and Behavior

```text
.githooks/pre-push          Git entry point
tooling/repository/         Review creation and deterministic validation
tooling/tests/              Temporary-repository integration tests
docs/decisions/             Root-owned accepted ADRs
apps/browser-recorder/docs/decisions/    Recorder and transitional repository ADRs
apps/relay-api/docs/decisions/     API-owned accepted ADRs
AGENTS.md                   Agent authorization and review policy
```

- Commits do not require a marker.
- Review defaults to the current branch, configured push remote (or `origin`),
  and same-named remote branch.
- Existing targets use their remote-tracking tip as expected remote tip and
  comparison base. New targets use the remote default branch.
- The marker binds the local commit, comparison base and diff, remote branch,
  and expected remote tip.
- Any local or remote movement fails closed.
- Accepted ADRs in the branch range and remote tip cannot be modified or
  removed. Added ADRs must all be named with `--adr`.
- Branch deletions and tags are outside the gate.
- The gate never commits, pushes, merges, rebases, squashes, or force-pushes.

## Testing

Vitest tests create isolated Git repositories and cover exact reviews, stale
local and remote refs, divergent ADR removal, ADR addition and immutability,
branch deletion, hook installation, ungated commits, and Codex bypass denial.
Run `npm run test:tooling` for repository-tooling verification.

## Boundaries and Success Criteria

- Always fail closed when pushed branch identity changes.
- Never infer push authorization or allow `--no-verify`.
- Never store markers in tracked files.
- Local commits do not require a review marker; publication through a branch push does.
- Unreviewed and stale branch pushes fail; exact reviewed pushes pass.
- The installer enables only the tracked pre-push gate.
