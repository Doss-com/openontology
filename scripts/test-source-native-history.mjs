import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { openCanonicalObjectBackend } from '../dist/src/canonical-object-backend.mjs';
import { stableObjectSha256, stableObjectText } from '../dist/src/canonical-content.mjs';
import { openObjectOntStore } from '../dist/src/object-ont-store.mjs';
import {
  bindSourceNativeProductResource,
  buildSourceNativeProduct,
  createSourceNativeProductResource,
  openExactProductArtifactState,
  openProductState,
  readSourceNativeProductArtifactDescriptor,
  validateSourceNativeProductResource,
} from '../dist/src/source-native-artifact.mjs';

function input(values) {
  const identity = {
    home: 'ObjectDef/InstanceRef', sourceSystem: 'tracker', objectType: 'task',
    namespace: 'demo', externalId: 'task-1',
  };
  return {
    schemaVersion: 1, kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'protected-history', namespace: 'demo',
    querySchemas: [{ sourceSystem: 'tracker', objectType: 'task', aliases: ['task'],
      fields: [{ fieldPath: 'title', aliases: ['title'] }] }],
    sources: values.map((value, index) => ({
      relativePath: `tracker/demo/revision-${index}.txt`, sourceType: 'tracker',
      occurredAt: `2026-0${index + 1}-01T00:00:00.000Z`, content: value,
    })),
    nativeObjectInputs: values.map((value, index) => ({
      relativePath: `tracker/demo/revision-${index}.txt`, objectIdentity: identity,
      fields: [{ fieldPath: 'title', value }],
    })),
  };
}

test('protected source binding refuses a raw rewind after restart and recovers the accepted cut', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-protected-source-'));
  try {
    const objectBackendUri = pathToFileURL(join(root, 'data')).href;
    const historyBackendUri = pathToFileURL(join(root, 'history')).href;
    const backend = openCanonicalObjectBackend({ uri: objectBackendUri }).backend;
    const historyBackend = openCanonicalObjectBackend({ uri: historyBackendUri }).backend;
    const route = { ontId: 'protected-history', branch: 'main' };
    const firstRoot = join(root, 'first');
    const resourceRoot = join(root, 'resource');
    const first = buildSourceNativeProduct({
      artifactRoot: firstRoot, input: input(['Alpha']), objectBackendUri, historyBackendUri,
      expectedSourceVersion: null,
    });
    const initial = openObjectOntStore({ backend, historyBackend }).readRefMetadata(route);
    createSourceNativeProductResource({ artifactRoot: firstRoot, resourceRoot });
    const second = buildSourceNativeProduct({
      artifactRoot: join(root, 'second'), input: input(['Alpha', 'Beta']),
      objectBackendUri, historyBackendUri, expectedSourceVersion: initial.version,
    });
    assert.notEqual(first.receipt.commitSha256, second.receipt.commitSha256);
    const current = openObjectOntStore({ backend, historyBackend }).readRefMetadata(route);
    backend.compareAndSwap(current.key, {
      expectedVersion: current.version, bytes: Buffer.from(stableObjectText(initial.ref)),
    });
    const rewound = backend.get(current.key);
    for (const [name, values, expectedSourceVersion] of [
      ['identical-rewind', ['Alpha'], rewound.version],
      ['identical-accepted', ['Alpha', 'Beta'], null],
      ['changed', ['Alpha', 'Beta', 'Gamma'], rewound.version],
    ]) {
      const artifactRoot = join(root, name);
      assert.throws(() => buildSourceNativeProduct({ artifactRoot, input: input(values),
        objectBackendUri, historyBackendUri, expectedSourceVersion }),
      { code: 'OBJECT_ONT_HISTORY_MISMATCH' });
      assert.equal(existsSync(join(artifactRoot, 'source-native.json')), false);
      assert.deepEqual(backend.get(current.key), rewound);
    }
    assert.throws(() => bindSourceNativeProductResource({
      resourceRoot, artifactRoot: join(root, 'must-not-bind-old-current'),
    }), error => /^OBJECT_ONT_HISTORY_/u.test(error.code));
    assert.throws(() => openProductState({ artifactRoot: firstRoot }),
      { code: 'OBJECT_ONT_HISTORY_MISMATCH' });
    const historical = openExactProductArtifactState({ artifactRoot: firstRoot });
    assert.equal(historical.objectOnt.commitSha256, first.receipt.commitSha256);
    assert.throws(() => historical.store.readRefHead(route), { code: 'OBJECT_ONT_HISTORY_MISMATCH' });
    const coldStore = openObjectOntStore({
      backend: openCanonicalObjectBackend({ uri: objectBackendUri }).backend,
      historyBackend: openCanonicalObjectBackend({ uri: historyBackendUri }).backend,
    });
    coldStore.recoverRefHistory(route);
    const recovered = bindSourceNativeProductResource({
      resourceRoot, artifactRoot: join(root, 'recovered-current'),
    });
    assert.equal(recovered.sourceCommitSha256, second.receipt.commitSha256);
    const advanced = buildSourceNativeProduct({
      artifactRoot: join(root, 'after-recovery'), input: input(['Alpha', 'Beta', 'Gamma']),
      objectBackendUri, historyBackendUri,
      expectedSourceVersion: coldStore.readRefMetadata(route).version,
    });
    assert.notEqual(advanced.receipt.commitSha256, second.receipt.commitSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit source versions do not bypass pending or corrupt protected history', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-version-history-'));
  try {
    const objectBackendUri = pathToFileURL(join(root, 'data')).href;
    const historyBackendUri = pathToFileURL(join(root, 'history')).href;
    const backend = openCanonicalObjectBackend({ uri: objectBackendUri }).backend;
    const historyBackend = openCanonicalObjectBackend({ uri: historyBackendUri }).backend;
    const built = buildSourceNativeProduct({ artifactRoot: join(root, 'initial'),
      input: input(['Alpha']), objectBackendUri, historyBackendUri, expectedSourceVersion: null });
    const route = { ontId: 'protected-history', branch: 'main' };
    const store = openObjectOntStore({ backend, historyBackend });
    const before = store.readRefMetadata(route);
    const interrupted = openObjectOntStore({ historyBackend, backend: {
      ...backend,
      compareAndSwap() { throw Object.assign(new Error('Simulated publication failure'),
        { code: 'OBJECT_BACKEND_PRECONDITION' }); },
    } });
    assert.throws(() => interrupted.compareAndSwapRefMetadataCheckpointed({
      ...route, expectedVersion: before.version, commitSha256: built.receipt.commitSha256,
    }));
    const build = (name, expectedSourceVersion) => buildSourceNativeProduct({
      artifactRoot: join(root, name), input: input(['Alpha']), objectBackendUri,
      historyBackendUri, expectedSourceVersion,
    });
    for (const [index, version] of [null, before.version].entries()) {
      assert.throws(() => build(`pending-${index}`, version), { code: 'OBJECT_ONT_HISTORY_PENDING' });
      assert.equal(existsSync(join(root, `pending-${index}`, 'source-native.json')), false);
    }
    assert.equal(backend.head(before.key).version, before.version);
    store.recoverRefHistory(route);
    const current = store.readRefMetadata(route);
    assert.equal(build('recovered', current.version).receipt.replayed, true);
    const historyKey = 'ref-history/protected-history/main.json';
    historyBackend.compareAndSwap(historyKey, {
      expectedVersion: historyBackend.head(historyKey).version,
      bytes: Buffer.from('{"corrupt":true}'),
    });
    assert.throws(() => build('corrupt', current.version), { code: 'OBJECT_ONT_HISTORY_CORRUPT' });
    assert.equal(existsSync(join(root, 'corrupt', 'source-native.json')), false);
    assert.equal(backend.head(current.key).version, current.version);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('V2 artifacts reject unknown configuration fields even with a matching content hash', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-protected-extra-field-'));
  try {
    const artifactRoot = join(root, 'artifact');
    buildSourceNativeProduct({ artifactRoot, input: input(['Alpha']),
      historyBackendUri: pathToFileURL(join(root, 'history')).href });
    const { artifactSha256: _hash, ...core } = readSourceNativeProductArtifactDescriptor({ artifactRoot });
    core.historyBackendMode = 'disabled';
    writeFileSync(join(artifactRoot, 'source-native.json'), stableObjectText({
      ...core, artifactSha256: stableObjectSha256(core),
    }));
    assert.throws(() => openProductState({ artifactRoot }), { code: 'SOURCE_NATIVE_PRODUCT_ARTIFACT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('protected resources preserve their profile and reject missing or substituted history', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-protected-profile-'));
  try {
    const artifactRoot = join(root, 'artifact');
    const resourceRoot = join(root, 'resource');
    const boundRoot = join(root, 'bound');
    const historyBackendUri = pathToFileURL(join(root, 'history')).href;
    const substituteUri = pathToFileURL(join(root, 'substitute')).href;
    buildSourceNativeProduct({ artifactRoot, input: input(['Alpha']), historyBackendUri });
    createSourceNativeProductResource({ artifactRoot, resourceRoot });
    const resource = JSON.parse(readFileSync(join(resourceRoot, 'source-native-resource.json'), 'utf8'));
    assert.equal(resource.schemaVersion, 2);
    assert.equal(resource.kind, 'OpenOntologySourceNativeProductResourceV2');
    assert.equal(validateSourceNativeProductResource(resource).historyBackend, historyBackendUri);
    bindSourceNativeProductResource({ resourceRoot, artifactRoot: boundRoot });
    const descriptor = readSourceNativeProductArtifactDescriptor({ artifactRoot: boundRoot });
    assert.equal(descriptor.schemaVersion, 2);
    assert.equal(descriptor.historyBackend, historyBackendUri);
    assert.equal(openProductState({ artifactRoot: boundRoot }).descriptor.historyBackend, historyBackendUri);
    for (const open of [openProductState, openExactProductArtifactState]) {
      assert.throws(() => open({ artifactRoot: boundRoot, historyBackendUri: substituteUri }),
        { code: 'SOURCE_NATIVE_PRODUCT_HISTORY_BACKEND_CONFLICT' });
    }
    assert.throws(() => buildSourceNativeProduct({
      artifactRoot, input: input(['Alpha']), historyBackendUri: substituteUri,
    }), { code: 'SOURCE_NATIVE_PRODUCT_HISTORY_BACKEND_CONFLICT' });
    const { resourceSha256: _hash, historyBackend: _uri, ...missingHistory } = resource;
    assert.throws(() => validateSourceNativeProductResource({
      ...missingHistory, resourceSha256: stableObjectSha256(missingHistory),
    }), { code: 'SOURCE_NATIVE_PRODUCT_RESOURCE' });
    const { artifactSha256: _artifactHash, historyBackend: _artifactUri, ...missingArtifactHistory } = descriptor;
    writeFileSync(join(boundRoot, 'source-native.json'), stableObjectText({
      ...missingArtifactHistory, artifactSha256: stableObjectSha256(missingArtifactHistory),
    }));
    assert.throws(() => openProductState({ artifactRoot: boundRoot }),
      { code: 'SOURCE_NATIVE_PRODUCT_ARTIFACT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy artifacts remain V1 and cannot gain history implicitly at open', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-legacy-profile-'));
  try {
    const artifactRoot = join(root, 'artifact');
    const resourceRoot = join(root, 'resource');
    buildSourceNativeProduct({ artifactRoot, input: input(['Alpha']) });
    createSourceNativeProductResource({ artifactRoot, resourceRoot });
    const descriptor = readSourceNativeProductArtifactDescriptor({ artifactRoot });
    const resource = JSON.parse(readFileSync(join(resourceRoot, 'source-native-resource.json'), 'utf8'));
    assert.equal(descriptor.schemaVersion, 1);
    assert.equal(resource.schemaVersion, 1);
    assert.equal(Object.hasOwn(descriptor, 'historyBackend'), false);
    assert.equal(Object.hasOwn(resource, 'historyBackend'), false);
    assert.equal(openProductState({ artifactRoot }).objectOnt.sources[0].content, 'Alpha');
    assert.throws(() => openProductState({
      artifactRoot, historyBackendUri: pathToFileURL(join(root, 'history')).href,
    }), { code: 'SOURCE_NATIVE_PRODUCT_HISTORY_BACKEND_CONFLICT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a protected build rejects identical data and history backends before publication', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-protected-same-backend-'));
  try {
    const uri = pathToFileURL(join(root, 'data')).href;
    assert.throws(() => buildSourceNativeProduct({
      artifactRoot: join(root, 'artifact'), input: input(['Alpha']),
      objectBackendUri: uri, historyBackendUri: uri,
    }), { code: 'SOURCE_NATIVE_PRODUCT_HISTORY_BACKEND_CONFLICT' });
    const backend = openCanonicalObjectBackend({ uri }).backend;
    assert.equal(openObjectOntStore({ backend }).readRefHead({
      ontId: 'protected-history', branch: 'main',
    }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a deleted established source head refuses current opening and recovers without affecting history', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-protected-deleted-source-'));
  try {
    const artifactRoot = join(root, 'artifact');
    const dataRoot = join(root, 'data');
    const built = buildSourceNativeProduct({ artifactRoot, input: input(['Alpha']),
      objectBackendUri: pathToFileURL(dataRoot).href,
      historyBackendUri: pathToFileURL(join(root, 'history')).href });
    const route = { ontId: 'protected-history', branch: 'main' };
    const historical = openExactProductArtifactState({ artifactRoot });
    const head = historical.store.readRefHead(route);
    // Remove only the disposable test backend's ref envelope, never an original source.
    const keyHash = createHash('sha256').update(head.key).digest('hex');
    rmSync(join(dataRoot, 'objects', keyHash.slice(0, 2), `${keyHash.slice(2)}.json`));
    assert.throws(() => openProductState({ artifactRoot }), { code: 'OBJECT_ONT_HISTORY_MISMATCH' });
    assert.equal(historical.store.readRefHead({ ...route, branch: 'never-published' }), null);
    assert.equal(openExactProductArtifactState({ artifactRoot }).objectOnt.commitSha256,
      built.receipt.commitSha256);
    historical.store.recoverRefHistory(route);
    assert.equal(openProductState({ artifactRoot }).objectOnt.sources[0].content, 'Alpha');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
