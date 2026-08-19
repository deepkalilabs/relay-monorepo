# ADR 0017: Select workflow workspaces at runtime

- Status: Accepted
- Date: 2026-08-11
- Supersedes: ADR 0011 for workflow repository selection

## Context

ADR 0011 selected local or remote persistence once at server startup and applied that
choice to workflows and profiles together. Relay now organizes workflows into namespaces,
and Browser Memory Recorder needs to choose among those namespaces without restarting the
Node server. Profiles remain local and are not part of Relay's namespace contract.

Namespace selection is organizational rather than an authorization boundary. Remote
credentials must remain on the Node server, and workflow state from different persistence
sources must not mix in one rendered application session.

## Decision

Expose a same-origin workspace catalog through the Node server. Development offers local
workflow files plus namespaces returned by Relay; production offers Relay namespaces only.
The browser remembers one confirmed workspace key and sends it with workflow and initial
batch requests. The key is `local` in development or the Relay namespace UUID. A server-side
resolver validates that key and selects either the filesystem repository or a namespace-bound
remote repository.

Keep existing workflow repository ports unchanged. Keep profile routes permanently bound
to the local profile repository. Changing workspace performs a full navigation to the
Library so client state is reconstructed from one source.

## Alternatives Considered

- Restart the server to change namespace. Rejected because namespace is user-selected
  organizational context, not deployment configuration.
- Put remote credentials or base URLs in the browser. Rejected because storage credentials
  must remain server-side.
- Add namespace parameters to every workflow repository method. Rejected because a
  namespace-bound remote adapter preserves the existing repository interface and keeps
  scope out of local persistence.
- Switch profiles with workflows. Rejected because profiles are not namespace-scoped and
  the current Relay persistence contract does not own them.

## Consequences

- Development can continue with local files when Relay is unavailable.
- Production requires Relay configuration and at least one valid namespace before product
  routes can be used.
- Remembered namespace IDs are accepted only while namespace discovery still returns them.
- Workflow and batch requests require a workspace key; profile requests do not.
- ADR 0011 remains applicable to the remote adapter's credential and failure-handling rules,
  but no longer controls workflow selection or profile persistence.
