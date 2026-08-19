# ADR 0001: Store workflows as local JSON files

- Status: Accepted
- Date: 2026-07-27

## Context

The Library UI originally displayed static mock recordings while the editor kept its workflow only in browser memory. The first functional Library needs durable local workflows without introducing authentication, a database, or a remote service. The existing custom Node server is already the trusted boundary for Browserbase credentials and recorder sessions.

## Decision

Define a server-side `WorkflowRepository` port and use a filesystem implementation for v1. Each workflow is a schema `1.1` JSON file named `{workflowId}.json` under `.data/workflows`, or under `WORKFLOW_DATA_DIR` when configured.

The custom server exposes list, create, get, save, and finish endpoints. Saves carry an expected revision, are serialized per workflow ID within the process, and replace files through a same-directory atomic rename. The Library receives only names, lifecycle data, and ordered step names; the editor fetches the complete workflow by ID.

Saving is explicit. Starting a recording changes the saved workflow's Browserbase session ID without replacing its identity or steps. Finishing first stops an active browser session, requires at least one step, marks the workflow complete, and returns to the selected Library item.

## Consequences

- A future remote adapter can implement `WorkflowRepository` without changing Library or editor behavior.
- Local JSON may contain recorded sensitive values and must be protected accordingly.
- Revision checks prevent silent stale overwrites, but there is no cross-process file lock or multi-user editing model.
- Invalid canonical files are skipped and surfaced as a non-sensitive count.
- External file changes appear after a page refresh; no filesystem watcher or autosave queue is added.
- Empty drafts remain until their files are manually removed.
