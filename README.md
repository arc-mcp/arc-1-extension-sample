# arc-1-extension-sample

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
| `Custom_RunClass` | ADT classrun | code tier — **executes** an `IF_OO_ADT_CLASSRUN` console class |
| `Custom_CreateSalesOrder` | OData (`ZGWSAMPLE_BASIC`) | code tier — **writes** (`ctx.http.post`, gated) |

Reads go through the gated `ctx.http` (`GET`/`HEAD`) → `checkOperation` + scope + audit.
`Custom_RunClass` runs a console class via `ctx.run.classRun` (a named, gated op).
`Custom_CreateSalesOrder` **writes** via `ctx.http.post` to a non-ADT (OData) path — the same gated
pattern a **LISA-style custom-ICF write tool** uses (POST to `/sap/bc/http/sap/your_service`). ADT
**object** writes (CLAS/DDLS/…) stay a **v2** item (the package-aware `ctx.write` vocabulary) — see
`arc-1` `docs/research/extension-framework-v2-spec.md`.

### Running `Custom_CreateSalesOrder` (gated non-ADT write)

```sh
# needs BOTH opt-ins + a write-scoped tool (the tool declares scope:'write'):
SAP_ALLOW_PLUGIN_RAW_WRITES=true SAP_ALLOW_WRITES=true \
  ARC1_PLUGINS=$PWD/dist/index.js \
  arc1-cli call Custom_CreateSalesOrder --json '{"note":"hello"}'
# → HTTP <status> + the service response. With either opt-in off, the call is refused.
# (ZGWSAMPLE_BASIC must be activated in /IWFND for a 2xx; the gating + CSRF + POST path works regardless.)
```

### Running `Custom_RunClass`

Executing ABAP is gated — **all** of these are required (else the call is refused):

```sh
# the class must implement IF_OO_ADT_CLASSRUN; e.g. create ZCL_ARC1_RUN_DEMO with a main( ) that
# calls out->write( ... ), then:
SAP_ALLOW_PLUGIN_EXECUTE=true SAP_ALLOW_WRITES=true \
  ARC1_PLUGINS=$PWD/dist/index.js \
  arc1-cli call Custom_RunClass --json '{"className":"ZCL_ARC1_RUN_DEMO"}'
# → the class's console output (out->write) as text
```

The tool declares `policy.scope: 'write'`, so the caller also needs the `write` scope. **Live-verified
against a4h (S/4HANA 2023)** — returns the real console output; with the opt-in off it is refused.

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
- `package.json#arc1.requires` declares the scopes/packages the plugin needs. This is a **v2**
  declaration (intersected with the server ceiling, never expands it) — **not yet enforced in v1**,
  where the runtime scope + safety ceiling already gate every call. Kept here as a forward example.
- Pure TS — **no ABAP artifacts**. Custom endpoints (if any) must already exist on the SAP system.

## Status

**Working + live-verified** against a4h (S/4HANA 2023): code-tier `Custom_ProgramLineCount` and
manifest-tier `Custom_ReadProgram` return real ABAP source through the gated `ctx.http`, and
`Custom_RunClass` executes a console class (`ctx.run.classRun`) and returns its real output — with the
three safety gates (opt-in off / `allowWrites` off / bad class name) all refusing as expected.
