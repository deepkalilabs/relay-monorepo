# Browserbase automation service agent guide

The root [`AGENTS.md`](../../AGENTS.md) is authoritative for Git safety, ADR review,
repository-wide tooling, and cross-project verification. Read it before this guide.
Read the root [`NAVIGATION.md`](../../NAVIGATION.md) and this project's
[`NAVIGATION.md`](NAVIGATION.md) for current ownership, runtime flows, entry points, and
the sources-of-truth order.

This app exposes the `@relay/automation-worker-browserbase` package through a private
Fastify HTTP process. [`openapi.yaml`](openapi.yaml) is the source of truth for its wire
contract; the Relay API consumes that file read-only from its sibling app.

## Non-negotiable guardrails

- Preserve the `@relay/automation-service-browserbase` package name, scripts, runtime
  entry point, environment variables, ports, OpenAPI semantics, and response shapes.
- Keep the default listener on loopback and never expose the unauthenticated service
  publicly.
- Never log workflow bodies, credentials, parameter values, session IDs, artifact IDs,
  artifact URLs, or local paths.
- Preserve shared process-wide run capacity, disconnect and shutdown cancellation,
  bounded batch state, and privacy-safe terminal results.
- Keep provider-neutral execution in root packages; this app owns transport and process
  lifecycle only.
- Update the app tests, README, OpenAPI file, and the API integration checks together
  when a contract boundary changes.

## Verification

Install Node dependencies once with `npm ci` and run Node checks from the repository
root so npm resolves sibling workspaces:

```bash
npm run typecheck --workspace @relay/automation-service-browserbase
npm test --workspace @relay/automation-service-browserbase
npm run build --workspace @relay/automation-service-browserbase
```

Validate the contract from `apps/relay-api/`:

```bash
uv run python -m openapi_spec_validator ../automation-service-browserbase/openapi.yaml
```

Build the deployment image from the repository root:

```bash
docker build -f apps/automation-service-browserbase/Dockerfile -t relay-automation .
```
