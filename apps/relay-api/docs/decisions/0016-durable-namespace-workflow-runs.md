# ADR-016: Persist namespace workflow runs and evidence

## Status

Accepted

## Date

2026-08-20

## Context

The private Browserbase service intentionally keeps its batch queue, progress snapshots,
and thumbnail capabilities in one process. That remains useful for local execution, but
it means an authenticated namespace caller loses completion history when the browser or
Relay restarts. Assertion execution also produces only transient pass/fail information,
and the existing thumbnail URL cannot be recovered after the private process restarts.

Browser actions may have external side effects, so recovery must never resubmit uncertain
work. Assertion inputs, page content, workflow payloads, Browserbase identifiers, and raw
exceptions may be sensitive and must not become run-history data.

## Decision

Add PostgreSQL records for namespace run batches, individual workflow runs, and executed
assertion results. A workflow has many runs, each run records the workflow revision it
executed, and every run receives its own stable UUID. Relay generates the batch UUID and
passes it to the private service so recovery polling has a stable correlation key.

Relay submits each accepted batch exactly once. A lease-based background tracker polls
the existing private batch snapshot, resumes due nonterminal records after Relay restart,
and applies progress monotonically and idempotently. An expired lease may be claimed by a
new Relay process. The tracker never retries workflow execution. Missing private work and
uncertain submission or an invalid/mismatched runner snapshot become terminal fixed
failure codes.

Persist one result for every assertion that actually executed: step ID, step index, step
name, assertion kind, matched boolean, duration, and the fixed `assertion_failed` code when
unmatched. Disabled and unreached assertions have no row. Do not persist expected or
observed text, locator attempts, page bodies, workflow documents or payloads, provider
identifiers, artifact capabilities, or raw exceptions. Run-level failures are restricted
to an enumerated set of fixed codes.

When a terminal snapshot contains a thumbnail capability, Relay performs a bounded,
read-only WebP fetch and writes the bytes to the existing private S3-compatible object
store under a namespace/run-derived immutable key. The database stores only the private
object key and dimensions. Artifact transfer may be retried until the capability expires;
capture or transfer failure never changes the automation result.

Expose authenticated namespace-scoped create, batch lookup, cursor-paginated history,
run detail, and screenshot operations. Default history pages contain 50 newest runs and
the maximum is 100. Keep the pre-existing `/v1/batches` and `/v1/artifacts` gateways for
ephemeral local-development compatibility. Retain durable records and screenshot objects
indefinitely; deletion and expiry APIs are outside this decision.

This decision supersedes ADR 0007's process-local-only result history for namespace-backed
batches, ADR 0009's temporary-only screenshot access for those durable runs, and ADR
0013's statement that FastAPI does not persist batch run state. Those decisions remain in
force for direct runs and compatibility batches. The private service remains
unauthenticated, private, process-local, and non-retrying.

## Alternatives considered

### Recover by resubmitting workflows

Rejected because the original submission may have executed browser actions before its
status became uncertain. A retry could duplicate external side effects.

### Persist private service snapshots in the browser

Rejected because browser lifecycle cannot provide restart recovery, namespace isolation,
or server-side evidence storage.

### Store assertion diagnostics and full screenshots in PostgreSQL

Rejected because diagnostics can contain sensitive page data and large binary values do
not belong in the relational run index.

## Consequences

- Namespace run history and evidence survive browser and Relay restarts.
- A private execution-service restart can still lose active work; Relay records that loss
  safely instead of executing it again.
- PostgreSQL and object storage grow indefinitely until a separately reviewed retention
  policy is introduced.
- Shared HTTP Basic authentication remains a POC boundary; namespaces scope data but are
  not independent user authorization tenants.
- Screenshot availability remains best effort and independent of run success.
