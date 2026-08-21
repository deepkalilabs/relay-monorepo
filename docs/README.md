# Repository documentation

Repository-wide decisions, historical plans, and agent-workflow documents live here.
For current architecture and project routing, start with the root
[`NAVIGATION.md`](../NAVIGATION.md). Application-specific product, API, deployment, and
decision documents live with their owning application under `apps/`.

## Planning lifecycle

- [`plans/archive/`](plans/archive/) preserves completed implementation plans and task
  lists as historical context. Archived plans do not describe current behavior and
  never override contracts, runtime code, tests, or accepted ADRs.

Create a new file under `plans/active/` only for approved or proposed work that has not
yet been completed. Remove or archive it when the work closes so agents do not mistake
an obsolete plan for current architecture.

Use descriptive filenames that include the owning app, package, or outcome. Do not use
generic `plan.md`, `todo.md`, or runtime-generated context files as durable documentation.

## Agent workflows

- [`agent-workflows/adr-before-push.md`](agent-workflows/adr-before-push.md) describes the
  architectural-review push gate.

## Decisions

- [`decisions/`](decisions/) contains repository-wide architectural decisions.
- Application-specific decisions remain with their owning application under `apps/`.

Private execution state belongs in ignored `.agent/runtime/` state, never in tracked
planning documents.
