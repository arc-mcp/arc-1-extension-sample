import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockToolContext } from 'arc-1/public/testing';
import runReport, {
  parseReportAllowlist,
  REPORT_ALLOWLIST_ENV,
  REPORT_ENABLE_FLAG,
  REPORT_RUNNER_PATH,
} from '../dist/tools/Custom_RunReport.js';

async function withReportEnv(values, action) {
  const previous = {
    enabled: process.env[REPORT_ENABLE_FLAG],
    allowlist: process.env[REPORT_ALLOWLIST_ENV],
  };
  try {
    if (values.enabled === undefined) delete process.env[REPORT_ENABLE_FLAG];
    else process.env[REPORT_ENABLE_FLAG] = values.enabled;
    if (values.allowlist === undefined) delete process.env[REPORT_ALLOWLIST_ENV];
    else process.env[REPORT_ALLOWLIST_ENV] = values.allowlist;
    return await action();
  } finally {
    if (previous.enabled === undefined) delete process.env[REPORT_ENABLE_FLAG];
    else process.env[REPORT_ENABLE_FLAG] = previous.enabled;
    if (previous.allowlist === undefined) delete process.env[REPORT_ALLOWLIST_ENV];
    else process.env[REPORT_ALLOWLIST_ENV] = previous.allowlist;
  }
}

test('the report allowlist is exact and fails closed', () => {
  assert.deepEqual([...parseReportAllowlist('ZDEMO,/ACME/DAILY')], ['ZDEMO', '/ACME/DAILY']);
  assert.throws(() => parseReportAllowlist(undefined), /is empty/);
  assert.throws(() => parseReportAllowlist('ZDEMO,*'), /not a valid ABAP name/);
  assert.throws(() => parseReportAllowlist('ZDEMO,'), /empty entry/);
});

test('report execution is default-off before any SAP call', async () => {
  await withReportEnv({ enabled: undefined, allowlist: 'ZDEMO' }, async () => {
    const ctx = createMockToolContext();
    await assert.rejects(
      runReport.handler({ report: 'ZDEMO', parameters: {}, captureAlv: true, maxRows: 100 }, ctx),
      new RegExp(REPORT_ENABLE_FLAG),
    );
    assert.deepEqual(ctx.httpCalls, []);
  });
});

test('a report outside the exact allowlist is refused before any SAP call', async () => {
  await withReportEnv({ enabled: 'true', allowlist: 'ZALLOWED' }, async () => {
    const ctx = createMockToolContext();
    await assert.rejects(
      runReport.handler({ report: 'ZOTHER', parameters: {}, captureAlv: true, maxRows: 100 }, ctx),
      /not permitted/,
    );
    assert.deepEqual(ctx.httpCalls, []);
  });
});

test('posts a normalized, bounded request to the fixed report-runner endpoint', async () => {
  await withReportEnv({ enabled: 'true', allowlist: 'ZDEMO' }, async () => {
    const response = JSON.stringify({
      status: 'success',
      report: 'ZDEMO',
      runtime_ms: 12,
      rows: [{ CARRID: 'LH' }],
      total_rows: 1,
      truncated: false,
    });
    const ctx = createMockToolContext({ responseBody: response, scopes: ['write'] });
    const result = await runReport.handler(
      {
        report: 'zdemo',
        variant: 'daily',
        parameters: { p_carrid: 'LH' },
        captureAlv: true,
        maxRows: 20,
      },
      ctx,
    );

    assert.deepEqual(ctx.httpCalls, [{
      method: 'POST',
      path: REPORT_RUNNER_PATH,
      body: JSON.stringify({
        report: 'ZDEMO',
        variant: 'DAILY',
        parameters: { P_CARRID: 'LH' },
        capture_alv: true,
        max_rows: 20,
      }),
    }]);
    assert.match(result.content[0].text, /"report": "ZDEMO"/);
  });
});

test('rejects a mismatched backend response', async () => {
  await withReportEnv({ enabled: 'true', allowlist: 'ZDEMO' }, async () => {
    const ctx = createMockToolContext({
      responseBody: JSON.stringify({ status: 'success', report: 'ZOTHER' }),
      scopes: ['write'],
    });
    await assert.rejects(
      runReport.handler({ report: 'ZDEMO', parameters: {}, captureAlv: true, maxRows: 100 }, ctx),
      /did not match/,
    );
  });
});

test('refuses an oversized backend response', async () => {
  await withReportEnv({ enabled: 'true', allowlist: 'ZDEMO' }, async () => {
    const ctx = createMockToolContext({
      responseBody: JSON.stringify({ status: 'success', report: 'ZDEMO', output: 'x'.repeat(256 * 1024) }),
      scopes: ['write'],
    });
    await assert.rejects(
      runReport.handler({ report: 'ZDEMO', parameters: {}, captureAlv: true, maxRows: 100 }, ctx),
      /exceeded the 256 KiB sample limit/,
    );
  });
});
