# Repository documentation

Repository-wide planning and agent-workflow documents live here. Application-specific
product, API, deployment, and decision documents live with their owning application
under `apps/`.

## Planning lifecycle

- [`plans/active/`](plans/active/) contains approved or proposed work that may still be
  executed. Ralph accepts runnable plans only from this directory.
- [`plans/archive/`](plans/archive/) preserves completed implementation plans and task
  lists as historical context.
- [`handoffs/`](handoffs/) contains bounded work transferred between projects or agents.

Use descriptive filenames that include the owning app, package, or outcome. Do not use
generic `plan.md`, `todo.md`, or runtime-generated context files as durable documentation.

## Agent workflows

- [`agent-workflows/ralph-loop.md`](agent-workflows/ralph-loop.md) describes supervised,
  incremental execution.
- [`agent-workflows/adr-before-push.md`](agent-workflows/adr-before-push.md) describes the
  architectural-review push gate.

## Repository decisions

- [`decisions/0001-manage-development-railway-infrastructure-as-code.md`](decisions/0001-manage-development-railway-infrastructure-as-code.md)
  records the project-level Railway development topology and rollout boundary.
- [`decisions/0002-isolate-development-railway-resource-identities.md`](decisions/0002-isolate-development-railway-resource-identities.md)
  records the environment-specific PostgreSQL identity and explicit private-network
  endpoint required for stable Railway IaC reconciliation.

Private execution state belongs in ignored `.agent/runtime/` or `.ralphex/` state, never
in tracked planning documents.
