import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// OData example (code tier): query the EPM demo service GWSAMPLE_BASIC (present on the
// a4h test system at the iwbep namespace) through ctx.http with a caller-supplied
// Accept: application/json. Reads need no CSRF; the path is not restricted to /sap/bc/adt/*.
export default defineTool({
  name: 'Custom_QuerySalesOrders',
  description: 'List sales orders from the GWSAMPLE_BASIC OData service, newest first.',
  schema: z.object({ top: z.number().int().min(1).max(50).default(5) }),
  policy: { scope: 'read', opType: OperationType.Read },
  availableOn: 'all',
  async handler(args, ctx) {
    const { top } = args as { top: number };
    const res = await ctx.http.get(
      `/sap/opu/odata/iwbep/GWSAMPLE_BASIC/SalesOrderSet?$top=${top}&$orderby=CreatedAt%20desc&$format=json`,
      { Accept: 'application/json' },
    );
    return { content: [{ type: 'text', text: res.body }] };
  },
});
