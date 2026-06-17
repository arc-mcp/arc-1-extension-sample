# arc1-plugin-example

A **sample ARC-1 extension** — the playground for FEAT-61. Pure TypeScript, **no ABAP**.

> ⚠️ This targets the **`@experimental` `arc-1/public` API that does not exist yet**. It is a
> forward-looking sample + smoke test for the extension framework being built in arc-1
> (`docs/research/extension-framework-spec.md`). It typechecks against the local stub in
> `src/public-stub.d.ts` until the real `arc-1/public` ships (PR1–PR2) — then delete the stub
> and rely on the `arc-1` peer dependency.

## What it demonstrates

| Tool | SAP API | Style |
|------|---------|-------|
| `Custom_ProgramLineCount` | ADT (`/sap/bc/adt/...`) | code tier (GET + logic) |
| `Custom_QuerySalesOrders` | OData (`ZGWSAMPLE_BASIC`) | code tier (GET, `Accept: application/json`) |
| `Custom_ReadProgram` | ADT | **manifest tier** (declarative JSON) |
| _(TBD — Q-O)_ | a non-ADT/non-OData SAP API | code tier — endpoint to be chosen |

All read-only. Every call goes through the gated `ctx.http` → `checkOperation` + scope + audit.

## How it will be loaded

```
ARC1_PLUGINS=/abs/path/to/arc1-plugin-example/dist/index.js  arc1 --http-streamable
```

## Conventions (per the spec)

- Tool names are `Custom_*` (reserved namespace; collisions fail-fast at load).
- Each tool declares `policy: { scope, opType }` — gated exactly like a built-in (reuses the 7 scopes + allow\* ceiling; **no custom scopes**).
- `package.json#arc1.requires` declares the scopes/packages the plugin needs — **intersected** with the server ceiling, never expands it.
- Pure TS — **no ABAP artifacts**. Custom endpoints (if any) must already exist on the SAP system.

## Status

Cannot run until arc-1 ships the extension framework (PR1–PR3). Until then this is the design
reference and the target for `npm run typecheck`.
