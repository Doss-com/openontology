import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  buildSourceNativeProduct,
  openSourceNativeHistoricalProductRuntime,
  openSourceNativeProductRuntime,
  openSourceNativeProductWithAdmittedKnowledge,
  openSourceNativeProductWithConstruction,
} from '../dist/src/kernel.mjs';
import { openOntology } from '../dist/src/openontology.mjs';
import { openSourceNativeProduct } from '../dist/src/source-native-product.mjs';
import { openCanonicalObjectBackend } from '../dist/src/canonical-object-backend.mjs';
import { openExactProductArtifactState, openProductState } from '../dist/src/source-native-artifact.mjs';

function input(value) {
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'historical-runtime-test',
    namespace: 'example',
    querySchemas: [{
      sourceSystem: 'fixture', objectType: 'task', aliases: ['task'],
      fields: [{ fieldPath: 'status', aliases: ['status'] }],
    }],
    sources: [{
      relativePath: 'fixture/example/task-1.txt', sourceType: 'fixture',
      occurredAt: '2026-09-09T00:00:00.000Z', content: `status: ${value}`,
    }],
    nativeObjectInputs: [{
      relativePath: 'fixture/example/task-1.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'fixture', objectType: 'task',
        namespace: 'example', externalId: 'task-1',
      },
      fields: [{ fieldPath: 'status', value }],
    }],
  };
}

function query() {
  return {
    question: 'What is the current status for task-1?',
    typedQuery: {
      sourceSystem: 'fixture', objectType: 'task', externalId: 'task-1', fieldPath: 'status',
    },
  };
}

function trustRegistry() {
  const pair = generateKeyPairSync('ed25519');
  return [{
    issuerId: 'historical-reviewer',
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: ['reviewer'],
  }];
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oont-historical-runtime-'));
  const objectRoot = join(root, 'objects');
  const historyRoot = join(root, 'history');
  const objectBackendUri = pathToFileURL(objectRoot).href;
  const historyBackendUri = pathToFileURL(historyRoot).href;
  const aRoot = join(root, 'artifact-a');
  const bRoot = join(root, 'artifact-b');
  const a = buildSourceNativeProduct({
    artifactRoot: aRoot, objectBackendUri, historyBackendUri, input: input('A'),
  });
  const b = buildSourceNativeProduct({
    artifactRoot: bRoot, objectBackendUri, historyBackendUri, input: input('B'),
  });
  return { root, aRoot, bRoot, objectRoot, objectBackendUri, historyBackendUri, a, b };
}

function removeBlob(objectRoot, key) {
  const digest = createHash('sha256').update(key).digest('hex');
  rmSync(join(fileURLToPath(pathToFileURL(objectRoot)), 'objects', digest.slice(0, 2), `${digest.slice(2)}.json`));
}

test('historical runtime reopens A after main advances to B while current/root remain stale-refused', async () => {
  const f = fixture();
  try {
    const current = openProductState({ artifactRoot: f.bRoot });
    assert.equal(current.objectOnt.commitSha256, f.b.receipt.commitSha256);
    assert.throws(() => openSourceNativeProductRuntime({ artifactRoot: f.aRoot }), {
      code: 'SOURCE_NATIVE_PRODUCT_REF',
    });
    assert.throws(() => openSourceNativeProduct({ artifactRoot: f.aRoot }), {
      code: 'SOURCE_NATIVE_PRODUCT_REF',
    });
    assert.throws(() => openOntology({ artifactRoot: f.aRoot }), {
      code: 'SOURCE_NATIVE_PRODUCT_REF',
    });

    const historical = openSourceNativeHistoricalProductRuntime({ artifactRoot: f.aRoot });
    assert.equal(historical.status().cutSelection, 'exact-artifact');
    assert.equal(historical.status().sourceCommitSha256, f.a.receipt.commitSha256);
    const result = await historical.verify(query());
    assert.equal(result.answerable, true);
    assert.deepEqual(result.context.map(row => row.exactText), ['A']);
    const search = await historical.search(query());
    assert.equal(search.verification.sourceCommitSha256, f.a.receipt.commitSha256);
    const exact = await historical.read({ ref: search.matches[0].ref });
    assert.equal(exact.exactText, 'A');
    assert.equal(exact.evidence.relativePath, 'fixture/example/task-1.txt');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('historical selection is confined to admitted and construction control-plane configuration', async () => {
  const f = fixture();
  try {
    const trust = trustRegistry();
    const admitted = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: f.aRoot }, { trustRegistry: trust, historical: true });
    assert.equal(admitted.status().cutSelection, 'exact-artifact');
    assert.deepEqual((await admitted.verify(query())).context.map(row => row.exactText), ['A']);

    const construction = openSourceNativeProductWithConstruction(
      { artifactRoot: f.aRoot }, { trustRegistry: trust, historical: true });
    assert.equal(construction.status().cutSelection, 'exact-artifact');
    assert.deepEqual((await construction.verify(query())).context.map(row => row.exactText), ['A']);

    assert.throws(() => openSourceNativeProductRuntime({ artifactRoot: f.aRoot, historical: true }), {
      code: 'SOURCE_NATIVE_PRODUCT_OPTIONS',
    });
    assert.throws(() => openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: f.aRoot }, { trustRegistry: trust, historical: 'yes' }), {
      code: 'SOURCE_NATIVE_ADMISSION_TRUST',
    });
    assert.throws(() => openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: f.aRoot }, { trustRegistry: trust, unexpected: true }), {
      code: 'SOURCE_NATIVE_ADMISSION_TRUST',
    });
    assert.throws(() => openSourceNativeProductWithConstruction(
      { artifactRoot: f.aRoot }, { trustRegistry: trust, unexpected: true }), {
      code: 'CONSTRUCTION_NAVIGATION_INPUT',
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('historical opener preserves exact-pack missing and corrupt refusals without changing B', async () => {
  const missing = fixture();
  try {
    const state = openExactProductArtifactState({ artifactRoot: missing.aRoot });
    removeBlob(missing.objectRoot, state.objectOnt.sources[0].blobDescriptor.key);
    assert.throws(() => openSourceNativeHistoricalProductRuntime({ artifactRoot: missing.aRoot }), {
      code: 'OBJECT_BACKEND_NOT_FOUND',
    });
    assert.deepEqual((await openSourceNativeProduct({ artifactRoot: missing.bRoot }).verify(query())).context
      .map(row => row.exactText), ['B']);
  } finally {
    rmSync(missing.root, { recursive: true, force: true });
  }

  const corrupt = fixture();
  try {
    const state = openExactProductArtifactState({ artifactRoot: corrupt.aRoot });
    const backend = openCanonicalObjectBackend({ uri: corrupt.objectBackendUri }).backend;
    const stored = backend.get(state.objectOnt.sources[0].blobDescriptor.key);
    backend.compareAndSwap(state.objectOnt.sources[0].blobDescriptor.key, {
      expectedVersion: stored.version, bytes: Buffer.from('corrupt'),
    });
    assert.throws(() => openSourceNativeHistoricalProductRuntime({ artifactRoot: corrupt.aRoot }), error =>
      ['OBJECT_BACKEND_CORRUPT', 'OBJECT_ONT_BLOB_READ', 'SOURCE_NATIVE_OBJECT_ONT_SOURCE'].includes(error.code));
  } finally {
    rmSync(corrupt.root, { recursive: true, force: true });
  }
});
