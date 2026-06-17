import type { Plugin } from 'arc-1/public';
import programLineCount from './tools/Custom_ProgramLineCount.js';
import querySalesOrders from './tools/Custom_QuerySalesOrders.js';

// Sample ARC-1 extension. Loaded via:
//   ARC1_PLUGINS=/abs/path/to/arc1-plugin-example/dist/index.js
const plugin: Plugin = {
  name: 'arc1-plugin-example',
  version: '0.0.1',
  apiVersion: 1,
  tools: [programLineCount, querySalesOrders],
  manifests: ['manifests/Custom_ReadProgram.tool.json'],
  // TODO: a third tool calling a non-ADT/non-OData SAP API (endpoint TBD — Q-O).
};

export default plugin;
