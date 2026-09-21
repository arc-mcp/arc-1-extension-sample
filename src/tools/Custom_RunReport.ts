import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// Execute a classic report through ARC-1's named ADT program-run operation. The SAP endpoint is
// intentionally name-in/text-out: it captures classic WRITE list output, but accepts no selection
// parameters or variant. Use an IF_OO_ADT_CLASSRUN class when runtime input is required.
//
// Report execution can mutate anything, so ctx.run.programRun is gated exactly like classRun:
// SAP_ALLOW_PLUGIN_EXECUTE=true + SAP_ALLOW_WRITES=true + a write-scoped caller/tool.
export default defineTool({
  name: 'Custom_RunReport',
  description:
    'Execute an active classic ABAP report and return its list output. No selection parameters or variants. ' +
    'Requires SAP_ALLOW_PLUGIN_EXECUTE=true + SAP_ALLOW_WRITES=true and the write scope.',
  schema: z.object({
    reportName: z
      .string()
      .min(1)
      .max(40)
      .regex(/^(?:\/[A-Za-z0-9_]+\/)?[A-Za-z0-9_$]+$/u)
      .describe('Name of an active executable ABAP report, e.g. ZARC1_TEST_REPORT.'),
  }),
  policy: { scope: 'write', opType: OperationType.Workflow },
  availableOn: 'onprem',
  async handler(args, ctx) {
    const { reportName } = args as { reportName: string };
    const output = await ctx.run.programRun(reportName);
    return { content: [{ type: 'text', text: output.trim() ? output : '(report ran, no list output)' }] };
  },
});
