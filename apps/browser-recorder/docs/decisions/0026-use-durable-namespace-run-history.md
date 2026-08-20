# ADR 0026: Use durable namespace run history

- Status: Accepted
- Date: 2026-08-20

## Context

The Automations activity pane previously held only the current tab's batch snapshots.
Workflow IDs doubled as run IDs, so repeated executions could not coexist, refresh lost
all activity, and screenshot evidence depended on a temporary process-local capability.
Relay now provides namespace-scoped durable runs, safe assertion results, and stored WebP
evidence while retaining the old compatibility routes for local workspaces.

## Decision

For namespace workspaces, submit workflow IDs to Relay's durable run-batch operation,
poll the durable batch operation, and hydrate the 50 newest workflow runs when the
Automations screen opens. Poll nonterminal history after refresh while Relay independently
tracks the private runner. Identify activity cards by run UUID and resolve their display
name through workflow ID so repeated executions remain distinct.

Keep local filesystem workspaces on `/v1/batches` and temporary `/v1/artifacts` behavior.
Local activity remains tab-local and ephemeral.

Project only safe run fields into the browser. Run details list each executed assertion's
name, kind, duration, and `Matched: Yes` or `Matched: No`; they never display expected or
observed text, page content, or locator diagnostics. Completed runs with assertions may
open details as well as failed runs.

Proxy historical WebPs through a namespace/run-scoped same-origin Browser Replay route.
The Node server uses its Relay HTTP Basic credentials and validates a bounded WebP before
returning it with private no-store headers. Render the proxy directly rather than placing
the sensitive image in the Next.js optimizer cache. Remove the fictional demo evidence
card once real durable evidence is available.

This decision supersedes ADR 0014's refresh-loss and workflow-ID-as-run-ID choices, and
ADR 0015's temporary-only evidence choice, for namespace workspaces. Both decisions remain
accepted for local compatibility batches.

## Alternatives considered

- Persist activity in browser storage. Rejected because it cannot recover backend work,
  safely scope server evidence, or establish authoritative outcomes.
- Replace the local compatibility route. Rejected because local workflows are transient
  and the existing development flow remains useful.
- Return Relay screenshot URLs directly. Rejected because credentials and service
  topology must remain server-side.

## Consequences

- Namespace activity and evidence survive refresh and repeated executions remain visible.
- Folder organization itself remains a session-only prototype.
- Local workspace runs continue to reset on refresh.
- Browser Replay now validates both the durable Relay contract and the older compatibility
  snapshot contract.
