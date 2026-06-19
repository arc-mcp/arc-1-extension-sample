import type { Plugin } from 'arc-1/public';
import createSalesOrder from './tools/Custom_CreateSalesOrder.js';
import programLineCount from './tools/Custom_ProgramLineCount.js';
import querySalesOrders from './tools/Custom_QuerySalesOrders.js';
import runClass from './tools/Custom_RunClass.js';
import setTranslation from './tools/Custom_SetTranslation.js';

// Sample ARC-1 extension. Loaded via:
//   ARC1_PLUGINS=/abs/path/to/arc1-plugin-example/dist/index.js
const plugin: Plugin = {
  name: 'arc1-plugin-example',
  version: '0.0.1',
  apiVersion: 1,
  // Reads (ADT + OData), execute (gated console class), and writes (gated non-ADT POST):
  // an OData create + a LISA-style custom-ICF translation write.
  tools: [programLineCount, querySalesOrders, runClass, createSalesOrder, setTranslation],
  manifests: ['manifests/Custom_ReadProgram.tool.json'],
};

export default plugin;
