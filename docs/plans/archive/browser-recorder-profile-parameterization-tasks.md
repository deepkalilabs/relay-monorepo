# Profile-Parameterized Workflow Run Tasks

- [x] Task 1: Approve the feature spec and four open product decisions.
  - Acceptance: Parameterizable step types, missing-field behavior, replay handoff, and sensitive-preview behavior are explicit.
  - Verify: Human approval of `docs/product/features/profile-parameterization.md`.
  - Files: `frontend/docs/product/features/profile-parameterization.md`, `docs/plans/archive/browser-recorder-profile-parameterization.md`

- [x] Task 2: Record the parameter-binding and privacy architecture.
  - Acceptance: ADR defines schema versioning, backward normalization, profile field IDs, ephemeral resolution, and forbidden persistence/logging.
  - Verify: `npm run adr:review -- --adr docs/decisions/0006-profile-parameter-bindings.md --reason "Records workflow parameter bindings and the resolution privacy boundary."`
  - Files: `docs/decisions/0006-profile-parameter-bindings.md`

- [x] Task 3: Add failing contract tests for bindings and compatibility.
  - Acceptance: Tests specify eligible steps, all source modes, bounds, legacy defaults, and rejection of embedded profile/runtime values.
  - Verify: `npm run test:changed`
  - Files: `tests/workflow-contract.test.ts`, `src/shared/contracts/workflow/domain.ts`, `src/shared/contracts/workflow/schema.ts`

- [x] Task 4: Implement workflow binding and profile-field contracts.
  - Acceptance: The shared schema passes Task 3 tests and existing workflows normalize to Recorded value without changing recorded payloads.
  - Verify: `npm run test:changed && npm run typecheck`
  - Files: `src/shared/contracts/workflow/domain.ts`, `src/shared/contracts/workflow/schema.ts`, `src/shared/contracts/profile/field.ts`, `tests/workflow-contract.test.ts`

- [x] Task 5: Implement the pure parameter resolver test-first.
  - Acceptance: Resolution handles recorded, fixed, profile, runtime, missing, disabled, and non-input steps without mutating persisted workflows.
  - Verify: `npm run test:changed`
  - Files: `src/shared/contracts/workflow/parameters.ts`, `src/shared/contracts/workflow/index.ts`, `tests/workflow-parameters.test.ts`

- [x] Task 6: Implement deterministic auto-map test-first.
  - Acceptance: High-confidence matches map supported fields; ambiguous matches stay unchanged; explicit choices are preserved.
  - Verify: `npm run test:changed`
  - Files: `src/features/workflow-library/model/autoMapParameters.ts`, `src/features/workflow-library/index.ts`, `tests/workflow-parameters.test.ts`

- [x] Task 7: Add full workflow loading and revisioned save to Library.
  - Acceptance: Selection loads the full item, summaries remain value-free, dirty drafts save with expected revision, and conflicts cannot overwrite.
  - Verify: `npm run test:changed && npm run typecheck`
  - Files: `src/features/workflow-library/api/workflowLibraryClient.ts`, `src/features/workflow-library/components/LibraryScreen.tsx`, `tests/workflow-client.test.ts`, `tests/library-screen.test.tsx`

- [x] Task 8: Add profile summary/detail loading to Library.
  - Acceptance: The picker shows readiness, fetches only the selected full profile, handles empty/deleted/failure states, and keeps profile selection ephemeral.
  - Verify: `npm run test:changed`
  - Files: `src/features/workflow-library/components/LibraryScreen.tsx`, `src/features/workflow-library/components/RecordingDetails.tsx`, `tests/library-screen.test.tsx`

- [x] Task 9: Build the accessible parameter matrix and row modes.
  - Acceptance: The four reference columns, all source modes, resolved states, completeness, and visible labels work with keyboard and screen readers.
  - Verify: `npm run test:changed && npm run lint`
  - Files: `src/features/workflow-library/components/RecordingDetails.tsx`, `src/features/workflow-library/components/WorkflowParameters.tsx`, `src/features/workflow-library/components/WorkflowParameters.module.css`, `tests/library-screen.test.tsx`

- [x] Task 10: Connect auto-map, Save, conflict recovery, and Run gating.
  - Acceptance: Auto-map remains a draft; Save is revisioned; conflicts are recoverable; Run enables only when the saved configuration can enter preflight.
  - Verify: `npm run test:changed && npm run typecheck`
  - Files: `src/features/workflow-library/components/WorkflowParameters.tsx`, `src/features/workflow-library/components/RecordingDetails.tsx`, `tests/library-screen.test.tsx`

- [x] Task 11: Add runtime-value preflight and editor handoff.
  - Acceptance: IDs-only navigation opens the existing replay surface, runtime values are required before confirmation, and incomplete/cancelled preflight creates no session.
  - Verify: `npm run test:changed`
  - Files: `src/features/replay/components/RunWorkflowDialog.tsx`, `src/app/(product)/workflows/[workflowId]/edit/_hooks/useWorkspaceController.ts`, `tests/run-workflow-dialog.test.tsx`, `tests/e2e/workspace.spec.ts`

- [x] Task 12: Add targeted browser journeys and responsive verification.
  - Acceptance: The reference flow works at 1440×900 and 1024×768 with no overflow, logical focus, zero axe violations, and no sensitive values in URLs or diagnostics.
  - Verify: `npx playwright test tests/e2e/library.spec.ts tests/e2e/workspace.spec.ts`
  - Files: `tests/e2e/library.spec.ts`, `tests/e2e/workspace.spec.ts`

- [x] Task 13: Complete static/build verification and code-quality review.
  - Acceptance: Changed tests, typecheck, lint, targeted browser tests, build, ADR review, and multi-axis review pass with no unrelated changes.
  - Verify: `npm run test:changed && npm run typecheck && npm run lint && npx playwright test tests/e2e/library.spec.ts tests/e2e/workspace.spec.ts && npm run build`
  - Files: no planned source changes
