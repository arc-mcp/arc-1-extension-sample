import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// LISA integration (code tier) — the motivating use case for the gated non-ADT write surface.
//
// Writes an SAP object translation via LISA's custom ICF service ZI18N_SERVICE
// (https://github.com/ClementRingot/LISA — import the ZCL_I18N_SERVICE handler class first; it
// exposes POST /sap/bc/http/sap/ZI18N_SERVICE/<action> with a JSON body). This is exactly the
// pattern the framework's raw-write surface is for: a gated POST to a non-ADT path. CSRF is handled
// automatically. **Live-verified end-to-end on a4h / S/4HANA 2023** (HTTP 200, translation written +
// read back).
//
// Gated: refused unless SAP_ALLOW_PLUGIN_RAW_WRITES=true + SAP_ALLOW_WRITES=true and scope:'write'.
export default defineTool({
  name: 'Custom_SetTranslation',
  description: "Write an SAP object's translation in a target language via the LISA ZI18N_SERVICE.",
  schema: z.object({
    targetType: z.string().default('data_element'), // data_element | domain | message_class | text_pool | …
    objectName: z.string().min(1).max(40),
    language: z.string().min(1).max(2), // SAP language key, e.g. 'DE'
    transport: z.string().min(1).max(20), // an open transport request (LISA records the write into it)
    texts: z.array(z.object({ attribute: z.string(), value: z.string() })).min(1),
  }),
  policy: { scope: 'write', opType: OperationType.Update },
  availableOn: 'all',
  async handler(args, ctx) {
    const a = args as {
      targetType: string;
      objectName: string;
      language: string;
      transport: string;
      texts: Array<{ attribute: string; value: string }>;
    };
    const body = JSON.stringify({
      target_type: a.targetType,
      object_name: a.objectName,
      language: a.language,
      transport: a.transport,
      texts: a.texts,
    });
    const res = await ctx.http.post('/sap/bc/http/sap/ZI18N_SERVICE/set_translation', body, 'application/json', {
      Accept: 'application/json',
    });
    return { content: [{ type: 'text', text: `HTTP ${res.statusCode}\n${res.body}` }] };
  },
});
