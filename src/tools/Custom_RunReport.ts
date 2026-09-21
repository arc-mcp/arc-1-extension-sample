import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// Classic executable reports do not have a named execution operation in ARC-1's v1 extension API.
// This sample therefore uses the supported escape hatch for a deliberate SAP-side integration: a
// gated POST to one fixed, non-ADT ICF endpoint. The endpoint is a contract, not part of this
// TypeScript-only repository; see README.md for the required backend controls and wire format.

export const REPORT_RUNNER_PATH = '/sap/bc/http/sap/ZARC1_REPORT_RUNNER/run';
export const REPORT_ENABLE_FLAG = 'SAMPLE_REPORT_EXECUTION_ENABLED';
export const REPORT_ALLOWLIST_ENV = 'SAMPLE_REPORT_ALLOWLIST';

const MAX_RESPONSE_BYTES = 256 * 1024;
const ABAP_NAME = /^[A-Z0-9_/$]+$/u;
const SELECTION_NAME = /^[A-Z0-9_]+$/u;

interface RunReportArgs {
  report: string;
  variant?: string;
  parameters?: Record<string, string>;
  captureAlv?: boolean;
  maxRows?: number;
}

function normalizeName(value: string, label: string, maxLength: number, pattern: RegExp): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > maxLength || !pattern.test(normalized)) {
    throw new Error(`${label} is not a valid ABAP name.`);
  }
  return normalized;
}

/** Parse an exact-name allowlist. Wildcards and empty entries deliberately fail closed. */
export function parseReportAllowlist(raw: string | undefined): ReadonlySet<string> {
  if (!raw) {
    throw new Error(`${REPORT_ALLOWLIST_ENV} is empty — no reports are permitted.`);
  }
  const entries = raw.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw new Error(`${REPORT_ALLOWLIST_ENV} contains an empty entry.`);
  }

  const reports = new Set<string>();
  for (const entry of entries) {
    reports.add(normalizeName(entry, REPORT_ALLOWLIST_ENV, 40, ABAP_NAME));
  }
  return reports;
}

function parseRunnerResponse(body: string, expectedReport: string): Record<string, unknown> {
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('The report runner response exceeded the 256 KiB sample limit.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    throw new Error('The report runner did not return valid JSON.');
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error('The report runner response was not a JSON object.');
  }

  const response = decoded as Record<string, unknown>;
  if (response.status !== 'success' || typeof response.report !== 'string') {
    throw new Error('The report runner did not return a successful result.');
  }
  const returnedReport = normalizeName(response.report, 'The response report', 40, ABAP_NAME);
  if (returnedReport !== expectedReport) {
    throw new Error('The report runner response did not match the requested report.');
  }
  return response;
}

export default defineTool({
  name: 'Custom_RunReport',
  description:
    'Execute an allowlisted classic ABAP report through the fixed ZARC1_REPORT_RUNNER ICF endpoint and return its bounded JSON/ALV result. ' +
    `Requires ${REPORT_ENABLE_FLAG}=true, ${REPORT_ALLOWLIST_ENV}, SAP_ALLOW_PLUGIN_RAW_WRITES=true, SAP_ALLOW_WRITES=true, and the write scope.`,
  schema: z.object({
    report: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_/$]+$/u)
      .describe('Exact executable report name; it must also appear in SAMPLE_REPORT_ALLOWLIST.'),
    variant: z
      .string()
      .min(1)
      .max(14)
      .regex(/^[A-Za-z0-9_/$]+$/u)
      .optional()
      .describe('Optional existing report variant.'),
    parameters: z
      .record(
        z.string().min(1).max(8).regex(/^[A-Za-z0-9_]+$/u),
        z.string().max(255),
      )
      .default({})
      .describe('Selection-screen parameter name/value pairs. Select-options need a backend-specific extension.'),
    captureAlv: z.boolean().default(true).describe('Ask the backend to capture SALV/ALV rows.'),
    maxRows: z.number().int().min(1).max(200).default(100).describe('Maximum ALV rows returned to the model.'),
  }).strict(),
  policy: { scope: 'write', opType: OperationType.Workflow },
  availableOn: 'onprem',
  async handler(args, ctx) {
    if (process.env[REPORT_ENABLE_FLAG] !== 'true') {
      throw new Error(
        `${REPORT_ENABLE_FLAG} is not set to 'true' — this ARC-1 instance does not permit report execution.`,
      );
    }

    const input = args as RunReportArgs;
    const report = normalizeName(input.report, 'report', 40, ABAP_NAME);
    const allowlist = parseReportAllowlist(process.env[REPORT_ALLOWLIST_ENV]);
    if (!allowlist.has(report)) {
      throw new Error(`Report ${report} is not permitted by ${REPORT_ALLOWLIST_ENV}.`);
    }

    const variant = input.variant === undefined
      ? undefined
      : normalizeName(input.variant, 'variant', 14, ABAP_NAME);
    const parameters: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.parameters ?? {})) {
      parameters[normalizeName(name, 'A selection parameter', 8, SELECTION_NAME)] = value;
    }

    // Do not log selection values: they can be business data. The report and caller identity are
    // enough to correlate ARC-1's audit trail with the custom backend's execution log.
    ctx.logger.info('Report execution starting', {
      report,
      variant,
      mcpUser: ctx.authInfo?.userName,
      requestId: ctx.requestId,
    });

    const body = JSON.stringify({
      report,
      ...(variant === undefined ? {} : { variant }),
      parameters,
      capture_alv: input.captureAlv ?? true,
      max_rows: input.maxRows ?? 100,
    });
    const response = await ctx.http.post(REPORT_RUNNER_PATH, body, 'application/json', {
      Accept: 'application/json',
    });
    const result = parseRunnerResponse(response.body, report);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
});
