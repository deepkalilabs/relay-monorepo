# ADR 0016: Add replayable repeated-group assertions

- Status: Accepted
- Date: 2026-08-06

## Context

Element assertions identify one semantic target. They cannot express that a dynamic result set, card collection, or repeated row pattern still exists when members are inserted, removed, reordered, or rewritten with different content. Persisting member identities or recorded counts would make that check content-dependent and brittle.

Repeated-group discovery and replay also cross several compatibility and trust boundaries: the injected page chooses candidates, the recorder protocol transports the chosen target, workflow storage persists it, and replay must interpret it deterministically without exposing page content in diagnostics.

## Decision

Advance the canonical workflow schema from `1.3` to `1.4`. Add `GroupExistsAssertionStep` beside the unchanged element assertion shape under `AssertionStep`. Versions `1.0` through `1.3` normalize to `1.4` at read boundaries and are rewritten only on their next save.

Represent a chosen group with a content-free `RepeatedGroupTemplate`. Version one fixes the algorithm name to `structural-token-v1` and stores the root tag and role, shared root classes, sorted relative tag/role path tokens, optional frame URL, and captured match count. It excludes text, accessible names, IDs, values, URLs, positional indexes, and member identity. The captured count is diagnostic authoring context only.

Discover candidates inside the injected page from up to six ancestors of a hovered seed. Compare each ancestor with visible element siblings and offer only groups with at least two members and at least 70% structural-token Jaccard overlap. A single compact, viewport-bounded shadow-root card floats over the page and highlights every member equally; the surrounding workspace does not render another picker surface. Hover only previews; clicking a matched member or activating its row freezes the group locally, and only the card's confirmation action crosses the protocol boundary. Existing exact-element selection remains available through an explicit frozen-seed action or a direct click when no group qualifies.

Extend the request-correlated picker protocol additively with `assertion.pick.groupSelected`; keep `assertion.pick.selected` unchanged for element assertions. Only the chosen template crosses the protocol boundary.

Replay the stored template in its recorded frame using the same versioned token algorithm. Prefilter on exact root tag and role, reject root candidate sets over 500, and pass immediately when any one visible candidate reaches 70% Jaccard overlap. Do not apply recorded scroll position, require uniqueness or the captured count, choose a member, poll, or automatically retry. Failure diagnostics report the recorded count, algorithm version, candidate breadth, and highest similarity scores without page text. Successful replay reports locator kind `structural-group`.

## Alternatives Considered

- Persist one representative member locator. Rejected because it restores element identity and fails when that member disappears.
- Require the recorded count. Rejected because dynamic result counts are expected to change.
- Persist text, accessible names, or model-generated labels. Rejected because content changes independently of structure and would expand the sensitive-data boundary.
- Add an LLM matcher or third-party dependency. Rejected because version one needs local, deterministic, replayable semantics.
- Scan the whole page before hover. Rejected because seed-driven discovery is bounded, explainable, and keeps authoring responsive.

## Consequences

- Workflow consumers must support canonical schema `1.4` and the assertion union.
- Group templates remain inspectable and content-free, but structural page changes can still invalidate them.
- Authoring requires two current siblings while replay intentionally requires only one visible match.
- Candidate caps can reject legitimate but excessively broad roots; users must choose a nearer container.
- Changes to token extraction or similarity semantics require a new algorithm version rather than silently changing `structural-token-v1`.
