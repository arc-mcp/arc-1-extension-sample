import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

// LISA get_translation — reads an SAP object's texts in a language. Live-verified HTTP 200.
//
// Like Custom_ListLanguages, this is a READ that LISA exposes as a POST, so it declares
// `scope: 'write'` and needs `SAP_ALLOW_PLUGIN_RAW_WRITES` (LISA's API design). `opType: Read` keeps
// the operation honest. Pairs with Custom_SetTranslation for a read → write → read-back round-trip.
export default defineTool({
  name: 'Custom_GetTranslation',
  description: "Read an SAP object's translation in a given language via the LISA ZI18N_SERVICE.",
  schema: z.object({
    targetType: z.string().default('data_element'), // data_element | domain | message_class | text_pool | …
    objectName: z.string().min(1).max(40),
    language: z.string().min(1).max(2), // SAP language key, e.g. 'DE'
  }),
  policy: { scope: 'write', opType: OperationType.Read },
  availableOn: 'all',
  async handler(args, ctx) {
    const a = args as { targetType: string; objectName: string; language: string };
    const body = JSON.stringify({ target_type: a.targetType, object_name: a.objectName, language: a.language });
    const res = await ctx.http.post('/sap/bc/http/sap/ZI18N_SERVICE/get_translation', body, 'application/json', {
      Accept: 'application/json',
    });
    return { content: [{ type: 'text', text: res.body }] };
  },
});
