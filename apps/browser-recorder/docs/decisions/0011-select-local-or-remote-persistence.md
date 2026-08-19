# ADR 0011: Select local or remote persistence at server startup

- Status: Accepted
- Date: 2026-08-03
- Amends: ADR 0009

## Context

ADR 0001 and ADR 0004 established repository ports backed by local JSON files.
ADR 0009 defined a separately hosted cloud workflow API but intentionally left
authentication, profiles, and adapter selection undecided.

The application needs one deployment-time choice between its existing local
files and a remote persistence service. Workflow and profile values may contain
credentials or personal information, so remote failures must not fall back to a
second data store or expose record content.

## Decision

Select both repositories once at server startup with `DATA_SOURCE`, defaulting
to `filesystem`. Remote mode requires `REMOTE_STORAGE_BASE_URL` and a server-held
`REMOTE_STORAGE_BEARER_TOKEN`; incomplete configuration prevents startup.

Implement the remote boundary as HTTP repository adapters. Keep the cloud
database service, schema, migrations, deployment, and user authentication
outside this repository. Require bearer authentication for the workflow API and
define a parallel versioned profile API for list, create, load, save, and delete.

Every remote mutation receives a UUID idempotency key. The adapter may retry one
network or transient gateway failure using the same key. Remote records remain
independent from local files: there is no migration, mirroring, or automatic
fallback between modes.

## Alternatives Considered

- Connect this server directly to a database. Rejected because it would couple
  the recorder runtime to database selection, migrations, and credentials.
- Choose a backend per request or per user. Rejected because the application has
  no user identity boundary and mixed backends could expose inconsistent data.
- Fall back to local files during remote failures. Rejected because successful
  writes could diverge across stores and later overwrite newer records.

## Consequences

- Filesystem behavior and browser-facing APIs remain compatible.
- Deployments can switch both record types through server-only configuration.
- The remote service must implement both OpenAPI contracts, bearer validation,
  atomic revision checks, durable idempotency, and privacy-safe responses.
- Existing local files are untouched and unavailable while remote mode is active.
- Invalid authentication, malformed responses, and exhausted transient failures
  appear to the browser as safe storage-unavailable responses.
