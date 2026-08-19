# ADR 0018: Authenticate Relay workspaces with HTTP Basic

- Status: Accepted
- Date: 2026-08-12
- Supersedes: ADR 0011 for workflow API authentication
- Amends: ADR 0017

## Context

ADR 0011 selected a server-held bearer token for a provider-neutral remote persistence
service. ADR 0017 later made Relay namespaces selectable workflow workspaces while keeping
profiles local. The deployed Relay persistence API already authenticates namespace and
workflow routes with shared HTTP Basic credentials, so the bearer-only workflow adapter
cannot discover or use those workspaces.

Credentials must remain on the Node server. A partially configured Relay connection must
fail explicitly rather than silently selecting a different remote identity or persistence
service.

## Decision

Authenticate Relay namespace and namespace-scoped workflow requests with HTTP Basic. Read
the server-only `RELAY_API_BASE_URL`, `RELAY_API_USERNAME`, and `RELAY_API_PASSWORD`
variables as one all-or-nothing configuration. Development remains local-only when all
three are absent; incomplete configuration is invalid, and production requires all three.

Keep profiles permanently bound to the local filesystem repository. The separate legacy
remote-profile adapter and profile OpenAPI contract retain bearer authentication but are
not selected by the workspace flow.

## Alternatives Considered

- Add bearer authentication to Relay. Rejected because Relay already exposes one shared
  Basic-auth boundary and the current integration does not need multiple credential modes.
- Send Relay credentials from the browser. Rejected because browser-visible credentials
  would expose every namespace and workflow operation.
- Encode credentials in the Relay base URL. Rejected because URLs are more likely to be
  logged, copied, or exposed in diagnostics.

## Consequences

- Relay credentials stay in ignored environment files and server-side request headers.
- Workflow and namespace requests match Relay's existing authentication challenge.
- Missing or invalid credentials surface as unavailable Relay workspaces without leaking
  credential values.
- Profile storage and browser-facing profile APIs remain local and unchanged.
