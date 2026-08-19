# ADR 0009: Define a cloud workflow persistence contract

- Status: Accepted
- Date: 2026-07-30

## Context

ADR 0001 keeps workflows in local JSON files. A separately implemented cloud
persistence backend needs a stable handoff boundary before storage technology,
deployment, and authentication are selected.

Workflow documents may contain credentials, tokens, payment data, and other
sensitive values. Concurrent edits and retried requests must not silently
overwrite data or create duplicate workflows, and list and error responses must
not expose step payloads or targets.

## Decision

Define a versioned OpenAPI 3.1 contract in
`docs/specs/cloud-workflow-api.openapi.yaml` for workflow persistence.

Version 1 exposes list, create, load, save, and finish operations under
`/v1/workflows`. The backend owns workflow identity, lifecycle fields,
timestamps, and revisions. Mutations use an expected revision for optimistic
concurrency, an idempotency key for safe retries, and atomic persistence.

List responses contain lifecycle metadata and minimal ordered step summaries
only. Complete workflow content is returned only by single-workflow operations.
The contract standardizes validation, conflict, size, availability, and internal
error envelopes without including sensitive workflow values.

Authentication, backend storage, deployment, profiles, deletion, migration,
pagination, collaboration, replay execution, and local-file mirroring remain
outside version 1. Choosing any of those boundaries requires a later decision.
The existing local filesystem remains the active implementation until a cloud
adapter is built.

## Alternatives Considered

- Implement a cloud backend before fixing the contract. Rejected because backend
  choices would implicitly define the public protocol and make independent
  implementation and review harder.
- Reuse the local JSON document directly as an unversioned CRUD payload. Rejected
  because it lacks explicit concurrency, retry, privacy, and error semantics.
- Put complete workflows in list responses. Rejected because it increases
  payload size and unnecessarily exposes sensitive step content.

## Consequences

- The local BFF and a future cloud backend can be implemented independently
  against one reviewable wire contract.
- Clients must track revisions and supply idempotency keys for mutations.
- Backend implementations must provide atomic compare-and-write behavior and
  durable idempotency results.
- Protocol evolution must preserve version 1 or introduce a new version and, for
  expensive-to-reverse changes, a superseding ADR.
