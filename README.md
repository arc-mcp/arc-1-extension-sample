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
| `Custom_QuerySalesOrders` | OData (`GWSAMPLE_BASIC`) | code tier (GET, `Accept: application/json`) |
| `Custom_ReadProgram` | ADT | **manifest tier** (declarative JSON) |
| `Custom_RunClass` | ADT classrun | code tier — **executes** an `IF_OO_ADT_CLASSRUN` console class |
| `Custom_CreateSalesOrder` | OData (`GWSAMPLE_BASIC`) | code tier — **writes** (`ctx.http.post`, gated; HTTP 201 verified) |
| `Custom_ListLanguages` | custom ICF ([LISA](https://github.com/ClementRingot/LISA) `ZI18N_SERVICE`) | code tier — list languages (POST; HTTP 200 verified) |
| `Custom_GetTranslation` | custom ICF (LISA `ZI18N_SERVICE`) | code tier — read a translation (POST; HTTP 200 verified) |
| `Custom_SetTranslation` | custom ICF (LISA `ZI18N_SERVICE`) | code tier — **write** a translation (POST; HTTP 200 verified) |
| `Custom_RfcSystemInfo` | **classic RFC** (`RFC_SYSTEM_INFO` via [open-rfc](https://github.com/marianfoo/open-rfc)) | code tier — read **off** `ctx.http`, so it brings its own controls ([below](#rfc-a-different-trust-boundary)) |

Reads go through the gated `ctx.http` (`GET`/`HEAD`) → `checkOperation` + scope + audit.
`Custom_RunClass` runs a console class via `ctx.run.classRun` (a named, gated op).
`Custom_CreateSalesOrder` and the LISA tools **write** via `ctx.http.post` to a non-ADT path
(OData / custom ICF). ADT **object** writes (CLAS/DDLS/…) stay a **v2** item (the package-aware
`ctx.write` vocabulary) — see `arc-1` `docs/research/extension-framework-v2-spec.md`.

### Integrating LISA (`Custom_ListLanguages` / `GetTranslation` / `SetTranslation`)

[LISA](https://github.com/ClementRingot/LISA) is a translation MCP server backed by a custom ABAP ICF
service (`ZCL_I18N_SERVICE` → `POST /sap/bc/http/sap/ZI18N_SERVICE/<action>`, JSON body). These three
tools run LISA's full read → write → read-back flow **directly as ARC-1 extension tools** — gated
`ctx.http.post` to that non-ADT path. Import LISA's handler class first, then:

```sh
# all LISA tools need the write opt-ins (see the note below):
ENV="SAP_ALLOW_PLUGIN_RAW_WRITES=true SAP_ALLOW_WRITES=true ARC1_PLUGINS=$PWD/dist/index.js"

env $ENV arc1-cli call Custom_ListLanguages --json '{}'
env $ENV arc1-cli call Custom_GetTranslation --json '{"objectName":"BUKRS","language":"EN"}'
env $ENV arc1-cli call Custom_SetTranslation --json '{"objectName":"ZARC1_I18N","language":"DE","transport":"A4HK9xxxxx","texts":[{"attribute":"short_field_label","value":"Hallo"}]}'
# → HTTP 200; the write records into the transport (live-verified on a4h / S/4HANA 2023).
```

> **Why even the read tools need `SAP_ALLOW_PLUGIN_RAW_WRITES` + `scope: 'write'`:** LISA exposes
> *every* action — including reads — as a `POST`. `ctx.http` gates by HTTP method, so any `POST`
> needs the write opt-in regardless of what it semantically does. That's a consequence of LISA's API
> design, not ARC-1's; the read tools declare `opType: Read` to keep the operation honest.
> `set_translation` requires a real (open) transport — LISA records the write into it.

### Running `Custom_CreateSalesOrder` (gated non-ADT write)

```sh
# needs BOTH opt-ins + a write-scoped tool (the tool declares scope:'write'):
SAP_ALLOW_PLUGIN_RAW_WRITES=true SAP_ALLOW_WRITES=true \
  ARC1_PLUGINS=$PWD/dist/index.js \
  arc1-cli call Custom_CreateSalesOrder --json '{"note":"hello"}'
# → HTTP 201 + the created SalesOrder (live-verified on a4h / S/4HANA 2023).
# With either opt-in off the call is refused; a write to a /sap/bc/adt/ path is always refused.
```

## RFC: a different trust boundary

`Custom_RfcSystemInfo` calls the read-only `RFC_SYSTEM_INFO` function module over **classic RFC**,
using [open-rfc](https://github.com/marianfoo/open-rfc) — an SDK-free RFC client with **no native
addon and no runtime dependencies**, which is what makes RFC-from-a-plugin possible at all (the
NW RFC SDK never was).

It is the one tool here that does **not** go through `ctx.http`. `ToolContext` has no RFC channel,
so the tool opens its **own socket** with its **own credentials**. Know exactly what that changes:

| | a `ctx.http` tool | this RFC tool |
|---|---|---|
| Safety ceiling (`SAP_ALLOW_WRITES`, `SAP_ALLOWED_PACKAGES`, `denyActions`) | enforced on the call | **not enforced on the call** |
| SAP identity | per-user via principal propagation | **one shared technical RFC user** |
| Transport | HTTPS | **cleartext — classic RFC has no encryption and no peer authentication** |
| Reachable surface | the one path the tool writes | **every remote-enabled FM that RFC user may call** |

ARC-1 still gates *whether* the tool may be invoked (`policy.scope`, `denyActions`, audit). It does
**not** gate what the tool does once running. So the controls are the plugin's own:

1. **The function module is a hardcoded constant, never a parameter.** This is the control that
   matters most. A `Custom_RfcCall({ fm, params })` tool would hand any caller — or any
   prompt-injected LLM — a generic RFC gateway into your backend. Don't build that one.
2. **No inputs at all** (`z.object({})`). Nothing from the caller reaches the wire.
3. **Default-off opt-in** — `SAMPLE_RFC_ENABLED=true`. ARC-1's ceiling does not reach RFC, so the
   plugin ships its own gate, in the same shape as the server's `SAP_ALLOW_PLUGIN_*` opt-ins.
4. **A dedicated credential namespace** — `SAMPLE_RFC_*`, deliberately *not* `SAP_USER`/
   `SAP_PASSWORD`. Those are ARC-1's own ADT credentials; borrowing them would dial RFC as ARC-1's
   HTTP identity instead of a least-privilege RFC user.
5. **A response field allowlist.** `RFC_SYSTEM_INFO` also returns the database host and the server's
   IPv4/IPv6 addresses. The tool discloses seven identifying fields and drops that topology.
6. **Error redaction.** open-rfc messages can carry the backend endpoint (a failed connect reads
   `failed to connect NI socket to <host>:<port>`). The caller gets a classification key; the full
   error goes to the operator's stderr log.
7. **Attribution logging.** SAP's log records only the shared technical user, so the tool logs the
   MCP `userName` + `requestId` before dialing — that link exists nowhere else.
8. **A bounded call** (15 s) and `close()` in `finally`.

### Least-privilege `S_RFC` for this tool

An RFC client needs authorization for the **metadata** function groups on top of the target FM —
open-rfc reads the function interface before it can serialize the call. Verified on S/4HANA 2023: a
user holding only `SRFC` logs on fine and then fails with `RFC_NO_AUTHORITY` on
`RFC_GET_FUNCTION_INTERFACE`. Minimum grant (`S_RFC`, `ACTVT = 16`, `RFC_TYPE = FUGR`):

| `RFC_NAME` | Why | Function modules |
|---|---|---|
| `SRFC` | the target FM | `RFC_SYSTEM_INFO`, `RFC_PING` |
| `RFC1` | classic metadata | `RFC_GET_FUNCTION_INTERFACE` |
| `SDIFRUNTIME` | DDIC field info for structure parameters | `DDIF_FIELDINFO_GET` |

Add `RFC_METADATA` only if you want open-rfc's optimized metadata path. Function-group membership
above was read live from `TFDIR`/`ENLFDIR` on S/4HANA 2023.

Two things that set is chosen to **exclude**:

- **`SDTX`** — the home of `RFC_READ_TABLE`, the classic mass-exfiltration RFM. Granting the three
  groups above does not grant it. Never put `RFC_READ_TABLE` behind an MCP tool.
- Everything else. `S_RFC` with `RFC_NAME = *` on a technical user is how RFC becomes dangerous.

> **Caveat worth knowing:** many systems exempt `SRFC` from RFC authority checks entirely
> (`auth/rfc_authority_check`). Where that is set, this tool succeeding proves the *connection*
> works — it does **not** prove your `S_RFC` design is correct. Validate that with a function group
> that is actually checked.

Beyond authorization, classic RFC is **cleartext**: keep it on a trusted network segment, or put SNC
in front of it. Treat the RFC user as a shared service identity and give it nothing it does not need.

### BTP / Cloud Connector: not yet, and the tool refuses

ARC-1 on Cloud Foundry reaches on-premise SAP through the **Cloud Connector**, via the Connectivity
service's SOCKS5 proxy. **open-rfc 0.2.2 cannot use that route.** Its SOCKS5 connectivity transport
is, in its own changelog, "an implementation preview outside the first beta support contract", and
no connection path imports it. Verified against the published package:

| Path | Behaviour when given `connectivity_proxy_*` parameters |
|---|---|
| modern `RFCClient` | fails closed — `Missing RFC connection provider capabilities: connectivity-rfc-proxy, connectivity-proxy-authorization` |
| classic `Client` (used here) | **silently ignores them and dials the backend directly** |

That second row is the hazard: on CF the tool would attempt a direct connection to an on-premise
host instead of the tunnel — a confusing failure that invites someone to "fix" it by opening a
firewall hole. So the tool **refuses when the BTP Connectivity service is bound** (`VCAP_SERVICES`),
rather than dialing.

Until open-rfc implements the route, run this tool from an ARC-1 instance with network access to
the SAP gateway (on-premise, or a container in the same segment). Nothing else needs to change:
ARC-1's MTA already binds the Connectivity service, so the path opens as soon as the connector
supports it.

### Running `Custom_RfcSystemInfo`

```sh
export SAMPLE_RFC_ENABLED=true
export SAMPLE_RFC_ASHOST=your-app-server   SAMPLE_RFC_SYSNR=00
export SAMPLE_RFC_CLIENT=001               SAMPLE_RFC_LANG=EN
export SAMPLE_RFC_USER=RFC_READONLY        SAMPLE_RFC_PASSWD=...   # least-privilege user, see above

ARC1_PLUGINS=$PWD/dist/index.js arc1-cli call Custom_RfcSystemInfo --json '{}'
# → RFCSYSID / RFCSAPRL / RFCKERNRL / RFCOPSYS / RFCDBSYS / RFCHOST / RFCTZONE
# With SAMPLE_RFC_ENABLED unset the call is refused. Live-verified on a4h (S/4HANA 2023).
```

`npm test` runs the redaction + allowlist checks (`node:test`, no SAP system required).

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
