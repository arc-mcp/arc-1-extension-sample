import type { Plugin } from 'arc-1/public';
import programLineCount from './tools/Custom_ProgramLineCount.js';
import querySalesOrders from './tools/Custom_QuerySalesOrders.js';
import runClass from './tools/Custom_RunClass.js';

// Sample ARC-1 extension. Loaded via:
//   ARC1_PLUGINS=/abs/path/to/arc1-plugin-example/dist/index.js
const plugin: Plugin = {
  name: 'arc1-plugin-example',
  version: '0.0.1',
  apiVersion: 1,
  // Two read tools (ADT + OData) + one privileged execute tool (gated; runs a console class).
  tools: [programLineCount, querySalesOrders, runClass],
  manifests: ['manifests/Custom_ReadProgram.tool.json'],
};

export default plugin;
