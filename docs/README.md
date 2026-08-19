# Repository documentation

Repository-wide planning and agent-workflow documents live here. Application-specific
product, API, deployment, and decision documents live with their owning application
under `apps/`.

## Planning lifecycle

- [`plans/active/`](plans/active/) contains approved or proposed work that may still be
  executed.
- [`plans/archive/`](plans/archive/) preserves completed implementation plans and task
  lists as historical context.
- [`handoffs/`](handoffs/) contains bounded work transferred between projects or agents.

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
