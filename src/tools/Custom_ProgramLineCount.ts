import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// The simplest code-tier tool — the anatomy of a `Custom_*` extension.
//
// It GETs an ABAP program's source over ADT and applies logic the declarative manifest tier can't
// express (counting lines). Every field below is part of the contract `defineTool` validates:
export default defineTool({
  // `name` MUST start with `Custom_` (the reserved plugin namespace); a collision fails server start.
  name: 'Custom_ProgramLineCount',
  // `description` is what the LLM sees in tools/list — write it for an agent, not a human.
  description: 'Report the number of source lines in an ABAP program.',
  // `schema` (Zod) validates + types the args; it's converted to JSON Schema for tools/list.
  schema: z.object({ name: z.string().min(1).max(40) }),
  // `policy` is the gate: `scope` is the MCP role a user needs; `opType` the operation class. A plain
  // read is scope:'read' + Read. The declared scope must cover the opType (here: read covers Read).
  policy: { scope: 'read', opType: OperationType.Read },
  // Optional: hide the tool on the wrong system type ('onprem' | 'btp'); default 'all'.
  availableOn: 'all',
  // `handler(args, ctx)` runs per call. `ctx.http` is the gated SAP client (auth/CSRF/PP handled);
  // `ctx.http.get` reads any SAP path. Always percent-encode caller input spliced into a URL.
  async handler(args, ctx) {
    const { name } = args as { name: string };
    const res = await ctx.http.get(`/sap/bc/adt/programs/programs/${encodeURIComponent(name)}/source/main`, {
      Accept: 'text/plain',
    });
    const lines = res.body.split('\n').length;
    // Return MCP content blocks — text the agent reads back.
    return { content: [{ type: 'text', text: `Program ${name}: ${lines} source lines.` }] };
  },
});
