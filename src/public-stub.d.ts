// Minimal stub of the @experimental `arc-1/public` API so this sample typechecks
// standalone BEFORE the real API exists in arc-1. Delete this file and depend on the
// real `arc-1/public` once FEAT-61 PR1–PR2 land.
// Mirrors: arc-1 docs/research/extension-framework-spec.md §2.
declare module 'arc-1/public' {
  import type { ZodTypeAny } from 'zod';

  export type Scope = 'read' | 'write' | 'data' | 'sql' | 'transports' | 'git' | 'admin';

  export enum OperationType {
    Read = 'R', Search = 'S', Query = 'Q', FreeSQL = 'F',
    Create = 'C', Update = 'U', Delete = 'D', Activate = 'A',
    Test = 'T', Lock = 'L', Intelligence = 'I', Workflow = 'W', Transport = 'X',
  }

  export interface AdtResponse { statusCode: number; headers: Record<string, string>; body: string; }

  export interface SafeHttpClient {
    get(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
    head(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
    post(path: string, body?: string, contentType?: string, headers?: Record<string, string>): Promise<AdtResponse>;
    put(path: string, body: string, contentType?: string, headers?: Record<string, string>): Promise<AdtResponse>;
    delete(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
    fetchCsrfToken(path?: string): Promise<string>;
    withStatefulSession<T>(fn: (s: SafeHttpClient) => Promise<T>): Promise<T>;
  }

  export interface ToolContext {
    readonly http: SafeHttpClient;
    readonly logger: { info(msg: string, data?: unknown): void; warn(msg: string, data?: unknown): void };
    readonly authInfo?: { userName?: string; scopes: string[] };
    readonly requestId: string;
    // client, safety, cache, config, elicit/notify/sampling omitted from the stub for brevity.
  }

  export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

  export interface ToolDefinition {
    name: `Custom_${string}`;
    description: string;
    schema: ZodTypeAny;
    policy: { scope: Scope; opType: OperationType };
    availableOn?: 'all' | 'onprem' | 'btp';
    handler(args: unknown, ctx: ToolContext): Promise<ToolResult>;
  }

  export function defineTool(def: ToolDefinition): ToolDefinition;

  export interface Plugin {
    name: string;
    version: string;
    apiVersion: number;
    tools: ToolDefinition[];
    manifests?: string[];
  }
}
