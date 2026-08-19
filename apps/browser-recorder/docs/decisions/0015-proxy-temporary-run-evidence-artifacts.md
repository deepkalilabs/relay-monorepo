# ADR 0015: Proxy temporary run evidence artifacts

- Status: Accepted
- Date: 2026-08-05

## Context

ADR 0014 keeps Relay credentials and execution details out of the browser while
projecting batch progress through Browser Replay. Relay's terminal run snapshots can
also include a short-lived WebP thumbnail capability. Returning that upstream URL
directly would couple the browser to Relay and either expose credentials or require a
second browser-facing authentication boundary.

The thumbnails expire after one hour and batch state remains in memory. This feature is
run evidence for the current activity view, not durable run history or artifact storage.

## Decision

Extend the ADR 0014 proxy with a same-origin, authenticated server-to-server artifact
capability. Browser Replay validates Relay thumbnail metadata and exposes only a local
`/api/run-artifacts/{artifactId}` URL plus its dimensions. It never returns Relay's base
URL, bearer token, expiry capability, or other thumbnail metadata to the browser.

When the browser requests an artifact, Browser Replay validates the UUID and fetches the
corresponding Relay artifact with its server-held bearer token. The proxy accepts only a
successful, non-empty `image/webp` body of at most 100 KB. It streams the upstream body
through a size bound, returns `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`, maps expired or missing artifacts to 404, and maps
malformed or unavailable upstream responses to safe errors that do not reveal Relay
details.

The proxy does not persist, transform, optimize, or retry artifacts. The browser renders
the supplied dimensions and bypasses Next.js image optimization so temporary evidence is
not copied into another cache.

## Alternatives Considered

- Return Relay artifact URLs to the browser. Rejected because Relay authentication and
  service topology would cross the existing server trust boundary.
- Fetch and embed screenshots in batch polling responses. Rejected because it would
  inflate frequently polled JSON and remove independent artifact failure handling.
- Persist screenshots in Browser Replay. Rejected because durable run history, retention,
  and storage lifecycle are outside this prototype.
- Use Next.js image optimization for the local URL. Rejected because its cache semantics
  conflict with Relay's temporary, expiring evidence.

## Consequences

- The browser receives stable same-origin shapes while Relay remains the source of truth
  for temporary artifacts.
- Screenshot retrieval adds a bounded server request and keeps bearer credentials solely
  on the server.
- Evidence can disappear after Relay expiry and the UI must handle that independently of
  run status.
- No new persistence, durable history, or Relay contract change is introduced.
