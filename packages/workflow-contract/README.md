# @relay/workflow-contract

Private TypeScript contract for workflows consumed by the shared replay engine.

See the root [`NAVIGATION.md`](../../NAVIGATION.md) for the complete dependency graph
and change-routing map.

The package owns:

- canonical schema `1.5` workflow types and strict Zod validation;
- compatibility reads for frontend versions `1.0` through `1.4`;
- an executable boundary that treats `schemaVersion` as opaque metadata while retaining
  strict structural validation;
- locator ordering, element/group/page-text assertion shapes, repeated-group structure,
  and profile field identifiers;
- the generated cross-language JSON Schema artifact and shared conformance fixtures.

It does not own persistence, transport, runner orchestration, browser lifecycle, or UI
state.

## Source and consumers

- `src/domain.ts` defines canonical workflow, step, target, parameter, and wait types.
- `src/schema.ts` defines canonical and executable Zod validation plus compatibility
  parsing.
- `src/repeated-group.ts` owns content-free repeated-structure matching.
- `src/profile-field.ts` owns shared profile field identifiers.
- `src/index.ts` is the supported package export surface.
- `schema/workflow-1.5.schema.json` and `fixtures/conformance.json` keep TypeScript,
  Python, JSON Schema, and both checked-in OpenAPI contracts aligned.

Replay-core consumes this package directly. Browser Recorder uses it through thin
compatibility exports, while automation-core exposes compatible runner types. A
contract change therefore requires cross-project schema, OpenAPI, model, fixture, and
consumer verification; start with the root navigation guide's change-routing table.

## Commands

Install once with `npm ci` and run this package's commands from the repository root:

```bash
npm test --workspace @relay/workflow-contract
npm run typecheck --workspace @relay/workflow-contract
npm run build --workspace @relay/workflow-contract
npm run schema:check --workspace @relay/workflow-contract
```

Regenerate `schema/workflow-1.5.schema.json` after an intentional canonical contract
change:

```bash
npm run schema:generate --workspace @relay/workflow-contract
```

`fixtures/conformance.json` is executed against Zod, the generated JSON Schema,
Pydantic, and the Relay persistence and private execution OpenAPI definitions.
