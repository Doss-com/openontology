#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeEntry, entry as makeEntry } from '../src/assertion-envelope.mjs';
import { openGcsObjectBackend } from '../src/gcs-object-storage-backend.mjs';
import { openObjectOntStore } from '../src/object-ont-store.mjs';

const json = (status, value) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(JSON.stringify(value)),
});

function multipartParts(body, contentType) {
  const boundary = /boundary=([^;\s]+)/u.exec(contentType)?.[1];
  assert(boundary, contentType);
  const marker = Buffer.from(`--${boundary}`);
  const separator = Buffer.from('\r\n\r\n');
  const chunks = [];
  let cursor = body.indexOf(marker);
  while (cursor >= 0) {
    cursor += marker.length;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    assert(body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n')));
    cursor += 2;
    const headerEnd = body.indexOf(separator, cursor);
    assert(headerEnd >= 0);
    const next = body.indexOf(Buffer.concat([Buffer.from('\r\n'), marker]), headerEnd + separator.length);
    assert(next >= 0);
    chunks.push({
      headers: body.subarray(cursor, headerEnd).toString('utf8'),
      body: body.subarray(headerEnd + separator.length, next),
    });
    cursor = next + 2;
  }
  assert.equal(chunks.length, 2);
  return chunks;
}

function gcsFixtureTransport() {
  const objects = new Map();
  const requests = [];
  let nextGeneration = 1_700_000_000_000_000n;

  const metadata = (bucket, key, row) => ({
    bucket,
    name: key,
    generation: row.generation,
    size: String(row.bytes.length),
    metadata: row.metadata,
  });

  const transport = (request) => {
    requests.push(request);
    assert.match(request.headers.authorization, /^Bearer fixture-token-\d+$/u);
    const url = new URL(request.url);
    const segments = url.pathname.split('/');
    const isUpload = segments[1] === 'upload';
    const bucket = decodeURIComponent(segments[isUpload ? 5 : 4] ?? '');

    if (request.method === 'GET' && segments.length === 5 && segments[3] === 'b') {
      return json(200, { name: bucket });
    }

    const encodedKey = isUpload ? url.searchParams.get('name') : segments.at(-1);
    const key = decodeURIComponent(encodedKey ?? '');

    if (isUpload) {
      const expected = url.searchParams.get('ifGenerationMatch');
      const current = objects.get(key) ?? null;
      if (expected === '0' ? current !== null : current?.generation !== expected) return json(412, {});
      const parts = multipartParts(request.body, request.headers['content-type']);
      const objectMetadata = JSON.parse(parts[0].body.toString('utf8'));
      const row = {
        generation: String(nextGeneration),
        bytes: Buffer.from(parts[1].body),
        metadata: objectMetadata.metadata,
      };
      nextGeneration += 7n;
      objects.set(key, row);
      return json(200, metadata(bucket, key, row));
    }

    const current = objects.get(key) ?? null;
    if (current === null) return json(404, {});
    if (url.searchParams.get('alt') !== 'media') return json(200, metadata(bucket, key, current));
    if (url.searchParams.get('ifGenerationMatch') !== current.generation) return json(412, {});
    const range = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.range ?? '');
    if (!range) return { status: 200, headers: {}, body: Buffer.from(current.bytes) };
    const start = Number(range[1]);
    const end = Number(range[2]) + 1;
    return { status: 206, headers: {}, body: current.bytes.subarray(start, end) };
  };

  return { transport, requests };
}

test('GCS satisfies the canonical object contract with native generation preconditions', () => {
  const fixture = gcsFixtureTransport();
  let tokenCalls = 0;
  const backend = openGcsObjectBackend({
    bucket: 'customer-ontology',
    accessTokenProvider: () => `fixture-token-${tokenCalls += 1}`,
    transport: fixture.transport,
  });

  assert.equal(backend.capabilities.backend, 'gcs');
  assert.equal(backend.capabilities.distributedObjectStore, true);
  assert.equal(backend.capabilities.multiProcessCas, true);
  assert.equal(backend.capabilities.providerConditionalWritePolicy, true);
  assert.equal(backend.capabilities.nativeGenerationPreconditions, true);
  assert.equal(backend.ensureBucket().available, true);
  assert.equal(backend.head('segments/sha256/example'), null);

  const immutableBytes = Buffer.from('zero\none\ntwo\n');
  const immutable = backend.putIfAbsent('segments/sha256/example', immutableBytes);
  assert.equal(immutable.created, true);
  assert.equal(immutable.replayed, false);
  assert.match(immutable.version, /^gcs-v1:\d+$/u);
  assert.equal(typeof immutable.generation, 'string');
  const replay = backend.putIfAbsent('segments/sha256/example', immutableBytes);
  assert.equal(replay.created, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.version, immutable.version);
  assert.throws(
    () => backend.putIfAbsent('segments/sha256/example', Buffer.from('different')),
    { code: 'OBJECT_BACKEND_PRECONDITION' },
  );
  assert.deepEqual(backend.get('segments/sha256/example').bytes, immutableBytes);
  assert.equal(backend.get('segments/sha256/example', { start: 5, end: 8 }).bytes.toString(), 'one');
  assert.equal(backend.get('segments/sha256/example', { start: 4, end: 4 }).bytes.length, 0);

  const key = 'refs/example/main.json';
  const one = backend.compareAndSwap(key, { expectedVersion: null, bytes: Buffer.from('one') });
  const two = backend.compareAndSwap(key, { expectedVersion: one.version, bytes: Buffer.from('two') });
  const oneAgain = backend.compareAndSwap(key, { expectedVersion: two.version, bytes: Buffer.from('one') });
  assert.notEqual(oneAgain.version, one.version);
  assert.equal(oneAgain.previousVersion, two.version);
  assert.throws(
    () => backend.compareAndSwap(key, { expectedVersion: one.version, bytes: Buffer.from('stale') }),
    { code: 'OBJECT_BACKEND_PRECONDITION' },
  );
  assert.equal(backend.get(key).bytes.toString(), 'one');

  const uploadPreconditions = fixture.requests
    .filter((request) => new URL(request.url).pathname.startsWith('/upload/'))
    .map((request) => new URL(request.url).searchParams.get('ifGenerationMatch'));
  assert.equal(uploadPreconditions[0], '0');
  assert(uploadPreconditions.includes(one.generation));
  assert(uploadPreconditions.includes(two.generation));
  assert.equal(tokenCalls, fixture.requests.length);
});

test('GCS configuration and versions reject ambiguous or secret-bearing input', () => {
  const fixture = gcsFixtureTransport();
  for (const config of [
    {},
    { bucket: 'bad/bucket', accessToken: 'token', transport: fixture.transport },
    { bucket: 'valid-bucket', accessToken: 'line\nbreak', transport: fixture.transport },
    { bucket: 'valid-bucket', accessToken: 'token', endpoint: 'http://storage.example.test', transport: fixture.transport },
  ]) assert.throws(() => openGcsObjectBackend(config), { code: 'OBJECT_BACKEND_GCS_CONFIG' });

  const backend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'token',
    transport: fixture.transport,
  });
  assert.throws(
    () => backend.compareAndSwap('refs/main', { expectedVersion: 'gcs-v1:not-a-generation', bytes: 'x' }),
    { code: 'OBJECT_BACKEND_VERSION' },
  );
});

test('GCS carries a complete ObjectOnt commit, branch activation, and exact replay', () => {
  const fixture = gcsFixtureTransport();
  let tokenCalls = 0;
  const backend = openGcsObjectBackend({
    bucket: 'customer-ontology',
    accessTokenProvider: () => `fixture-token-${tokenCalls += 1}`,
    transport: fixture.transport,
  });
  const store = openObjectOntStore({ backend });
  const manifest = store.putBlob({
    logicalPath: 'oont.json',
    bytes: Buffer.from('{"v":"oont.ont/v1","org":"gcs-fixture","layout":"log/v1"}\n'),
    mediaType: 'application/json',
  });
  const entry = makeEntry({
    kind: 'element',
    about: 'gcs-fixture',
    body: { value: 'generation-bound' },
    provenance: 'authored',
    producer: 'gcs-test',
    recordedAt: '2026-09-03T00:00:00.000Z',
  });
  const segment = store.putAssertionSegment({
    logicalPath: 'ledger/gcs-test.jsonl',
    jsonlBytes: Buffer.from(`${encodeEntry(entry)}\n`),
  });
  const commit = store.writeCommit({
    ontId: 'gcs-fixture',
    ontManifest: manifest,
    segments: [segment],
  });
  const activated = store.compareAndSwapRef({
    ontId: 'gcs-fixture',
    branch: 'main',
    expectedVersion: null,
    commitSha256: commit.commitSha256,
  });

  assert.equal(store.readRef({ ontId: 'gcs-fixture', branch: 'main' }).version, activated.version);
  assert.equal(store.replay(commit.commitSha256).entries[0].id, entry.id);
  assert(tokenCalls > 0);
});
