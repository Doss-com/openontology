#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  objectBytesSha256,
  openObjectOntStore,
  stableObjectText,
} from '../dist/src/object-ont-store.mjs';

function backendError(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function openMemoryObjectBackend() {
  const objects = new Map();
  const receipt = (key, object, extra = {}) => Object.freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyObjectWriteReceiptV1',
    key,
    version: `memory-v1:${object.generation}`,
    checksumSha256: objectBytesSha256(object.bytes),
    byteLength: object.bytes.length,
    generation: object.generation,
    ...extra,
  });
  return {
    capabilities: Object.freeze({ backend: 'memory-test' }),
    head(key) {
      const object = objects.get(key);
      return object === undefined ? null : receipt(key, object);
    },
    get(key, { start = 0, end = null } = {}) {
      const object = objects.get(key);
      if (object === undefined) backendError('OBJECT_BACKEND_NOT_FOUND');
      const finalEnd = end ?? object.bytes.length;
      return Object.freeze({
        ...receipt(key, object),
        bytes: object.bytes.subarray(start, finalEnd),
        range: Object.freeze({ start, end: finalEnd }),
      });
    },
    putIfAbsent(key, bytesInput) {
      const bytes = Buffer.from(bytesInput);
      const existing = objects.get(key);
      if (existing !== undefined) {
        if (!existing.bytes.equals(bytes)) backendError('OBJECT_BACKEND_PRECONDITION');
        return receipt(key, existing, { created: false, replayed: true });
      }
      const object = Object.freeze({ bytes, generation: 1 });
      objects.set(key, object);
      return receipt(key, object, { created: true, replayed: false });
    },
    compareAndSwap(key, { expectedVersion = null, bytes: bytesInput } = {}) {
      const existing = objects.get(key);
      const version = existing === undefined ? null : `memory-v1:${existing.generation}`;
      if (version !== expectedVersion) backendError('OBJECT_BACKEND_PRECONDITION');
      const object = Object.freeze({
        bytes: Buffer.from(bytesInput),
        generation: existing === undefined ? 1 : existing.generation + 1,
      });
      objects.set(key, object);
      return receipt(key, object, { previousVersion: version });
    },
    overwrite(key, bytesInput) {
      const existing = objects.get(key);
      const object = Object.freeze({
        bytes: Buffer.from(bytesInput),
        generation: existing === undefined ? 1 : existing.generation + 1,
      });
      objects.set(key, object);
    },
    remove(key) {
      objects.delete(key);
    },
  };
}

function manifestFor(store) {
  return store.putBlob({
    logicalPath: 'oont.json',
    bytes: Buffer.from('{}'),
    mediaType: 'application/json',
  });
}

function commitFor(store, manifest, ontId, parents = []) {
  return store.writeCommitMetadata({ ontId, parents, ontManifest: manifest });
}

function faultBackend(raw, { failCasAt = [], keyPrefix = null } = {}) {
  let calls = 0;
  return {
    capabilities: raw.capabilities,
    head: (...args) => raw.head(...args),
    get: (...args) => raw.get(...args),
    putIfAbsent: (...args) => raw.putIfAbsent(...args),
    compareAndSwap(key, options) {
      calls += 1;
      if ((!keyPrefix || key.startsWith(keyPrefix)) && failCasAt.includes(calls)) backendError('OBJECT_BACKEND_PRECONDITION');
      return raw.compareAndSwap(key, options);
    },
  };
}

test('cold protected readers refuse a rewind and recover only the witnessed target', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const writer = openObjectOntStore({ backend: data, historyBackend: history });
  const manifest = manifestFor(writer);
  const first = commitFor(writer, manifest, 'history-fixture');
  const second = commitFor(writer, manifest, 'history-fixture', [first.commitSha256]);

  const firstPublished = writer.compareAndSwapRefMetadata({
    ontId: 'history-fixture',
    branch: 'main',
    commitSha256: first.commitSha256,
  });
  const secondPublished = writer.compareAndSwapRefMetadata({
    ontId: 'history-fixture',
    branch: 'main',
    expectedVersion: firstPublished.version,
    commitSha256: second.commitSha256,
  });

  const refBytes = Buffer.from(stableObjectText(firstPublished.ref));
  data.compareAndSwap(secondPublished.key, {
    expectedVersion: secondPublished.version,
    bytes: refBytes,
  });

  const cold = openObjectOntStore({ backend: data, historyBackend: history });
  assert.throws(() => cold.readRefMetadata({ ontId: 'history-fixture', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_MISMATCH',
  });
  cold.recoverRefHistory({ ontId: 'history-fixture', branch: 'main' });
  assert.equal(cold.readRefMetadata({ ontId: 'history-fixture', branch: 'main' }).ref.commitSha256,
    second.commitSha256);
});

test('enrollment is explicit, legacy mode remains available, and historical reads stay immutable', () => {
  const data = openMemoryObjectBackend();
  const legacy = openObjectOntStore({ backend: data });
  const manifest = manifestFor(legacy);
  const commit = commitFor(legacy, manifest, 'history-enrollment');
  const published = legacy.compareAndSwapRefMetadata({
    ontId: 'history-enrollment',
    branch: 'main',
    commitSha256: commit.commitSha256,
  });
  const history = openMemoryObjectBackend();
  const protectedStore = openObjectOntStore({ backend: data, historyBackend: history });
  assert.throws(() => protectedStore.readRefHead({ ontId: 'history-enrollment', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_MISSING',
  });
  const receipt = protectedStore.initializeRefHistory({
    ontId: 'history-enrollment',
    branch: 'main',
    expectedCommitSha256: commit.commitSha256,
    expectedReplaySha256: legacy.replayMetadata(commit.commitSha256).replaySha256,
  });
  assert.equal(receipt.acceptedRef.commitSha256, published.ref.commitSha256);
  assert.equal(protectedStore.readRefHead({ ontId: 'history-enrollment', branch: 'main' }).ref.commitSha256,
    commit.commitSha256);

  data.overwrite(published.key, Buffer.from(stableObjectText({
    ...published.ref,
    commitSha256: commit.commitSha256,
  })));
  assert.deepEqual(protectedStore.readCommit(commit.commitSha256).commit, legacy.readCommit(commit.commitSha256).commit);
  assert.equal(protectedStore.replayMetadata(commit.commitSha256).tipCommitSha256, commit.commitSha256);
});

test('protected publication covers ordinary, metadata, and checkpointed variants', () => {
  const variants = [
    ['ordinary', (store, input) => store.compareAndSwapRef(input)],
    ['metadata', (store, input) => store.compareAndSwapRefMetadata(input)],
    ['checkpointed', (store, input) => store.compareAndSwapRefMetadataCheckpointed(input)],
  ];
  for (const [name, publish] of variants) {
    const data = openMemoryObjectBackend();
    const history = openMemoryObjectBackend();
    const store = openObjectOntStore({ backend: data, historyBackend: history });
    const manifest = manifestFor(store);
    const first = commitFor(store, manifest, `history-variant-${name}`);
    const firstResult = publish(store, {
      ontId: `history-variant-${name}`,
      branch: 'main',
      commitSha256: first.commitSha256,
    });
    const second = commitFor(store, manifest, `history-variant-${name}`, [first.commitSha256]);
    assert.throws(() => publish(store, {
      ontId: `history-variant-${name}`,
      branch: 'main',
      expectedVersion: 'memory-v1:stale',
      commitSha256: second.commitSha256,
    }), { code: 'OBJECT_BACKEND_PRECONDITION' });
    const equalResult = publish(store, {
      ontId: `history-variant-${name}`,
      branch: 'main',
      expectedVersion: firstResult.version,
      commitSha256: first.commitSha256,
    });
    const secondResult = publish(store, {
      ontId: `history-variant-${name}`,
      branch: 'main',
      expectedVersion: equalResult.version,
      commitSha256: second.commitSha256,
    });
    assert.equal(store.readRefHead({ ontId: `history-variant-${name}`, branch: 'main' }).ref.commitSha256,
      second.commitSha256);
    assert.equal(store.readRef({ ontId: `history-variant-${name}`, branch: 'main' }).ref.commitSha256,
      second.commitSha256);
    assert.equal(store.readRefMetadata({ ontId: `history-variant-${name}`, branch: 'main' }).ref.commitSha256,
      second.commitSha256);
    assert.equal(store.readRefMetadataSnapshot({ ontId: `history-variant-${name}`, branch: 'main' })
      .ref.commitSha256, second.commitSha256);
    assert.equal(store.readRefMetadataCheckpointSnapshot({ ontId: `history-variant-${name}`, branch: 'main' })
      .ref.commitSha256, second.commitSha256);
    assert.notEqual(secondResult.version, firstResult.version);
  }
});

test('protected recovery refuses an unaccepted third state and malformed history', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const store = openObjectOntStore({ backend: data, historyBackend: history });
  const manifest = manifestFor(store);
  const first = commitFor(store, manifest, 'history-negative');
  const second = commitFor(store, manifest, 'history-negative', [first.commitSha256]);
  const forkManifest = store.putBlob({
    logicalPath: 'oont.json',
    bytes: Buffer.from('{"fork":true}'),
    mediaType: 'application/json',
  });
  const fork = commitFor(store, forkManifest, 'history-negative');
  const firstResult = store.compareAndSwapRefMetadata({
    ontId: 'history-negative', branch: 'main', commitSha256: first.commitSha256,
  });
  store.compareAndSwapRefMetadata({
    ontId: 'history-negative', branch: 'main', expectedVersion: firstResult.version, commitSha256: second.commitSha256,
  });
  const forkReplay = store.replayMetadata(fork.commitSha256);
  data.overwrite('refs/history-negative/main.json', Buffer.from(stableObjectText({
    ...firstResult.ref,
    commitSha256: fork.commitSha256,
    replaySha256: forkReplay.replaySha256,
  })));
  assert.throws(() => store.recoverRefHistory({ ontId: 'history-negative', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_CONFLICT',
  });

  const historyKey = 'ref-history/history-negative/main.json';
  history.overwrite(historyKey, Buffer.from('{"corrupt":true}'));
  assert.throws(() => store.readRefHead({ ontId: 'history-negative', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_CORRUPT',
  });
});

test('malformed supplied history backends refuse without changing legacy setup', () => {
  const data = openMemoryObjectBackend();
  assert.throws(() => openObjectOntStore({ backend: data, historyBackend: null }), {
    code: 'OBJECT_ONT_HISTORY_BACKEND',
  });
  assert.throws(() => openObjectOntStore({ backend: data, historyBackend: {} }), {
    code: 'OBJECT_ONT_HISTORY_BACKEND',
  });
  const legacy = openObjectOntStore({ backend: data });
  assert.equal(legacy.readRefHead({ ontId: 'new-legacy', branch: 'main' }), null);
});

test('reservation, data-ref, and finalization failures leave recoverable exact targets', () => {
  const variants = [
    ['reservation', 'history', [1]],
    ['data-ref', 'data', [1]],
    ['finalization', 'history', [2]],
  ];
  for (const [name, failingSide, failCasAt] of variants) {
    const data = openMemoryObjectBackend();
    const history = openMemoryObjectBackend();
    const dataBackend = failingSide === 'data'
      ? faultBackend(data, { failCasAt, keyPrefix: 'refs/' }) : data;
    const historyBackend = failingSide === 'history'
      ? faultBackend(history, { failCasAt, keyPrefix: 'ref-history/' }) : history;
    const store = openObjectOntStore({ backend: dataBackend, historyBackend });
    const manifest = manifestFor(store);
    const first = commitFor(store, manifest, `history-fault-${name}`);
    const second = commitFor(store, manifest, `history-fault-${name}`, [first.commitSha256]);
    if (name === 'reservation') {
      assert.throws(() => store.compareAndSwapRefMetadata({
        ontId: `history-fault-${name}`,
        branch: 'main',
        commitSha256: second.commitSha256,
      }), { code: 'OBJECT_BACKEND_PRECONDITION' });
      assert.equal(data.head('refs/history-fault-reservation/main.json'), null);
    } else {
      const firstStore = openObjectOntStore({ backend: data, historyBackend: history });
      const firstResult = firstStore.compareAndSwapRefMetadata({
        ontId: `history-fault-${name}`, branch: 'main', commitSha256: first.commitSha256,
      });
      assert.throws(() => store.compareAndSwapRefMetadata({
        ontId: `history-fault-${name}`,
        branch: 'main',
        expectedVersion: firstResult.version,
        commitSha256: second.commitSha256,
      }), { code: 'OBJECT_BACKEND_PRECONDITION' });
      const recovering = openObjectOntStore({ backend: data, historyBackend: history });
      assert.throws(() => recovering.readRefHead({ ontId: `history-fault-${name}`, branch: 'main' }), {
        code: 'OBJECT_ONT_HISTORY_PENDING',
      });
      if (name === 'data-ref') data.remove(`refs/history-fault-${name}/main.json`);
      if (name === 'finalization') data.overwrite(
        `refs/history-fault-${name}/main.json`,
        Buffer.from(stableObjectText(firstResult.ref)),
      );
      recovering.recoverRefHistory({ ontId: `history-fault-${name}`, branch: 'main' });
      assert.equal(recovering.readRefHead({ ontId: `history-fault-${name}`, branch: 'main' }).ref.commitSha256,
        second.commitSha256);
    }
  }
});

test('recovery refuses an accepted target whose immutable payload is unavailable', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const store = openObjectOntStore({ backend: data, historyBackend: history });
  const manifest = manifestFor(store);
  const first = commitFor(store, manifest, 'history-payload');
  const payload = store.putBlob({
    logicalPath: 'blobs/payload.json',
    bytes: Buffer.from('{"payload":true}'),
    mediaType: 'application/json',
  });
  const second = store.writeCommitMetadata({
    ontId: 'history-payload',
    parents: [first.commitSha256],
    ontManifest: manifest,
    blobs: [payload],
  });
  const firstResult = store.compareAndSwapRefMetadata({
    ontId: 'history-payload', branch: 'main', commitSha256: first.commitSha256,
  });
  store.compareAndSwapRefMetadata({
    ontId: 'history-payload', branch: 'main', expectedVersion: firstResult.version, commitSha256: second.commitSha256,
  });
  data.overwrite('refs/history-payload/main.json', Buffer.from(stableObjectText(firstResult.ref)));
  data.remove(payload.key);
  assert.throws(() => store.recoverRefHistory({ ontId: 'history-payload', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_TARGET',
  });
});
