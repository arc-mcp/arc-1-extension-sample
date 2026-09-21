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
| `Custom_RunReport` | ADT programrun | code tier — **executes** a classic report and returns its list output |
| `Custom_CreateSalesOrder` | OData (`GWSAMPLE_BASIC`) | code tier — **writes** (`ctx.http.post`, gated; HTTP 201 verified) |
| `Custom_ListLanguages` | custom ICF ([LISA](https://github.com/ClementRingot/LISA) `ZI18N_SERVICE`) | code tier — list languages (POST; HTTP 200 verified) |
| `Custom_GetTranslation` | custom ICF (LISA `ZI18N_SERVICE`) | code tier — read a translation (POST; HTTP 200 verified) |
| `Custom_SetTranslation` | custom ICF (LISA `ZI18N_SERVICE`) | code tier — **write** a translation (POST; HTTP 200 verified) |
| `Custom_RfcSystemInfo` | **classic RFC** (`RFC_SYSTEM_INFO` via [open-rfc](https://github.com/marianfoo/open-rfc)) | code tier — read **off** `ctx.http`, so it brings its own controls ([below](#rfc-a-different-trust-boundary)) |

Reads go through the gated `ctx.http` (`GET`/`HEAD`) → `checkOperation` + scope + audit.
`Custom_RunClass` and `Custom_RunReport` use ARC-1's named, gated ADT operations
(`ctx.run.classRun` / `ctx.run.programRun`). No custom ICF service is needed for either.
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

### Running `Custom_RunReport` (classic report through ADT)

`ctx.run.programRun` executes an active classic executable report (`PROG`) through SAP's native ADT
program-run endpoint and returns its classic `WRITE` list as plain text. No custom ICF service or
`SAP_ALLOW_PLUGIN_RAW_WRITES` is needed.

```sh
SAP_ALLOW_PLUGIN_EXECUTE=true SAP_ALLOW_WRITES=true \
ARC1_PLUGINS=$PWD/dist/index.js \
  arc1-cli call Custom_RunReport \
  --json '{"reportName":"ZARC1_TEST_REPORT"}'
# → the report list as text
```

The endpoint is deliberately **name-in/text-out**: it does not accept selection-screen parameters or
a variant. Use a small `IF_OO_ADT_CLASSRUN` class when runtime input is required. Report execution is
a mutation vector even when a report appears read-only, so ARC-1 requires the same three gates as
`classRun`: `SAP_ALLOW_PLUGIN_EXECUTE=true`, `SAP_ALLOW_WRITES=true`, and the `write` scope. The
sample is `availableOn: 'onprem'`; SAP still applies the calling user's execute authorization. As
with `classRun`, SAP can return execution errors such as `Error: Program does not exist!` as text
with HTTP 200, so the ARC-1 tool call itself has a successful status. The sample returns that text
verbatim and does not infer success from the transport status.

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
| Transport | HTTPS | classic RFC has no peer authentication; on CF it is carried inside the managed Connectivity / Cloud Connector tunnel |
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
in front of clients that support it. This sample and open-rfc do **not** support SNC. Treat the RFC
user as a shared service identity and give it nothing it does not need.

### BTP / Cloud Connector SOCKS5 route

On Cloud Foundry the tool reads exactly one bound BTP Connectivity service, obtains a short-lived
OAuth token with its client credentials, and passes open-rfc the documented SOCKS5 host/port/token
tuple. `SAMPLE_RFC_GWHOST` and `SAMPLE_RFC_GWSERV` select a dedicated Cloud Connector **TCP**
virtual mapping to the SAP gateway (`33NN`); `SAMPLE_RFC_ASHOST` remains the actual application
server identity carried by CPIC. `SAMPLE_RFC_LOCATION_ID` is optional.

This route requires open-rfc 0.2.3 or newer. The package dependency is pinned to exactly `0.2.3`,
not a range, so deployments use the reviewed release artifact published to npm rather than an
unbuilt Git checkout or an automatically selected future version.

This is deliberately not the Connectivity service's separate RFC-proxy endpoint. The generic TCP
mapping is opaque, so Cloud Connector cannot enforce an RFC function-module resource allowlist on
it. Cloud Connector's Trusted Applications allowlist applies only to Neo, not Cloud Foundry. For CF,
restrict who can create or consume Connectivity service bindings in the connected subaccount,
isolate production and non-production subaccounts/spaces, expose one exact virtual host and gateway
port, and enforce the function boundary with the dedicated technical user's exact `S_RFC` role
described above. The tool still hardcodes one RFM and accepts no caller-controlled wire values.

Configure Cloud Connector and CF in this order:

1. Connect Cloud Connector to the BTP subaccount containing the ARC-1 CF application. Use a separate
   production subaccount/connector configuration. Record its Location ID if one is configured.
2. In Cloud Connector, add an **ABAP System** with protocol **TCP**. Do not select RFC or RFC SNC:
   this sample uses the Connectivity SOCKS5/TCP endpoint, not the separate RFC proxy.
3. Set the internal host to the S/4HANA application server reachable from Cloud Connector and the
   internal port to its RFC gateway `33NN` (`3300` for system number `00`). Choose one virtual host
   and one virtual port and do not expose a host or port range.
4. In CF, create and bind one BTP Connectivity service instance to ARC-1 and restage the app. This
   sample supports the default **client-secret** binding only. X.509/mTLS Connectivity bindings are
   rejected explicitly because their token-acquisition flow is not implemented here.
5. Set `SAMPLE_RFC_GWHOST` and `SAMPLE_RFC_GWSERV` to the Cloud Connector **virtual** values. Set
   `SAMPLE_RFC_ASHOST` to the actual SAP application-server identity carried inside CPIC. Set
   `SAMPLE_RFC_LOCATION_ID` only when it exactly matches the connector's Location ID.
6. Keep the SAP technical user limited to the exact `S_RFC` function groups above. Restrict CF
   org/space membership, service-key creation, binding operations, and deployment credentials:
   possession of the Connectivity binding credentials is the application-side tunnel authority.

The managed BTP-to-Cloud-Connector tunnel is TLS-protected. The internal
Cloud-Connector-to-SAP-gateway hop still carries classic RFC without SNC or end-to-end peer
authentication, so keep it on a trusted segmented network. Choosing TCP TLS is valid only when the
mapped backend endpoint actually speaks the matching TLS protocol; it does not add SNC to an
ordinary SAP gateway.

SAP references: [TCP/SOCKS5 for cloud applications](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/using-tcp-protocol-for-cloud-applications),
[create and bind Connectivity](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/create-and-bind-connectivity-service-instance),
[Cloud Connector access control](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configure-access-control), and
[subaccount separation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/managing-subaccounts?locale=en).

Binding selection and token handling fail closed: malformed or multiple Connectivity bindings,
missing SOCKS5 credentials, an insecure token URL, an OAuth rejection, a partial route, or a token
with a `Bearer ` prefix stops before the SAP socket opens. The token is cached only until shortly
before expiry and is never included in tool output or inspected configuration. The sample reads
`onpremise_proxy_host` and `onpremise_socks5_proxy_port`; it never uses
`onpremise_proxy_rfc_port`.

### Running `Custom_RfcSystemInfo`

```sh
export SAMPLE_RFC_ENABLED=true
export SAMPLE_RFC_ASHOST=your-app-server   SAMPLE_RFC_SYSNR=00
export SAMPLE_RFC_CLIENT=001               SAMPLE_RFC_LANG=EN
export SAMPLE_RFC_USER=RFC_READONLY        SAMPLE_RFC_PASSWD=...   # least-privilege user, see above

# additionally on BTP CF, using the Cloud Connector TCP virtual mapping (not its internal target):
export SAMPLE_RFC_GWHOST=virtual-rfc-host  SAMPLE_RFC_GWSERV=3300
# export SAMPLE_RFC_LOCATION_ID=optional-location

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

`Custom_RunReport` is also **live-verified**: it executed `ZARC1_TEST_REPORT` through
`ctx.run.programRun`, returned the report list, preserved SAP's text response for a missing program,
and refused calls when either server gate was disabled or the name was invalid.
