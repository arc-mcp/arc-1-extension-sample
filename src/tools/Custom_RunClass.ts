import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// Execute-an-ABAP-class example (the one privileged op in the sample).
//
// Runs an ABAP **console class** — one implementing IF_OO_ADT_CLASSRUN — and returns its
// console output (out->write( … )). This is the modern ABAP "run some code and see the result"
// (the replacement for executable reports on ABAP Cloud).
//
// Unlike the read tools, executing a class can mutate anything, so it goes through ctx.run.classRun
// (POST /sap/bc/adt/oo/classrun/{class}), which is gated server-side. To use it, the admin must set
// BOTH `SAP_ALLOW_PLUGIN_EXECUTE=true` and `SAP_ALLOW_WRITES=true`, and the caller needs the `write`
// scope — hence policy.scope: 'write' below. With the opt-in off (the default), the call is refused.
export default defineTool({
  name: 'Custom_RunClass',
  description:
    'Execute an ABAP console class (one implementing IF_OO_ADT_CLASSRUN) and return its console output. ' +
    'Requires SAP_ALLOW_PLUGIN_EXECUTE=true + SAP_ALLOW_WRITES=true and the write scope.',
  schema: z.object({
    className: z
      .string()
      .min(1)
      .max(40)
      .describe('Name of the ABAP class implementing IF_OO_ADT_CLASSRUN, e.g. ZCL_ARC1_RUN_DEMO.'),
  }),
  policy: { scope: 'write', opType: OperationType.Workflow },
  availableOn: 'all',
  async handler(args, ctx) {
    const { className } = args as { className: string };
    const output = await ctx.run.classRun(className);
    return { content: [{ type: 'text', text: output.trim() ? output : '(class ran, no console output)' }] };
  },
});
