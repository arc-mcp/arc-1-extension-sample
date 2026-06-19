import type { Plugin } from 'arc-1/public';
import createSalesOrder from './tools/Custom_CreateSalesOrder.js';
import getTranslation from './tools/Custom_GetTranslation.js';
import listLanguages from './tools/Custom_ListLanguages.js';
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
  // Reads (ADT + OData), execute (gated console class), a gated OData write, and a complete LISA
  // integration (list languages → get translation → set translation, all via the custom ICF service).
  tools: [programLineCount, querySalesOrders, runClass, createSalesOrder, listLanguages, getTranslation, setTranslation],
  manifests: ['manifests/Custom_ReadProgram.tool.json'],
};

export default plugin;
