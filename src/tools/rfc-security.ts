// Security-critical RFC helpers, kept free of `arc-1`/`zod` imports
// so they stay testable without a linked arc-1 build or a live SAP system (see test/).

const CUSTOM_INSPECT = Symbol.for('nodejs.util.inspect.custom');
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

export interface ConnectivityBinding {
  readonly proxyHost: string;
  readonly proxyPort: number;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenServiceUrl: string;
}

interface TokenCacheEntry {
  readonly identity: string;
  readonly accessToken: string;
  readonly refreshAt: number;
}

let cachedToken: TokenCacheEntry | undefined;
let tokenRequest: Promise<string> | undefined;
let tokenRequestIdentity: string | undefined;

/**
 * The ONLY `RFCSI_EXPORT` fields the tool discloses. `RFC_SYSTEM_INFO` also returns the database
 * host and the server's IPv4/IPv6 addresses; those are internal topology that answers no question
 * the tool is for, so they are deliberately not in this list. Least disclosure — an allowlist, so a
 * future SAP release adding fields cannot widen what leaks.
 */
export const DISCLOSED_FIELDS = [
  'RFCSYSID',
  'RFCSAPRL',
  'RFCKERNRL',
  'RFCOPSYS',
  'RFCDBSYS',
  'RFCHOST',
  'RFCTZONE',
] as const;

/** Project the allowlisted fields out of an RFCSI_EXPORT structure, trimming SAP's CHAR padding. */
export function pickDisclosedFields(rfcsi: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of DISCLOSED_FIELDS) {
    const value = rfcsi[field];
    if (typeof value === 'string' && value.trim()) out[field] = value.trim();
  }
  return out;
}

/**
 * Turn an open-rfc failure into a message that is safe to hand back to an MCP client.
 *
 * open-rfc error text can carry the backend endpoint — a failed connect reads
 * `failed to connect NI socket to <host>:<port>` (observed live). Returning that to the LLM would
 * disclose internal hostnames, so the caller only ever sees a stable classification key; the full
 * error goes to the operator's stderr log instead.
 */
function bindingText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`The Connectivity service binding is missing ${field}.`);
  }
  return value;
}

function bindingPort(value: unknown): number {
  const numeric = typeof value === 'string' && /^\d+$/u.test(value)
    ? Number.parseInt(value, 10)
    : value;
  if (!Number.isSafeInteger(numeric) || (numeric as number) < 1 || (numeric as number) > 65_535) {
    throw new Error('The Connectivity service binding has an invalid onpremise_socks5_proxy_port.');
  }
  return numeric as number;
}

/** Read exactly one BTP Connectivity service binding without exposing its credentials. */
export function readConnectivityBinding(vcapServices: string | undefined): ConnectivityBinding | undefined {
  if (!vcapServices) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(vcapServices);
  } catch {
    throw new Error('VCAP_SERVICES is not valid JSON; refusing to choose an RFC route.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('VCAP_SERVICES does not contain a service-binding object.');
  }

  const matches: Record<string, unknown>[] = [];
  for (const [label, services] of Object.entries(parsed)) {
    if (!label.toLowerCase().includes('connectivity')) continue;
    if (!Array.isArray(services)) {
      throw new Error('The Connectivity entry in VCAP_SERVICES is not an array.');
    }
    for (const service of services) {
      if (typeof service !== 'object' || service === null || Array.isArray(service)) {
        throw new Error('A Connectivity service binding is malformed.');
      }
      const credentials = (service as { credentials?: unknown }).credentials;
      if (typeof credentials !== 'object' || credentials === null || Array.isArray(credentials)) {
        throw new Error('A Connectivity service binding has no credentials object.');
      }
      matches.push(credentials as Record<string, unknown>);
    }
  }
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) {
    throw new Error('Exactly one Connectivity service binding is required for RFC.');
  }

  const credentials = matches[0]!;
  if (
    typeof credentials.clientid !== 'string' || credentials.clientid.length === 0 ||
    typeof credentials.clientsecret !== 'string' || credentials.clientsecret.length === 0
  ) {
    throw new Error(
      'The RFC sample requires a client-secret Connectivity binding; X.509/mTLS bindings are not supported.',
    );
  }
  const tokenServiceUrl = bindingText(credentials.token_service_url, 'token_service_url');
  let parsedTokenUrl: URL;
  try {
    parsedTokenUrl = new URL(tokenServiceUrl);
  } catch {
    throw new Error('The Connectivity token_service_url is invalid.');
  }
  if (
    parsedTokenUrl.protocol !== 'https:' ||
    parsedTokenUrl.username !== '' ||
    parsedTokenUrl.password !== '' ||
    parsedTokenUrl.hash !== '' ||
    parsedTokenUrl.search !== ''
  ) {
    throw new Error('The Connectivity token_service_url must be an HTTPS URL without user info, query, or fragment.');
  }

  const binding = Object.defineProperties({} as ConnectivityBinding, {
    proxyHost: {
      enumerable: false,
      value: bindingText(credentials.onpremise_proxy_host, 'onpremise_proxy_host'),
    },
    proxyPort: {
      enumerable: false,
      value: bindingPort(credentials.onpremise_socks5_proxy_port),
    },
    clientId: {
      enumerable: false,
      value: bindingText(credentials.clientid, 'clientid'),
    },
    clientSecret: {
      enumerable: false,
      value: bindingText(credentials.clientsecret, 'clientsecret'),
    },
    tokenServiceUrl: {
      enumerable: false,
      value: parsedTokenUrl.href,
    },
  });
  const safe = () => ({
    proxyHost: '<redacted>',
    proxyPort: binding.proxyPort,
    clientId: '<redacted>',
    clientSecret: '<redacted>',
    tokenServiceUrl: '<redacted>',
  });
  Object.defineProperty(binding, 'toJSON', { enumerable: false, value: safe });
  Object.defineProperty(binding, CUSTOM_INSPECT, { enumerable: false, value: safe });
  return Object.freeze(binding);
}

function tokenIdentity(binding: ConnectivityBinding): string {
  return `${binding.tokenServiceUrl}\u0000${binding.clientId}`;
}

function tokenEndpoint(binding: ConnectivityBinding): string {
  const endpoint = new URL(binding.tokenServiceUrl);
  const basePath = endpoint.pathname.replace(/\/+$/u, '');
  endpoint.pathname = basePath.endsWith('/oauth/token')
    ? basePath
    : `${basePath}/oauth/token`;
  return endpoint.href;
}

async function readTokenResponseBody(response: Response): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_TOKEN_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Connectivity token response exceeded the size limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

/** Obtain and briefly cache a raw Connectivity access token. No secret enters an error message. */
export async function getConnectivityAccessToken(
  binding: ConnectivityBinding,
  options: { readonly fetch?: typeof fetch; readonly now?: () => number } = {},
): Promise<string> {
  const now = options.now ?? Date.now;
  const fetchToken = options.fetch ?? fetch;
  const identity = tokenIdentity(binding);
  const currentTime = now();
  if (cachedToken?.identity === identity && cachedToken.refreshAt > currentTime) {
    return cachedToken.accessToken;
  }
  if (tokenRequest !== undefined && tokenRequestIdentity === identity) return tokenRequest;

  tokenRequestIdentity = identity;
  tokenRequest = (async () => {
    let response: Response;
    try {
      response = await fetchToken(tokenEndpoint(binding), {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${binding.clientId}:${binding.clientSecret}`, 'utf8').toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Connectivity token request failed before a response was received.');
    }
    if (!response.ok) {
      throw new Error(`Connectivity token request was rejected with HTTP ${response.status}.`);
    }
    const body = await readTokenResponseBody(response);
    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw new Error('Connectivity token response was not valid JSON.');
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new Error('Connectivity token response was not an object.');
    }
    const accessToken = (decoded as { access_token?: unknown }).access_token;
    const expiresValue = (decoded as { expires_in?: unknown }).expires_in;
    const expiresIn = typeof expiresValue === 'string' && /^\d+$/u.test(expiresValue)
      ? Number.parseInt(expiresValue, 10)
      : expiresValue;
    if (
      typeof accessToken !== 'string' ||
      accessToken.length === 0 ||
      !/^[\x21-\x7e]+$/u.test(accessToken) ||
      Buffer.byteLength(accessToken, 'ascii') > 65_536
    ) {
      throw new Error('Connectivity token response did not contain a valid access_token.');
    }
    if (
      !Number.isSafeInteger(expiresIn) ||
      (expiresIn as number) < 1 ||
      (expiresIn as number) > MAX_TOKEN_LIFETIME_SECONDS
    ) {
      throw new Error('Connectivity token response did not contain a valid expires_in.');
    }
    const lifetimeMs = (expiresIn as number) * 1_000;
    const safetySkewMs = Math.min(60_000, Math.max(1_000, Math.floor(lifetimeMs / 10)));
    cachedToken = Object.freeze({
      identity,
      accessToken,
      refreshAt: now() + Math.max(0, lifetimeMs - safetySkewMs),
    });
    return accessToken;
  })().finally(() => {
    tokenRequest = undefined;
    tokenRequestIdentity = undefined;
  });
  return tokenRequest;
}

export function redactRfcError(err: unknown): string {
  const candidate = (err as { key?: unknown; code?: unknown } | null)?.key ??
    (err as { code?: unknown } | null)?.code;
  if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(candidate)) {
    return `RFC call failed (${candidate}). See the ARC-1 server log for details.`;
  }
  return 'RFC call failed. See the ARC-1 server log for details.';
}
