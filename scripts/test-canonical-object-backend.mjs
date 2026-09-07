#!/usr/bin/env node

import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  normalizeCanonicalObjectBackendUri,
  openCanonicalObjectBackend,
} from '../dist/src/canonical-object-backend.mjs';
import {
  normalizeCanonicalObjectBackendUri as kernelNormalizeCanonicalObjectBackendUri,
  openCanonicalObjectBackend as kernelOpenCanonicalObjectBackend,
} from '../dist/src/kernel.mjs';
import {
  buildSourceNativeProduct,
  openObjectOntStore,
} from '../dist/src/kernel.mjs';

test('kernel re-exports the canonical backend selection primitives', () => {
  assert.equal(kernelNormalizeCanonicalObjectBackendUri, normalizeCanonicalObjectBackendUri);
  assert.equal(kernelOpenCanonicalObjectBackend, openCanonicalObjectBackend);
});

test('kernel-selected local backend interoperates with protected source publication', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-kernel-backend-entry-'));
  try {
    const input = JSON.parse(readFileSync(new URL('../examples/quickstart/source-native-input.json', import.meta.url), 'utf8'));
    input.branch = 'research';
    const objectBackendUri = pathToFileURL(join(root, 'objects')).href;
    const historyBackendUri = pathToFileURL(join(root, 'history')).href;
    const initial = buildSourceNativeProduct({
      artifactRoot: join(root, 'initial'),
      input,
      objectBackendUri,
      historyBackendUri,
    });
    const backend = kernelOpenCanonicalObjectBackend({ uri: objectBackendUri }).backend;
    const historyBackend = kernelOpenCanonicalObjectBackend({ uri: historyBackendUri }).backend;
    const store = openObjectOntStore({ backend, historyBackend });
    const before = store.readRefMetadata({ ontId: input.ontId, branch: input.branch });
    assert.equal(before.version, initial.receipt.refVersion);
    assert.equal(before.ref.commitSha256, initial.receipt.commitSha256);
    assert.ok(historyBackend.head(`ref-history/${input.ontId}/${input.branch}.json`));
    assert.ok(store.readRefMetadataCheckpointSnapshot({
      ontId: input.ontId,
      branch: input.branch,
    }));
    const historyBefore = historyBackend.head(`ref-history/${input.ontId}/${input.branch}.json`);

    const successorInput = structuredClone(input);
    successorInput.sources[1].content = 'Task task-1 title: Verified successor';
    successorInput.nativeObjectInputs[1].fields[0].value = 'Verified successor';
    const successor = buildSourceNativeProduct({
      artifactRoot: join(root, 'successor'),
      input: successorInput,
      objectBackendUri,
      historyBackendUri,
      expectedSourceVersion: before.version,
    });
    const after = store.readRefMetadata({ ontId: input.ontId, branch: input.branch });
    assert.equal(after.version, successor.receipt.refVersion);
    assert.equal(after.ref.commitSha256, successor.receipt.commitSha256);
    assert.notEqual(after.ref.commitSha256, initial.receipt.commitSha256);
    const historyAfter = historyBackend.head(`ref-history/${input.ontId}/${input.branch}.json`);
    assert.ok(historyAfter);
    assert.notEqual(historyAfter.version, historyBefore.version);
    const checkpointAfter = store.readRefMetadataCheckpointSnapshot({
      ontId: input.ontId,
      branch: input.branch,
    });
    assert.equal(checkpointAfter?.ref.commitSha256, after.ref.commitSha256);
    assert.equal(checkpointAfter?.ref.replaySha256, after.ref.replaySha256);

    const staleInput = structuredClone(input);
    staleInput.sources[1].content = 'Task task-1 title: Stale successor';
    staleInput.nativeObjectInputs[1].fields[0].value = 'Stale successor';
    assert.throws(() => buildSourceNativeProduct({
      artifactRoot: join(root, 'stale'),
      input: staleInput,
      objectBackendUri,
      historyBackendUri,
      expectedSourceVersion: before.version,
    }), { code: 'SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT' });
    assert.deepEqual(store.readRefMetadata({ ontId: input.ontId, branch: input.branch }), after);
    assert.deepEqual(historyBackend.head(`ref-history/${input.ontId}/${input.branch}.json`), historyAfter);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('canonical backend syntax is normalized once for every consumer', () => {
  assert.equal(normalizeCanonicalObjectBackendUri('gs://customer-ontology/'), 'gs://customer-ontology');
  assert.equal(
    normalizeCanonicalObjectBackendUri('gs://customer-ontology/tenant-a/ont-a'),
    'gs://customer-ontology/tenant-a/ont-a',
  );
  assert.equal(normalizeCanonicalObjectBackendUri('s3://customer-ontology/'), 's3://customer-ontology');
  assert.throws(() => normalizeCanonicalObjectBackendUri('s3://customer-ontology/prefix'), {
    code: 'CANONICAL_OBJECT_BACKEND_URI',
  });
});

test('canonical GCS prefixes reject aliases, traversal, and encoded separators', () => {
  for (const uri of [
    'gs://customer-ontology/tenant-a/',
    'gs://customer-ontology/tenant-a//ont-a',
    'gs://customer-ontology/tenant-a/./ont-a',
    'gs://customer-ontology/tenant-a/../ont-a',
    'gs://customer-ontology/tenant-a/..',
    ' gs://customer-ontology/tenant-a/..',
    'gs://customer-ontology/tenant-a/..\n',
    'gs://customer-ontology/tenant-a/%2e%2e',
    'gs://customer-ontology/%2e',
    'gs://customer-ontology/tenant-a%2Font-a',
    'gs://customer-ontology/tenant-a%2Font-a/child',
  ]) {
    assert.throws(() => normalizeCanonicalObjectBackendUri(uri), {
      code: 'CANONICAL_OBJECT_BACKEND_URI',
    });
  }
});

test('s3 URI selects the distributed Adapter without opening the network', () => {
  const selected = openCanonicalObjectBackend({
    uri: 's3://customer-ontology',
    env: {
      OONT_S3_ENDPOINT: 'https://objects.example.test',
      OONT_S3_REGION: 'us-west-2',
      OONT_S3_ACCESS_KEY_ID: 'fixture-access',
      OONT_S3_SECRET_ACCESS_KEY: 'fixture-secret',
      OONT_S3_SESSION_TOKEN: 'fixture-session',
      OONT_S3_CONDITIONAL_WRITE_POLICY: 'enforced',
    },
  });
  assert.equal(selected.uri, 's3://customer-ontology');
  assert.equal(selected.capabilities.backend, 's3-compatible');
  assert.equal(selected.capabilities.bucket, 'customer-ontology');
  assert.equal(selected.capabilities.endpointOrigin, 'https://objects.example.test');
  assert.equal(selected.capabilities.region, 'us-west-2');
  assert.equal(selected.capabilities.distributedObjectStore, true);
  assert.equal(selected.capabilities.providerConditionalWritePolicy, true);
});

test('gs URI selects the native GCS Adapter without opening the network', () => {
  const selected = openCanonicalObjectBackend({
    uri: 'gs://customer-ontology',
    env: { OONT_GCS_ACCESS_TOKEN: 'fixture-token' },
  });
  assert.equal(selected.uri, 'gs://customer-ontology');
  assert.equal(selected.capabilities.backend, 'gcs');
  assert.equal(selected.capabilities.bucket, 'customer-ontology');
  assert.equal(selected.capabilities.endpointOrigin, 'https://storage.googleapis.com');
  assert.equal(selected.capabilities.distributedObjectStore, true);
  assert.equal(selected.capabilities.providerConditionalWritePolicy, true);
  assert.equal(selected.capabilities.nativeGenerationPreconditions, true);
});

test('gs URI preserves a scoped prefix and accepts a renewable token provider', () => {
  const selected = openCanonicalObjectBackend({
    uri: 'gs://customer-ontology/tenant-a/ont-a',
    env: { OONT_GCS_ACCESS_TOKEN_PROVIDER: () => 'fixture-token' },
  });
  assert.equal(selected.uri, 'gs://customer-ontology/tenant-a/ont-a');
  assert.equal(selected.capabilities.backend, 'gcs');
  assert.equal(selected.capabilities.keyPrefix, 'tenant-a/ont-a');
  assert.equal('accessToken' in selected.capabilities, false);
  assert.equal('accessTokenProvider' in selected.capabilities, false);
});

test('gs URI accepts a programmatic request observer and rejects non-callback configuration', () => {
  const observations = [];
  const curlCalls = [];
  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (_command, args) => {
    curlCalls.push(args);
    const headersPath = args[args.indexOf('--dump-header') + 1];
    const responsePath = args[args.indexOf('--output') + 1];
    writeFileSync(headersPath, 'HTTP/1.1 404 Not Found\r\nContent-Length: 2\r\n\r\n');
    writeFileSync(responsePath, '{}');
    return { status: 0, stdout: '404', stderr: '' };
  };
  syncBuiltinESMExports();
  try {
    const selected = openCanonicalObjectBackend({
      uri: 'gs://customer-ontology/tenant-a/ont-a',
      env: {
        OONT_GCS_ACCESS_TOKEN: 'fixture-token',
        OONT_GCS_REQUEST_OBSERVER: (observation) => observations.push(observation),
      },
    });
    assert.equal(selected.capabilities.backend, 'gcs');
    assert.equal(selected.backend.head('refs/main'), null);
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    syncBuiltinESMExports();
  }
  assert.equal(curlCalls.length, 1);
  assert.equal(curlCalls[0][curlCalls[0].indexOf('--request') + 1], 'GET');
  assert.deepEqual(observations.map(({ operationClass, method, attempt, status, requestBodyBytes, responseBodyBytes,
    bucket, prefix, failureClass }) => ({
    operationClass,
    method,
    attempt,
    status,
    requestBodyBytes,
    responseBodyBytes,
    bucket,
    prefix,
    failureClass,
  })), [{
    operationClass: 'object-metadata',
    method: 'GET',
    attempt: 1,
    status: 404,
    requestBodyBytes: 0,
    responseBodyBytes: 2,
    bucket: 'customer-ontology',
    prefix: 'tenant-a/ont-a',
    failureClass: null,
  }]);
  assert.throws(() => openCanonicalObjectBackend({
    uri: 'gs://customer-ontology',
    env: {
      OONT_GCS_ACCESS_TOKEN: 'fixture-token',
      OONT_GCS_REQUEST_OBSERVER: 'not-a-callback',
    },
  }), { code: 'CANONICAL_OBJECT_BACKEND_URI' });
});

test('canonical backend URI never accepts embedded credentials or configuration query text', () => {
  for (const uri of [
    's3://access:secret@customer-ontology',
    's3://customer-ontology?endpoint=https://objects.example.test',
    'gs://token@customer-ontology',
    'gs://customer-ontology?token=secret',
    'file:///tmp/objects?token=secret',
  ]) {
    assert.throws(() => openCanonicalObjectBackend({ uri, env: {} }), {
      code: 'CANONICAL_OBJECT_BACKEND_URI',
    });
  }
});

test('file backend hashes large canonical metadata without a second string-to-Buffer allocation', () => {
  const child = String.raw`
    import { mkdtempSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const originalFrom = Buffer.from;
    const largeStringCalls = [];
    Buffer.from = function patchedBufferFrom(value, ...args) {
      if (typeof value === 'string' && value.length > 1_000_000) largeStringCalls.push(value.length);
      return originalFrom.call(Buffer, value, ...args);
    };
    const { openFileObjectBackend } = await import('./dist/src/object-storage-backend.mjs');
    const root = mkdtempSync(join(tmpdir(), 'oont-file-hash-allocation-'));
    try {
      const bytes = Buffer.alloc(2 * 1024 * 1024, 0x61);
      openFileObjectBackend({ root }).putIfAbsent('objects/large', bytes);
      process.stdout.write(JSON.stringify({ largeStringCalls }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  `;
  const result = childProcess.spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.largeStringCalls.length, 1, JSON.stringify(observed));
});

test('file backend hash conversion preserves physical envelopes, versions, ranges, and corruption checks', () => {
  const child = String.raw`
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const modulePath = join(process.cwd(), 'dist/src/object-storage-backend.mjs');
    const candidateText = readFileSync(modulePath, 'utf8');
    const oldText = candidateText.replace(
      "createHash('sha256').update(canonical(value), 'utf8').digest('hex')",
      "createHash('sha256').update(Buffer.from(canonical(value))).digest('hex')",
    );
    assert.notEqual(oldText, candidateText);
    const root = mkdtempSync(join(tmpdir(), 'oont-file-hash-parity-'));
    const oldModulePath = join(root, 'old-backend.mjs');
    writeFileSync(oldModulePath, oldText);
    const [{ openFileObjectBackend: openNew }, { openFileObjectBackend: openOld }] = await Promise.all([
      import(pathToFileURL(modulePath)),
      import(pathToFileURL(oldModulePath)),
    ]);
    const newRoot = join(root, 'new');
    const oldRoot = join(root, 'old');
    const newBackend = openNew({ root: newRoot });
    const oldBackend = openOld({ root: oldRoot });
    const key = 'objects/unicode-numeric';
    const bytes = Buffer.from(JSON.stringify({ '10': 'ten', '2': 'two', text: 'café 漢字 🙂 \\ud800' }));
    const comparable = ({ key: rowKey, version, checksumSha256, byteLength, generation, created, replayed, previousVersion }) =>
      ({ key: rowKey, version, checksumSha256, byteLength, generation, created, replayed, previousVersion });
    const newFirst = newBackend.putIfAbsent(key, bytes);
    const oldFirst = oldBackend.putIfAbsent(key, bytes);
    assert.deepEqual(comparable(newFirst), comparable(oldFirst));
    assert.deepEqual(readFileSync(join(newRoot, 'BACKEND.json')), readFileSync(join(oldRoot, 'BACKEND.json')));
    const envelopePath = (rootPath) => {
      const keyHash = createHash('sha256').update(key).digest('hex');
      return join(rootPath, 'objects', keyHash.slice(0, 2), keyHash.slice(2) + '.json');
    };
    assert.deepEqual(readFileSync(envelopePath(newRoot)), readFileSync(envelopePath(oldRoot)));
    assert.deepEqual(newBackend.get(key).bytes, oldBackend.get(key).bytes);
    assert.deepEqual(newBackend.get(key, { start: 2, end: bytes.length - 2 }).bytes,
      oldBackend.get(key, { start: 2, end: bytes.length - 2 }).bytes);
    const newSecond = newBackend.compareAndSwap(key, { expectedVersion: newFirst.version, bytes: Buffer.concat([bytes, Buffer.from([0x0a])]) });
    const oldSecond = oldBackend.compareAndSwap(key, { expectedVersion: oldFirst.version, bytes: Buffer.concat([bytes, Buffer.from([0x0a])]) });
    assert.deepEqual(comparable(newSecond), comparable(oldSecond));
    assert.deepEqual(readFileSync(envelopePath(newRoot)), readFileSync(envelopePath(oldRoot)));
    const newCold = openNew({ root: newRoot });
    const oldCold = openOld({ root: oldRoot });
    assert.deepEqual(comparable(newCold.head(key)), comparable(oldCold.head(key)));
    assert.deepEqual(newCold.get(key).bytes, oldCold.get(key).bytes);
    for (const [name, backend, rootPath] of [['new', newCold, newRoot], ['old', oldCold, oldRoot]]) {
      const corrupted = Buffer.from(readFileSync(envelopePath(rootPath)));
      corrupted[corrupted.length - 3] ^= 1;
      writeFileSync(envelopePath(rootPath), corrupted);
      assert.throws(() => backend.get(key), { code: 'OBJECT_BACKEND_CORRUPT' }, name);
    }
    process.stdout.write(JSON.stringify({ status: 'PASS', envelopeBytes: readFileSync(envelopePath(newRoot)).length }));
    rmSync(root, { recursive: true, force: true });
  `;
  const result = childProcess.spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'PASS');
});
