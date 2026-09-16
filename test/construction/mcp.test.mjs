import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as kernel from '../../dist/kernel.js';
import {
  createSourceNativeProductMcpHandler,
  SOURCE_NATIVE_PRODUCT_TOOLS,
} from '../../dist/product/mcp.js';

const at = (day) => `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const signature = (statement, key) =>
  sign(null, Buffer.from(kernel.stableObjectText(statement)), key).toString('base64');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oont-construction-mcp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { artifactRoot: join(root, 'ont') };
  const sources = [
    {
      relativePath: 'docs/guide.txt',
      sourceType: 'docs',
      occurredAt: at(1),
      content: 'AllocationException means inventory allocation mismatch.',
    },
    {
      relativePath: 'clickup/CT-17.txt',
      sourceType: 'clickup',
      occurredAt: at(1),
      content: 'ClickupTask CT-17: allocation mismatch. Status: open.',
    },
    {
      relativePath: 'clickup/CT-18.txt',
      sourceType: 'clickup',
      occurredAt: at(1),
      content: 'ClickupTask CT-18: allocation mismatch. Status: closed.',
    },
  ];
  const buildInput = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'construction-mcp-example',
    namespace: 'example',
    sources,
    querySchemas: [
      {
        sourceSystem: 'docs',
        objectType: 'Document',
        aliases: ['document'],
        fields: [{ fieldPath: 'body', aliases: ['body'] }],
      },
      {
        sourceSystem: 'clickup',
        objectType: 'ClickupTask',
        aliases: ['ClickupTask'],
        fields: [
          { fieldPath: 'body', aliases: ['body'] },
          { fieldPath: 'status', aliases: ['status'] },
        ],
      },
    ],
    nativeObjectInputs: sources.map((source, index) => ({
      relativePath: source.relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: source.sourceType,
        objectType: index === 0 ? 'Document' : 'ClickupTask',
        namespace: 'example',
        externalId: index === 0 ? 'guide' : `CT-${16 + index}`,
      },
      fields: [
        { fieldPath: 'body', value: source.content },
        ...(index === 0
          ? []
          : [
              {
                fieldPath: 'status',
                value: index === 1 ? 'open' : 'closed',
              },
            ]),
      ],
    })),
  };
  kernel.buildSourceNativeProduct({ ...options, input: buildInput });
  const state = kernel.openProductState(options);
  const witness = (relativePath) => {
    const object = state.objectOnt.map.nativeObjects.find(
      (item) => item.relativePath === relativePath,
    );
    const source = sources.find((item) => item.relativePath === relativePath);
    return {
      nativeObjectSha256: object.nativeObjectSha256,
      evidence: {
        sourceRef: relativePath,
        sourceSha256: object.sourceSha256,
        byteStart: 0,
        byteEnd: Buffer.byteLength(source.content),
        textSha256: object.sourceSha256,
      },
    };
  };
  const constructionInput = {
    proposedBy: 'constructor',
    proposedAt: at(2),
    method: 'authored',
    objectDefs: [
      {
        kind: 'ObjectDef',
        id: 'allocation-exception',
        name: 'AllocationException',
        source: witness('docs/guide.txt'),
        aliases: [
          {
            value: 'allocation mismatch',
            sourceSystem: 'clickup',
            source: witness('clickup/CT-17.txt'),
          },
        ],
      },
    ],
    claims: [
      {
        kind: 'Claim',
        id: 'definition',
        about: 'allocation-exception',
        predicate: 'defines',
        source: witness('docs/guide.txt'),
      },
      ...sources.slice(1).map((source, index) => ({
        kind: 'Claim',
        id: `mention-${index}`,
        about: 'allocation-exception',
        predicate: 'mentions',
        source: witness(source.relativePath),
      })),
    ],
    coverage: state.objectOnt.sources.map((source) => ({
      sourceRef: source.relativePath,
      sourceSha256: source.sourceSha256,
      disposition: 'examined',
    })),
  };
  const keys = {
    constructor: generateKeyPairSync('ed25519'),
    reviewer: generateKeyPairSync('ed25519'),
  };
  const trustRegistry = [
    {
      issuerId: 'constructor',
      publicKeyPem: keys.constructor.publicKey.export({ type: 'spki', format: 'pem' }),
      roles: ['proposer'],
    },
    {
      issuerId: 'reviewer',
      publicKeyPem: keys.reviewer.publicKey.export({ type: 'spki', format: 'pem' }),
      roles: ['reviewer'],
    },
  ];
  const construction = kernel.compileSourceNativeSemanticConstruction({
    options,
    input: constructionInput,
  });
  const proposalStatement = kernel.sourceNativeConstructionProposalStatement({ construction });
  const statement = kernel.sourceNativeConstructionAdmissionStatement({
    construction,
    issuerId: 'reviewer',
    admittedAt: at(3),
    supersedesRecordSha256s: [],
  });
  const record = kernel.compileSourceNativeConstructionAdmissionRecord({
    construction,
    proposalStatement,
    statement,
    proposalSignatureBase64: signature(proposalStatement, keys.constructor.privateKey),
    signatureBase64: signature(statement, keys.reviewer.privateKey),
  });
  kernel.writeSourceNativeConstructionAdmission({ options, trustRegistry, record });
  const product = kernel.openSourceNativeProductWithConstruction(options, { trustRegistry });
  return { product, options, trustRegistry };
}

async function call(handler, id, name, argumentsValue) {
  return handler.handle({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: argumentsValue },
  });
}

function resultValue(response) {
  assert.equal(response.result.isError, undefined);
  return JSON.parse(response.result.content[0].text);
}

function errorCode(response) {
  assert.equal(response.result.isError, true);
  return response.result.content[0].text;
}

test('construction advanced MCP forwards navigation and ordinary operations through one client', async (t) => {
  const fixtureState = fixture(t);
  const { product } = fixtureState;
  const handler = createSourceNativeProductMcpHandler(product, { profile: 'advanced' });
  const listed = await handler.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ['search', 'read'],
  );
  assert.equal(listed.result.tools[0].inputSchema.type, 'object');
  assert.equal(listed.result.tools[0].inputSchema.oneOf.length, 2);
  assert.deepEqual(
    listed.result.tools[0].inputSchema.oneOf.map((schema) => schema.required),
    [['question'], ['term']],
  );
  assert.match(listed.result.tools[1].inputSchema.properties.ref.pattern, /construction:/u);

  const constructionSearch = resultValue(
    await call(handler, 2, 'search', {
      term: 'allocation mismatch',
      scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' },
      limit: 1,
    }),
  );
  assert.equal(constructionSearch.kind, 'OpenOntologyConstructionSearchResultV1');
  assert.equal(constructionSearch.state, 'resolved-construction-navigation');
  assert.equal(constructionSearch.matches.length, 1);
  assert.equal(constructionSearch.matches[0].requiredForProof, false);
  assert.equal('exactText' in constructionSearch.matches[0], false);
  assert.equal(constructionSearch.policy.navigationOnly, true);
  assert.equal(constructionSearch.policy.exactReadRequired, true);
  const selected = constructionSearch.matches[0];
  const constructionRead = resultValue(await call(handler, 3, 'read', { ref: selected.ref }));
  assert.equal(constructionRead.kind, 'OpenOntologyConstructionReadResultV1');
  assert.equal(constructionRead.exactText, 'ClickupTask CT-17: allocation mismatch. Status: open.');
  assert.equal(constructionRead.binding.navigationOnly, true);
  assert.equal(constructionRead.binding.exactSourcesRemainAuthority, true);

  const secondProduct = kernel.openSourceNativeProductWithConstruction(fixtureState.options, {
    trustRegistry: fixtureState.trustRegistry,
  });
  const secondHandler = createSourceNativeProductMcpHandler(secondProduct, { profile: 'advanced' });
  const secondSearch = resultValue(
    await call(secondHandler, 30, 'search', {
      term: 'allocation mismatch',
      scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' },
      limit: 1,
    }),
  );
  const secondRef = secondSearch.matches[0].ref;
  assert.equal(
    resultValue(await call(secondHandler, 31, 'read', { ref: secondRef })).kind,
    'OpenOntologyConstructionReadResultV1',
  );
  assert.equal(
    errorCode(await call(handler, 32, 'read', { ref: secondRef })),
    'CONSTRUCTION_NAVIGATION_REFERENCE',
  );

  const ordinaryQuery = {
    question: 'What is the current status for CT-17?',
    scope: {
      sourceSystem: 'clickup',
      objectType: 'ClickupTask',
      externalId: 'CT-17',
      field: 'status',
    },
  };
  const ordinarySearch = resultValue(await call(handler, 4, 'search', ordinaryQuery));
  assert.equal(ordinarySearch.kind, 'OpenOntologySourceNativeProductSearchResultV2');
  assert.equal(ordinarySearch.matches[0].requiredForProof, true);
  const ordinaryRead = resultValue(
    await call(handler, 5, 'read', {
      ref: ordinarySearch.matches[0].ref,
    }),
  );
  assert.equal(ordinaryRead.exactText, 'open');

  const verifyHandler = createSourceNativeProductMcpHandler(product, { profile: 'verify' });
  const verifyTools = await verifyHandler.handle({ jsonrpc: '2.0', id: 6, method: 'tools/list' });
  assert.deepEqual(
    verifyTools.result.tools.map((tool) => tool.name),
    ['verify'],
  );
  const verification = resultValue(await call(verifyHandler, 7, 'verify', ordinaryQuery));
  assert.equal(verification.answerable, true);
  assert.equal(verification.context[0].exactText, 'open');

  const unbound = resultValue(
    await call(verifyHandler, 8, 'verify', {
      question: 'What is the current status?',
      scope: { sourceSystem: 'clickup', objectType: 'ClickupTask', field: 'status' },
    }),
  );
  assert.equal(unbound.answerable, false);
  assert.equal(unbound.context.length, 0);
  assert.equal(
    errorCode(
      await call(verifyHandler, 9, 'verify', {
        term: 'allocation mismatch',
      }),
    ),
    'SOURCE_NATIVE_PRODUCT_QUERY',
  );
});

test('construction MCP rejects mixed, invalid and foreign inputs without changing ordinary clients', async (t) => {
  const { product } = fixture(t);
  const constructionHandler = createSourceNativeProductMcpHandler(product, { profile: 'advanced' });
  for (const argumentsValue of [
    { term: 'allocation mismatch', scope: { objectType: 'ClickupTask' } },
    { term: 'allocation mismatch', scope: null },
    { term: 'allocation mismatch', extra: true },
    { term: 'allocation mismatch', question: 'What is true?' },
    { term: '', limit: 0 },
    { term: 'allocation mismatch', limit: 65 },
    { term: 'allocation mismatch', limit: 1.5 },
    { term: 'allocation mismatch', conceptId: '../other' },
  ]) {
    assert.equal(
      errorCode(await call(constructionHandler, randomUUID(), 'search', argumentsValue)),
      'SOURCE_NATIVE_PRODUCT_QUERY',
    );
  }
  assert.equal(
    errorCode(
      await call(constructionHandler, 20, 'verify', {
        question: 'What is true?',
      }),
    ),
    'SOURCE_NATIVE_PRODUCT_TOOL_NOT_FOUND',
  );
  assert.equal(
    errorCode(
      await call(constructionHandler, 21, 'read', {
        ref: `construction:${randomUUID()}`,
      }),
    ),
    'CONSTRUCTION_NAVIGATION_REFERENCE',
  );
  const offered = resultValue(
    await call(constructionHandler, 24, 'search', {
      term: 'allocation mismatch',
      scope: { sourceSystem: 'clickup' },
      limit: 1,
    }),
  ).matches[0].ref;
  assert.equal(
    errorCode(
      await call(constructionHandler, 25, 'read', {
        ref: offered,
        extra: true,
      }),
    ),
    'SOURCE_NATIVE_PRODUCT_QUERY',
  );

  const ordinary = createSourceNativeProductMcpHandler(
    {
      ...product,
      kind: 'OpenOntologySourceNativeAdmittedKnowledgeProductV1',
    },
    { profile: 'advanced' },
  );
  assert.deepEqual(
    ordinary.tools.map((tool) => tool.name),
    ['search', 'read'],
  );
  assert.equal(
    errorCode(
      await call(ordinary, 22, 'search', {
        term: 'allocation mismatch',
      }),
    ),
    'SOURCE_NATIVE_PRODUCT_QUERY',
  );
  assert.equal(
    errorCode(
      await call(ordinary, 23, 'read', {
        ref: `construction:${randomUUID()}`,
      }),
    ),
    'SOURCE_NATIVE_PRODUCT_READ',
  );
  assert.deepEqual(
    SOURCE_NATIVE_PRODUCT_TOOLS.advanced.map((tool) => tool.name),
    ['search', 'read'],
  );
  assert.deepEqual(SOURCE_NATIVE_PRODUCT_TOOLS.advanced[0].inputSchema.required, ['question']);
  assert.equal(
    SOURCE_NATIVE_PRODUCT_TOOLS.advanced[1].inputSchema.properties.ref.pattern,
    '^evidence:[0-9a-f]{64}$',
  );
});
