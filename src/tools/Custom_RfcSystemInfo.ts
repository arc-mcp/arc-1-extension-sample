import { Client } from 'open-rfc';
import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';
import { isConnectivityServiceBound, pickDisclosedFields, redactRfcError } from './rfc-redact.js';

// Classic RFC from an ARC-1 extension — and the security work that has to come with it.
//
// Every other tool in this sample reaches SAP through `ctx.http`, which is ARC-1's GATED client:
// the safety ceiling (`checkOperation`), principal propagation, CSRF and audit all apply to the
// call itself. `ctx` has no RFC channel, so this tool cannot do that. It opens its OWN socket with
// its OWN credentials, which moves four things outside ARC-1's control:
//
//   * the safety ceiling (SAP_ALLOW_WRITES / SAP_ALLOWED_PACKAGES / denyActions) does not gate the call
//   * SAP sees ONE shared technical RFC user, not the per-user identity principal propagation gives it
//   * classic RFC has no transport encryption and no peer authentication
//   * the reachable surface is every remote-enabled FM that RFC user is allowed to call
//
// ARC-1 still gates WHETHER this tool may be invoked (policy.scope + audit). It does not gate what
// the tool does once running — so the controls below are the plugin's own. See the README.
//
// `open-rfc` (https://github.com/marianfoo/open-rfc) makes this possible at all: an SDK-free RFC
// client with no native addon and no runtime dependencies, so the plugin stays pure JS.

// CONTROL 1, and the most important one: the function module is a hardcoded constant, never a
// parameter. A `Custom_RfcCall({ fm })` tool would hand any caller — or any prompt-injected LLM — a
// generic RFC gateway into the backend. One tool, one FM, chosen for its narrow blast radius:
// RFC_SYSTEM_INFO is read-only, present on effectively every SAP system since R/3, returns no
// business data, and lives in function group SRFC (verified on S/4HANA 2023 via TFDIR/ENLFDIR).
const FUNCTION_MODULE = 'RFC_SYSTEM_INFO';

// CONTROL 2: default-off opt-in. ARC-1's safety ceiling does not reach RFC, so the plugin brings
// its own gate — the same shape as the server's `SAP_ALLOW_PLUGIN_*` opt-ins.
const ENABLE_FLAG = 'SAMPLE_RFC_ENABLED';

// CONTROL 3: credentials come from a DEDICATED env namespace, never from tool arguments.
// Deliberately NOT `SAP_USER`/`SAP_PASSWORD` — ARC-1 already uses those for its own ADT connection,
// and quietly borrowing them would dial RFC as ARC-1's HTTP identity. Give the RFC path its own
// least-privilege user (README has the S_RFC grant).
const ENV = {
  ashost: 'SAMPLE_RFC_ASHOST',
  sysnr: 'SAMPLE_RFC_SYSNR',
  client: 'SAMPLE_RFC_CLIENT',
  user: 'SAMPLE_RFC_USER',
  passwd: 'SAMPLE_RFC_PASSWD',
  lang: 'SAMPLE_RFC_LANG',
} as const;

const CALL_TIMEOUT_SECONDS = 15; // open-rfc `Client` timeouts are in seconds; always bound the call.

export default defineTool({
  name: 'Custom_RfcSystemInfo',
  description:
    'Report identifying information about the connected SAP system (system ID, release, kernel, OS, ' +
    'database, host, time zone) by calling the read-only RFC_SYSTEM_INFO function module over classic ' +
    `RFC. Requires ${ENABLE_FLAG}=true and the SAMPLE_RFC_* connection variables.`,
  // CONTROL 4: no inputs at all. Nothing from the caller reaches the wire, so there is no injection
  // surface — no FM name, no parameters, no table filter.
  schema: z.object({}),
  // A read that returns system metadata: `read` scope, Read opType. A tool wrapping an FM that
  // returns business data must declare `data` instead — match the scope to what the FM exposes.
  policy: { scope: 'read', opType: OperationType.Read },
  // Classic RFC is not reachable on BTP ABAP, so hide the tool there rather than fail at call time.
  availableOn: 'onprem',
  async handler(_args, ctx) {
    if (process.env[ENABLE_FLAG] !== 'true') {
      throw new Error(`${ENABLE_FLAG} is not set to 'true' — this ARC-1 instance does not permit RFC calls.`);
    }

    // CONTROL 8: fail closed on BTP. ARC-1 on Cloud Foundry reaches on-premise SAP through the
    // Cloud Connector, and open-rfc 0.2.2 cannot use that route — the classic Client silently
    // ignores connectivity-proxy parameters and dials the backend direct. Refuse rather than make
    // an unintended direct connection attempt. See isConnectivityServiceBound().
    if (isConnectivityServiceBound(process.env.VCAP_SERVICES)) {
      throw new Error(
        'This ARC-1 instance is bound to the BTP Connectivity service, so RFC would have to traverse ' +
          'the Cloud Connector — a route open-rfc does not yet implement. Refusing rather than ' +
          'attempting a direct connection to the backend. Run this tool from an ARC-1 instance with ' +
          'network access to the SAP gateway instead.',
      );
    }

    const missing = Object.values(ENV).filter((name) => !process.env[name]);
    if (missing.length > 0) {
      // Name the missing variables, never any value.
      throw new Error(`Missing RFC connection environment variables: ${missing.join(', ')}`);
    }

    // CONTROL 5: attribution. SAP's own log records only the shared technical RFC user, so the link
    // back to the MCP caller exists only here. stderr (operator-only) — never the tool result.
    ctx.logger.info('RFC call starting', {
      functionModule: FUNCTION_MODULE,
      mcpUser: ctx.authInfo?.userName,
      requestId: ctx.requestId,
    });

    const client = new Client(
      {
        ashost: process.env[ENV.ashost],
        sysnr: process.env[ENV.sysnr],
        client: process.env[ENV.client],
        user: process.env[ENV.user],
        passwd: process.env[ENV.passwd],
        lang: process.env[ENV.lang],
      },
      { timeout: CALL_TIMEOUT_SECONDS },
    );

    let opened = false;
    try {
      await client.open();
      opened = true;
      const result = (await client.call(FUNCTION_MODULE, {})) as { RFCSI_EXPORT?: Record<string, unknown> };
      // CONTROL 6: disclose an allowlist of fields, not the whole structure (see rfc-redact.ts).
      const info = pickDisclosedFields(result.RFCSI_EXPORT ?? {});
      const text = Object.entries(info)
        .map(([field, value]) => `${field}: ${value}`)
        .join('\n');
      return { content: [{ type: 'text', text: text || 'RFC_SYSTEM_INFO returned no readable fields.' }] };
    } catch (err) {
      // CONTROL 7: redact. open-rfc failures can carry the backend host:port, so the full error goes
      // to the operator log and the caller gets only a classification key.
      ctx.logger.error('RFC call failed', { functionModule: FUNCTION_MODULE, requestId: ctx.requestId, err });
      throw new Error(redactRfcError(err));
    } finally {
      // Always hand the SAP work process back, on every path — and never let a close failure mask
      // the original error.
      if (opened) {
        try {
          await client.close();
        } catch (closeErr) {
          ctx.logger.warn('RFC close failed', { requestId: ctx.requestId, err: closeErr });
        }
      }
    }
  },
});
