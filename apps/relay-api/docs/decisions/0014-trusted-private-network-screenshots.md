# ADR-014: Permit screenshots on an explicitly trusted private listener

## Status

Accepted

## Date

2026-08-13

## Context

The production `relay-automation` service listens on `0.0.0.0:8080` so `relay-api` can
reach it through Railway private networking. Railway public networking is disabled for
that service. The existing screenshot configuration guard rejects every non-loopback
listener, so production cannot return terminal thumbnail capabilities even though the
browser retrieves them through the authenticated public FastAPI artifact gateway.

The Node service remains unauthenticated. Enabling screenshots must not imply that a
non-loopback listener is safe by default, permit public exposure, or relax the local-only
Inngest boundary. An accidentally broad exception could expose side-effecting runs and
sensitive screenshot capabilities.

## Decision

Add the exact opt-in `AUTOMATION_TRUST_PRIVATE_NETWORK=1`. A non-loopback listener may
enable `AUTOMATION_SCREENSHOTS=true` only when that opt-in is present. Missing or empty
values remain disabled, and any value other than exactly `1` is invalid. Loopback
screenshot behavior is unchanged.

The exception applies only to terminal screenshot capture and artifact serving. Inngest
continues to require a loopback listener even when the private-network opt-in is set.
Deployments using the opt-in must keep the Node service behind trusted private networking
with no public domain. Browser callers continue to use relative thumbnail URLs through
the authenticated FastAPI artifact gateway and never contact the Node service directly.

This decision supersedes only ADR 0009's loopback-only screenshot restriction for an
explicitly trusted private listener. ADR 0008's prohibition on public exposure and ADR
0013's authenticated FastAPI gateway remain in force. No public wire contract changes.

## Consequences

- Railway can enable terminal screenshots while keeping `relay-automation` private and
  unauthenticated.
- The opt-in is an operator assertion about network isolation, not authentication or an
  application-level authorization control.
- A deployment must first roll out the supporting build with screenshots disabled, then
  set both `AUTOMATION_TRUST_PRIVATE_NETWORK=1` and `AUTOMATION_SCREENSHOTS=true` and
  restart the service.
- Removing private network isolation while the opt-in is set would violate the service's
  security boundary.
- Rollback requires setting `AUTOMATION_SCREENSHOTS=false` and restarting. The trust
  opt-in may remain because it enables no artifact-return path by itself.

## Alternatives considered

### Continue disabling production screenshots

Rejected because the authenticated public gateway already provides the intended browser
handoff without making the Node service public.

### Allow screenshots on every non-loopback listener

Rejected because the unauthenticated service is unsafe when publicly reachable and a
fail-open default would weaken ADR 0008.

### Add authentication to the Node service

Rejected as outside this POC. FastAPI already owns the authenticated public boundary,
and adding a second authentication contract would expand the wire and deployment scope.
