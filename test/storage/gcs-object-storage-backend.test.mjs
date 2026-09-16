#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encodeEntry, entry as makeEntry } from '../../dist/storage/assertion-envelope.js';
import { openGcsObjectBackend } from '../../dist/storage/gcs-backend.js';
import { openObjectOntStore } from '../../dist/storage/ont-store.js';

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
    const isDownload = !isUpload && segments[1] !== 'storage';
    const bucket = decodeURIComponent(segments[isDownload ? 1 : isUpload ? 5 : 4] ?? '');

    if (request.method === 'GET' && segments.length === 5 && segments[3] === 'b') {
      return json(200, { name: bucket });
    }

    const encodedKey = isUpload ? url.searchParams.get('name')
      : isDownload ? segments.slice(2).join('/') : segments.at(-1);
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
    if (isDownload) {
      const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) + 1 : current.bytes.length;
      if (range && (start >= current.bytes.length || end > current.bytes.length)
        || !range && (start > current.bytes.length || end > current.bytes.length)) {
        return { status: 416, headers: {}, body: Buffer.alloc(0) };
      }
      const bytes = current.bytes.subarray(start, end);
      const integrityHeaders = {
        'content-length': String(bytes.length),
        'x-goog-generation': current.generation,
        'x-goog-meta-oont-byte-length': String(current.bytes.length),
        'x-goog-meta-oont-sha256': current.metadata['oont-sha256'],
      };
      return {
        status: range ? 206 : 200,
        headers: {
          ...integrityHeaders,
          ...(range ? { 'content-range': `bytes ${start}-${end - 1}/${current.bytes.length}` } : {}),
        },
        body: bytes,
      };
    }
    if (url.searchParams.get('alt') !== 'media') return json(200, metadata(bucket, key, current));
    return { status: 200, headers: {}, body: Buffer.from(current.bytes) };
  };

  return { transport, requests, objects };
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

test('GCS observes a frozen bucket metadata transport attempt with bounded fields', () => {
  const fixture = gcsFixtureTransport();
  const observations = [];
  const backend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: fixture.transport,
    observeRequest: (observation) => observations.push(observation),
  });

  assert.equal(backend.ensureBucket().available, true);
  assert.equal(observations.length, 1);
  const [observation] = observations;
  assert.equal(Object.isFrozen(observation), true);
  assert.deepEqual(observation, {
    schemaVersion: 1,
    kind: 'OpenOntologyGcsRequestObservationV1',
    operationClass: 'bucket-metadata',
    method: 'GET',
    attempt: 1,
    status: 200,
    requestBodyBytes: 0,
    responseBodyBytes: Buffer.byteLength(JSON.stringify({ name: 'valid-bucket' })),
    elapsedTransportMs: observation.elapsedTransportMs,
    bucket: 'valid-bucket',
    prefix: null,
    failureClass: null,
  });
  assert.equal(Number.isFinite(observation.elapsedTransportMs), true);
  assert.equal(observation.elapsedTransportMs >= 0, true);
  assert.equal('authorization' in observation, false);
  assert.equal('url' in observation, false);
  assert.equal('body' in observation, false);
});

test('GCS observations distinguish reads, creates, conflicts, and CAS with exact body bytes', () => {
  const fixture = gcsFixtureTransport();
  const responses = [];
  const observations = [];
  const transport = (request) => {
    const response = fixture.transport(request);
    responses.push(response);
    return response;
  };
  const backend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    prefix: 'tenant-a/ont-a',
    accessToken: 'fixture-token-1',
    transport,
    observeRequest: (observation) => observations.push(observation),
  });
  const bytes = Buffer.from('alpha\nbeta\n');

  const created = backend.putIfAbsent('segments/example', bytes);
  assert.equal(created.created, true);
  const replayed = backend.putIfAbsent('segments/example', bytes);
  assert.equal(replayed.replayed, true);
  assert.equal(backend.get('segments/example', { start: 2, end: 7 }).bytes.toString(), 'pha\nb');
  const cas = backend.compareAndSwap('refs/main', { expectedVersion: null, bytes: Buffer.from('head') });
  assert.match(cas.version, /^gcs-v1:\d+$/u);

  assert.deepEqual(observations.map(({ operationClass, method, attempt, status, failureClass }) => ({
    operationClass,
    method,
    attempt,
    status,
    failureClass,
  })), [
    { operationClass: 'create-if-absent', method: 'POST', attempt: 1, status: 200, failureClass: null },
    { operationClass: 'create-if-absent', method: 'POST', attempt: 1, status: 412, failureClass: null },
    { operationClass: 'body-read', method: 'GET', attempt: 1, status: 200, failureClass: null },
    { operationClass: 'body-read', method: 'GET', attempt: 1, status: 206, failureClass: null },
    { operationClass: 'compare-and-swap', method: 'POST', attempt: 1, status: 200, failureClass: null },
  ]);
  for (const [index, observation] of observations.entries()) {
    assert.equal(observation.requestBodyBytes, fixture.requests[index].body.length);
    assert.equal(observation.responseBodyBytes, responses[index].body.length);
  }
});

test('GCS configuration and versions reject ambiguous or secret-bearing input', () => {
  const fixture = gcsFixtureTransport();
  for (const config of [
    {},
    { bucket: 'bad/bucket', accessToken: 'token', transport: fixture.transport },
    { bucket: 'valid-bucket', accessToken: 'line\nbreak', transport: fixture.transport },
    { bucket: 'valid-bucket', accessToken: 'token with space', transport: fixture.transport },
    { bucket: 'valid-bucket', accessToken: 'token', endpoint: 'http://storage.example.test', transport: fixture.transport },
    { bucket: 'valid-bucket', prefix: 'tenant-a/', accessToken: 'token', transport: fixture.transport },
    { bucket: 'valid-bucket', prefix: 'tenant-a//ont-a', accessToken: 'token', transport: fixture.transport },
    { bucket: 'valid-bucket', prefix: 'tenant-a/../ont-a', accessToken: 'token', transport: fixture.transport },
    {
      bucket: 'valid-bucket',
      prefix: `tenant-${'a'.repeat(510)}`,
      accessToken: 'token',
      transport: fixture.transport,
    },
    {
      bucket: 'valid-bucket',
      accessToken: 'token',
      accessTokenProvider: () => 'provider-token',
      transport: fixture.transport,
    },
    {
      bucket: 'valid-bucket',
      accessToken: 'token',
      observeRequest: 'not-a-callback',
      transport: fixture.transport,
    },
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

test('GCS scoped prefixes bind provider keys while receipts remain logical', () => {
  const fixture = gcsFixtureTransport();
  let tokenCalls = 0;
  const backend = openGcsObjectBackend({
    bucket: 'customer-ontology',
    prefix: 'tenant-a/ont-a',
    accessTokenProvider: () => `fixture-token-${tokenCalls += 1}`,
    transport: fixture.transport,
  });

  const receipt = backend.putIfAbsent('refs/main', Buffer.from('scoped'));
  const upload = fixture.requests.find((request) => new URL(request.url).pathname.startsWith('/upload/'));
  assert(upload);
  assert.equal(new URL(upload.url).searchParams.get('name'), 'tenant-a/ont-a/refs/main');
  assert.equal(receipt.key, 'refs/main');
  assert.equal(backend.capabilities.keyPrefix, 'tenant-a/ont-a');
  assert.equal(tokenCalls, 1);
  assert.equal(backend.get('refs/main').bytes.toString(), 'scoped');
  assert.equal(fixture.objects.has('tenant-a/ont-a/refs/main'), true);
  assert.equal(fixture.objects.has('refs/main'), false);
  assert.throws(
    () => backend.putIfAbsent(`${'a'.repeat(1010)}`, Buffer.from('too long')),
    { code: 'OBJECT_BACKEND_KEY' },
  );
});

test('GCS full and ranged reads use one media request and validate response integrity', () => {
  const fixture = gcsFixtureTransport();
  const backend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    prefix: 'tenant-a/ont-a',
    accessToken: 'fixture-token-1',
    transport: fixture.transport,
  });
  const bytes = Buffer.from('zero\none\ntwo\n');
  backend.putIfAbsent('segments/sha256/example', bytes);

  const beforeFull = fixture.requests.length;
  assert.deepEqual(backend.get('segments/sha256/example').bytes, bytes);
  assert.equal(fixture.requests.length - beforeFull, 1);

  const emptyFixture = gcsFixtureTransport();
  const emptyBackend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: emptyFixture.transport,
  });
  emptyBackend.putIfAbsent('segments/sha256/empty', Buffer.alloc(0));
  assert.deepEqual(emptyBackend.get('segments/sha256/empty').bytes, Buffer.alloc(0));

  const beforeRange = fixture.requests.length;
  assert.equal(backend.get('segments/sha256/example', { start: 5, end: 8 }).bytes.toString(), 'one');
  assert.equal(fixture.requests.length - beforeRange, 1);

  const corruptFixture = gcsFixtureTransport();
  const corruptBackend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: (request) => {
      const response = corruptFixture.transport(request);
      if (request.method === 'GET' && new URL(request.url).pathname.split('/')[1] !== 'storage') {
        response.headers['x-goog-meta-oont-sha256'] = 'sha256:' + '0'.repeat(64);
      }
      return response;
    },
  });
  corruptBackend.putIfAbsent('segments/sha256/example', bytes);
  assert.throws(() => corruptBackend.get('segments/sha256/example'), {
    code: 'OBJECT_BACKEND_CORRUPT',
  });
  assert.throws(() => corruptBackend.get('segments/sha256/example', { start: 0, end: bytes.length }), {
    code: 'OBJECT_BACKEND_CORRUPT',
  });

  const rangeCorruptFixture = gcsFixtureTransport();
  const rangeCorruptBackend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: (request) => {
      const response = rangeCorruptFixture.transport(request);
      if (request.method === 'GET' && new URL(request.url).pathname.split('/')[1] !== 'storage'
        && response.status === 206) {
        response.headers['content-range'] = `bytes 0-${bytes.length - 1}/${bytes.length}`;
      }
      return response;
    },
  });
  rangeCorruptBackend.putIfAbsent('segments/sha256/example', bytes);
  assert.throws(() => rangeCorruptBackend.get('segments/sha256/example', { start: 5, end: 8 }), {
    code: 'OBJECT_BACKEND_CORRUPT',
  });
});

test('GCS retries only bounded reads and reacquires renewable credentials', () => {
  const fixture = gcsFixtureTransport();
  let transientReads = 2;
  let transportCalls = 0;
  let tokenCalls = 0;
  const retryDelays = [];
  const transport = (request) => {
    transportCalls += 1;
    if (request.method === 'GET' && transientReads > 0) {
      transientReads -= 1;
      const error = new Error('OBJECT_BACKEND_GCS_TRANSPORT');
      error.code = 'OBJECT_BACKEND_GCS_TRANSPORT';
      throw error;
    }
    return fixture.transport(request);
  };
  const backend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessTokenProvider: () => `fixture-token-${tokenCalls += 1}`,
    transport,
    maximumReadAttempts: 3,
    retryDelay: (attempt) => retryDelays.push(attempt),
  });
  assert.equal(backend.ensureBucket().available, true);
  assert.equal(transportCalls, 3);
  assert.equal(tokenCalls, 3);
  assert.deepEqual(retryDelays, [1, 2]);
  assert.equal(backend.capabilities.maximumReadAttempts, 3);

  const statusFixture = gcsFixtureTransport();
  let transientStatuses = 2;
  let statusCalls = 0;
  const statusBackend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: (request) => {
      statusCalls += 1;
      if (request.method === 'GET' && transientStatuses > 0) {
        transientStatuses -= 1;
        return { status: 503, headers: {}, body: Buffer.alloc(0) };
      }
      return statusFixture.transport(request);
    },
    maximumReadAttempts: 3,
    retryDelay: () => {},
  });
  assert.equal(statusBackend.ensureBucket().available, true);
  assert.equal(statusCalls, 3);

  let writeCalls = 0;
  const unsafeWrite = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: () => {
      writeCalls += 1;
      const error = new Error('OBJECT_BACKEND_GCS_TRANSPORT');
      error.code = 'OBJECT_BACKEND_GCS_TRANSPORT';
      throw error;
    },
    maximumReadAttempts: 3,
    retryDelay: () => assert.fail('write retry delay must not run'),
  });
  assert.throws(() => unsafeWrite.putIfAbsent('segments/sha256/example', Buffer.from('value')), {
    code: 'OBJECT_BACKEND_GCS_TRANSPORT',
  });
  assert.equal(writeCalls, 1);
});

test('GCS elapsed transport time excludes token refresh and retry backoff', () => {
  const fixture = gcsFixtureTransport();
  const observations = [];
  const originalHrtimeBigint = process.hrtime.bigint;
  let clock = 0n;
  let transientStatuses = 1;
  let tokenCalls = 0;
  process.hrtime.bigint = () => clock;
  try {
    const backend = openGcsObjectBackend({
      bucket: 'valid-bucket',
      accessTokenProvider: () => {
        tokenCalls += 1;
        clock += 100_000_000n;
        return `fixture-token-${tokenCalls}`;
      },
      transport: (request) => {
        clock += request.headers.range ? 7_000_000n : 5_000_000n;
        if (request.method === 'GET' && transientStatuses > 0) {
          transientStatuses -= 1;
          return { status: 503, headers: {}, body: Buffer.from('busy') };
        }
        return fixture.transport(request);
      },
      maximumReadAttempts: 2,
      retryDelay: () => { clock += 200_000_000n; },
      observeRequest: (observation) => observations.push(observation),
    });
    assert.equal(backend.ensureBucket().available, true);
  } finally {
    process.hrtime.bigint = originalHrtimeBigint;
  }
  assert.deepEqual(observations.map(({ attempt, status, elapsedTransportMs }) => ({
    attempt,
    status,
    elapsedTransportMs,
  })), [
    { attempt: 1, status: 503, elapsedTransportMs: 5 },
    { attempt: 2, status: 200, elapsedTransportMs: 5 },
  ]);
  assert.equal(tokenCalls, 2);
});

test('GCS observations retain retry, transport, and malformed-response classifications', () => {
  const retryFixture = gcsFixtureTransport();
  const retryObservations = [];
  let transientStatuses = 1;
  const retryBackend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: (request) => {
      if (request.method === 'GET' && transientStatuses > 0) {
        transientStatuses -= 1;
        return { status: 503, headers: {}, body: Buffer.from('busy') };
      }
      return retryFixture.transport(request);
    },
    maximumReadAttempts: 2,
    retryDelay: () => {},
    observeRequest: (observation) => retryObservations.push(observation),
  });
  assert.equal(retryBackend.ensureBucket().available, true);
  assert.deepEqual(retryObservations.map(({ attempt, status, responseBodyBytes, failureClass }) => ({
    attempt,
    status,
    responseBodyBytes,
    failureClass,
  })), [
    { attempt: 1, status: 503, responseBodyBytes: 4, failureClass: null },
    {
      attempt: 2,
      status: 200,
      responseBodyBytes: Buffer.byteLength(JSON.stringify({ name: 'valid-bucket' })),
      failureClass: null,
    },
  ]);

  const expectedError = Object.assign(new Error('transport failure'), {
    code: 'OBJECT_BACKEND_GCS_TRANSPORT',
  });
  const transportObservations = [];
  const transportBackend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: () => { throw expectedError; },
    maximumReadAttempts: 2,
    retryDelay: () => {},
    observeRequest: (observation) => transportObservations.push(observation),
  });
  let actualError;
  try { transportBackend.ensureBucket(); } catch (error) { actualError = error; }
  assert.equal(actualError, expectedError);
  assert.deepEqual(transportObservations.map(({ attempt, status, responseBodyBytes, failureClass }) => ({
    attempt,
    status,
    responseBodyBytes,
    failureClass,
  })), [
    { attempt: 1, status: null, responseBodyBytes: null, failureClass: 'transport' },
    { attempt: 2, status: null, responseBodyBytes: null, failureClass: 'transport' },
  ]);

  const malformedObservations = [];
  const malformedBackend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: () => ({ status: 200, headers: {}, body: 'not-a-buffer' }),
    observeRequest: (observation) => malformedObservations.push(observation),
  });
  assert.throws(() => malformedBackend.ensureBucket(), { code: 'OBJECT_BACKEND_GCS_RESPONSE' });
  assert.deepEqual(malformedObservations.map(({ attempt, status, responseBodyBytes, failureClass }) => ({
    attempt,
    status,
    responseBodyBytes,
    failureClass,
  })), [{ attempt: 1, status: 200, responseBodyBytes: null, failureClass: 'malformed-response' }]);

  const authError = new Error('authentication failure');
  const authObservations = [];
  let authTransportCalls = 0;
  const authBackend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessTokenProvider: () => { throw authError; },
    transport: () => {
      authTransportCalls += 1;
      return retryFixture.transport({
        method: 'GET',
        url: 'https://storage.googleapis.com/storage/v1/b/valid-bucket',
        headers: {},
        body: Buffer.alloc(0),
        curlPath: '/usr/bin/curl',
      });
    },
    observeRequest: (observation) => authObservations.push(observation),
  });
  let actualAuthError;
  try { authBackend.ensureBucket(); } catch (error) { actualAuthError = error; }
  assert.equal(actualAuthError, authError);
  assert.equal(authTransportCalls, 0);
  assert.deepEqual(authObservations, []);
});

test('GCS observer failures do not alter outcomes or repeat the diagnostic', () => {
  const fixture = gcsFixtureTransport();
  let observerCalls = 0;
  const diagnostics = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    diagnostics.push(String(chunk));
    return true;
  };
  const backend = openGcsObjectBackend({
    bucket: 'valid-bucket',
    accessToken: 'fixture-token-1',
    transport: fixture.transport,
    observeRequest: () => {
      observerCalls += 1;
      throw new Error('observer secret must not escape');
    },
  });
  try {
    const receipt = backend.compareAndSwap('refs/main', {
      expectedVersion: null,
      bytes: Buffer.from('committed'),
    });
    assert.match(receipt.version, /^gcs-v1:\d+$/u);
    assert.equal(backend.get('refs/main').bytes.toString(), 'committed');
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(observerCalls, 2);
  assert.deepEqual(diagnostics, ['OpenOntology GCS request observer failed; accounting incomplete\n']);
});

test('GCS classifies transport parser failures without changing the original error', () => {
  const expectedError = Object.assign(new Error('malformed provider response'), {
    code: 'OBJECT_BACKEND_GCS_RESPONSE',
  });
  const observations = [];
  const backend = openGcsObjectBackend({
    bucket: 'valid-bucket', accessToken: 'fixture-token',
    transport: () => { throw expectedError; },
    observeRequest: (observation) => observations.push(observation),
  });
  assert.throws(() => backend.ensureBucket(), (error) => error === expectedError);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].failureClass, 'malformed-response');
  assert.equal(observations[0].responseBodyBytes, null);
  assert.equal(observations[0].status, null);
});

test('GCS async observer rejection cannot terminate a committed writer or leak its error', () => {
  const moduleUrl = new URL('../../dist/storage/gcs-backend.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createHash } from 'node:crypto';
    import { openGcsObjectBackend } from ${JSON.stringify(moduleUrl)};
    const bytes = Buffer.from('committed');
    const metadata = { bucket: 'valid-bucket', name: 'refs/main', generation: '1',
      size: String(bytes.length), metadata: { 'oont-byte-length': String(bytes.length),
        'oont-sha256': 'sha256:' + createHash('sha256').update(bytes).digest('hex') } };
    const backend = openGcsObjectBackend({ bucket: 'valid-bucket', accessToken: 'fixture-token',
      transport: () => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify(metadata)) }),
      observeRequest: async () => { throw new Error('observer-secret-must-not-escape'); } });
    const committed = backend.compareAndSwap('refs/main', { bytes });
    const current = backend.head('refs/main');
    await new Promise(resolve => setImmediate(resolve));
    process.stdout.write(JSON.stringify({ committed: committed.version, current: current.version }));
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { committed: 'gcs-v1:1', current: 'gcs-v1:1' });
  assert.equal(child.stderr, 'OpenOntology GCS request observer failed; accounting incomplete\n');
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
