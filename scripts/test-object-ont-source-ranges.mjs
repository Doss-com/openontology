import assert from 'node:assert/strict';
import test from 'node:test';

import { openGcsObjectBackend } from '../dist/src/gcs-object-storage-backend.mjs';
import { objectBytesSha256, openObjectOntStore } from '../dist/src/kernel.mjs';

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
