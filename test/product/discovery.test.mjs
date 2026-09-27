import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { objectBytesSha256 } from '../../dist/canonical-content.js';
import { openOntology } from '../../dist/openontology.js';
import { createSourceNativeProductMcpHandler } from '../../dist/product/mcp.js';
import {
  compileSourceNativeObjectDiscoveryInventory,
  openSourceNativeObjectDiscovery,
} from '../../dist/product/discovery.js';
import { buildSourceNativeProduct, openSourceNativeProduct } from '../../dist/product/runtime.js';
import { compileSourceNativeObjectMap } from '../../dist/source/object-map.js';

function source(relativePath, sourceType, occurredAt, content) {
  return { relativePath, sourceType, occurredAt, content };
}

function object(relativePath, sourceSystem, objectType, externalId, fields) {
  return {
    relativePath,
    objectIdentity: {
      home: 'ObjectDef/InstanceRef',
      sourceSystem,
      objectType,
      namespace: 'discovery-test',
      externalId,
    },
    fields: fields.map((fieldPath) => ({ fieldPath, value: `${externalId}-${fieldPath}` })),
  };
}

function buildInput() {
  const sources = [
    source('clickup/task-a-1.txt', 'clickup', '2026-09-01T00:00:00.000Z', 'task-a-status'),
    source('clickup/task-a-2.txt', 'clickup', '2026-09-02T00:00:00.000Z', 'task-a-title'),
    source('clickup/task-b.txt', 'clickup', '2026-09-03T00:00:00.000Z', 'task-b-title'),
    source('linear/task-a.txt', 'linear', '2026-09-04T00:00:00.000Z', 'task-a-status'),
    source('clickup/task-c.txt', 'clickup', '2026-09-05T00:00:00.000Z', 'task-c-secret'),
    source('clickup/unmapped.txt', 'clickup', '2026-09-06T00:00:00.000Z', 'unmapped-raw'),
  ];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'native-discovery-test',
    namespace: 'discovery-test',
    querySchemas: [
      {
        sourceSystem: 'clickup',
        objectType: 'task',
        aliases: ['task'],
        fields: [
          { fieldPath: 'status', aliases: ['status'] },
          { fieldPath: 'title', aliases: ['title'] },
        ],
      },
      {
        sourceSystem: 'linear',
        objectType: 'issue',
        aliases: ['issue'],
        fields: [{ fieldPath: 'status', aliases: ['status'] }],
      },
    ],
    sources,
    nativeObjectInputs: [
      object('clickup/task-a-1.txt', 'clickup', 'task', 'task-a', ['status']),
      object('clickup/task-a-2.txt', 'clickup', 'task', 'task-a', ['title']),
      object('clickup/task-b.txt', 'clickup', 'task', 'task-b', ['title']),
      object('linear/task-a.txt', 'linear', 'issue', 'task-a', ['status']),
      object('clickup/task-c.txt', 'clickup', 'task', 'task-c', ['secret']),
      object('clickup/unmapped.txt', 'clickup', 'task', 'unmapped', ['raw']),
    ],
  };
}

function buildLargeInput() {
  const input = buildInput();
  for (let index = 0; index < 70; index += 1) {
    const externalId = `task-extra-${String(index).padStart(2, '0')}`;
    const relativePath = `clickup/${externalId}.txt`;
    input.sources.push(
      source(
        relativePath,
        'clickup',
        `2026-${String(10 + Math.floor(index / 30)).padStart(2, '0')}-${String(
          (index % 30) + 1,
        ).padStart(2, '0')}T00:00:00.000Z`,
        `${externalId}-title`,
      ),
    );
    input.nativeObjectInputs.push(object(relativePath, 'clickup', 'task', externalId, ['title']));
  }
  return input;
}

function call(handler, id, name, argumentsValue) {
  return handler.handle({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: argumentsValue },
  });
}

function resultValue(response) {
  assert.notEqual(response.result?.isError, true, JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
}

function errorCode(response) {
  assert.equal(response.result?.isError, true, JSON.stringify(response));
  return response.result.content[0].text;
}

test('native object discovery groups observations and exposes only queryable fields', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'oont-native-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });

  const product = openSourceNativeProduct({ artifactRoot: root });
  const first = await product.search({ browse: 'objects', limit: 2 });
  assert.equal(first.kind, 'OpenOntologySourceNativeObjectDiscoveryResultV1');
  assert.equal(first.freshness, 'unknown');
  assert.equal(first.navigationOnly, true);
  assert.equal(first.absenceProven, false);
  assert.deepEqual(
    first.objects.map((row) => [row.objectIdentity.sourceSystem, row.objectIdentity.externalId]),
    [
      ['clickup', 'task-a'],
      ['clickup', 'task-b'],
    ],
  );
  assert.deepEqual(first.objects[0].fields, ['status', 'title']);
  assert.equal(Object.hasOwn(first.objects[0], 'ref'), false);
  assert.equal(first.coverage.sourceCount, 6);
  assert.equal(first.coverage.mappedSourceCount, 6);
  assert.equal(first.coverage.complete, true);
  assert.equal(first.sourceBinding.namespace, 'discovery-test');
  assert.equal(typeof first.sourceBinding.sourceCommitSha256, 'string');
  assert.equal(typeof first.sourceBinding.nativeObjectMapSha256, 'string');
  assert.ok(first.nextCursor);

  const second = await product.search({ browse: 'objects', limit: 2, cursor: first.nextCursor });
  assert.deepEqual(
    second.objects.map((row) => [row.objectIdentity.sourceSystem, row.objectIdentity.externalId]),
    [
      ['clickup', 'task-c'],
      ['clickup', 'unmapped'],
    ],
  );
  assert.deepEqual(second.objects[0].fields, []);
  assert.equal(second.objects[0].objectIdentity.objectType, 'task');
  const third = await product.search({ browse: 'objects', limit: 2, cursor: second.nextCursor });
  assert.deepEqual(
    third.objects.map((row) => [row.objectIdentity.sourceSystem, row.objectIdentity.externalId]),
    [['linear', 'task-a']],
  );
  const otherClient = openSourceNativeProduct({ artifactRoot: root });
  await assert.rejects(
    otherClient.search({ browse: 'objects', limit: 2, cursor: first.nextCursor }),
    { code: 'SOURCE_NATIVE_PRODUCT_DISCOVERY_CURSOR' },
  );

  const scoped = await product.search({
    browse: 'objects',
    scope: { sourceSystem: 'clickup', objectType: 'task', externalId: 'task-a' },
  });
  assert.equal(scoped.totalObjects, 1);
  assert.deepEqual(scoped.objects[0].fields, ['status', 'title']);
  assert.equal(scoped.nextCursor, null);
  assert.deepEqual(
    (await product.search({ browse: 'objects', scope: { sourceSystem: 'missing' } })).objects,
    [],
  );

  await assert.rejects(product.search({ browse: 'objects', scope: { objectType: 'task' } }), {
    code: 'SOURCE_NATIVE_PRODUCT_DISCOVERY_QUERY',
  });
  await assert.rejects(
    product.search({ browse: 'objects', scope: { sourceSystem: 'clickup', externalId: 'task-a' } }),
    { code: 'SOURCE_NATIVE_PRODUCT_DISCOVERY_QUERY' },
  );
  await assert.rejects(product.search({ browse: 'objects', limit: 65 }), {
    code: 'SOURCE_NATIVE_PRODUCT_DISCOVERY_QUERY',
  });
  await assert.rejects(
    product.search({
      browse: 'objects',
      scope: { sourceSystem: 'linear' },
      cursor: first.nextCursor,
    }),
    { code: 'SOURCE_NATIVE_PRODUCT_DISCOVERY_CURSOR_STALE' },
  );
});

test('SDK and advanced MCP route object discovery without changing ordinary search', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'oont-native-discovery-mcp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });

  const ont = openOntology({ artifactRoot: root });
  const sdkPage = await ont.search({ browse: 'objects', scope: { sourceSystem: 'linear' } });
  assert.equal(sdkPage.objects.length, 1);
  assert.equal(sdkPage.objects[0].objectIdentity.objectType, 'issue');
  const ordinary = await ont.search('What is the current status of task?');
  assert.equal(ordinary.kind, 'OpenOntologySourceNativeProductSearchResultV2');

  const product = openSourceNativeProduct({ artifactRoot: root });
  const handler = createSourceNativeProductMcpHandler(product, { profile: 'advanced' });
  const listed = await handler.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ['search', 'read'],
  );
  const browseSchema = listed.result.tools[0].inputSchema.oneOf[1];
  assert.deepEqual(browseSchema.properties.scope.required, ['sourceSystem']);
  assert.deepEqual(browseSchema.properties.scope.dependentRequired, { externalId: ['objectType'] });
  const page = resultValue(await call(handler, 2, 'search', { browse: 'objects', limit: 1 }));
  assert.equal(page.kind, 'OpenOntologySourceNativeObjectDiscoveryResultV1');
  assert.equal(page.objects.length, 1);
  assert.equal(
    errorCode(await call(handler, 3, 'search', { browse: 'objects', question: 'bad' })),
    'SOURCE_NATIVE_PRODUCT_QUERY',
  );

  const constructionHandler = createSourceNativeProductMcpHandler(
    { ...product, kind: 'OpenOntologySourceNativeConstructionProductV1' },
    { profile: 'advanced' },
  );
  assert.equal(
    errorCode(await call(constructionHandler, 4, 'search', { browse: 'objects' })),
    'SOURCE_NATIVE_PRODUCT_QUERY',
  );
});

test('MCP advertises read-only tools only when the product status confirms it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'oont-native-discovery-annotations-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
  const product = openSourceNativeProduct({ artifactRoot: root });
  const readOnly = createSourceNativeProductMcpHandler(product);
  assert.equal(readOnly.tools[0].annotations.readOnlyHint, true);

  const writable = createSourceNativeProductMcpHandler({
    kind: product.kind,
    verify: product.verify,
    search: product.search,
    read: product.read,
    status: () => ({ readOnly: false }),
  });
  assert.equal(Object.hasOwn(writable.tools[0], 'annotations'), false);

  const unknown = createSourceNativeProductMcpHandler({
    kind: product.kind,
    verify: product.verify,
    search: product.search,
    read: product.read,
  });
  assert.equal(Object.hasOwn(unknown.tools[0], 'annotations'), false);
});

test('object discovery remains navigable with a partial mapped cut and no absence authority', () => {
  const input = buildInput();
  const sources = input.sources.map((row) => ({
    ...row,
    sourceSha256: objectBytesSha256(Buffer.from(row.content)),
  }));
  const nativeObjectInputs = input.nativeObjectInputs.slice(0, -1).map((row) => ({
    ...row,
    fields: row.fields.map((field) => ({
      ...field,
      codeUnitStart: sources
        .find((source) => source.relativePath === row.relativePath)
        .content.indexOf(field.value),
    })),
  }));
  const map = compileSourceNativeObjectMap({ sources, nativeObjectInputs });
  const sha = `sha256:${'0'.repeat(64)}`;
  const descriptor = {
    ontId: 'partial-discovery-test',
    branch: 'main',
    namespace: 'discovery-test',
    artifactSha256: sha,
    querySchemas: input.querySchemas,
  };
  const objectOnt = {
    map,
    catalog: { sourceCatalogSha256: sha, sourceCount: sources.length },
    sources: [],
    commitSha256: sha,
    replaySha256: sha,
  };
  const page = openSourceNativeObjectDiscovery({
    descriptor,
    objectOnt,
    input: { browse: 'objects' },
    cursors: new Map(),
    clientId: 'partial-client',
    inventory: compileSourceNativeObjectDiscoveryInventory(descriptor, objectOnt),
  });
  assert.equal(page.coverage.sourceCount, 6);
  assert.equal(page.coverage.mappedSourceCount, 5);
  assert.equal(page.coverage.complete, false);
  assert.equal(page.absenceProven, false);
  assert.equal(page.objects.length, 4);
});

test('object discovery refuses one oversized row instead of returning zero-progress pages', () => {
  const input = buildInput();
  const sha = `sha256:${'0'.repeat(64)}`;
  const descriptor = {
    ontId: 'oversized-discovery-test',
    branch: 'main',
    namespace: 'discovery-test',
    artifactSha256: sha,
    querySchemas: input.querySchemas,
  };
  const objectOnt = {
    map: {
      sourceCount: 1,
      mappedSourceCount: 1,
      unsupportedSourceCount: 0,
      parseFailureCount: 0,
      nativeObjectMapSha256: sha,
    },
    catalog: { sourceCatalogSha256: sha, sourceCount: 1 },
    sources: [],
    commitSha256: sha,
    replaySha256: sha,
  };
  const cursors = new Map();
  const inventory = [
    {
      objectIdentity: input.nativeObjectInputs[0].objectIdentity,
      objectIdentitySha256: sha,
      fields: Array.from({ length: 40_000 }, (_, index) => `field-${index}`),
    },
  ];
  assert.throws(
    () =>
      openSourceNativeObjectDiscovery({
        descriptor,
        objectOnt,
        input: { browse: 'objects' },
        cursors,
        clientId: 'oversized-client',
        inventory,
      }),
    { code: 'SOURCE_NATIVE_PRODUCT_DISCOVERY_PAGE' },
  );
  assert.equal(cursors.size, 0);
});

test('CLI browse walks bounded SDK pages and reports aggregate truncation', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-native-discovery-cli-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildLargeInput() });
    const cli = resolve(import.meta.dirname, '..', '..', 'dist', 'cli', 'oont.js');
    const result = spawnSync(
      process.execPath,
      [cli, 'search', root, '--browse', 'objects', '--limit', '70'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.kind, 'OpenOntologyCliObjectDiscoveryResultV1');
    assert.equal(value.objects.length, 70);
    assert.equal(value.returnedObjects, 70);
    assert.equal(value.truncated, true);
    assert.equal(value.truncationReason, 'requested-limit');
    assert.equal(Object.hasOwn(value, 'nextCursor'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
