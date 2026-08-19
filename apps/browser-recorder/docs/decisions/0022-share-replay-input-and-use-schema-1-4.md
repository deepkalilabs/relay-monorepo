# ADR 0022: Share replay input and use canonical schema 1.4

- Status: Accepted
- Date: 2026-08-17

## Context

The frontend interactive runner and backend automation runner duplicate workflow types,
validation, locator ordering, and repeated-group structure. Their matching version labels
do not guarantee structural compatibility: the frontend previously emitted assertion-
capable schema `1.2` documents while Python persistence accepted only action steps, and
automation treated the version label as opaque.

ADR 0021 introduced an additive root workspace so a shared TypeScript dependency can be
adopted without moving the backend automation packages. ADR 0020 selected schema `1.2`
as a temporary frontend/backend write label, but overloading that label with the later
assertion union obscures the actual capability boundary.

## Decision

Add the private root package `@relay/workflow-contract` as the authoritative TypeScript
input contract for the shared replay engine. It owns workflow domain types, strict Zod
schemas, locator ordering, repeated-group structure and matching, profile field IDs, and
shared conformance fixtures. Frontend contract modules remain temporary compatibility
re-exports; frontend serialization, parameter resolution, and library projections stay
frontend-owned.

Use schema `1.4` for new canonical frontend and persistence writes. The complete schema
`1.4` step union includes actions, element assertions, and repeated-group assertions.
Frontend compatibility readers continue to accept supported versions `1.0` through
`1.3`, including assertion-capable `1.2` documents already emitted by the frontend, and
normalize them to `1.4` only in memory. Loading a document does not rewrite it.

Python persistence remains a native Pydantic/OpenAPI implementation. It accepts stored
schema `1.2` documents and canonical schema `1.4` documents, creates new drafts as
`1.4`, and writes `1.4` on an explicit save. A generated, checked-in JSON Schema artifact
and shared accept/reject fixtures provide the cross-language conformance boundary;
Python does not import or execute TypeScript.

Expose a separate executable schema from the shared package. It treats
`schemaVersion` as opaque string metadata while enforcing the same executable structure,
preserving backend ADR 0012. Automation-core adopts that boundary in a later increment.

This decision supersedes ADR 0020's canonical `1.2` write and normalization target.
ADR 0020's historical compatibility and no-rewrite-on-read rationale remain accepted.
It extends ADR 0021 with root ownership of the shared replay input while retaining the
existing backend automation package locations and project lockfiles.

## Alternatives Considered

### Expand schema 1.2 to mean the complete assertion-capable contract

Rejected because the backend already gave `1.2` a narrower action-only meaning. Reusing
the same label for incompatible structures makes version-based diagnostics misleading.

### Make the version label opaque at every boundary

Rejected because persistence and frontend file compatibility need an explicit canonical
format. Only execution admission benefits from version-agnostic structural validation.

### Require a bulk stored-document migration

Rejected because existing schema `1.2` documents remain readable. They can become `1.4`
through normal explicit saves without pausing writes or rewriting immutable objects in
bulk.

### Move automation-core before sharing the contract

Rejected because package relocation is mechanical and can happen after behavior sharing
is stable. It is not required to establish a root contract dependency.

## Consequences

- Frontend and persistence produce unambiguous canonical schema `1.4` documents.
- Existing supported frontend files and stored schema `1.2` documents remain readable.
- Contract changes must update Zod, the generated JSON Schema, Pydantic, OpenAPI, and
  shared fixtures together.
- The root build must build `@relay/workflow-contract` before its consumers.
- Automation-core and replay behavior remain unchanged until their later migration
  increments.
- Relocating automation-core remains a separately reviewed follow-up.
