# Forms sample validation

Verified on 17 October 2026 with ARC-1 1.6.0 and Node.js 24.11.1. This is sample validation,
not certification of a customer's roles, forms or deployment route.

| Check | 7.50 (750) | S/4HANA 2023 (758) | S/4HANA 2025 (816) |
| --- | --- | --- | --- |
| Companion syntax and activation | Pass | Pass | Pass |
| Nine ABAP Unit tests | Pass | Pass | Pass |
| SAPscript, SO10 and SmartForm through the loaded CLI extension | Pending SICF setup | Pass | Pass |
| Missing objects, invalid keys/language, reference refusal, no SAPscript language fallback | Pending SICF setup | Pass | Pass |

The 22-test TypeScript suite passes, including eight forms tests. Typechecking and abaplint's
7.50 parser checks also pass.
The ABAP denial tests force the authorization result to false; they do not verify PFCG roles.

Live checks used temporary customer fixtures and standard SmartForm `SF_EXAMPLE_01`:

- SAPscript returned its header, one page and two windows, with ITF and format tables.
- SO10 preserved UTF-8, symbols and an unexpanded `INCLUDE` command exactly. A header reference
  returned 409; nonexistent objects returned 404.
- SmartForm XML included pages/windows and `NOLANGUAGE=X` nodes with their actual symbols,
  including `TEXT_CARRID` / `WA_BOOKING-CARRID`. XML namespace declarations were present.
- English, German and lowercase Catalan (`c`) requests returned valid XML on 2023/2025. German
  umlauts survived UTF-8 conversion. An untranslated node omitted its display `TEXT` for Catalan,
  retaining the English/German `T_TEXT` entries; it did not fall back to German display text.
  Unknown language `?` returned 400. The new lowercase-key ABAP test also passed on 7.50.
- CLI reads passed on 2023/2025 with all runtime write and plugin execution gates disabled.
- A local MCP HTTP server against 2023 hid and refused the tool for `viewer`; `viewer-data`
  could list and call it, even with the server's SQL/data-preview gates off. Anonymous access to
  the companion returned 401. This checks MCP scopes and authenticated ICF, not SAP role denial.

Temporary fixture forms/texts and setup reports were removed from 2023/2025 after testing;
the companion class and dedicated service remain installed there.

## Remaining deployment checks

- Complete the 7.50 SICF setup and repeat live reads. This test system has no ADT report-run
  endpoint and its WebGUI returns 403, so service creation needs an administrator.
- Verify a real allowed and denied SAP user for each kind; then repeat through the intended
  Cloud Foundry / Cloud Connector / principal-propagation route. Only direct Basic access was tested.
- Test the reporter's `LE_SHP_DELNOTE` quantity node on their 7.50 system; that form is absent
  on the available 2023/2025 systems. The equivalent missing-text mechanism was verified above.
- Verify abapGit import in the target package. Test installation used ADT source upload;
  the serialized repository has not yet been round-tripped through abapGit.

BTP ABAP Environment is not a target: these native forms APIs require a classic backend.
