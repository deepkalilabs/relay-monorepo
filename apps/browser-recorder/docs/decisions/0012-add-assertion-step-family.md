# ADR 0012: Add assertions as a separate workflow step family

- Status: Accepted
- Date: 2026-08-03

## Context

Recorded actions describe page mutations and inherit action behavior such as recorder deduplication, parameter binding, target retry, and post-step settling. A page-state check has different semantics: it must be authored intentionally, must not activate the selected website element, and should fail at the state observed when replay reaches it.

Adding assertions to the existing action enum would make action-only boundaries accept non-actions and would couple checks to retry and wait behavior. Persisting the new step shape also requires a canonical workflow schema change and a request-correlated browser-picker protocol.

## Decision

Add `AssertionStep` beside `ActionStep` under the `WorkflowStep` union. Keep assertions out of `RecordedAction`, `WorkflowActionType`, parameter binding, recorder deduplication, and `waitAfter`. Version one provides `visible` and `text_contains` expectations. Expected text is nonblank and limited to 1,000 characters.

Advance the canonical workflow schema from `1.2` to `1.3`. Normalize versions `1.0` through `1.2` to `1.3` at read boundaries without rewriting a file until its next explicit save.

Require a live recording session for authoring. Use request-correlated `assertion.pick.start`, `assertion.pick.cancel`, `assertion.pick.selected`, and `assertion.pick.cancelled` WebSocket messages. Reuse the injected recorder's semantic target description. Capture the selection click before website and recording handlers so selection neither activates the page nor records an action.

At replay, apply the stored viewport position and run one locator-resolution pass. Pass only when a stored candidate uniquely resolves to a visible element. For text containment, trim, collapse whitespace, and lowercase both strings before checking `actual.includes(expected)`. Do not poll or perform assertion-owned post-step settling. Expose replay phase `asserting` and use the existing Retry, Skip, Take control, and Stop recovery flow.

Store and report expected and observed text without special redaction. Document that assertion targets and expected phrases must not contain secrets.

## Alternatives Considered

- Model assertions as recorded actions. Rejected because checks are intentional non-mutating steps and must not inherit action capture, deduplication, waits, or parameter behavior.
- Allow CSS-only assertion creation without a browser session. Rejected because it bypasses semantic locator evidence and prevents a trustworthy target preview.
- Reuse the action resolver's 15-second retry loop. Rejected because version one specifies the state at the instant the step is reached; Retry remains an explicit user recovery action.
- Redact all assertion text. Rejected for version one because the selected storage policy keeps workflow values and diagnostics plain; users must avoid capturing secrets.

## Consequences

- Workflow consumers must handle an explicit action-or-assertion union and schema `1.3`.
- Existing workflow files remain readable and are upgraded lazily.
- Picker lifecycle must be cancelled on request replacement, CAPTCHA lock, page/session replacement, and replay start.
- Assertion failures are immediate and deterministic, while preceding actions retain their existing settling behavior.
- Workflow files, exports, and diagnostics can contain assertion text and must be protected accordingly.
