# ADR 0002: Isolate development Railway resource identities

- Status: Accepted
- Date: 2026-08-19
- Supersedes: the PostgreSQL naming and implicit frontend private-network endpoint
  decisions in ADR 0001

## Context

The first Railway IaC apply created the bucket and three application services, but the
database named `Postgres` did not materialize in the `development` environment. The
project already has a global service with that name and instances in other environments.
Railway's beta IaC engine repeatedly reported the database creation as successful while
continuing to plan it on every reconciliation.

Railway also assigned `relay_frontend` the normalized private-network endpoint
`relayfrontend`. Because the desired graph omitted that platform-generated value, every
subsequent plan attempted to remove it without converging.

## Decision

Name the development database `Postgres-development`. This gives the environment-owned
database a project-wide identity that cannot collide with the existing `Postgres`
service. Keep the API's `DATABASE_URL` as a typed reference to that database.

Declare `relayfrontend` as the frontend's private-network endpoint. The endpoint matches
Railway's normalization of the existing service name and makes the live and desired
graphs converge without changing the service's private reachability.

These identities remain specific to the `development` graph. Production and preview
resources remain outside this IaC definition.

## Alternatives considered

### Reuse the global `Postgres` service identity

Rejected because two successful IaC applies failed to create its development instance,
leaving identical drift and no database volume.

### Create PostgreSQL manually and preserve it outside IaC

Rejected because the API dependency and managed storage would no longer be reproducible
from the reviewed graph.

### Leave the generated frontend endpoint implicit

Rejected because Railway records the normalized endpoint for the underscore-containing
service name, while the beta IaC differ treats an omitted endpoint as a requested
removal and produces permanent drift.

## Consequences

- The development database has an unambiguous project-wide service identity.
- The API database reference can converge through the IaC graph.
- The frontend's private-network endpoint is explicit and drift-detectable.
- Existing production and preview PostgreSQL instances are unchanged.
