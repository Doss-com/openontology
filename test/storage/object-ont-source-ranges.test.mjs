import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { openGcsObjectBackend } from '../../dist/storage/gcs-backend.js';
import { openFileObjectBackend } from '../../dist/storage/backend.js';
import {
  buildSourceNativeProduct,
  objectBytesSha256,
  openObjectOntStore,
  openSourceNativeObjectOntRefIndex,
} from '../../dist/kernel.js';

function memoryBackend({ mutateGet = null } = {}) {
  const rows = new Map();
  let generation = 0;
  const makeReceipt = (key, row) => ({
    schemaVersion: 1,
    kind: 'OpenOntologyObjectWriteReceiptV1',
    key,
    version: `memory-v1:${row.generation}`,
    checksumSha256: row.checksumSha256,
    byteLength: row.bytes.length,
    generation: row.generation,
  });
  const rawGet = (key, { start = 0, end = null } = {}) => {
    const row = rows.get(key);
    if (!row) throw Object.assign(new Error('OBJECT_BACKEND_NOT_FOUND'), { code: 'OBJECT_BACKEND_NOT_FOUND' });
    const finalEnd = end === null ? row.bytes.length : end;
    return {
      ...makeReceipt(key, row),
      bytes: row.bytes.subarray(start, finalEnd),
      range: { start, end: finalEnd },
    };
  };
  return {
    capabilities: {
      schemaVersion: 1,
      kind: 'OpenOntologyObjectBackendCapabilitiesV1',
      backend: 'memory-test',
      contractSha256: 'sha256:' + '0'.repeat(64),
      operations: { putIfAbsent: 'required', compareAndSwap: 'required', rangeGet: 'required', checksummedBytes: 'required' },
      distributedObjectStore: false,
      multiProcessCas: false,
      singleProcessCas: true,
      providerConditionalWritePolicy: false,
    },
    head(key) {
      const row = rows.get(key);
      return row ? makeReceipt(key, row) : null;
    },
    get(key, options = {}) {
      const result = rawGet(key, options);
      return mutateGet ? mutateGet(result) : result;
    },
    putIfAbsent(key, input) {
      const bytes = Buffer.from(input);
      const existing = rows.get(key);
      if (existing) {
        if (!existing.bytes.equals(bytes)) {
          throw Object.assign(new Error('OBJECT_BACKEND_PRECONDITION'), { code: 'OBJECT_BACKEND_PRECONDITION' });
        }
        return { ...makeReceipt(key, existing), replayed: true };
      }
      const row = { bytes, checksumSha256: objectBytesSha256(bytes), generation: ++generation };
      rows.set(key, row);
      return { ...makeReceipt(key, row), replayed: false };
    },
    compareAndSwap(key, { expectedVersion = null, bytes: input }) {
      const existing = rows.get(key);
      const actual = existing ? makeReceipt(key, existing).version : null;
      if (actual !== expectedVersion) {
        throw Object.assign(new Error('OBJECT_BACKEND_PRECONDITION'), { code: 'OBJECT_BACKEND_PRECONDITION' });
      }
      const bytes = Buffer.from(input);
      const row = { bytes, checksumSha256: objectBytesSha256(bytes), generation: ++generation };
      rows.set(key, row);
      return makeReceipt(key, row);
    },
  };
}

function putFixtureBlob(backend, bytes = Buffer.from('zero\none\ntwo\n')) {
  const store = openObjectOntStore({ backend });
  const descriptor = store.putBlob({
    logicalPath: 'blobs/source-native/source-packs/sha256/fixture',
    bytes,
    mediaType: 'application/octet-stream',
  });
  return { store, descriptor, bytes };
}

test('ObjectOntStore readBlobRange preserves full and partial range authority', () => {
  const { store, descriptor, bytes } = putFixtureBlob(memoryBackend());
  const partial = store.readBlobRange(descriptor, { start: 5, end: 8 });
  assert.deepEqual(partial.bytes, Buffer.from('one'));
  assert.deepEqual(partial.range, { start: 5, end: 8 });
  assert.equal(partial.descriptor.byteLength, bytes.length);
  assert.equal(partial.objectChecksumSha256, descriptor.storedSha256);
  assert.equal(partial.objectChecksumBound, true);
  assert.equal(partial.completeObjectBytesVerified, false);
  assert.equal(partial.deliveredSha256, objectBytesSha256(partial.bytes));

  const whole = store.readBlobRange(descriptor);
  assert.deepEqual(whole.bytes, bytes);
  assert.deepEqual(whole.range, { start: 0, end: bytes.length });
  assert.equal(whole.objectChecksumSha256, descriptor.storedSha256);
  assert.equal(whole.deliveredSha256, descriptor.storedSha256);
  assert.equal(whole.completeObjectBytesVerified, true);
});

test('ObjectOntStore readBlobRange refuses bad metadata, bounds, and delivered length', () => {
  const cases = [
    ['bad checksum metadata', (result) => ({ ...result, checksumSha256: 'sha256:' + 'f'.repeat(64) })],
    ['bad total length metadata', (result) => ({ ...result, byteLength: result.byteLength + 1 })],
    ['truncated delivered body', (result) => ({ ...result, bytes: result.bytes.subarray(0, result.bytes.length - 1) })],
    ['echoed range mismatch', (result) => ({ ...result, range: { start: result.range.start + 1, end: result.range.end } })],
  ];
  for (const [label, mutateGet] of cases) {
    const { store, descriptor } = putFixtureBlob(memoryBackend({ mutateGet }));
    assert.throws(() => store.readBlobRange(descriptor, { start: 5, end: 8 }), {
      code: 'OBJECT_ONT_BLOB_RANGE',
    }, label);
  }
});

test('ObjectOntStore readBlobRange refuses invalid numeric and interval bounds', () => {
  const { store, descriptor } = putFixtureBlob(memoryBackend());
  const invalidRanges = [
    ['negative start', { start: -1, end: 2 }],
    ['fractional start', { start: 0.5, end: 2 }],
    ['end before start', { start: 4, end: 3 }],
    ['end beyond descriptor', { start: 0, end: descriptor.byteLength + 1 }],
  ];
  for (const [label, range] of invalidRanges) {
    assert.throws(() => store.readBlobRange(descriptor, range), {
      code: 'OBJECT_ONT_BLOB_RANGE',
    }, label);
  }
});

test('matching stored checksum metadata does not certify corrupted partial bytes', () => {
  const { store, descriptor } = putFixtureBlob(memoryBackend({
    mutateGet: (result) => ({ ...result, bytes: Buffer.from('BAD') }),
  }));
  const partial = store.readBlobRange(descriptor, { start: 5, end: 8 });
  assert.deepEqual(partial.bytes, Buffer.from('BAD'));
  assert.equal(partial.objectChecksumSha256, descriptor.storedSha256);
  assert.notEqual(partial.deliveredSha256, objectBytesSha256(Buffer.from('one')));
  assert.equal(partial.completeObjectBytesVerified, false);
});

test('full-object range hashing rejects same-length corrupt bytes with matching metadata', () => {
  const original = Buffer.from('zero\none\ntwo\n');
  const corrupt = Buffer.from(original);
  corrupt[0] ^= 1;
  const { store, descriptor } = putFixtureBlob(memoryBackend({
    mutateGet: (result) => ({ ...result, bytes: corrupt }),
  }), original);
  assert.throws(() => store.readBlobRange(descriptor), {
    code: 'OBJECT_ONT_BLOB_RANGE',
  });
});

test('ObjectOntStore range wrapper preserves a synthetic native GCS 206 response', () => {
  const bytes = Buffer.from('native-range-fixture');
  const storedSha256 = objectBytesSha256(bytes);
  const requests = [];
  const backend = openGcsObjectBackend({
    bucket: 'range-fixture',
    accessToken: 'fixture-token-1',
    endpoint: 'https://storage.googleapis.com',
    transport: (request) => {
      requests.push(request);
      const rangeHeader = request.headers.range ?? null;
      const match = /^bytes=(\d+)-(\d*)$/u.exec(rangeHeader ?? '');
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) + 1 : bytes.length;
      const delivered = bytes.subarray(start, end);
      return {
        status: match ? 206 : 200,
        headers: {
          'content-length': String(delivered.length),
          'content-range': `bytes ${start}-${end - 1}/${bytes.length}`,
          'x-goog-generation': '1700000000000000',
          'x-goog-meta-oont-byte-length': String(bytes.length),
          'x-goog-meta-oont-sha256': storedSha256,
        },
        body: delivered,
      };
    },
  });
  const descriptor = {
    schemaVersion: 1,
    kind: 'OpenOntologyBlobDescriptorV1',
    key: `blobs/sha256/${storedSha256.slice(7)}`,
    logicalPath: `blobs/source-native/source-packs/sha256/${storedSha256.slice(7)}`,
    storedSha256,
    byteLength: bytes.length,
    mediaType: 'application/octet-stream',
  };
  const range = openObjectOntStore({ backend }).readBlobRange(descriptor, { start: 7, end: 12 });
  assert.deepEqual(range.bytes, bytes.subarray(7, 12));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.range, 'bytes=7-11');
  assert.equal(range.objectChecksumSha256, storedSha256);
  assert.equal(range.completeObjectBytesVerified, false);
});

test('source reader rejects matching-header corrupt selected ranges and does not read unknown refs', async () => {
  const { createSourceNativeObjectOntSourceReader } =
    await import('../../dist/source/object-ont.js');
  assert.equal(typeof createSourceNativeObjectOntSourceReader, 'function',
    'source-reader factory is supplied by the selected-source implementation lane');

  const root = mkdtempSync(join(tmpdir(), 'oont-source-reader-range-'));
  try {
    const objectRoot = join(root, 'objects');
    const historyRoot = join(root, 'history');
    const objectBackendUri = pathToFileURL(objectRoot).href;
    const historyBackendUri = pathToFileURL(historyRoot).href;
    const sources = [
      {
        relativePath: 'docs/a-selected.md',
        sourceType: 'docs',
        occurredAt: '2026-09-08T00:00:00.000Z',
        content: 'Selected source body.\n',
      },
      {
        relativePath: 'docs/b-other.md',
        sourceType: 'docs',
        occurredAt: '2026-09-08T00:00:01.000Z',
        content: 'Other source body in the same pack.\n',
      },
    ];
    const input = {
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeBuildInputV1',
      ontId: 'source-reader-range-fixture',
      namespace: 'source-reader-range-fixture',
      querySchemas: [{
        sourceSystem: 'docs', objectType: 'Document', aliases: ['document'],
        fields: [{ fieldPath: 'body', aliases: ['body'] }],
      }],
      sources,
      nativeObjectInputs: sources.map((source, index) => ({
        relativePath: source.relativePath,
        objectIdentity: {
          home: 'ObjectDef/InstanceRef',
          sourceSystem: 'docs',
          objectType: 'Document',
          namespace: 'source-reader-range-fixture',
          externalId: index === 0 ? 'selected' : 'other',
        },
        fields: [{ fieldPath: 'body', value: source.content, codeUnitStart: 0 }],
      })),
    };
    buildSourceNativeProduct({
      artifactRoot: join(root, 'artifact'),
      input,
      objectBackendUri,
      historyBackendUri,
    });
    const fileBackend = openFileObjectBackend({ root: objectRoot });
    const fileHistoryBackend = openFileObjectBackend({ root: historyRoot });
    const refIndex = openSourceNativeObjectOntRefIndex({
      backend: fileBackend,
      historyBackend: fileHistoryBackend,
      ontId: input.ontId,
      branch: 'main',
    });
    assert(refIndex);
    const selected = refIndex.objectOnt.sources.find((source) =>
      source.relativePath === 'docs/a-selected.md');
    const other = refIndex.objectOnt.sources.find((source) =>
      source.relativePath === 'docs/b-other.md');
    assert(selected);
    assert(other);
    assert.equal(selected.blobDescriptor.key, other.blobDescriptor.key);
    const selectedLength = selected.blobByteEnd - selected.blobByteStart;
    const corrupted = Buffer.alloc(selectedLength, 0x58);
    const selectedOriginal = Buffer.from(sources[0].content);
    assert.equal(corrupted.equals(selectedOriginal), false);
    const requests = [];
    const gcsBackend = openGcsObjectBackend({
      bucket: 'source-reader-range-fixture',
      accessToken: 'fixture-token-1',
      endpoint: 'https://storage.googleapis.com',
      transport: (request) => {
        requests.push(request);
        const match = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? '');
        assert(match, 'reader must request a bounded source range');
        const start = Number(match[1]);
        const end = Number(match[2]) + 1;
        assert.equal(start, selected.blobByteStart);
        assert.equal(end, selected.blobByteEnd);
        return {
          status: 206,
          headers: {
            'content-length': String(corrupted.length),
            'content-range': `bytes ${start}-${end - 1}/${selected.blobDescriptor.byteLength}`,
            'x-goog-generation': '1700000000000000',
            'x-goog-meta-oont-byte-length': String(selected.blobDescriptor.byteLength),
            'x-goog-meta-oont-sha256': selected.blobDescriptor.storedSha256,
          },
          body: corrupted,
        };
      },
    });
    const reader = createSourceNativeObjectOntSourceReader({
      store: openObjectOntStore({ backend: gcsBackend }),
      index: refIndex.objectOnt,
    });
    assert.throws(() => reader('docs/a-selected.md'), {
      code: 'SOURCE_NATIVE_OBJECT_ONT_SOURCE',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.range,
      `bytes=${selected.blobByteStart}-${selected.blobByteEnd - 1}`);

    requests.length = 0;
    assert.throws(() => reader('docs/unknown.md'), {
      code: 'SOURCE_NATIVE_OBJECT_ONT_SOURCE',
    });
    assert.equal(requests.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
