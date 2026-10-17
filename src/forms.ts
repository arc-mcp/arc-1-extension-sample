import type { Plugin } from 'arc-1/public';
import readForm from './tools/Custom_ReadForm.js';

// Load separately: ARC1_PLUGINS=/absolute/path/to/dist/forms.js
export default {
  name: 'arc1-forms-sample',
  version: '0.0.1',
  apiVersion: 1,
  tools: [readForm],
} satisfies Plugin;
