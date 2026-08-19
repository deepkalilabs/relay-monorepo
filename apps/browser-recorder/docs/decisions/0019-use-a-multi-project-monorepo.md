# ADR 0019: Use a multi-project monorepo

- Status: Accepted
- Date: 2026-08-14

## Context

The Browser Memory Recorder frontend and Relay backend are developed together but were
stored in separate Git repositories. The frontend is a Next.js application with a custom
Node server. The backend is a Python FastAPI service that also contains independently
managed TypeScript automation libraries and a Fastify automation service.

The immediate goal is to coordinate frontend and backend work in one repository without
also extracting the automation libraries, centralizing contracts, or coupling the
projects' dependency and deployment lifecycles.

## Decision

Use one Git repository with two self-contained top-level projects:

- `frontend/` contains the complete Browser Memory Recorder project.
- `backend/` contains the complete Relay backend project, including its existing
  `packages/` directory and OpenAPI contracts.

Each project retains its own manifests, lockfiles, commands, documentation, agent
instructions, and deployment files. The repository has no root package manifest or
language workspace. Root documentation provides navigation and records only decisions
that cross project boundaries.

## Alternatives Considered

### Create one root Node workspace

Rejected for this phase because it would change dependency installation and lockfile
ownership while the current goal is repository consolidation.

### Promote automation libraries and contracts to root directories

Rejected because automation extraction is planned separately. Moving those boundaries
now would mix architectural refactoring with the repository move.

### Keep separate Git repositories

Rejected because coordinated frontend and backend changes would continue to require
multiple branches and pull requests with no atomic integration point.

## Consequences

- Frontend and backend changes can be reviewed together when necessary.
- Existing project commands continue to run from their owning directories.
- Deployment services must select the owning project directory as their build root.
- Dependency installation remains duplicated where it was already duplicated.
- Repository-level CI and developer tooling must set the appropriate project working
  directory.
- A later automation extraction or root workspace requires its own decision and migration.
