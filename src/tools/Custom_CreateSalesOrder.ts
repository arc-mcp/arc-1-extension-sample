import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// OData WRITE example (code tier). Creates a sales order in the EPM demo service ZGWSAMPLE_BASIC via
// a gated POST — the natural write pair to Custom_QuerySalesOrders.
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
  description: 'Create a sales order in the ZGWSAMPLE_BASIC OData service (demonstrates a gated non-ADT write).',
  schema: z.object({
    note: z.string().min(1).max(40).default('ARC-1 extension demo'),
    currency: z.string().length(3).default('EUR'),
  }),
  policy: { scope: 'write', opType: OperationType.Create },
  availableOn: 'all',
  async handler(args, ctx) {
    const { note, currency } = args as { note: string; currency: string };
    // Minimal SalesOrder entity — extend with the fields your service requires.
    const body = JSON.stringify({ Note: note, CurrencyCode: currency });
    const res = await ctx.http.post('/sap/opu/odata/sap/ZGWSAMPLE_BASIC/SalesOrderSet?$format=json', body, 'application/json', {
      Accept: 'application/json',
    });
    return { content: [{ type: 'text', text: `HTTP ${res.statusCode}\n${res.body}` }] };
  },
});
