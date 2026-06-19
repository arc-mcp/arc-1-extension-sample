import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// LISA list_languages — lists the installed SAP languages. Live-verified HTTP 200.
//
// NOTE: this is a READ, but LISA exposes EVERY action as a POST, so as an extension tool it must
// declare `scope: 'write'` and needs `SAP_ALLOW_PLUGIN_RAW_WRITES` — a consequence of LISA's
// POST-for-everything API, not of ARC-1 (ctx.http gates by HTTP method). `opType: Read` keeps the
// declared operation honest (it reads); the write scope is only the POST requirement.
export default defineTool({
  name: 'Custom_ListLanguages',
  description: 'List the installed SAP languages via the LISA ZI18N_SERVICE.',
  schema: z.object({}),
  policy: { scope: 'write', opType: OperationType.Read },
  availableOn: 'all',
  async handler(_args, ctx) {
    const res = await ctx.http.post('/sap/bc/http/sap/ZI18N_SERVICE/list_languages', '', 'application/json', {
      Accept: 'application/json',
    });
    return { content: [{ type: 'text', text: res.body }] };
  },
});
