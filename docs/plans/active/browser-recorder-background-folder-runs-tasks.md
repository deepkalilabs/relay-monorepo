# Frontend Tasks: Background Folder Runs

- [ ] Task 1: Approve the frontend plan and Relay dependency.
  - Acceptance: UI/server ownership, API shapes, real-workflow folder behavior, polling, and MVP non-goals are accepted.
  - Verify: Human approval of `docs/plans/active/browser-recorder-background-folder-runs.md` and the Relay batch contract.
  - Files: `docs/plans/active/browser-recorder-background-folder-runs.md`

- [ ] Task 2: Specify the thin server proxy with failing tests.
  - Acceptance: Tests cover strict ID validation, full workflow loading, complete-only gating, Relay authentication, no retry, safe errors, and polling passthrough.
  - Verify: `npm run test:changed`
  - Files: `tests/automation-batch-api.test.ts`, `src/server/automation/batch-http-client.ts`, `src/server/automation/http-router.ts`

- [ ] Task 3: Implement and register the thin server proxy.
  - Acceptance: Browser-facing create/poll routes protect the token, preserve workflow order, load bodies server-side, and hold no batch state.
  - Verify: `npm run test:changed && npm run typecheck`
  - Files: `src/server/automation/batch-http-client.ts`, `src/server/automation/http-router.ts`, `server.ts`, `.env.example`, `tests/automation-batch-api.test.ts`

- [ ] Task 4: Replace fictional tasks with real Library workflow tasks.
  - Acceptance: All workflows and Inbox use real IDs/statuses; custom folders move real workflows; drafts remain visible but non-runnable; simulated run actions are removed.
  - Verify: `npm run test:changed`
  - Files: `src/features/automations/model/automationWorkspace.ts`, `src/features/automations/AutomationsScreen.tsx`, `tests/automations-workspace.test.ts`, `tests/automations-screen.test.tsx`

- [ ] Task 5: Add the typed browser batch client test-first.
  - Acceptance: Create and poll parse strict safe responses and expose fixed request errors without retrying.
  - Verify: `npm run test:changed`
  - Files: `src/features/automations/api/backgroundRunClient.ts`, `src/features/automations/index.ts`, `tests/automations-screen.test.tsx`

- [ ] Task 6: Add the polling hook test-first.
  - Acceptance: The hook creates once, maintains one poll timer, restores from `sessionStorage`, stops on all-terminal state, and distinguishes transport errors from run failures.
  - Verify: `npm run test:changed`
  - Files: `src/features/automations/model/useBackgroundBatch.ts`, `tests/automations-screen.test.tsx`

- [ ] Task 7: Connect Run folder and real activity presentation.
  - Acceptance: The button submits only completed workflow IDs; real snapshots render in Activity and Details; the client derives success/failure without timers.
  - Verify: `npm run test:changed && npm run typecheck && npm run lint`
  - Files: `src/features/automations/AutomationsScreen.tsx`, `src/features/automations/components/ActivityPane.tsx`, `src/features/automations/components/RunDetailsDialog.tsx`, `tests/automations-screen.test.tsx`

- [ ] Task 8: Add targeted browser verification.
  - Acceptance: A stubbed two-workflow folder run progresses queued-to-running-to-terminal, refresh resumes polling, and no duplicate batch is created.
  - Verify: `npx playwright test tests/e2e/automations.spec.ts`
  - Files: `tests/e2e/automations.spec.ts`

- [ ] Task 9: Complete frontend verification and quality review.
  - Acceptance: Changed tests, typecheck, lint, targeted E2E, build, ADR review assessment, and code review pass without unrelated changes.
  - Verify: `npm run test:changed && npm run typecheck && npm run lint && npx playwright test tests/e2e/automations.spec.ts && npm run build`
  - Files: no planned source changes
