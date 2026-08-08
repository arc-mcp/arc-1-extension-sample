// The two security-critical pure functions of the RFC sample, kept free of `arc-1`/`zod` imports
// so they stay testable without a linked arc-1 build or a live SAP system (see test/).

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
export function redactRfcError(err: unknown): string {
  const key = (err as { key?: unknown } | null)?.key;
  if (typeof key === 'string' && key) return `RFC call failed (${key}). See the ARC-1 server log for details.`;
  return 'RFC call failed. See the ARC-1 server log for details.';
}
