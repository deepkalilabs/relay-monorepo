# POC Plan: Background Folder Runs

- Status: Proposed
- UI: `src/features/automations`
- Backend dependency: Relay batch API

## Goal

Replace the fake Automations folder run with one real Relay batch.

The user puts real Library workflows in a folder, clicks **Run folder**, and sees each
workflow become queued, running, completed, or failed.

## Keep the POC Small

- Use real Library workflows and remove all fictional tasks and fake run timers.
- Run only workflows with `status: "complete"`.
- Reject workflows that need `profile` or `runtime` parameter values.
- Allow one active batch per browser tab.
- Reset folders, activity, and batch state on refresh.
- Do not add persistence, cancellation, retries, scheduling, or notifications.

## Flow

```text
Automations UI
  -> POST workflow IDs to Browser Replay
  -> Browser Replay loads full workflows and calls the public Relay API with HTTP Basic auth
  -> UI polls Browser Replay once per second
  -> UI shows each run and derives the final result
```

Browser Replay is only a credential-protecting proxy. It does not store batch state.

## Minimal API

### Create

```http
POST /api/run-batches
```

```json
{ "workflowIds": ["workflow-uuid-1", "workflow-uuid-2"] }
```

Rules:

- Accept one to ten unique workflow UUIDs.
- Load the complete workflow documents server-side and preserve request order.
- Reject missing, draft, or parameter-dependent workflows before calling Relay.
- Call Relay `POST /v1/batches` exactly once with `{ "runs": [{ "workflow": {} }] }`.

Success:

```json
{ "batchId": "batch-uuid", "runCount": 2 }
```

Return `202` with `Cache-Control: no-store`.

### Poll

```http
GET /api/run-batches/{batchId}
```

```json
{
  "batchId": "batch-uuid",
  "runs": [
    {
      "workflowId": "workflow-uuid-1",
      "status": "running",
      "currentStep": 2,
      "totalSteps": 5
    }
  ]
}
```

`status` is `queued`, `running`, `completed`, or `failed`. A failed run may include a
safe `error` string. Every poll must contain every run in the batch.

Relay may omit both progress counters before a run reports progress. Browser Replay
normalizes that state to `currentStep: 0` and `totalSteps: 0`. Relay-only diagnostics are
accepted for compatibility, then stripped before the response reaches the browser.

The proxy validates Relay responses and never returns workflow contents, parameter
values, credentials, screenshots, session links, or raw Relay errors.

Error responses use `{ "error": "safe message" }`:

- `400` for an invalid create request;
- `404` for an unknown batch;
- `502` for an invalid Relay response; and
- `503` when Relay or its configuration is unavailable.

## UI Behavior

1. Load real workflows from Library into Inbox and the read-only **All workflows** view.
2. Keep drafts visible but exclude them from **Run folder**.
3. Keep existing folder movement and nested-folder behavior.
4. Disable every **Run folder** button while one batch is active.
5. Poll once per second with one timer.
6. Stop when the expected `runCount` is present and every run is completed or failed.
7. Report success only when every run completed; otherwise report failure.
8. If create or polling fails, stop and show a safe error. Refresh resets the POC.

## Server Configuration

```env
RELAY_API_BASE_URL=https://relay.example.com/
RELAY_API_USERNAME=server-user
RELAY_API_PASSWORD=server-secret
```

The credentials stay server-side and are shared with Relay workflow workspaces. Missing
configuration must not stop Browser Replay from starting; the batch routes return `503`.
Relay calls use a timeout, and batch creation has no automatic retry.

## Implementation

1. Confirm Relay's native request and poll shapes, define the browser-safe projection
   above, and add a short ADR for the new API boundary.
2. Add tests and implement the Relay client plus `/api/run-batches` proxy routes.
3. Replace fictional Automations data with real Library workflows.
4. Add the browser client, one-batch polling hook, real activity UI, and one stubbed E2E
   test with two workflows.

## Verification

Prove that:

- one click creates one Relay batch in folder order;
- invalid or unsupported workflows do not call Relay;
- only one batch can be active;
- polling renders all four run states;
- success requires the expected run count and all runs completed; and
- no secret or full workflow reaches the browser.

Run:

```bash
npm run test:changed
npm run typecheck
npm run lint
npx playwright test tests/e2e/automations.spec.ts
npm run build
```

Do not run the full test suite unless explicitly requested.

## Done When

A folder with two safe completed workflows creates one Relay batch, shows real progress,
and reports the final result without fake timers or exposed secrets.
