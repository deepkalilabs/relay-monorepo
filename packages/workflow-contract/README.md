# @relay/workflow-contract

Private TypeScript contract for workflows consumed by the shared replay engine.

The package owns:

- canonical schema `1.4` workflow types and strict Zod validation;
- compatibility reads for frontend versions `1.0` through `1.3`;
- an executable boundary that treats `schemaVersion` as opaque metadata while retaining
  strict structural validation;
- locator ordering, repeated-group structure, and profile field identifiers;
- the generated cross-language JSON Schema artifact and shared conformance fixtures.

It does not own persistence, transport, runner orchestration, browser lifecycle, or UI
state.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run schema:check
```

Regenerate `schema/workflow-1.4.schema.json` after an intentional canonical contract
change:

```bash
npm run schema:generate
```

`fixtures/conformance.json` is executed against Zod, the generated JSON Schema,
Pydantic, and both persistence OpenAPI definitions.
