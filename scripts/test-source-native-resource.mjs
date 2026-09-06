import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { openCanonicalObjectBackend } from '../dist/src/canonical-object-backend.mjs';
import {
  stableObjectSha256,
  stableObjectText,
} from '../dist/src/canonical-content.mjs';
import { openObjectOntStore } from '../dist/src/object-ont-store.mjs';
import {
  bindSourceNativeProductResource,
  createSourceNativeProductResource,
  openExactProductArtifactState,
  validateSourceNativeProductResource,
} from '../dist/src/source-native-artifact.mjs';
import {
  buildSourceNativeProduct,
  openSourceNativeProduct,
} from '../dist/src/source-native-product.mjs';

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
    querySchemas: [{
      sourceSystem: 'clickup',
      objectType: 'task',
      aliases: ['task'],
      fields: [{ fieldPath: 'title', aliases: ['title'] }],
    }],
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

function rewriteResource(resourceRoot, mutate) {
  const path = join(resourceRoot, 'source-native-resource.json');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  const { resourceSha256: _resourceSha256, ...core } = value;
  writeFileSync(path, `${stableObjectText({
    ...core,
    resourceSha256: stableObjectSha256(core),
  })}\n`);
}

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
    assert.equal(createSourceNativeProductResource({
      artifactRoot: initialRoot,
      resourceRoot,
    }).replayed, true);
    const resourceValue = JSON.parse(readFileSync(
      join(resourceRoot, 'source-native-resource.json'),
      'utf8',
    ));
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
      blob.logicalPath.includes('/source-packs/'));
    assert.ok(successorPack);
    const successorPackBytes = successorBackend.get(successorPack.key).bytes;
    const successorPackKeyHash = createHash('sha256').update(successorPack.key).digest('hex');
    const successorPackPath = join(
      fileURLToPath(new URL(backendUri)),
      'objects', successorPackKeyHash.slice(0, 2), `${successorPackKeyHash.slice(2)}.json`,
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
    assert.throws(() => bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: boundA,
      expectedSourceCommitSha256: second.receipt.commitSha256,
    }), { code: 'SOURCE_NATIVE_PRODUCT_ARTIFACT_CONFLICT' });
    assert.equal(readFileSync(join(boundA, 'source-native.json')).equals(boundABytes), true);

    const secondBinding = bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: boundB,
      expectedSourceCommitSha256: second.receipt.commitSha256,
    });
    assert.equal(secondBinding.replayed, false);
    assert.equal(await currentValue(boundB), 'Gamma');
    assert.equal(bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: boundB,
      expectedSourceCommitSha256: second.receipt.commitSha256,
    }).replayed, true);
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
    assert.throws(() => store.compareAndSwapRefMetadata({
      ontId: first.receipt.ontId,
      branch: 'main',
      expectedVersion: current.version,
      commitSha256: first.receipt.commitSha256,
    }), { code: 'OBJECT_ONT_REF_ROLLBACK' });
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
        changed.nativeObjectInputs.forEach((object) => { object.objectIdentity.namespace = 'other'; });
      } else if (drift === 'source-system') {
        changed.querySchemas[0].sourceSystem = 'linear';
        changed.nativeObjectInputs.forEach((object) => { object.objectIdentity.sourceSystem = 'linear'; });
      } else {
        changed.querySchemas[0].objectType = 'issue';
        changed.nativeObjectInputs.forEach((object) => { object.objectIdentity.objectType = 'issue'; });
      }
      buildSourceNativeProduct({
        artifactRoot: join(root, 'drifted'),
        input: changed,
        objectBackendUri: backendUri,
      });
      const target = join(root, 'target');
      assert.throws(() => bindSourceNativeProductResource({
        resourceRoot,
        artifactRoot: target,
      }), { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE_PROFILE' }, drift);
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
    assert.throws(() => bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: join(root, 'tampered-target'),
    }), { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE' });
    rmSync(resourceRoot, { recursive: true, force: true });
    createSourceNativeProductResource({ artifactRoot: initialRoot, resourceRoot });

    const emptyBackendUri = pathToFileURL(join(root, 'empty-backend')).href;
    rewriteResource(resourceRoot, (value) => { value.objectBackend = emptyBackendUri; });
    assert.throws(() => bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: join(root, 'missing-ref-target'),
    }), { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE_REF' });
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
      bytes: Buffer.from(stableObjectText({
        ...current.ref,
        commitSha256: unrelated.receipt.commitSha256,
        replayStatus: unrelatedReplay.status,
        replaySha256: unrelatedReplay.replaySha256,
      })),
    });
    assert.throws(() => bindSourceNativeProductResource({
      resourceRoot,
      artifactRoot: join(root, 'unrelated-target'),
    }), { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE_HISTORY' });
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
    writeFileSync(descriptorPath, `${stableObjectText({
      ...core,
      artifactSha256: stableObjectSha256(core),
    })}\n`);
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
    const sourcePack = commit.blobs.find((blob) =>
      blob.logicalPath.includes('/source-packs/'));
    assert.ok(sourcePack);
    const sourcePackBytes = backend.get(sourcePack.key).bytes;
    const sourcePackKeyHash = createHash('sha256').update(sourcePack.key).digest('hex');
    const sourcePackPath = join(
      fileURLToPath(new URL(backendUri)),
      'objects', sourcePackKeyHash.slice(0, 2), `${sourcePackKeyHash.slice(2)}.json`,
    );
    rmSync(sourcePackPath);
    assert.throws(() => openExactProductArtifactState({ artifactRoot: cleanRoot }), {
      code: 'OBJECT_BACKEND_NOT_FOUND',
    });
    backend.putIfAbsent(sourcePack.key, sourcePackBytes);
    const map = commit.blobs.find((blob) => blob.logicalPath.includes('/maps/'));
    assert.ok(map);
    assert.throws(() => {
      backend.get('missing-object-that-is-not-present');
    }, { code: 'OBJECT_BACKEND_NOT_FOUND' });
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
