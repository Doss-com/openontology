/** MCP transport for the source-native verification product. */
import { createInterface } from 'node:readline';
import type { UnknownRecord } from '../source/object-map.js';
import type { ProductSearchInput } from './runtime.js';
import type {
  SourceNativeConstructionProduct,
  SourceNativeConstructionSearchInput,
} from '../construction/navigation.js';
import type { SourceNativeFieldQuery } from '../query/planner.js';

export interface ProductTransport {
  kind: 'OpenOntologySourceNativeProductV2' | 'OpenOntologySourceNativeAdmittedKnowledgeProductV1';
  verify(input: ProductSearchInput): Promise<unknown>;
  search(input: ProductSearchInput): Promise<unknown>;
  read(input: { ref: string }): Promise<unknown>;
}
type McpProduct = ProductTransport | Pick<SourceNativeConstructionProduct, keyof ProductTransport>;
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: unknown;
  result?: unknown;
  error?: UnknownRecord;
}

function fail(code: string): never {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
}
const EXACT_UTC_MILLISECOND_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const SCOPE_SCHEMA = Object.freeze({
  type: 'object',
  description:
    'Optional exact source profile. Omit scope when its names are unknown; use the question or returned availableFields to identify the declared profile. Scope may fill missing choices or narrow matching declared profiles and fields, but conflicting recognized choices refuse. A native object ID named in the question must agree with externalId.',
  required: ['sourceSystem', 'objectType', 'field'],
  properties: {
    sourceSystem: {
      type: 'string',
      minLength: 1,
      description:
        'Exact, case-sensitive sourceSystem from the declared profile or availableFields. Do not infer it from the object type.',
    },
    objectType: {
      type: 'string',
      minLength: 1,
      description: 'Exact, case-sensitive objectType from the declared profile or availableFields.',
    },
    externalId: {
      type: 'string',
      minLength: 1,
      description:
        'Optional source-native object ID. Omit when the question identifies the object by a supported name. A different explicit ID in the question is refused.',
    },
    field: {
      type: 'string',
      minLength: 1,
      description: 'Exact fieldPath from the declared profile or availableFields.',
    },
  },
  additionalProperties: false,
});

const QUERY_PROPERTIES = Object.freeze({
  question: {
    type: 'string',
    minLength: 1,
    description:
      'Complete question, including the requested field and any known source-native object ID or supported name.',
  },
  intent: {
    type: 'string',
    enum: ['current', 'next'],
    default: 'current',
    description:
      'Omit for the latest recorded field value. Use next only for the field revision immediately following a known field value.',
  },
  at: {
    type: 'string',
    pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
    description:
      'Explicitly requested as-of time in UTC with milliseconds. Omit for current queries; do not invent a time. at cannot be combined with anchorValue or intent next.',
  },
  anchorValue: {
    type: 'string',
    minLength: 1,
    description:
      'Known previous field value, not an object ID. Only used with intent next; current queries ignore it. Omit when the question already names that value. Do not combine with at.',
  },
  scope: SCOPE_SCHEMA,
});

const CONSTRUCTION_SCOPE_SCHEMA = Object.freeze({
  type: 'object',
  description:
    'Optional declared source scope for concept navigation. Omit scope when its names are unknown; unscoped results preserve ambiguity.',
  required: ['sourceSystem'],
  properties: {
    sourceSystem: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Exact, case-sensitive declared source-system name, not an object type.',
    },
    objectType: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Optional exact, case-sensitive declared object type within the source system.',
    },
  },
  additionalProperties: false,
});

const CONSTRUCTION_QUERY_PROPERTIES = Object.freeze({
  term: { type: 'string', minLength: 1, maxLength: 256 },
  scope: CONSTRUCTION_SCOPE_SCHEMA,
  conceptId: {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
  },
  limit: { type: 'integer', minimum: 1, maximum: 64, default: 20 },
  cursor: { type: 'string', minLength: 1, maxLength: 256 },
});

const VERIFY_TOOL = Object.freeze({
  name: 'verify',
  description:
    'Verify one complete question against the named source cut. Start with only question; omit unknown optional selectors. OpenOntology searches for candidate references, resolves identity and chronology, reads every required exact source range, and returns proof-complete context or a typed refusal. It does not generate a prose answer.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: QUERY_PROPERTIES,
    additionalProperties: false,
  },
});

const SEARCH_TOOL = Object.freeze({
  name: 'search',
  description:
    'Find candidate references for one complete question. Start with only question; omit unknown optional selectors. Results are navigation only and are not evidence. Read every match marked requiredForProof before making a material claim.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: QUERY_PROPERTIES,
    additionalProperties: false,
  },
});

const READ_TOOL = Object.freeze({
  name: 'read',
  description:
    'Read one reference returned by search. Returns exact authorized source bytes, their byte anchor, a typed binding, and a receipt.',
  inputSchema: {
    type: 'object',
    required: ['ref'],
    properties: { ref: { type: 'string', pattern: '^evidence:[0-9a-f]{64}$' } },
    additionalProperties: false,
  },
});

const CONSTRUCTION_SEARCH_TOOL = Object.freeze({
  name: 'search',
  description:
    'Search either one ordinary question or one exact construction term, not both. Start with only question or term; omit unknown optional selectors. Construction results are navigation metadata only. Ambiguous concepts remain browsable but do not select an identity, prove absence, or create factual proof.',
  inputSchema: {
    type: 'object',
    oneOf: [
      {
        type: 'object',
        required: ['question'],
        properties: QUERY_PROPERTIES,
        additionalProperties: false,
      },
      {
        type: 'object',
        required: ['term'],
        properties: CONSTRUCTION_QUERY_PROPERTIES,
        additionalProperties: false,
      },
    ],
  },
});

const CONSTRUCTION_READ_TOOL = Object.freeze({
  name: 'read',
  description:
    'Read one evidence or construction reference returned by search. Construction reads return exact source bytes for navigation and do not create factual proof.',
  inputSchema: {
    type: 'object',
    required: ['ref'],
    properties: {
      ref: {
        type: 'string',
        pattern:
          '^(?:evidence:[0-9a-f]{64}|construction:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$',
      },
    },
    additionalProperties: false,
  },
});

function exactArguments(value: unknown, allowed: string[]): UnknownRecord {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as UnknownRecord)
      : fail('SOURCE_NATIVE_PRODUCT_QUERY');
  if (Object.keys(record).some((name) => !allowed.includes(name))) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  return { ...record };
}

function scopeArguments(value: unknown): SourceNativeFieldQuery | null {
  if (value === undefined) return null;
  const scope = exactArguments(value, ['sourceSystem', 'objectType', 'externalId', 'field']);
  const { sourceSystem, objectType, externalId, field } = scope;
  if (
    typeof sourceSystem !== 'string' ||
    !sourceSystem ||
    typeof objectType !== 'string' ||
    !objectType ||
    typeof field !== 'string' ||
    !field ||
    (externalId !== undefined && (typeof externalId !== 'string' || !externalId))
  ) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  return {
    sourceSystem,
    objectType,
    fieldPath: field,
    ...(externalId === undefined ? {} : { externalId }),
  };
}

function exactUtcMillisecondIso(value: unknown): value is string {
  if (typeof value !== 'string' || !EXACT_UTC_MILLISECOND_ISO.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function queryArguments(value: unknown): ProductSearchInput {
  const args = exactArguments(value, ['question', 'intent', 'at', 'anchorValue', 'scope']);
  const { question, intent: inputIntent, at, anchorValue: inputAnchorValue } = args;
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    (inputIntent !== undefined && inputIntent !== 'current' && inputIntent !== 'next') ||
    (at !== undefined && !exactUtcMillisecondIso(at)) ||
    (inputAnchorValue !== undefined && typeof inputAnchorValue !== 'string')
  ) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  const anchorValue = inputAnchorValue === undefined ? null : inputAnchorValue.trim() || null;
  if (at !== undefined && (inputIntent === 'next' || anchorValue !== null)) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  const intent = inputIntent === 'next' ? 'next' : 'current';
  return {
    question,
    intent,
    ...(at === undefined ? {} : { at }),
    anchorValue,
    typedQuery: scopeArguments(args.scope),
  };
}

function constructionText(value: unknown, maximum = 256): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.from(value).toString('utf8') !== value
  ) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  return value.trim();
}

function constructionScopeArguments(value: unknown): SourceNativeConstructionSearchInput['scope'] {
  if (value === undefined) return undefined;
  const scope = exactArguments(value, ['sourceSystem', 'objectType']);
  return {
    sourceSystem: constructionText(scope.sourceSystem),
    ...(scope.objectType === undefined ? {} : { objectType: constructionText(scope.objectType) }),
  };
}

function constructionSearchArguments(value: unknown): SourceNativeConstructionSearchInput {
  const args = exactArguments(value, ['term', 'scope', 'conceptId', 'limit', 'cursor']);
  const term = constructionText(args.term);
  const conceptId =
    args.conceptId === undefined ? undefined : constructionText(args.conceptId, 128);
  if (conceptId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(conceptId)) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  const limit =
    args.limit === undefined
      ? undefined
      : typeof args.limit === 'number'
        ? args.limit
        : fail('SOURCE_NATIVE_PRODUCT_QUERY');
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)) {
    fail('SOURCE_NATIVE_PRODUCT_QUERY');
  }
  const cursor = args.cursor === undefined ? undefined : constructionText(args.cursor);
  return {
    term,
    ...(args.scope === undefined ? {} : { scope: constructionScopeArguments(args.scope) }),
    ...(conceptId === undefined ? {} : { conceptId }),
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function constructionAdvancedSearchArguments(
  value: unknown,
): ProductSearchInput | SourceNativeConstructionSearchInput {
  const args = exactArguments(value, [
    'question',
    'intent',
    'at',
    'anchorValue',
    'scope',
    'term',
    'conceptId',
    'limit',
    'cursor',
  ]);
  const hasQuestion = Object.hasOwn(args, 'question');
  const hasTerm = Object.hasOwn(args, 'term');
  if (hasQuestion === hasTerm) fail('SOURCE_NATIVE_PRODUCT_QUERY');
  return hasTerm ? constructionSearchArguments(args) : queryArguments(args);
}

function readArguments(value: unknown, constructionProduct = false): { ref: string } {
  const args = exactArguments(value, ['ref']);
  const ref = args.ref;
  const valid =
    typeof ref === 'string' &&
    (/^evidence:[0-9a-f]{64}$/u.test(ref) ||
      (constructionProduct &&
        /^construction:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(ref)));
  if (!valid) {
    fail('SOURCE_NATIVE_PRODUCT_READ');
  }
  return { ref };
}

function result(value: unknown): UnknownRecord {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(error: unknown): UnknownRecord {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'SOURCE_NATIVE_PRODUCT_ERROR';
  return {
    isError: true,
    content: [{ type: 'text', text: code }],
  };
}

export function createSourceNativeProductMcpHandler(
  product: McpProduct,
  { profile = 'verify' }: { profile?: 'verify' | 'advanced' } = {},
) {
  const constructionProduct = product?.kind === 'OpenOntologySourceNativeConstructionProductV1';
  if (
    ![
      'OpenOntologySourceNativeProductV2',
      'OpenOntologySourceNativeAdmittedKnowledgeProductV1',
      'OpenOntologySourceNativeConstructionProductV1',
    ].includes(product?.kind) ||
    typeof product.verify !== 'function' ||
    typeof product.search !== 'function' ||
    typeof product.read !== 'function' ||
    !['verify', 'advanced'].includes(profile)
  ) {
    throw new TypeError('SOURCE_NATIVE_PRODUCT_MCP');
  }
  const tools = Object.freeze(
    profile === 'verify'
      ? [VERIFY_TOOL]
      : constructionProduct
        ? [CONSTRUCTION_SEARCH_TOOL, CONSTRUCTION_READ_TOOL]
        : [SEARCH_TOOL, READ_TOOL],
  );
  const handle = async (input: unknown): Promise<JsonRpcResponse | null> => {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      !('id' in input) ||
      input.id === undefined
    )
      return null;
    const request = input as UnknownRecord;
    const params =
      request.params && typeof request.params === 'object' && !Array.isArray(request.params)
        ? (request.params as UnknownRecord)
        : {};
    const response: JsonRpcResponse = { jsonrpc: '2.0', id: request.id };
    try {
      if (request.method === 'initialize') {
        response.result = {
          protocolVersion: params.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'openontology-source-native', version: '2' },
        };
      } else if (request.method === 'ping') {
        response.result = {};
      } else if (request.method === 'tools/list') {
        response.result = { tools };
      } else if (request.method === 'tools/call') {
        if (profile === 'verify' && params.name === 'verify') {
          response.result = result(await product.verify(queryArguments(params.arguments)));
        } else if (profile === 'advanced' && params.name === 'search') {
          response.result = result(
            await (product.kind === 'OpenOntologySourceNativeConstructionProductV1'
              ? product.search(constructionAdvancedSearchArguments(params.arguments))
              : product.search(queryArguments(params.arguments))),
          );
        } else if (profile === 'advanced' && params.name === 'read') {
          const args = readArguments(params.arguments, constructionProduct);
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
    return response;
  };
  return Object.freeze({ tools, handle });
}

export function runSourceNativeProductMcp(
  product: McpProduct,
  {
    input = process.stdin,
    output = process.stdout,
    profile = 'verify',
  }: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    profile?: 'verify' | 'advanced';
  } = {},
) {
  const handler = createSourceNativeProductMcpHandler(product, { profile });
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', async (line) => {
    if (!line.trim()) return;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    const response = await handler.handle(request);
    if (response !== null) output.write(`${JSON.stringify(response)}\n`);
  });
  return lines;
}

export const SOURCE_NATIVE_PRODUCT_TOOLS = Object.freeze({
  verify: Object.freeze([VERIFY_TOOL]),
  advanced: Object.freeze([SEARCH_TOOL, READ_TOOL]),
});
