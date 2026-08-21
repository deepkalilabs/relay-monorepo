# Browserbase Proxy Selection Tasks

- [x] Add failing protocol and provider tests for explicit proxy selection.
  - Acceptance: missing proxy intent is rejected and both SDK proxy values are covered.
  - Verify: focused Vitest command for browser navigation and provider tests.
- [x] Implement contract and provider propagation.
  - Acceptance: validated options reach Browserbase session creation.
  - Verify: focused tests pass.
- [x] Add failing recorder hook and component tests.
  - Acceptance: default-off, toggle, start/replay payloads, labeling, and disabled state
    are specified.
  - Verify: focused Vitest command for recorder session and components.
- [x] Implement recorder state and browser-header checkbox.
  - Acceptance: users can opt in before a session and cannot change an active session.
  - Verify: focused tests pass and local browser inspection is clean.
- [x] Run recorder verification and review the diff.
  - Acceptance: required changed-test routing passes and no unrelated files are changed.
  - Verify: `npm run test:changed` from `apps/browser-recorder/`.
