# Relay monorepo agent guide

This repository contains two application projects coordinated by an additive root Node
workspace. Read the nested agent guide
before changing either project:

- [`frontend/AGENTS.md`](frontend/AGENTS.md)
- [`backend/AGENTS.md`](backend/AGENTS.md)

## Repository boundaries

- Keep frontend package ownership, documentation, and deployment files in `frontend/`.
- Keep backend dependency management, migrations, contracts, automation packages,
  documentation, and deployment files in `backend/`.
- Use the root Node workspace for cross-project orchestration. Retain project lockfiles
  and project-local deployment commands until a later reviewed migration removes them.
- Do not extract or consolidate the backend automation libraries as part of unrelated
  frontend or backend work.
- Keep architectural decisions in the owning project's existing decision directory. The
  frontend ADR sequence currently records repository-wide workflow decisions.

## Git authorization

- Do not commit, push, rewrite history, merge, or create a pull request unless the user
  explicitly authorizes that action.
- Never bypass Git hooks with `--no-verify`.
- Before every authorized non-deletion branch push, review the complete committed branch
  diff and record the result through the frontend ADR gate.

## Verification

- Frontend changes: run `npm run test:changed` from `frontend/`.
- Backend changes: follow the checks in `backend/AGENTS.md`.
- Cross-project changes: run the applicable checks for both projects.
- Root-workspace changes: run `npm run typecheck` and the affected root test command.
