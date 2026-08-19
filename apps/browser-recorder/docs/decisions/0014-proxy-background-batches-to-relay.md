# ADR 0014: Proxy background workflow batches to Relay

- Status: Accepted
- Date: 2026-08-04

## Context

The Automations prototype needs to run a folder without exposing stored workflow
documents or Relay credentials to the browser. Relay already owns background queueing
and execution, while Browser Replay already owns access to canonical workflows.

## Decision

Add a small Browser Replay HTTP proxy for creating and polling Relay batches. The browser
sends workflow IDs, Browser Replay loads and validates the complete workflows, and Relay
receives the batch through a server-held bearer token.

Treat Relay's tested batch response as the upstream contract. Browser Replay validates
its core batch, workflow, status, and progress fields; normalizes missing progress to
zero; and projects only the browser-safe fields. Workflow IDs identify runs within a
batch because create requests require them to be unique. Relay-only execution
diagnostics remain server-side.

Keep batch state in Relay and allow one active batch per browser tab. The POC does not
persist batch or folder state and rejects workflows that require profile or runtime
parameter values.

## Alternatives Considered

- Call Relay directly from the browser. Rejected because it would expose Relay
  credentials and require full workflow documents in browser code.
- Execute folders inside Browser Replay. Rejected because it would duplicate Relay's
  queue and background lifecycle.
- Add durable local batch storage. Rejected because refresh recovery and run history are
  outside the POC.

## Consequences

- Browser Replay adapts Relay's native batch response to the smaller browser contract.
- Browser Replay validates browser requests and Relay's core response fields while
  stripping upstream diagnostics.
- Missing Relay configuration disables only the batch routes.
- Folder runs reset on refresh and cannot accept profile or runtime values.
