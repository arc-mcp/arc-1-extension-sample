# Read SAPscript, SO10 and SmartForms

An optional example for [ARC-1 #1000](https://github.com/arc-mcp/arc-1/issues/1000).
`Custom_ReadForm` makes one authenticated GET to a small ABAP companion on the same system.
It uses SAP's native readers; no RFC gateway or JavaScript cluster decoder is involved.

| `kind` | Result in `content` | Display authorization |
| --- | --- | --- |
| `sapscript` | Header, ITF lines, pages, windows, paragraph/character formats and tabs | `S_SCRP_FRM`: `FORMNAME`, `LANGUAGE`, `ACTVT=03` |
| `so10` | Text header and ITF lines; object is always `TEXT` | `S_SCRP_TXT`: `TEXTNAME`, `TEXTID`, `LANGUAGE`, `ACTVT=03` |
| `smartform` | Active source XML, including layout and embedded language-independent texts | `S_DEVELOP`: `OBJTYPE=SSFO`, actual package/name, `ACTVT=03`; SAP's Workbench check also applies |

This is source inspection, not print rendering. Symbols and ITF `INCLUDE` commands remain source.
SO10 header references are refused. SAPscript reads only the current client and exact language;
it does not silently use client 000 or another language. SmartForms are cross-client repository
objects; their XML can contain embedded translations as well as the requested display language.
When a SmartForm translation is missing, a node's `TEXT` may be absent while other translations
remain in `T_TEXT`. `NOLANGUAGE` nodes keep their language-independent text.
Separate text modules, referenced standard texts, graphics and styles are not fetched recursively.

## Install the companion

Use a classic on-premise/private-cloud ABAP system with `/UI2/CL_JSON` and Smart Forms.
The APIs are not released ABAP Cloud APIs; this does not apply to BTP ABAP Environment.

1. Import this repository with abapGit into a dedicated customer package. The root `.abapgit.xml`
   selects only `abap/forms/src/`. Check for an existing `ZCL_ARC1_FORMS_SAMPLE` before importing;
   do not overwrite unrelated code. Activate the class and run its ABAP Unit tests.
2. In SICF, create a leaf `zarc1_forms` under `default_host/sap/bc`, with handler
   `ZCL_ARC1_FORMS_SAMPLE`. Use normal authenticated logon; do not configure an anonymous/service
   user. Activate only this leaf. Existing `/sap/bc/smart_forms` services need not be enabled.
3. Give intended users the narrow display permissions in the table. Check both an allowed and a
   denied user before wider deployment. The endpoint is also callable directly: review existing
   holders of these permissions before activation; the service does not check transaction-start
   permissions for SO10, SE71 or SMARTFORMS. Do not grant `SAP_ALL` for this sample.
4. Build the extension with `npm install && npm run build`, using the same compatible ARC-1
   version as the server. Set `ARC1_PLUGINS` to the absolute path of `dist/forms.js` and restart.
5. The MCP caller needs `data` scope. Runtime writes and plugin execution can remain disabled.
   Raw ICF GET does not use the data-preview/SQL flags; access depends on the explicit plugin load,
   MCP scope and the companion's SAP authorization checks.

```sh
ARC1_PLUGINS=/absolute/path/to/arc-1-extension-sample/dist/forms.js \
  arc1-cli call Custom_ReadForm \
  --json '{"kind":"smartform","name":"SF_EXAMPLE_01","language":"E"}'

# SO10 defaults to textId ST. Language is SAP's case-sensitive one-character key, not EN/DE.
ARC1_PLUGINS=/absolute/path/to/arc-1-extension-sample/dist/forms.js \
  arc1-cli call Custom_ReadForm \
  --json '{"kind":"so10","name":"MY_STANDARD_TEXT","language":"E","textId":"ST"}'
```

Names are uppercase: up to 16 characters for SAPscript, 30 for SmartForms and 70 for SO10.
This intentionally narrow example accepts letters, digits, underscores, slashes and hyphens.
It rejects unsupported names rather than changing them. There is no client, URL or function-name input.

## BTP Cloud Foundry

Package `dist/forms.js` and its dependencies with ARC-1 as described in the
[extension deployment guide](https://github.com/arc-mcp/arc-1/blob/main/docs_page/extensions.md#deploying-extensions-btp-cloud-foundry-docker).
The existing destination/Cloud Connector transport carries `ctx.http.get` and its selected SAP
identity. Add `/sap/bc/zarc1_forms` as an exact path resource to the existing Cloud Connector
system mapping, retaining its ADT resources and principal propagation;
do not add shared credentials to the extension. This is CF hosting against a classic backend,
not installation in BTP ABAP Environment. Verify the route with allowed and denied users.

## Limits and errors

Both sides reject responses above 1 MiB in UTF-8 without returning partial source. SAP's readers
materialize the object before this check; it is an output limit, not a backend memory budget.
The extension also checks size after receiving the response, not while streaming it.
The service sends `Cache-Control: no-store` and accepts GET only.
MCP clients can impose smaller output limits. ARC-1's normal audit logging can retain a response
preview, including text-header metadata; apply the usual audit access and retention policy.

| Status | Meaning |
| --- | --- |
| 400 | Invalid kind, name, language or text ID |
| 403 | Missing SAP display permission (or upstream logon/service access refusal) |
| 404 | Missing object in the selected client/language, or no active SmartForm; check whether the body came from the companion or SICF |
| 405 | HTTP method other than GET |
| 409 | SO10 header reference: references are refused, not followed |
| 413 | Result exceeds 1 MiB |
| 422 | SAP could not read/export the object |

`npm test` checks the TypeScript boundary. The class's nine ABAP Unit tests check validation,
method rejection, simulated authorization denial and UTF-8 limits without requiring business fixtures.
Live coverage and remaining deployment checks are recorded in [forms-validation.md](forms-validation.md).

For an explicit live read test, configure the usual `SAP_URL`, `SAP_USER`, `SAP_PASSWORD` and
`SAP_CLIENT` variables, then run:

```sh
SAMPLE_SAPSCRIPT_FORM=YOUR_FORM SAMPLE_SO10_TEXT=YOUR_TEXT npm run test:forms:live
```

The fixtures must exist in the connected client. Optional variables are
`SAMPLE_LANGUAGE` (default `E`), `SAMPLE_TEXT_ID` (`ST`), `SAMPLE_SMARTFORM` (`SF_EXAMPLE_01`), and
`SAMPLE_EXPECT_NOLANGUAGE=true` to require a language-independent SmartForm node. This test reads
only and forces the ARC-1 runtime write gates off; it does not create fixtures or configure SICF.

To disable the sample, remove its plugin path and restart ARC-1, then deactivate the dedicated SICF
leaf. Remove the leaf before deleting its handler class. Do not deactivate shared parent services.
