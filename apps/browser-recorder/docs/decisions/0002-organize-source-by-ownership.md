# ADR 0002: Organize source by ownership

- Status: Accepted
- Date: 2026-07-28

## Context

The source tree mixed framework routes, cross-feature composition, product behavior, shared contracts, and infrastructure. Generic `lib`, `hooks`, and `components` directories obscured ownership, while the workspace implementation lived outside the route that exclusively consumed it.

The restructuring must preserve existing URLs, workflow files, HTTP endpoints, WebSocket messages, rendering, and fixture availability.

## Decision

Use Next.js route groups to separate product and test-support routes without changing URL paths. Keep workflow workspace composition in private folders beneath its editor route.

Organize reusable client code by product feature, expose feature entry points through `index.ts`, and keep feature internals relative. Put client/server-safe workflow, recording, and protocol definitions under `shared/contracts`; split protocol schemas by message direction. Put shared presentation primitives under `shared/ui`.

Organize server adapters under `server/infrastructure` and server capabilities under `server/recording`, `server/replay`, and `server/workflows`. Enforce dependency direction with ESLint:

```text
app → features → shared
server ─────────→ shared
```

Shared and server modules cannot depend on client features, and lower layers cannot depend on route composition.

## Consequences

- Every non-route module has an explicit product, shared-contract, UI, or infrastructure owner.
- Route groups and private folders add hierarchy without altering public URLs.
- Client and server code share validated wire and persistence contracts without importing one another.
- Moving or renaming feature internals requires updating only relative imports and the feature entry point.
- Route-specific workspace components are intentionally not reusable outside the editor route.
