// The two security-critical behaviours of the RFC sample: disclose only the allowlist, and never
// let an open-rfc error message (which can carry the backend host:port) reach the MCP client.
// stdlib `node:test` — no framework, no SAP system needed. Run: npm test
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISCLOSED_FIELDS,
  getConnectivityAccessToken,
  pickDisclosedFields,
  readConnectivityBinding,
  redactRfcError,
} from '../dist/tools/rfc-redact.js';

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

function connectivityVcap(overrides = {}) {
  return JSON.stringify({
    connectivity: [{
      name: 'arc1-connectivity',
      credentials: {
        onpremise_proxy_host: 'proxy.fixture.invalid',
        onpremise_socks5_proxy_port: '20004',
        clientid: 'client-fixture',
        clientsecret: 'secret-fixture',
        token_service_url: 'https://token.fixture.invalid/oauth/token',
        ...overrides,
      },
    }],
    xsuaa: [{}],
  });
}

test('admits exactly one redaction-safe Connectivity SOCKS5 binding', () => {
  const binding = readConnectivityBinding(connectivityVcap());
  assert.ok(binding);
  assert.equal(binding.proxyHost, 'proxy.fixture.invalid');
  assert.equal(binding.proxyPort, 20004);
  assert.equal(binding.clientSecret, 'secret-fixture');
  assert.ok(Object.isFrozen(binding));
  assert.deepEqual(Object.keys(binding), []);
  assert.ok(!JSON.stringify(binding).includes('secret-fixture'));
  assert.ok(!JSON.stringify(binding).includes('client-fixture'));
});

test('no Connectivity binding means the direct RFC route is intended', () => {
  assert.equal(readConnectivityBinding(undefined), undefined);
  assert.equal(readConnectivityBinding(''), undefined);
  assert.equal(readConnectivityBinding(JSON.stringify({ destination: [{}], xsuaa: [{}] })), undefined);
});

test('malformed, ambiguous, or non-HTTPS Connectivity bindings fail closed', () => {
  assert.throws(() => readConnectivityBinding('{not json'), /not valid JSON/);
  assert.throws(
    () => readConnectivityBinding(connectivityVcap({ token_service_url: 'http://token.fixture.invalid' })),
    /must be an HTTPS URL/,
  );
  const twice = JSON.parse(connectivityVcap());
  twice.connectivity.push(twice.connectivity[0]);
  assert.throws(() => readConnectivityBinding(JSON.stringify(twice)), /Exactly one/);
});

test('requests and caches a raw Connectivity access token without leaking credentials', async () => {
  const binding = readConnectivityBinding(connectivityVcap({
    clientid: 'cache-client-fixture',
    clientsecret: 'cache-secret-fixture',
    token_service_url: 'https://cache-token.fixture.invalid',
  }));
  assert.ok(binding);
  let calls = 0;
  let currentTime = 1_000;
  const fetchToken = async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://cache-token.fixture.invalid/oauth/token');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, 'grant_type=client_credentials');
    assert.equal(init.redirect, 'error');
    assert.equal(
      Buffer.from(init.headers.authorization.slice('Basic '.length), 'base64').toString('utf8'),
      'cache-client-fixture:cache-secret-fixture',
    );
    return new Response(JSON.stringify({ access_token: `access-token-${calls}`, expires_in: 100 }));
  };

  assert.equal(
    await getConnectivityAccessToken(binding, { fetch: fetchToken, now: () => currentTime }),
    'access-token-1',
  );
  assert.equal(
    await getConnectivityAccessToken(binding, { fetch: fetchToken, now: () => currentTime }),
    'access-token-1',
  );
  assert.equal(calls, 1);
  currentTime = 92_000;
  assert.equal(
    await getConnectivityAccessToken(binding, { fetch: fetchToken, now: () => currentTime }),
    'access-token-2',
  );
  assert.equal(calls, 2);
});

test('token-service failures expose status but not the response body', async () => {
  const binding = readConnectivityBinding(connectivityVcap({
    clientid: 'failure-client-fixture',
    token_service_url: 'https://failure-token.fixture.invalid/oauth/token',
  }));
  assert.ok(binding);
  await assert.rejects(
    getConnectivityAccessToken(binding, {
      fetch: async () => new Response('response-body-secret', { status: 401 }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.ok(!error.message.includes('response-body-secret'));
      return true;
    },
  );
});

test('rejects an oversized token response while streaming it', async () => {
  const binding = readConnectivityBinding(connectivityVcap({
    clientid: 'oversize-client-fixture',
    token_service_url: 'https://oversize-token.fixture.invalid',
  }));
  assert.ok(binding);
  await assert.rejects(
    getConnectivityAccessToken(binding, {
      fetch: async () => new Response('x'.repeat(65 * 1024)),
    }),
    /exceeded the size limit/,
  );
});

test('redaction handles errors without a key, and non-errors', () => {
  assert.ok(!redactRfcError(new Error('Name or password is incorrect')).includes('password'));
  for (const value of [undefined, null, 'boom', { key: 42 }]) {
    assert.match(redactRfcError(value), /^RFC call failed\./);
  }
});
