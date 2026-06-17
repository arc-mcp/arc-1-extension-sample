# arc1-plugin-example

A **sample ARC-1 extension** — the playground for FEAT-61. Pure TypeScript, **no ABAP**.

> Consumes the **`@experimental` `arc-1/public` API**. It is the smoke test for the FEAT-61
> extension framework (`arc-1` `docs/research/extension-framework-spec.md`). **Verified live
> against a real S/4HANA system** — both tiers return real SAP source. The API may break in any
> release (it declares `apiVersion`).

## What it demonstrates

| Tool | SAP API | Style |
|------|---------|-------|
| `Custom_ProgramLineCount` | ADT (`/sap/bc/adt/...`) | code tier (GET + logic) |
| `Custom_QuerySalesOrders` | OData (`ZGWSAMPLE_BASIC`) | code tier (GET, `Accept: application/json`) |
| `Custom_ReadProgram` | ADT | **manifest tier** (declarative JSON) |
| _(TBD — Q-O)_ | a non-ADT/non-OData SAP API | code tier — endpoint to be chosen |

All read-only. Every call goes through the gated `ctx.http` → `checkOperation` + scope + audit.

## Build + load

```sh
# 1. link the local arc-1 build (until arc-1 is published with the public API)
( cd /path/to/arc-1 && npm link )
npm install && npm link arc-1 && npm run build

# 2. load into an arc-1 instance…
ARC1_PLUGINS=$PWD/dist/index.js  arc1 --http-streamable
# …or drive one call via the CLI:
ARC1_PLUGINS=$PWD/dist/index.js  arc1-cli call Custom_ProgramLineCount --json '{"name":"RSPARAM"}'
```

## Conventions (per the spec)

- Tool names are `Custom_*` (reserved namespace; collisions fail-fast at load).
- Each tool declares `policy: { scope, opType }` — gated exactly like a built-in (reuses the 7 scopes + allow\* ceiling; **no custom scopes**).
- `package.json#arc1.requires` declares the scopes/packages the plugin needs — **intersected** with the server ceiling, never expands it.
- Pure TS — **no ABAP artifacts**. Custom endpoints (if any) must already exist on the SAP system.

## Status

**Working + live-verified** against a4h (S/4HANA 2023): code-tier `Custom_ProgramLineCount` and
manifest-tier `Custom_ReadProgram` both return real ABAP source through the gated `ctx.http`.
The third (non-ADT/non-OData) tool is still TBD.
