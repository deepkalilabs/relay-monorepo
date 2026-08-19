# Feature Spec: Assertion Steps

- Status: Implemented
- Last updated: 2026-08-06

## Objective

Let a user add a non-mutating workflow step that verifies the current page state during replay. Assertions are manually authored checks, not recorded browser actions.

Supported checks are:

- **Visible** — one stored locator candidate resolves to exactly one visible element.
- **Text contains** — the same unique visible target has visible text containing an expected phrase after trimming, collapsing whitespace, and lowercasing both values.
- **Group exists** — at least one visible container matches a recorded, content-free repeated-structure template.

## Authoring Experience

The timeline's **Add assertion** control starts picking directly. Assertions require an active recording session because their target must be selected in the live browser; there is no CSS-only fallback.

While picking, the injected recorder shows one compact, cobalt-blue floating card near the website's upper-right edge. It is isolated in a shadow root, stays within the viewport, and does not resize or modify the website layout. The workspace does not render a second picker notice. Hover still highlights an exact element, while also seeding repeated-group discovery from up to six ancestors. Each ancestor is compared with visible element siblings. Qualifying groups require at least two current members with the same root tag and role and at least 70% Jaccard overlap between structural tokens. Candidates appear nearest-first with live counts and structural previews.

Hover previews a candidate and highlights every member identically; the seed has no special treatment. Clicking a highlighted member freezes that group without creating an assertion, after which pointer movement cannot replace it. Activating a group row provides the keyboard-equivalent freeze operation. Only **Use matched group** submits the frozen template. **Use exact element instead** deliberately submits the frozen seed through the existing element-selection path, while clicking an unmatched element retains direct exact-element selection.

Rows, visible focus, collapsed JSON disclosure, **Continue picking**, and cancellation are keyboard accessible. A frozen group continues updating its live count; submission is disabled if it drops below two visible members. Panel controls neither activate the website nor record actions. Escape, CAPTCHA protection, navigation, page or session replacement, and replay start remove the panel and all highlights.

Exact-element selection captures the same semantic locator evidence used by recording, plus frame URL, page context, viewport position, display name, and normalized visible text. Its confirmation editor infers **Text contains** when text is available and **Visible** otherwise.

Group selection sends only the chosen structural template. Its confirmation editor shows the captured group summary and locks the expectation to **Group exists**. Users can edit the step name before insertion.

The inspector keeps element locator candidates editable. Group assertions instead show read-only root, matcher, captured-count, and structural-token details. Assertion steps do not show action payload, parameter-binding, or post-action wait controls.

## Replay Semantics

Element assertions apply their captured viewport position and evaluate once. Assertions do not use the action resolver's retry window, poll for a future state, mutate the page, or trigger post-step settling.

Replay tries stored locator candidates in priority order and retains diagnostics for candidates that fail before resolution or exhaustion. A check passes only when a candidate resolves to exactly one visible element. Missing, hidden, and ambiguous targets fail immediately. Text containment then compares:

```ts
normalize(actual).includes(normalize(expected))
```

`normalize` trims, collapses whitespace, and lowercases. It does not remove punctuation or reorder words. A mismatch reports the normalized expected and observed text. Locator failures retain attempted-locator diagnostics. Retry performs a fresh immediate evaluation; Skip, Take control, and Stop use the existing replay recovery behavior.

Group assertions do not apply recorded scroll position. Replay resolves the recorded frame, prefilters by exact root tag and role, and inspects at most 500 containers. It describes each container with `structural-token-v1`: sorted relative tag/role paths to depth three and at most 150 descendants. It passes immediately when one visible candidate reaches 70% Jaccard overlap.

Replay ignores `capturedMatchCount`, does not select a representative member, require uniqueness, poll, or automatically retry. A failure reports zero matches, the captured count, algorithm version, excessive breadth when applicable, and the highest similarities without page text. The reported locator kind is `structural-group`.

## Contract and Compatibility

Canonical workflow schema `1.4` represents assertions as an element-or-group union:

```ts
type AssertionExpectation =
  | { kind: "visible" }
  | { kind: "text_contains"; expected: string };

type ElementAssertionStep = ElementWorkflowStepBase & {
  type: "assertion";
  expectation: AssertionExpectation;
};

type RepeatedGroupTemplate = {
  version: 1;
  algorithm: "structural-token-v1";
  frameUrl?: string;
  root: { tagName: string; role?: string; sharedClasses: string[] };
  structureTokens: string[];
  capturedMatchCount: number;
};

type GroupExistsAssertionStep = WorkflowStepBase & {
  type: "assertion";
  groupTarget: RepeatedGroupTemplate;
  expectation: { kind: "group_exists" };
};

type AssertionStep = ElementAssertionStep | GroupExistsAssertionStep;

type WorkflowStep = ActionStep | AssertionStep;
```

Assertions are excluded from `RecordedAction`, `WorkflowActionType`, parameter binding, recorder deduplication, and action waits. Expected text must contain a non-whitespace character and cannot exceed 1,000 characters. Valid schema `1.0` through `1.3` workflows normalize to `1.4` in memory and are rewritten only on their next save. The existing legacy-fill rejection boundary remains unchanged.

The picker protocol retains request-correlated `assertion.pick.start`, `assertion.pick.cancel`, `assertion.pick.selected`, and `assertion.pick.cancelled` messages and additively introduces `assertion.pick.groupSelected`. Candidate discovery stays inside the injected page. Replay exposes the `asserting` phase to the UI.

## Data and Safety

Expected and observed text remain plain in workflow storage, exports, UI, and replay diagnostics. Assertions must not capture passwords, tokens, payment details, personal data, or other secrets. Future evidence capture must treat assertion text as potentially sensitive even though version one does not redact it.

Repeated-group templates deliberately exclude text, accessible names, IDs, form values, URLs, positional indexes, and member identity. Group failure diagnostics likewise contain no page text.

## Non-goals

- URL, title, attribute, numeric, visual, count, every-member, child-content, or identity assertions.
- Polling, configurable assertion timeouts, or eventual-state checks.
- Assertion creation without a live recording session.
- Secret redaction or a secret-management system.
- Branching, conditional execution, or assertion-driven page mutation.

ADR 0012 records the original step-family, picker-protocol, and element evaluation decisions. ADR 0013 records the breaking legacy-fill compatibility boundary. ADR 0016 records repeated-group schema, protocol, privacy, matcher, and dynamic-count semantics.
