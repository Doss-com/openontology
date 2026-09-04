/** MCP transport for the source-native verification product. */
import { createInterface } from 'node:readline';

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

function exactArguments(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((name) => !allowed.includes(name))) {
    const error = new TypeError('SOURCE_NATIVE_PRODUCT_QUERY');
    error.code = 'SOURCE_NATIVE_PRODUCT_QUERY';
    throw error;
  }
  return value;
}

function scopeArguments(value) {
  if (value === undefined) return null;
  const scope = exactArguments(value, ['sourceSystem', 'objectType', 'externalId', 'field']);
  if (typeof scope.sourceSystem !== 'string' || !scope.sourceSystem
    || typeof scope.objectType !== 'string' || !scope.objectType
    || typeof scope.field !== 'string' || !scope.field
    || scope.externalId !== undefined
      && (typeof scope.externalId !== 'string' || !scope.externalId)) {
    const error = new TypeError('SOURCE_NATIVE_PRODUCT_QUERY');
    error.code = 'SOURCE_NATIVE_PRODUCT_QUERY';
    throw error;
  }
  return {
    sourceSystem: scope.sourceSystem,
    objectType: scope.objectType,
    fieldPath: scope.field,
    ...(scope.externalId === undefined ? {} : { externalId: scope.externalId }),
  };
}

function queryArguments(value) {
  const args = exactArguments(value, ['question', 'intent', 'anchorValue', 'scope']);
  if (typeof args.question !== 'string' || !args.question.trim()
    || args.intent !== undefined && !['current', 'next'].includes(args.intent)
    || args.anchorValue !== undefined && typeof args.anchorValue !== 'string') {
    const error = new TypeError('SOURCE_NATIVE_PRODUCT_QUERY');
    error.code = 'SOURCE_NATIVE_PRODUCT_QUERY';
    throw error;
  }
  return {
    question: args.question,
    intent: args.intent ?? 'current',
    anchorValue: args.anchorValue?.trim() || null,
    typedQuery: scopeArguments(args.scope),
  };
}

function readArguments(value) {
  const args = exactArguments(value, ['ref']);
  if (typeof args.ref !== 'string' || !/^evidence:[0-9a-f]{64}$/u.test(args.ref)) {
    const error = new TypeError('SOURCE_NATIVE_PRODUCT_READ');
    error.code = 'SOURCE_NATIVE_PRODUCT_READ';
    throw error;
  }
  return args;
}

function result(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(error) {
  const code = error?.code ?? 'SOURCE_NATIVE_PRODUCT_ERROR';
  return {
    isError: true,
    content: [{ type: 'text', text: code }],
  };
}

export function runSourceNativeProductMcp(product, {
  input = process.stdin,
  output = process.stdout,
  profile = 'verify',
} = {}) {
  if (product?.kind !== 'OpenOntologySourceNativeProductV2'
    || typeof product.verify !== 'function'
    || typeof product.search !== 'function'
    || typeof product.read !== 'function'
    || !['verify', 'advanced'].includes(profile)) {
    throw new TypeError('SOURCE_NATIVE_PRODUCT_MCP');
  }
  const tools = profile === 'verify' ? [VERIFY_TOOL] : [SEARCH_TOOL, READ_TOOL];
  const send = (message) => output.write(`${JSON.stringify(message)}\n`);
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', async (line) => {
    if (!line.trim()) return;
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request.id === undefined) return;
    const response = { jsonrpc: '2.0', id: request.id };
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
