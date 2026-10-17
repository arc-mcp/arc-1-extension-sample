import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationType } from 'arc-1/public';
import { createMockToolContext } from 'arc-1/public/testing';
import tool from '../dist/tools/Custom_ReadForm.js';
import forms from '../dist/forms.js';
import defaults from '../dist/index.js';

const input = { kind: 'so10', name: '/EXAMPLE/NOTICE', language: 'E' };
const body = JSON.stringify({ version: 1, ...input, content: { header: { tdid: 'ST' }, lines: [] } });

test('forms load separately with data/Query policy and are advertised on classic backends', () => {
  assert.deepEqual(forms.tools, [tool]);
  assert.ok(!defaults.tools.includes(tool));
  assert.equal(tool.policy.scope, 'data');
  assert.equal(tool.policy.opType, OperationType.Query);
  assert.equal(tool.availableOn, 'onprem');
});

test('case-sensitive SAP language keys are sent unchanged', async () => {
  for (const language of ['c', 'D', 'd']) {
    const args = { ...input, language };
    const ctx = createMockToolContext({ responseBody: JSON.stringify({ version: 1, ...args, content: {} }) });
    await tool.handler(args, ctx);
    assert.ok(ctx.httpCalls[0].path.includes(`language=${language}&`));
  }
});

test('GET encodes the exact key and preserves SAP source', async () => {
  const ctx = createMockToolContext({ responseBody: body });
  const result = await tool.handler(input, ctx);
  assert.equal(result.content[0].text, body);
  assert.deepEqual(ctx.httpCalls, [
    { method: 'GET', path: '/sap/bc/zarc1_forms?kind=so10&name=%2FEXAMPLE%2FNOTICE&language=E&textId=ST' },
  ]);
  assert.deepEqual(ctx.classRunCalls, []);
});

test('SmartForm and SAPscript requests carry no SO10 text ID', async () => {
  for (const kind of ['smartform', 'sapscript']) {
    const args = { kind, name: 'FORM', language: 'D' };
    const ctx = createMockToolContext({
      responseBody: JSON.stringify({ version: 1, ...args, content: { xml: '<form/>' } }),
    });
    await tool.handler(args, ctx);
    assert.ok(!ctx.httpCalls[0].path.includes('textId'));
  }
});

test('invalid or ambiguous keys never reach SAP', async () => {
  for (const patch of [
    { name: '../SECRET' },
    { name: 'A&kind=smartform' },
    { name: 'A\nB' },
    { name: 'x' },
    { name: 'A'.repeat(71) },
    { language: 'EN' },
    { language: '' },
    { textId: 'ABCDE' },
    { kind: 'sapscript', name: 'A'.repeat(17) },
    { kind: 'smartform', name: 'A'.repeat(31) },
    { kind: 'smartform', textId: 'ST' },
    { object: 'VBBK' },
    { client: '000' },
  ]) {
    const ctx = createMockToolContext();
    await assert.rejects(tool.handler({ ...input, ...patch }, ctx));
    assert.equal(ctx.httpCalls.length, 0);
  }
});

test('wrong service output is rejected, including HTML login pages', async () => {
  for (const responseBody of [
    '<html>Sign in</html>',
    'null',
    '{}',
    JSON.stringify({ version: 2, ...input, content: {} }),
    JSON.stringify({ version: 1, ...input, name: 'OTHER', content: {} }),
  ]) {
    await assert.rejects(
      tool.handler(input, createMockToolContext({ responseBody })),
      /Unexpected forms companion response/,
    );
  }
});

test('limit measures UTF-8 bytes, not characters, and never returns truncated source', async () => {
  await assert.rejects(
    tool.handler(input, createMockToolContext({ responseBody: 'ü'.repeat(524289) })),
    /exceeds 1 MiB/,
  );
});

test('SAP refusals and transport failures retain the original error', async () => {
  const ctx = createMockToolContext();
  const failure = new Error('403: display denied');
  ctx.http.get = async () => {
    throw failure;
  };
  await assert.rejects(tool.handler(input, ctx), (error) => error === failure);
});
