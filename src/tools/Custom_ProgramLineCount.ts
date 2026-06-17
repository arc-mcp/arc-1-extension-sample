import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// ADT example (code tier): GET a program's source, then apply logic the declarative
// manifest tier cannot express (counting lines). Gated as Read via ctx.http.
export default defineTool({
  name: 'Custom_ProgramLineCount',
  description: 'Report the number of source lines in an ABAP program.',
  schema: z.object({ name: z.string().min(1).max(40) }),
  policy: { scope: 'read', opType: OperationType.Read },
  availableOn: 'all',
  async handler(args, ctx) {
    const { name } = args as { name: string };
    const res = await ctx.http.get(
      `/sap/bc/adt/programs/programs/${encodeURIComponent(name)}/source/main`,
      { Accept: 'text/plain' },
    );
    const lines = res.body.split('\n').length;
    return { content: [{ type: 'text', text: `Program ${name}: ${lines} source lines.` }] };
  },
});
