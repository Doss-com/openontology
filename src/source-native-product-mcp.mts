/** MCP transport for the source-native verification product. */
import { createInterface } from 'node:readline';
import type { UnknownRecord } from './source-native-object-map.mjs';
import type {
  ProductSearchInput,
  SourceNativeProductReadResult,
  SourceNativeProductSearchResult,
  SourceNativeProductVerificationResult,
} from './source-native-product.mjs';
import type { SourceNativeFieldQuery } from './source-native-query-planner.mjs';

interface ProductTransport {
  kind: 'OpenOntologySourceNativeProductV2';
  verify(input: ProductSearchInput): Promise<SourceNativeProductVerificationResult>;
  search(input: ProductSearchInput): Promise<SourceNativeProductSearchResult>;
  read(input: { ref: string }): Promise<SourceNativeProductReadResult>;
}
interface JsonRpcResponse { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: UnknownRecord }

const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};

const SCOPE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['sourceSystem', 'objectType', 'field'],
  properties: {
    sourceSystem: { type: 'string', minLength: 1 },
    objectType: { type: 'string', minLength: 1 },
    externalId: { type: 'string', minLength: 1 },
    field: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
});

const QUERY_PROPERTIES = Object.freeze({
  question: { type: 'string', minLength: 1 },
  intent: { type: 'string', enum: ['current', 'next'], default: 'current' },
  anchorValue: { type: 'string', minLength: 1 },
  scope: SCOPE_SCHEMA,
});

const VERIFY_TOOL = Object.freeze({
  name: 'verify',
  description: 'Verify one complete question against the named source cut. OpenOntology searches for candidate references, resolves identity and chronology, reads every required exact source range, and returns proof-complete context or a typed refusal. It does not generate a prose answer.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: QUERY_PROPERTIES,
    additionalProperties: false,
  },
});

const SEARCH_TOOL = Object.freeze({
  name: 'search',
  description: 'Find candidate references for one complete question. Results are navigation only and are not evidence. Read every match marked requiredForProof before making a material claim.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: QUERY_PROPERTIES,
    additionalProperties: false,
  },
});

const READ_TOOL = Object.freeze({
  name: 'read',
  description: 'Read one reference returned by search. Returns exact authorized source bytes, their byte anchor, a typed binding, and a receipt.',
  inputSchema: {
    type: 'object',
    required: ['ref'],
    properties: { ref: { type: 'string', pattern: '^evidence:[0-9a-f]{64}$' } },
    additionalProperties: false,
  },
});

function exactArguments(value: unknown, allowed: string[]): UnknownRecord {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord : fail('SOURCE_NATIVE_PRODUCT_QUERY');
  if (Object.keys(record).some((name) => !allowed.includes(name))) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  return { ...record };
}

function scopeArguments(value: unknown): SourceNativeFieldQuery | null {
  if (value === undefined) return null;
  const scope = exactArguments(value, ['sourceSystem', 'objectType', 'externalId', 'field']);
  const { sourceSystem, objectType, externalId, field } = scope;
  if (typeof sourceSystem !== 'string' || !sourceSystem
    || typeof objectType !== 'string' || !objectType
    || typeof field !== 'string' || !field
    || externalId !== undefined && (typeof externalId !== 'string' || !externalId)) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  const exactSourceSystem = typeof sourceSystem === 'string'
    ? sourceSystem : fail('SOURCE_NATIVE_PRODUCT_QUERY');
  const exactObjectType = typeof objectType === 'string'
    ? objectType : fail('SOURCE_NATIVE_PRODUCT_QUERY');
  const exactField = typeof field === 'string' ? field : fail('SOURCE_NATIVE_PRODUCT_QUERY');
  return {
    sourceSystem: exactSourceSystem,
    objectType: exactObjectType,
    fieldPath: exactField,
    ...(typeof externalId === 'string' ? { externalId } : {}),
  };
}

function queryArguments(value: unknown): ProductSearchInput {
  const args = exactArguments(value, ['question', 'intent', 'anchorValue', 'scope']);
  const { question, intent: inputIntent, anchorValue: inputAnchorValue } = args;
  if (typeof question !== 'string' || !question.trim()
    || inputIntent !== undefined && inputIntent !== 'current' && inputIntent !== 'next'
    || inputAnchorValue !== undefined && typeof inputAnchorValue !== 'string') {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  const exactQuestion = typeof question === 'string' ? question : fail('SOURCE_NATIVE_PRODUCT_QUERY');
  const anchorValue = typeof inputAnchorValue === 'string' ? inputAnchorValue.trim() || null : null;
  const intent = inputIntent === 'next' ? 'next' : 'current';
  return {
    question: exactQuestion,
    intent,
    anchorValue,
    typedQuery: scopeArguments(args.scope),
  };
}

function readArguments(value: unknown): { ref: string } {
  const args = exactArguments(value, ['ref']);
  const ref = args.ref;
  if (typeof ref !== 'string' || !/^evidence:[0-9a-f]{64}$/u.test(ref)) {
    fail('SOURCE_NATIVE_PRODUCT_READ');
  }
  return { ref: typeof ref === 'string' ? ref : fail('SOURCE_NATIVE_PRODUCT_READ') };
}

function result(value: unknown): UnknownRecord {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(error: unknown): UnknownRecord {
  const code = error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' ? error.code : 'SOURCE_NATIVE_PRODUCT_ERROR';
  return {
    isError: true,
    content: [{ type: 'text', text: code }],
  };
}

export function runSourceNativeProductMcp(product: ProductTransport, {
  input = process.stdin,
  output = process.stdout,
  profile = 'verify',
}: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; profile?: 'verify' | 'advanced' } = {}) {
  if (product?.kind !== 'OpenOntologySourceNativeProductV2'
    || typeof product.verify !== 'function'
    || typeof product.search !== 'function'
    || typeof product.read !== 'function'
    || !['verify', 'advanced'].includes(profile)) {
    throw new TypeError('SOURCE_NATIVE_PRODUCT_MCP');
  }
  const tools = profile === 'verify' ? [VERIFY_TOOL] : [SEARCH_TOOL, READ_TOOL];
  const send = (message: JsonRpcResponse) => output.write(`${JSON.stringify(message)}\n`);
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', async (line) => {
    if (!line.trim()) return;
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request.id === undefined) return;
    const response: JsonRpcResponse = { jsonrpc: '2.0', id: request.id };
    try {
      if (request.method === 'initialize') {
        response.result = {
          protocolVersion: request.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'openontology-source-native', version: '2' },
        };
      } else if (request.method === 'ping') {
        response.result = {};
      } else if (request.method === 'tools/list') {
        response.result = { tools };
      } else if (request.method === 'tools/call') {
        if (profile === 'verify' && request.params?.name === 'verify') {
          response.result = result(await product.verify(queryArguments(request.params?.arguments)));
        } else if (profile === 'advanced' && request.params?.name === 'search') {
          response.result = result(await product.search(queryArguments(request.params?.arguments)));
        } else if (profile === 'advanced' && request.params?.name === 'read') {
          const args = readArguments(request.params?.arguments);
          response.result = result(await product.read({ ref: args.ref }));
        } else {
          response.result = errorResult({ code: 'SOURCE_NATIVE_PRODUCT_TOOL_NOT_FOUND' });
        }
      } else {
        response.error = { code: -32601, message: 'Method not found' };
      }
    } catch (error) {
      response.result = errorResult(error);
    }
    send(response);
  });
  return lines;
}

export const SOURCE_NATIVE_PRODUCT_TOOLS = Object.freeze({
  verify: Object.freeze([VERIFY_TOOL]),
  advanced: Object.freeze([SEARCH_TOOL, READ_TOOL]),
});
