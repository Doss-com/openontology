import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { openCanonicalObjectBackend } from '../../dist/storage/canonical-backend.js';
import { stableObjectSha256, stableObjectText } from '../../dist/canonical-content.js';
import { openObjectOntStore } from '../../dist/storage/ont-store.js';
import {
  bindSourceNativeProductResource,
  createSourceNativeProductResource,
  openExactProductArtifactState,
  validateSourceNativeProductResource,
} from '../../dist/source/artifact.js';
import { buildSourceNativeProduct, openSourceNativeProduct } from '../../dist/product/runtime.js';
import {
  openSourceNativeObjectOntIndex,
  openSourceNativeObjectOntRefIndex,
} from '../../dist/source/object-ont.js';

function input(values = ['Alpha', 'Beta']) {
  const rows = values.map((value, index) => ({
    relativePath: `clickup/acme/rev-${index + 1}.md`,
    occurredAt: `2026-0${index + 1}-01T00:00:00.000Z`,
    content: value,
  }));
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'stable-resource-fixture',
    namespace: 'acme',
    querySchemas: [
      {
        sourceSystem: 'clickup',
        objectType: 'task',
        aliases: ['task'],
        fields: [{ fieldPath: 'title', aliases: ['title'] }],
      },
    ],
    sources: rows.map((row) => ({
      relativePath: row.relativePath,
      sourceType: 'clickup',
      occurredAt: row.occurredAt,
      content: row.content,
    })),
    nativeObjectInputs: rows.map((row) => ({
      relativePath: row.relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'task',
        namespace: 'acme',
        externalId: 'task-1',
      },
      fields: [{ fieldPath: 'title', value: row.content }],
    })),
  };
}

function anchoredInput({
  status = 'open',
  witnessText = 'source document one',
  includeWitness = true,
  includeDocumentObject = false,
  includeFuture = false,
  includeUnanchored = false,
  queryFields = ['status'],
  occurredAt = '2026-01-01T00:00:00.000Z',
} = {}) {
  const content =
    `title:Alpha;status:${status};source:${witnessText}` +
    (includeFuture ? ';future:future-value' : '') +
    (includeUnanchored ? ';unanchored:unanchored-value' : '');
  const fields = [
    { fieldPath: 'title', value: 'title:Alpha' },
    { fieldPath: 'status', value: `status:${status}` },
  ];
  if (includeWitness) fields.push({ fieldPath: 'sourceText', value: content });
  if (includeFuture) fields.push({ fieldPath: 'futureField', value: 'future-value' });
  if (includeUnanchored) fields.push({ fieldPath: 'unanchoredField', value: 'unanchored-value' });
  const nativeObjectInputs = [
    {
      relativePath: 'clickup/acme/task-1.md',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'task',
        namespace: 'acme',
        externalId: 'task-1',
      },
      fields,
    },
  ];
  if (includeDocumentObject)
    nativeObjectInputs.push({
      relativePath: 'clickup/acme/task-1.md',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'source-document',
        namespace: 'acme',
        externalId: 'doc-1',
      },
      fields: [{ fieldPath: 'sourceText', value: content }],
    });
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'anchored-resource-fixture',
    namespace: 'acme',
    querySchemas: [
      {
        sourceSystem: 'clickup',
        objectType: 'task',
        aliases: ['task'],
        fields: queryFields.map((fieldPath) => ({ fieldPath, aliases: [fieldPath] })),
      },
    ],
    sources: [
      {
        relativePath: 'clickup/acme/task-1.md',
        sourceType: 'clickup',
        occurredAt,
        content,
      },
    ],
    nativeObjectInputs,
  };
}

async function currentValue(artifactRoot) {
  const product = openSourceNativeProduct({ artifactRoot });
  const result = await product.verify({
    question: 'What is the current title of task-1?',
    typedQuery: {
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'task-1',
      fieldPath: 'title',
    },
  });
  assert.equal(result.answerable, true);
  return result.context[0].exactText;
}

async function verifiedFieldValue(artifactRoot, fieldPath) {
  const product = openSourceNativeProduct({ artifactRoot });
  const result = await product.verify({
    question: `What is the current ${fieldPath} of task-1?`,
    typedQuery: {
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'task-1',
      fieldPath,
    },
  });
  assert.equal(result.answerable, true);
  return result.context[0].exactText;
}

async function unavailableField(artifactRoot, fieldPath) {
  return unavailableTypedField(artifactRoot, 'task', fieldPath, 'task-1');
}

async function unavailableTypedField(artifactRoot, objectType, fieldPath, externalId) {
  const product = openSourceNativeProduct({ artifactRoot });
  return product.search({
    question: `What is the current ${fieldPath} of ${externalId}?`,
    typedQuery: {
      sourceSystem: 'clickup',
      objectType,
      externalId,
      fieldPath,
    },
  });
}

function rewriteResource(resourceRoot, mutate) {
  const path = join(resourceRoot, 'source-native-resource.json');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  const { resourceSha256: _resourceSha256, ...core } = value;
  writeFileSync(
    path,
    `${stableObjectText({
      ...core,
      resourceSha256: stableObjectSha256(core),
    })}\n`,
  );
}

function removeBlobObject(backendUri, descriptor) {
  rmSync(blobObjectPath(backendUri, descriptor));
}

function blobObjectPath(backendUri, descriptor) {
  const keyHash = createHash('sha256').update(descriptor.key).digest('hex');
  return join(
    fileURLToPath(new URL(backendUri)),
    'objects',
    keyHash.slice(0, 2),
    `${keyHash.slice(2)}.json`,
  );
}

test('keeps query schemas narrow while allowing anchored witness fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-witness-'));
  try {
    const artifactRoot = join(root, 'artifact');
    const resourceRoot = join(root, 'resource');
    const content = 'Alpha open source-text task-1';
    const builtInput = input();
    builtInput.sources = [
      {
        relativePath: 'clickup/acme/rev-1.md',
        sourceType: 'clickup',
        occurredAt: '2026-01-01T00:00:00.000Z',
        content,
      },
    ];
    builtInput.nativeObjectInputs = [
      {
        relativePath: 'clickup/acme/rev-1.md',
        objectIdentity: {
          home: 'ObjectDef/InstanceRef',
          sourceSystem: 'clickup',
          objectType: 'task',
          namespace: 'acme',
          externalId: 'task-1',
        },
        fields: [
          { fieldPath: 'title', value: 'Alpha' },
          { fieldPath: 'status', value: 'open' },
          { fieldPath: 'sourceText', value: content },
        ],
      },
    ];
    builtInput.querySchemas = [
      {
        sourceSystem: 'clickup',
        objectType: 'task',
        aliases: ['task'],
        fields: [{ fieldPath: 'status', aliases: ['status'] }],
      },
    ];
    buildSourceNativeProduct({ artifactRoot, input: builtInput });
    assert.equal(await verifiedFieldValue(artifactRoot, 'status'), 'open');
    const resource = createSourceNativeProductResource({ artifactRoot, resourceRoot });
    assert.equal(resource.replayed, false);
    const resourceValue = JSON.parse(
      readFileSync(join(resourceRoot, 'source-native-resource.json'), 'utf8'),
    );
    assert.deepEqual(resourceValue.querySchemas, builtInput.querySchemas);
    assert.equal(JSON.stringify(resourceValue.querySchemas).includes('sourceText'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps anchored witness shape fixed across changed, removed, and reintroduced cuts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-witness-cuts-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    const initial = buildSourceNativeProduct({
      artifactRoot: initialRoot,
      input: anchoredInput(),
    });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
    assert.equal(
      (await unavailableField(initialRoot, 'sourceText')).state,
      'unavailable-native-field-not-declared',
    );

    const changed = buildSourceNativeProduct({
      artifactRoot: join(root, 'changed'),
      input: anchoredInput({
        status: 'closed',
        witnessText: 'source document two',
        occurredAt: '2026-02-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    const changedBound = join(root, 'changed-bound');
    bindSourceNativeProductResource({ resourceRoot, artifactRoot: changedBound });
    assert.equal(await verifiedFieldValue(changedBound, 'status'), 'status:closed');
    assert.equal(
      (await unavailableField(changedBound, 'sourceText')).state,
      'unavailable-native-field-not-declared',
    );

    const removed = buildSourceNativeProduct({
      artifactRoot: join(root, 'removed'),
      input: anchoredInput({
        status: 'triaged',
        includeWitness: false,
        occurredAt: '2026-03-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    assert.notEqual(removed.receipt.commitSha256, changed.receipt.commitSha256);
    const removedBound = join(root, 'removed-bound');
    bindSourceNativeProductResource({ resourceRoot, artifactRoot: removedBound });
    assert.equal(await verifiedFieldValue(removedBound, 'status'), 'status:triaged');

    const reintroduced = buildSourceNativeProduct({
      artifactRoot: join(root, 'reintroduced'),
      input: anchoredInput({
        status: 'done',
        witnessText: 'source document three',
        occurredAt: '2026-04-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    assert.notEqual(reintroduced.receipt.commitSha256, removed.receipt.commitSha256);
    const reintroducedBound = join(root, 'reintroduced-bound');
    bindSourceNativeProductResource({ resourceRoot, artifactRoot: reintroducedBound });
    assert.equal(await verifiedFieldValue(reintroducedBound, 'status'), 'status:done');
    assert.equal(
      (await unavailableField(reintroducedBound, 'sourceText')).state,
      'unavailable-native-field-not-declared',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps an evidence-only source-document object outside the query surface', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-document-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    const assertUnavailable = async (artifactRoot) => {
      const result = await unavailableTypedField(
        artifactRoot,
        'source-document',
        'sourceText',
        'doc-1',
      );
      assert.match(result.state, /^unavailable-/u);
      assert.deepEqual(result.matches, []);
    };
    buildSourceNativeProduct({
      artifactRoot: initialRoot,
      input: anchoredInput({ includeWitness: false, includeDocumentObject: true }),
    });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
    await assertUnavailable(initialRoot);

    const changed = join(root, 'changed');
    buildSourceNativeProduct({
      artifactRoot: changed,
      input: anchoredInput({
        status: 'closed',
        witnessText: 'source document two',
        includeWitness: false,
        includeDocumentObject: true,
        occurredAt: '2026-02-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    const changedBound = join(root, 'changed-bound');
    bindSourceNativeProductResource({ resourceRoot, artifactRoot: changedBound });
    await assertUnavailable(changedBound);

    const removed = join(root, 'removed');
    buildSourceNativeProduct({
      artifactRoot: removed,
      input: anchoredInput({
        status: 'triaged',
        includeWitness: false,
        includeDocumentObject: false,
        occurredAt: '2026-03-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    const removedBound = join(root, 'removed-bound');
    bindSourceNativeProductResource({ resourceRoot, artifactRoot: removedBound });
    await assertUnavailable(removedBound);

    const reintroduced = join(root, 'reintroduced');
    buildSourceNativeProduct({
      artifactRoot: reintroduced,
      input: anchoredInput({
        status: 'done',
        witnessText: 'source document three',
        includeWitness: false,
        includeDocumentObject: true,
        occurredAt: '2026-04-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    const reintroducedBound = join(root, 'reintroduced-bound');
    bindSourceNativeProductResource({ resourceRoot, artifactRoot: reintroducedBound });
    await assertUnavailable(reintroducedBound);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('permits declared future fields but not an unanchored intermediate shape', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-future-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    const initial = buildSourceNativeProduct({
      artifactRoot: initialRoot,
      input: anchoredInput({ queryFields: ['status', 'futureField'], includeFuture: false }),
    });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
    const declared = buildSourceNativeProduct({
      artifactRoot: join(root, 'declared'),
      input: anchoredInput({
        queryFields: ['status', 'futureField'],
        includeFuture: true,
        occurredAt: '2026-02-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    const declaredBound = join(root, 'declared-bound');
    bindSourceNativeProductResource({ resourceRoot, artifactRoot: declaredBound });
    assert.notEqual(declared.receipt.commitSha256, initial.receipt.commitSha256);
    assert.equal(await verifiedFieldValue(declaredBound, 'futureField'), 'future-value');

    const intermediate = buildSourceNativeProduct({
      artifactRoot: join(root, 'intermediate'),
      input: anchoredInput({
        includeFuture: false,
        includeUnanchored: true,
        occurredAt: '2026-03-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    const intermediateTarget = join(root, 'intermediate-bound');
    assert.throws(
      () =>
        bindSourceNativeProductResource({
          resourceRoot,
          artifactRoot: intermediateTarget,
        }),
      { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE_PROFILE' },
    );
    assert.equal(existsSync(join(intermediateTarget, 'source-native.json')), false);
    assert.notEqual(intermediate.receipt.commitSha256, declared.receipt.commitSha256);

    const later = buildSourceNativeProduct({
      artifactRoot: join(root, 'later'),
      input: anchoredInput({
        occurredAt: '2026-04-01T00:00:00.000Z',
      }),
      objectBackendUri: backendUri,
    });
    bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: join(root, 'later-bound'),
      expectedSourceCommitSha256: later.receipt.commitSha256,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds protected V2 resources and refuses missing protected history', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-v2-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    const historyRoot = join(root, 'history');
    const historyBackendUri = pathToFileURL(historyRoot).href;
    buildSourceNativeProduct({
      artifactRoot: initialRoot,
      input: anchoredInput(),
      objectBackendUri: backendUri,
      historyBackendUri,
    });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
    const resourceValue = JSON.parse(
      readFileSync(join(resourceRoot, 'source-native-resource.json'), 'utf8'),
    );
    assert.equal(resourceValue.schemaVersion, 2);
    assert.equal(resourceValue.historyBackend, historyBackendUri);
    buildSourceNativeProduct({
      artifactRoot: join(root, 'successor'),
      input: anchoredInput({ status: 'closed', occurredAt: '2026-02-01T00:00:00.000Z' }),
      objectBackendUri: backendUri,
      historyBackendUri,
    });
    bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: join(root, 'bound'),
    });
    rmSync(historyRoot, { recursive: true, force: true });
    const missingHistoryTarget = join(root, 'missing-history');
    assert.throws(
      () =>
        bindSourceNativeProductResource({
          resourceRoot,
          artifactRoot: missingHistoryTarget,
        }),
      { code: 'OBJECT_ONT_HISTORY_MISSING' },
    );
    assert.equal(existsSync(join(missingHistoryTarget, 'source-native.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates anchor and successor indexes without hydrating source packs', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-index-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    const initial = buildSourceNativeProduct({
      artifactRoot: initialRoot,
      input: anchoredInput(),
    });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
    const successor = buildSourceNativeProduct({
      artifactRoot: join(root, 'successor'),
      input: anchoredInput({ status: 'closed', occurredAt: '2026-02-01T00:00:00.000Z' }),
      objectBackendUri: backendUri,
    });
    const backend = openCanonicalObjectBackend({ uri: backendUri }).backend;
    const store = openObjectOntStore({ backend });
    const anchorCommit = store.readCommit(initial.receipt.commitSha256).commit;
    const anchorPack = anchorCommit.blobs.find((blob) =>
      blob.logicalPath.includes('/source-packs/'),
    );
    assert.ok(anchorPack);
    const reads = [];
    const instrumented = {
      ...backend,
      get(key, ...args) {
        reads.push(key);
        return backend.get(key, ...args);
      },
    };
    openSourceNativeObjectOntIndex({
      backend: instrumented,
      ontId: initial.receipt.ontId,
      commitSha256: initial.receipt.commitSha256,
    });
    openSourceNativeObjectOntRefIndex({
      backend: instrumented,
      ontId: initial.receipt.ontId,
      branch: 'main',
    });
    assert.equal(reads.filter((key) => key.includes('/source-packs/')).length, 0);
    removeBlobObject(backendUri, anchorPack);
    bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: join(root, 'index-only-bound'),
      expectedSourceCommitSha256: successor.receipt.commitSha256,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds a successor from a cold Node process', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-cold-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    buildSourceNativeProduct({ artifactRoot: initialRoot, input: anchoredInput() });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
    const successor = buildSourceNativeProduct({
      artifactRoot: join(root, 'successor'),
      input: anchoredInput({ status: 'closed', occurredAt: '2026-02-01T00:00:00.000Z' }),
      objectBackendUri: backendUri,
    });
    const target = join(root, 'cold-bound');
    const moduleUrl = pathToFileURL(
      join(import.meta.dirname, '..', '..', 'dist', 'source', 'artifact.js'),
    ).href;
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          'const { bindSourceNativeProductResource } = await import(process.argv[1]);',
          'const result = bindSourceNativeProductResource({ resourceRoot: process.argv[2], artifactRoot: process.argv[3], expectedSourceCommitSha256: process.argv[4] });',
          'process.stdout.write(JSON.stringify(result));',
        ].join('\n'),
        moduleUrl,
        resourceRoot,
        target,
        successor.receipt.commitSha256,
      ],
      {
        cwd: join(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      },
    );
    const binding = JSON.parse(output);
    assert.equal(binding.sourceCommitSha256, successor.receipt.commitSha256);
    assert.equal(existsSync(join(target, 'source-native.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing or altered immutable anchor data before writing a descriptor', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-anchor-'));
  try {
    for (const mode of ['missing', 'altered']) {
      const initialRoot = join(root, mode, 'initial');
      const resourceRoot = join(root, mode, 'resource');
      const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
      const initial = buildSourceNativeProduct({
        artifactRoot: initialRoot,
        input: anchoredInput(),
      });
      createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
      buildSourceNativeProduct({
        artifactRoot: join(root, mode, 'successor'),
        input: anchoredInput({ status: 'closed', occurredAt: '2026-02-01T00:00:00.000Z' }),
        objectBackendUri: backendUri,
      });
      const backend = openCanonicalObjectBackend({ uri: backendUri }).backend;
      const store = openObjectOntStore({ backend });
      const anchorCommit = store.readCommit(initial.receipt.commitSha256).commit;
      const anchorMap = anchorCommit.blobs.find((blob) => blob.logicalPath.includes('/maps/'));
      assert.ok(anchorMap);
      const mapPath = blobObjectPath(backendUri, anchorMap);
      if (mode === 'missing') rmSync(mapPath);
      else {
        const bytes = readFileSync(mapPath);
        bytes[bytes.length - 1] ^= 1;
        writeFileSync(mapPath, bytes);
      }
      const target = join(root, mode, 'bound');
      assert.throws(
        () =>
          bindSourceNativeProductResource({
            resourceRoot,
            artifactRoot: target,
          }),
        { code: mode === 'missing' ? 'OBJECT_BACKEND_NOT_FOUND' : 'OBJECT_BACKEND_CORRUPT' },
      );
      assert.equal(existsSync(join(target, 'source-native.json')), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates, advances, binds, and exact-opens stable source cuts', async () => {
  assert.throws(() => validateSourceNativeProductResource([]), {
    code: 'SOURCE_NATIVE_PRODUCT_RESOURCE',
  });
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const boundA = join(root, 'bound-a');
    const boundB = join(root, 'bound-b');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    const first = buildSourceNativeProduct({ artifactRoot: initialRoot, input: input() });
    const created = createSourceNativeProductResource({
      artifactRoot: initialRoot,
      resourceRoot,
    });
    assert.equal(created.replayed, false);
    assert.equal(created.objectBackend, backendUri);
    assert.equal(
      createSourceNativeProductResource({
        artifactRoot: initialRoot,
        resourceRoot,
      }).replayed,
      true,
    );
    const resourceValue = JSON.parse(
      readFileSync(join(resourceRoot, 'source-native-resource.json'), 'utf8'),
    );
    assert.deepEqual(Object.keys(resourceValue).sort(), [
      'branch',
      'canonicalTruthMutation',
      'exactSourcesRemainAuthority',
      'kind',
      'namespace',
      'objectBackend',
      'ontId',
      'querySchemas',
      'readOnly',
      'resourceSha256',
      'schemaVersion',
      'sourceHistoryAnchorCommitSha256',
    ]);
    assert.equal(resourceValue.sourceHistoryAnchorCommitSha256, first.receipt.commitSha256);
    assert.equal(Object.hasOwn(resourceValue, 'sourceCommitSha256'), false);

    const firstBinding = bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: boundA,
      expectedSourceCommitSha256: first.receipt.commitSha256,
    });
    assert.equal(firstBinding.replayed, false);
    assert.equal(firstBinding.replayMetadataSource, 'checkpoint');
    assert.match(firstBinding.replayIndexCheckpointSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(firstBinding.replayIndexCheckpointByteLength > 0);
    assert.equal(await currentValue(boundA), 'Beta');

    const second = buildSourceNativeProduct({
      artifactRoot: join(root, 'successor'),
      input: input(['Alpha', 'Beta', 'Gamma']),
      objectBackendUri: backendUri,
    });
    assert.notEqual(second.receipt.commitSha256, first.receipt.commitSha256);
    const successorBackend = openCanonicalObjectBackend({ uri: backendUri }).backend;
    const successorStore = openObjectOntStore({ backend: successorBackend });
    const successorCommit = successorStore.readCommit(second.receipt.commitSha256).commit;
    const successorPack = successorCommit.blobs.find((blob) =>
      blob.logicalPath.includes('/source-packs/'),
    );
    assert.ok(successorPack);
    const successorPackBytes = successorBackend.get(successorPack.key).bytes;
    const successorPackKeyHash = createHash('sha256').update(successorPack.key).digest('hex');
    const successorPackPath = join(
      fileURLToPath(new URL(backendUri)),
      'objects',
      successorPackKeyHash.slice(0, 2),
      `${successorPackKeyHash.slice(2)}.json`,
    );
    rmSync(successorPackPath);
    assert.throws(() => openSourceNativeProduct({ artifactRoot: boundA }), {
      code: 'SOURCE_NATIVE_PRODUCT_REF',
    });
    successorBackend.putIfAbsent(successorPack.key, successorPackBytes);
    const exact = openExactProductArtifactState({ artifactRoot: boundA });
    assert.equal(exact.replayMetadataSource, 'checkpoint');
    assert.equal(exact.objectOnt.sources.at(-1).content, 'Beta');

    const boundABytes = readFileSync(join(boundA, 'source-native.json'));
    assert.throws(
      () =>
        bindSourceNativeProductResource({
          resourceRoot,
          artifactRoot: boundA,
          expectedSourceCommitSha256: second.receipt.commitSha256,
        }),
      { code: 'SOURCE_NATIVE_PRODUCT_ARTIFACT_CONFLICT' },
    );
    assert.equal(readFileSync(join(boundA, 'source-native.json')).equals(boundABytes), true);

    const secondBinding = bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: boundB,
      expectedSourceCommitSha256: second.receipt.commitSha256,
    });
    assert.equal(secondBinding.replayed, false);
    assert.equal(await currentValue(boundB), 'Gamma');
    assert.equal(
      bindSourceNativeProductResource({
        resourceRoot,
        artifactRoot: boundB,
        expectedSourceCommitSha256: second.receipt.commitSha256,
      }).replayed,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a current-version source rewind before a cold bind can serve it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-continuity-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    const first = buildSourceNativeProduct({ artifactRoot: initialRoot, input: input() });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
    const second = buildSourceNativeProduct({
      artifactRoot: join(root, 'successor'),
      input: input(['Alpha', 'Beta', 'Gamma']),
      objectBackendUri: backendUri,
    });
    const backend = openCanonicalObjectBackend({ uri: backendUri }).backend;
    const store = openObjectOntStore({ backend });
    const current = store.readRefMetadata({ ontId: first.receipt.ontId, branch: 'main' });
    assert.equal(current.ref.commitSha256, second.receipt.commitSha256);
    assert.throws(
      () =>
        store.compareAndSwapRefMetadata({
          ontId: first.receipt.ontId,
          branch: 'main',
          expectedVersion: current.version,
          commitSha256: first.receipt.commitSha256,
        }),
      { code: 'OBJECT_ONT_REF_ROLLBACK' },
    );
    const coldRoot = join(root, 'cold');
    const binding = bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: coldRoot,
    });
    assert.equal(binding.sourceCommitSha256, second.receipt.commitSha256);
    assert.equal(await currentValue(coldRoot), 'Gamma');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects profile expansion and identity drift before binding output', () => {
  for (const drift of ['field', 'namespace', 'source-system', 'object-type']) {
    const root = mkdtempSync(join(tmpdir(), `oont-source-native-resource-${drift}-`));
    try {
      const initialRoot = join(root, 'initial');
      const resourceRoot = join(root, 'resource');
      const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
      buildSourceNativeProduct({ artifactRoot: initialRoot, input: input() });
      createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });
      const changed = input(['Alpha', 'Beta', 'Gamma']);
      if (drift === 'field') {
        changed.sources.forEach((source, index) => {
          source.content += ` owner-${index + 1}`;
          changed.nativeObjectInputs[index].fields.push({
            fieldPath: 'owner',
            value: `owner-${index + 1}`,
          });
        });
      } else if (drift === 'namespace') {
        changed.namespace = 'other';
        changed.nativeObjectInputs.forEach((object) => {
          object.objectIdentity.namespace = 'other';
        });
      } else if (drift === 'source-system') {
        changed.querySchemas[0].sourceSystem = 'linear';
        changed.nativeObjectInputs.forEach((object) => {
          object.objectIdentity.sourceSystem = 'linear';
        });
      } else {
        changed.querySchemas[0].objectType = 'issue';
        changed.nativeObjectInputs.forEach((object) => {
          object.objectIdentity.objectType = 'issue';
        });
      }
      buildSourceNativeProduct({
        artifactRoot: join(root, 'drifted'),
        input: changed,
        objectBackendUri: backendUri,
      });
      const target = join(root, 'target');
      assert.throws(
        () =>
          bindSourceNativeProductResource({
            resourceRoot,
            artifactRoot: target,
          }),
        { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE_PROFILE' },
        drift,
      );
      assert.equal(existsSync(join(target, 'source-native.json')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('rejects tampering, backend identity changes, ancestry gaps, and missing refs', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-integrity-'));
  try {
    const initialRoot = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
    const first = buildSourceNativeProduct({ artifactRoot: initialRoot, input: input() });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });

    const tamperedResourcePath = join(resourceRoot, 'source-native-resource.json');
    const tamperedResource = JSON.parse(readFileSync(tamperedResourcePath, 'utf8'));
    tamperedResource.namespace = 'tampered';
    writeFileSync(tamperedResourcePath, JSON.stringify(tamperedResource));
    assert.throws(
      () =>
        bindSourceNativeProductResource({
          resourceRoot,
          artifactRoot: join(root, 'tampered-target'),
        }),
      { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE' },
    );
    rmSync(resourceRoot, { recursive: true, force: true });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });

    const emptyBackendUri = pathToFileURL(join(root, 'empty-backend')).href;
    rewriteResource(resourceRoot, (value) => {
      value.objectBackend = emptyBackendUri;
    });
    assert.throws(
      () =>
        bindSourceNativeProductResource({
          resourceRoot,
          artifactRoot: join(root, 'missing-ref-target'),
        }),
      { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE_REF' },
    );
    rmSync(resourceRoot, { recursive: true, force: true });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });

    const backend = openCanonicalObjectBackend({ uri: backendUri }).backend;
    const store = openObjectOntStore({ backend });
    const unrelatedInput = input(['Unrelated']);
    unrelatedInput.branch = 'unrelated';
    const unrelated = buildSourceNativeProduct({
      artifactRoot: join(root, 'unrelated'),
      input: unrelatedInput,
      objectBackendUri: backendUri,
    });
    const current = store.readRefMetadata({ ontId: first.receipt.ontId, branch: 'main' });
    const unrelatedReplay = store.replayMetadata(unrelated.receipt.commitSha256);
    backend.compareAndSwap(current.key, {
      expectedVersion: current.version,
      bytes: Buffer.from(
        stableObjectText({
          ...current.ref,
          commitSha256: unrelated.receipt.commitSha256,
          replayStatus: unrelatedReplay.status,
          replaySha256: unrelatedReplay.replaySha256,
        }),
      ),
    });
    assert.throws(
      () =>
        bindSourceNativeProductResource({
          resourceRoot,
          artifactRoot: join(root, 'unrelated-target'),
        }),
      { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE_HISTORY' },
    );
    assert.equal(existsSync(join(root, 'unrelated-target', 'source-native.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact open rejects forged cut metadata and missing source objects', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-resource-open-'));
  try {
    const artifactRoot = join(root, 'artifact');
    const backendUri = pathToFileURL(join(artifactRoot, 'objects')).href;
    buildSourceNativeProduct({ artifactRoot, input: input() });
    const descriptorPath = join(artifactRoot, 'source-native.json');
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
    const { artifactSha256: _artifactSha256, ...core } = descriptor;
    core.sourceReplaySha256 = `sha256:${'f'.repeat(64)}`;
    writeFileSync(
      descriptorPath,
      `${stableObjectText({
        ...core,
        artifactSha256: stableObjectSha256(core),
      })}\n`,
    );
    assert.throws(() => openExactProductArtifactState({ artifactRoot }), {
      code: 'SOURCE_NATIVE_PRODUCT_ARTIFACT',
    });

    const resourceRoot = join(root, 'resource');
    const cleanRoot = join(root, 'clean-artifact');
    const clean = buildSourceNativeProduct({
      artifactRoot: cleanRoot,
      input: input(),
      objectBackendUri: backendUri,
    });
    createSourceNativeProductResource({ artifactRoot: cleanRoot, resourceRoot });
    const backend = openCanonicalObjectBackend({ uri: backendUri }).backend;
    const store = openObjectOntStore({ backend });
    const commit = store.readCommit(clean.receipt.commitSha256).commit;
    const sourcePack = commit.blobs.find((blob) => blob.logicalPath.includes('/source-packs/'));
    assert.ok(sourcePack);
    const sourcePackBytes = backend.get(sourcePack.key).bytes;
    const sourcePackKeyHash = createHash('sha256').update(sourcePack.key).digest('hex');
    const sourcePackPath = join(
      fileURLToPath(new URL(backendUri)),
      'objects',
      sourcePackKeyHash.slice(0, 2),
      `${sourcePackKeyHash.slice(2)}.json`,
    );
    rmSync(sourcePackPath);
    assert.throws(() => openExactProductArtifactState({ artifactRoot: cleanRoot }), {
      code: 'OBJECT_BACKEND_NOT_FOUND',
    });
    backend.putIfAbsent(sourcePack.key, sourcePackBytes);
    const map = commit.blobs.find((blob) => blob.logicalPath.includes('/maps/'));
    assert.ok(map);
    assert.throws(
      () => {
        backend.get('missing-object-that-is-not-present');
      },
      { code: 'OBJECT_BACKEND_NOT_FOUND' },
    );
    const keyHash = createHash('sha256').update(map.key).digest('hex');
    const mapObjectPath = join(
      fileURLToPath(new URL(backendUri)),
      'objects',
      keyHash.slice(0, 2),
      `${keyHash.slice(2)}.json`,
    );
    rmSync(mapObjectPath);
    assert.throws(() => openExactProductArtifactState({ artifactRoot: cleanRoot }), {
      code: 'OBJECT_BACKEND_NOT_FOUND',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
