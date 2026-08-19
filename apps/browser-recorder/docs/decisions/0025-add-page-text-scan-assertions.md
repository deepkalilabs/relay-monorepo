# ADR 0025: Add privacy-preserving page-text scan assertions

- Status: Accepted
- Date: 2026-08-19

## Context

Relay assertions currently require either one replayable element target or a repeated-
group structural template. Users also need a simple question about the page at a replay
point, such as whether “John Snow” appears anywhere in the currently visible document.
Making that question an element assertion would require an arbitrary locator and would
miss text rendered inside nested frames.

The stored workflow contract, interactive replay engine, background automation runner,
and Python persistence boundary must agree on the new shape. The scan must not expose
the page's observed text through errors, events, results, or logs.

## Decision

Advance the canonical workflow schema from `1.4` to `1.5` and add a targetless
`page_text_contains` assertion. It stores only the expected phrase and cannot store an
element target, group target, viewport position, or post-step wait. Recorder read
boundaries normalize supported schema `1.0` through `1.4` documents to `1.5` in memory;
loading alone does not rewrite storage. Relay persistence accepts schema `1.2`, `1.4`,
and `1.5`, creates and saves `1.5`, and rejects a page-text assertion labeled with an
older schema version. Executable background validation continues to treat the version
string as opaque metadata.

At assertion start, replay snapshots the main frame and every currently attached nested
frame. It searches normalized `document.body.innerText` inside each visible frame,
using case-insensitive substring containment after collapsing whitespace. The match is
computed within the frame evaluation so observed document text is never transferred to
the Node process. Hidden frame trees are skipped. Detached, cross-origin-failed, or
otherwise uninspectable frames count as not found. Text fragments from separate frames
are never concatenated.

The assertion passes when any inspected frame matches. Otherwise replay fails once with
the stable `page_text_missing` detail and no observed text. Interactive replay may show
the expected phrase already present in the workflow; background automation keeps its
fixed privacy-safe assertion failure. The existing user-triggered Retry action starts a
fresh one-shot frame snapshot and scan.

Retain the historical `workflow-1.4.schema.json` artifact unchanged and publish a new
generated `workflow-1.5.schema.json` artifact. Keep the scan internal to replay-core so
the package export surface does not grow.

## Alternatives Considered

### Model the check as an element assertion against `body`

Rejected because a synthetic locator obscures the targetless semantics, does not cover
nested frames, and exposes irrelevant locator controls in authoring and diagnostics.

### Concatenate text from every frame before matching

Rejected because it could create a false positive from phrase fragments that never
appear together in one document and would require transferring observed page text.

### Poll until the phrase appears

Rejected because assertions are intentionally one-shot and user-triggered Retry already
provides an explicit fresh evaluation without adding hidden timing behavior.

### Fail when any frame is uninspectable

Rejected because detached and inaccessible frames are expected browser conditions. They
contribute no match, while other visible frames remain eligible to satisfy the assertion.

## Consequences

- Canonical writers and persistence contracts move to schema `1.5` without a bulk data
  migration.
- Replay gains an all-frame text primitive with deterministic one-shot semantics.
- Page-text failures are diagnostically less detailed by design because observed page
  content remains inside browser execution.
- Authoring and inspection UIs must treat the assertion as targetless and hide locator,
  position, group-template, and wait controls.
