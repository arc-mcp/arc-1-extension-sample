import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// OData WRITE example (code tier). Creates a sales order in the EPM demo service GWSAMPLE_BASIC via
// a gated POST — the natural write pair to Custom_QuerySalesOrders. Live-verified (HTTP 201) on a4h.
//
// This is the SAME mechanism a LISA-style translation-write tool uses: a POST to a **non-ADT**
// (OData/ICF) path through `ctx.http.post`. CSRF is fetched + attached automatically. To adapt this
// for LISA, swap the path to the custom ICF service (e.g. `/sap/bc/http/sap/zi18n_service`) and the
// body to the translation payload — the gating is identical.
//
// Gated: refused unless the admin sets BOTH `SAP_ALLOW_PLUGIN_RAW_WRITES=true` and
// `SAP_ALLOW_WRITES=true`, and the tool declares `scope: 'write'` (below). Writes to `/sap/bc/adt/…`
// object paths are always refused (no package-allowlist enforcement on a raw write).
export default defineTool({
  name: 'Custom_CreateSalesOrder',
  description: 'Create a sales order in the GWSAMPLE_BASIC OData service (demonstrates a gated non-ADT write).',
  schema: z.object({
    note: z.string().min(1).max(40).default('ARC-1 extension demo'),
    customerId: z.string().min(1).max(10).default('0100000002'),
    currency: z.string().length(3).default('EUR'),
  }),
  policy: { scope: 'write', opType: OperationType.Create },
  availableOn: 'all',
  async handler(args, ctx) {
    const { note, customerId, currency } = args as { note: string; customerId: string; currency: string };
    // OData V2 create: no `$format` query option on a POST (it's a SystemQueryOption SAP rejects) —
    // negotiate JSON via the Accept header instead.
    const body = JSON.stringify({ Note: note, CustomerID: customerId, CurrencyCode: currency });
    const res = await ctx.http.post('/sap/opu/odata/iwbep/GWSAMPLE_BASIC/SalesOrderSet', body, 'application/json', {
      Accept: 'application/json',
    });
    return { content: [{ type: 'text', text: `HTTP ${res.statusCode}\n${res.body}` }] };
  },
});
