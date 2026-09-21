import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockToolContext } from 'arc-1/public/testing';
import runReport from '../dist/tools/Custom_RunReport.js';

test('runs the named report through ctx.run and returns its list output', async () => {
  const ctx = createMockToolContext({ programRunOutput: 'Report output' });
  const result = await runReport.handler({ reportName: 'ZARC1_TEST_REPORT' }, ctx);

  assert.deepEqual(ctx.programRunCalls, ['ZARC1_TEST_REPORT']);
  assert.deepEqual(ctx.httpCalls, []);
  assert.equal(result.content[0].text, 'Report output');
});

test('makes an empty SAP list result explicit', async () => {
  const ctx = createMockToolContext({ programRunOutput: '' });
  const result = await runReport.handler({ reportName: 'ZEMPTY_REPORT' }, ctx);

  assert.equal(result.content[0].text, '(report ran, no list output)');
});
