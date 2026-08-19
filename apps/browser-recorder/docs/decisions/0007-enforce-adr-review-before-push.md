# ADR 0007: Enforce ADR review before branch pushes

- Status: Accepted
- Date: 2026-07-30
- Supersedes: ADR 0003

## Context

ADR 0003 binds an ADR review to the exact staged index before every commit. That
works for interactive commits but interrupts autonomous plan executors such as
Ralphex, which rely on small task and review-fix commits.

Local commits on an isolated branch are recoverable and unpublished. A branch
push is the point where the complete committed change crosses the repository
boundary. The gate should protect that boundary without granting permission to
push or weakening accepted-ADR immutability.

## Decision

Require ADR review before every non-deletion branch push instead of every commit.
Store a private marker bound to the exact local commit, comparison base and
committed diff, target remote branch, and expected remote tip.

Existing targets use their remote-tracking tip as the default comparison base.
New targets use the remote default branch. The pre-push hook validates Git's
proposed ref update and fails closed when either side changed.

Routine branches record a justified `none` outcome. A branch adding ADRs must
name every added ADR. Accepted ADRs in both the reviewed branch range and current
remote tip are immutable; changed decisions require a new superseding ADR.
Branch deletions and tag pushes do not introduce a branch diff and are outside
the gate.

Starting an autonomous plan may authorize its task-scoped commits on an isolated
branch or worktree. It never implicitly authorizes pushing, merging, or rewriting
history, and an ADR review does not itself authorize a push.

## Consequences

- Ralphex can make incremental local commits without a staged-index gate.
- The complete change receives one review at the publication boundary.
- New local commits, fetches, and remote movement require another review.
- Contributors must keep remote-tracking refs current before review.
- `git push --no-verify` can bypass any local hook, so repository policy forbids
  it; server-side enforcement remains a possible future addition.
- Per-commit audit and bypass-remediation state from ADR 0003 is retired.
