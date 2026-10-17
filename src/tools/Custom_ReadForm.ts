import { defineTool, OperationType } from 'arc-1/public';
import { z } from 'zod';

const schema = z
  .strictObject({
    kind: z.enum(['sapscript', 'so10', 'smartform']),
    name: z
      .string()
      .min(1)
      .max(70)
      .regex(/^[A-Z0-9_/-]+$/),
    language: z.string().length(1).describe('Case-sensitive SAP language key, e.g. E for English or D for German.'),
    textId: z
      .string()
      .min(1)
      .max(4)
      .regex(/^[A-Z0-9_]+$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const max = value.kind === 'sapscript' ? 16 : value.kind === 'smartform' ? 30 : 70;
    if (value.name.length > max) ctx.addIssue({ code: 'custom', message: `Name exceeds ${max} characters.` });
    if (value.kind !== 'so10' && value.textId !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'textId is only valid for SO10 texts.' });
    }
  });

export default defineTool({
  name: 'Custom_ReadForm',
  description:
    'Read SAPscript form definitions, SO10 standard texts, or active SmartForm source XML with layout and embedded text. ' +
    'Requires the optional forms companion service. Returns source, not rendered output; refuses SO10 references and leaves INCLUDE commands unexpanded.',
  schema,
  // Registration pairs Query with data scope; the HTTP GET itself is checked as a read.
  policy: { scope: 'data', opType: OperationType.Query },
  availableOn: 'onprem',
  async handler(args, ctx) {
    const input = schema.parse(args);
    const query = new URLSearchParams({ kind: input.kind, name: input.name, language: input.language });
    if (input.kind === 'so10') query.set('textId', input.textId ?? 'ST');
    const response = await ctx.http.get(`/sap/bc/zarc1_forms?${query}`, { Accept: 'application/json' });
    if (Buffer.byteLength(response.body, 'utf8') > 1024 * 1024) {
      throw new Error('Forms companion response exceeds 1 MiB. No partial result was returned.');
    }
    // A login page or a different service must not be presented as form source.
    const unexpected = 'Unexpected forms companion response. Verify the installed companion version and service path.';
    let result;
    try {
      result = JSON.parse(response.body);
    } catch {
      throw new Error(unexpected);
    }
    if (
      response.statusCode !== 200 ||
      result?.version !== 1 ||
      result.kind !== input.kind ||
      result.name !== input.name ||
      result.language !== input.language ||
      !result.content
    ) {
      throw new Error(unexpected);
    }
    return { content: [{ type: 'text', text: response.body }] };
  },
});
