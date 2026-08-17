# ADR-015: Keep deployment ownership provider-neutral

## Status

Accepted

## Date

2026-08-17

## Context

The repository included configuration, rollout instructions, and handoff documents for
Railway. Those files made one hosting vendor appear to be part of the supported
application architecture even though the runtime depends only on PostgreSQL, an
S3-compatible private object store, and trusted private networking between the
authenticated FastAPI gateway and the unauthenticated Node execution service.

The vendor-specific material also coupled unrelated application and package changes to
a deployment target that may be replaced independently. Removing that ownership must
not weaken the security boundary or change persistence behavior.

## Decision

Keep deployment requirements provider-neutral. The repository documents and tests the
runtime interfaces it owns, but it does not contain a vendor deployment manifest or a
vendor-specific rollout guide.

The following invariants remain in force:

- canonical workflow documents use the existing private S3-compatible object-store
  adapter;
- PostgreSQL remains the metadata, summary, pointer, and idempotency store;
- the Node execution service remains unauthenticated and must not be publicly exposed;
- a non-loopback listener may enable screenshots only behind trusted private networking
  with `AUTOMATION_TRUST_PRIVATE_NETWORK=1`;
- browser callers use relative artifact URLs through the authenticated FastAPI gateway;
- remote deployments use exactly one execution-service replica while batch and artifact
  access state remains process-local.

This decision supersedes the Railway-specific hosting and configuration portions of
ADR 0010 and ADR 0014. It preserves ADR 0010's private S3-compatible document-store
decision and ADR 0014's trusted-private-network screenshot boundary. Both accepted ADRs
remain unchanged as historical records.

## Consequences

- Operators must supply PostgreSQL, private S3-compatible storage, TLS at the public
  boundary, and private service-to-service networking in their chosen environment.
- Active documentation and examples describe required capabilities rather than one
  vendor's domains, environment references, or product names.
- Removing the checked-in deployment manifest and rollout guide does not remove or
  replace a running deployment.
- Choosing and documenting a supported hosting platform requires a separate decision.

## Alternatives considered

### Keep the existing vendor deployment files as examples

Rejected because examples become stale operational guidance and continue coupling the
repository to a platform it no longer owns.

### Select a replacement hosting vendor now

Rejected because the application cleanup does not require a hosting selection, and a
new platform deserves separate operational design and review.

### Remove private storage or private networking support

Rejected because those are application security and persistence boundaries, not
vendor-specific behavior.
