// The two security-critical behaviours of the RFC sample: disclose only the allowlist, and never
// let an open-rfc error message (which can carry the backend host:port) reach the MCP client.
// stdlib `node:test` — no framework, no SAP system needed. Run: npm test
import assert from 'node:assert/strict';
import test from 'node:test';
import { DISCLOSED_FIELDS, pickDisclosedFields, redactRfcError } from '../dist/tools/rfc-redact.js';

test('discloses only allowlisted fields, trimmed', () => {
  const picked = pickDisclosedFields({
    RFCSYSID: 'A4H  ',
    RFCSAPRL: '758',
    RFCDBHOST: 'internal-db-host', // topology — must not be disclosed
    RFCIPADDR: '10.0.0.5', // ditto
    RFCIPV6ADDR: 'fe80::1', // ditto
    RFCDEST: 'AAAAAAAAAAAAAAAA', // not on the allowlist
  });

  assert.deepEqual(picked, { RFCSYSID: 'A4H', RFCSAPRL: '758' });
  for (const leaked of ['RFCDBHOST', 'RFCIPADDR', 'RFCIPV6ADDR', 'RFCDEST']) {
    assert.ok(!(leaked in picked), `${leaked} must not be disclosed`);
  }
});

test('drops blank and non-string values', () => {
  assert.deepEqual(pickDisclosedFields({ RFCSYSID: '   ', RFCHOST: 42, RFCOPSYS: 'Linux' }), { RFCOPSYS: 'Linux' });
});

test('an empty structure yields no fields rather than throwing', () => {
  assert.deepEqual(pickDisclosedFields({}), {});
  assert.ok(DISCLOSED_FIELDS.length > 0);
});

test('redaction keeps the classification key but never the error message', () => {
  // Shape of a real open-rfc connect failure — the message carries the backend endpoint.
  const err = Object.assign(new Error('failed to connect NI socket to vhcalhost:3300'), {
    key: 'NI_CONNECT_FAILED',
  });
  const redacted = redactRfcError(err);

  assert.match(redacted, /NI_CONNECT_FAILED/);
  assert.ok(!redacted.includes('vhcalhost'), 'must not leak the host');
  assert.ok(!redacted.includes('3300'), 'must not leak the port');
});

test('redaction handles errors without a key, and non-errors', () => {
  assert.ok(!redactRfcError(new Error('Name or password is incorrect')).includes('password'));
  for (const value of [undefined, null, 'boom', { key: 42 }]) {
    assert.match(redactRfcError(value), /^RFC call failed\./);
  }
});
