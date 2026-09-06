#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  objectBytesSha256,
  openObjectOntStore,
  stableObjectSha256,
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

function mutateThenThrowBackend(raw, { casAt = [], keyPrefix = null } = {}) {
  let calls = 0;
  return {
    capabilities: raw.capabilities,
    head: (...args) => raw.head(...args),
    get: (...args) => raw.get(...args),
    putIfAbsent: (...args) => raw.putIfAbsent(...args),
    compareAndSwap(key, options) {
      calls += 1;
      const result = raw.compareAndSwap(key, options);
      if ((!keyPrefix || key.startsWith(keyPrefix)) && casAt.includes(calls)) {
        backendError('OBJECT_BACKEND_UNCERTAIN');
      }
      return result;
    },
  };
}

function readBoundaryBackend(raw, {
  mutateOnGet = false,
  disappearOnGet = false,
  throwCode = null,
  corrupt = null,
} = {}) {
  let armed = true;
  return {
    capabilities: raw.capabilities,
    head: (...args) => raw.head(...args),
    get(key, options) {
      if (throwCode) backendError(throwCode);
      if (mutateOnGet && armed) {
        armed = false;
        const current = raw.get(key);
        if (disappearOnGet) raw.remove(key);
        else raw.overwrite(key, current.bytes);
      }
      const result = raw.get(key, options);
      if (corrupt === 'key') return { ...result, key: `${result.key}.wrong` };
      if (corrupt === 'checksum') return { ...result, checksumSha256: 'sha256:' + '0'.repeat(64) };
      if (corrupt === 'length') return { ...result, byteLength: result.byteLength + 1 };
      if (corrupt === 'bytes') return { ...result, bytes: Buffer.from(`${result.bytes.toString('utf8')} `) };
      return result;
    },
    putIfAbsent: (...args) => raw.putIfAbsent(...args),
    compareAndSwap: (...args) => raw.compareAndSwap(...args),
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

test('protected data and history observations distinguish drift from same-version corruption', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const writer = openObjectOntStore({ backend: data, historyBackend: history });
  const manifest = manifestFor(writer);
  const commit = commitFor(writer, manifest, 'history-observation');
  writer.compareAndSwapRefMetadata({
    ontId: 'history-observation', branch: 'main', commitSha256: commit.commitSha256,
  });

  const driftedData = openObjectOntStore({
    backend: readBoundaryBackend(data, { mutateOnGet: true }), historyBackend: history,
  });
  assert.throws(() => driftedData.readRefHead({ ontId: 'history-observation', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_CONFLICT',
  });

  for (const corrupt of ['key', 'checksum', 'length', 'bytes']) {
    const corruptedData = openObjectOntStore({
      backend: readBoundaryBackend(data, { corrupt }), historyBackend: history,
    });
    assert.throws(() => corruptedData.readRefHead({ ontId: 'history-observation', branch: 'main' }), {
      code: 'OBJECT_ONT_HISTORY_CORRUPT',
    });
  }

  const corruptedHistory = openObjectOntStore({
    backend: data,
    historyBackend: readBoundaryBackend(history, { corrupt: 'bytes' }),
  });
  assert.throws(() => corruptedHistory.readRefHead({ ontId: 'history-observation', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_CORRUPT',
  });

  for (const throwCode of ['OBJECT_BACKEND_NOT_FOUND', 'OBJECT_BACKEND_CORRUPT', 'OBJECT_BACKEND_TIMEOUT']) {
    const thrownData = openObjectOntStore({
      backend: readBoundaryBackend(data, { throwCode }), historyBackend: history,
    });
    assert.throws(() => thrownData.readRefHead({ ontId: 'history-observation', branch: 'main' }), {
      code: throwCode === 'OBJECT_BACKEND_NOT_FOUND'
        ? 'OBJECT_ONT_HISTORY_CONFLICT'
        : throwCode === 'OBJECT_BACKEND_CORRUPT' ? 'OBJECT_ONT_HISTORY_CORRUPT' : throwCode,
    });
    const thrownHistory = openObjectOntStore({
      backend: data, historyBackend: readBoundaryBackend(history, { throwCode }),
    });
    assert.throws(() => thrownHistory.readRefHead({ ontId: 'history-observation', branch: 'main' }), {
      code: throwCode === 'OBJECT_BACKEND_NOT_FOUND'
        ? 'OBJECT_ONT_HISTORY_CONFLICT'
        : throwCode === 'OBJECT_BACKEND_CORRUPT' ? 'OBJECT_ONT_HISTORY_CORRUPT' : throwCode,
    });
  }

  const disappearedData = openObjectOntStore({
    backend: readBoundaryBackend(data, { mutateOnGet: true, disappearOnGet: true }),
    historyBackend: history,
  });
  assert.throws(() => disappearedData.readRefHead({ ontId: 'history-observation', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_CONFLICT',
  });

  const disappearedHistory = openObjectOntStore({
    backend: data,
    historyBackend: readBoundaryBackend(history, { mutateOnGet: true, disappearOnGet: true }),
  });
  assert.throws(() => disappearedHistory.readRefHead({ ontId: 'history-observation', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_CONFLICT',
  });
});

test('accepted-head deletion is repaired only to the protected target', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const store = openObjectOntStore({ backend: data, historyBackend: history });
  const manifest = manifestFor(store);
  const commit = commitFor(store, manifest, 'history-deleted-head');
  const published = store.compareAndSwapRefMetadata({
    ontId: 'history-deleted-head', branch: 'main', commitSha256: commit.commitSha256,
  });
  data.remove(published.key);
  assert.throws(() => store.readRefHead({ ontId: 'history-deleted-head', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_MISMATCH',
  });
  store.recoverRefHistory({ ontId: 'history-deleted-head', branch: 'main' });
  assert.equal(store.readRefHead({ ontId: 'history-deleted-head', branch: 'main' }).ref.commitSha256,
    commit.commitSha256);
});

test('enrollment detects a ref advance during the history CAS', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const legacy = openObjectOntStore({ backend: data });
  const manifest = manifestFor(legacy);
  const first = commitFor(legacy, manifest, 'history-enrollment-race');
  const second = commitFor(legacy, manifest, 'history-enrollment-race', [first.commitSha256]);
  const firstResult = legacy.compareAndSwapRefMetadata({
    ontId: 'history-enrollment-race', branch: 'main', commitSha256: first.commitSha256,
  });
  const secondReplay = legacy.replayMetadata(second.commitSha256);
  const secondRef = {
    ...firstResult.ref,
    commitSha256: second.commitSha256,
    replaySha256: secondReplay.replaySha256,
  };
  const racingHistory = {
    capabilities: history.capabilities,
    head: (...args) => history.head(...args),
    get: (...args) => history.get(...args),
    putIfAbsent: (...args) => history.putIfAbsent(...args),
    compareAndSwap(key, options) {
      const result = history.compareAndSwap(key, options);
      if (key === 'ref-history/history-enrollment-race/main.json') {
        data.overwrite(firstResult.key, Buffer.from(stableObjectText(secondRef)));
      }
      return result;
    },
  };
  const protectedStore = openObjectOntStore({ backend: data, historyBackend: racingHistory });
  assert.throws(() => protectedStore.initializeRefHistory({
    ontId: 'history-enrollment-race',
    branch: 'main',
    expectedCommitSha256: first.commitSha256,
    expectedReplaySha256: firstResult.ref.replaySha256,
  }), { code: 'OBJECT_ONT_HISTORY_ENROLLMENT_RACE' });
  assert.throws(() => openObjectOntStore({ backend: data, historyBackend: history })
    .readRefHead({ ontId: 'history-enrollment-race', branch: 'main' }), {
      code: 'OBJECT_ONT_HISTORY_MISMATCH',
    });
});

test('recovery rejects self-hashed impossible history states', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const store = openObjectOntStore({ backend: data, historyBackend: history });
  const manifest = manifestFor(store);
  const first = commitFor(store, manifest, 'history-impossible');
  const forkManifest = store.putBlob({
    logicalPath: 'oont.json', bytes: Buffer.from('{"fork":true}'), mediaType: 'application/json',
  });
  const fork = commitFor(store, forkManifest, 'history-impossible');
  store.compareAndSwapRefMetadata({
    ontId: 'history-impossible', branch: 'main', commitSha256: first.commitSha256,
  });
  const historyKey = 'ref-history/history-impossible/main.json';
  const current = JSON.parse(history.get(historyKey).bytes.toString('utf8'));
  const forkReplay = store.replayMetadata(fork.commitSha256);
  current.pending = {
    schemaVersion: 1,
    kind: 'OpenOntologyRefHistoryPendingV1',
    baseRef: current.acceptedRef,
    baseVersion: history.head(historyKey).version,
    targetRef: {
      ...current.acceptedRef,
      commitSha256: fork.commitSha256,
      replaySha256: forkReplay.replaySha256,
    },
  };
  const { historySha256: _historySha256, ...core } = current;
  current.historySha256 = stableObjectSha256(core);
  history.overwrite(historyKey, Buffer.from(stableObjectText(current)));
  assert.throws(() => store.recoverRefHistory({ ontId: 'history-impossible', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_CORRUPT',
  });

  current.pending = null;
  current.acceptedRef = null;
  const { historySha256: _invalidSha256, ...invalidCore } = current;
  current.historySha256 = stableObjectSha256(invalidCore);
  history.overwrite(historyKey, Buffer.from(stableObjectText(current)));
  assert.throws(() => store.readRefHead({ ontId: 'history-impossible', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_CORRUPT',
  });
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

test('publication validates every target payload before reserving protected history', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const store = openObjectOntStore({ backend: data, historyBackend: history });
  const manifest = manifestFor(store);
  const payload = store.putBlob({
    logicalPath: 'blobs/publish-payload.json',
    bytes: Buffer.from('{"payload":"required"}'),
    mediaType: 'application/json',
  });
  const target = store.writeCommitMetadata({
    ontId: 'history-publish-payload',
    ontManifest: manifest,
    blobs: [payload],
  });
  data.remove(payload.key);
  assert.throws(() => store.compareAndSwapRefMetadata({
    ontId: 'history-publish-payload', branch: 'main', commitSha256: target.commitSha256,
  }), { code: 'OBJECT_ONT_HISTORY_TARGET' });
  assert.throws(() => store.compareAndSwapRef({
    ontId: 'history-publish-payload', branch: 'ordinary', commitSha256: target.commitSha256,
  }), { code: 'OBJECT_ONT_HISTORY_TARGET' });
  assert.equal(data.head('refs/history-publish-payload/main.json'), null);
  assert.equal(history.head('ref-history/history-publish-payload/main.json'), null);
});

test('recovery refuses a target when an older historical source manifest is unavailable', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const store = openObjectOntStore({ backend: data, historyBackend: history });
  const firstManifest = store.putBlob({
    logicalPath: 'oont.json', bytes: Buffer.from('{"cut":1}'), mediaType: 'application/json',
  });
  const secondManifest = store.putBlob({
    logicalPath: 'oont.json', bytes: Buffer.from('{"cut":2}'), mediaType: 'application/json',
  });
  const first = store.writeCommitMetadata({ ontId: 'history-manifest', ontManifest: firstManifest });
  const second = store.writeCommitMetadata({
    ontId: 'history-manifest', parents: [first.commitSha256], ontManifest: secondManifest,
  });
  const firstResult = store.compareAndSwapRefMetadata({
    ontId: 'history-manifest', branch: 'main', commitSha256: first.commitSha256,
  });
  store.compareAndSwapRefMetadata({
    ontId: 'history-manifest', branch: 'main', expectedVersion: firstResult.version, commitSha256: second.commitSha256,
  });
  data.overwrite('refs/history-manifest/main.json', Buffer.from(stableObjectText(firstResult.ref)));
  data.remove(firstManifest.key);
  assert.throws(() => store.recoverRefHistory({ ontId: 'history-manifest', branch: 'main' }), {
    code: 'OBJECT_ONT_HISTORY_TARGET',
  });
});

test('mutate-then-throw CAS boundaries recover without aborting the reservation', () => {
  {
    const data = openMemoryObjectBackend();
    const history = openMemoryObjectBackend();
    const store = openObjectOntStore({
      backend: data,
      historyBackend: mutateThenThrowBackend(history, { casAt: [1], keyPrefix: 'ref-history/' }),
    });
    const manifest = manifestFor(store);
    const commit = commitFor(store, manifest, 'history-uncertain-reservation');
    assert.throws(() => store.compareAndSwapRefMetadata({
      ontId: 'history-uncertain-reservation', branch: 'main', commitSha256: commit.commitSha256,
    }), { code: 'OBJECT_BACKEND_UNCERTAIN' });
    const recovery = openObjectOntStore({ backend: data, historyBackend: history });
    recovery.recoverRefHistory({ ontId: 'history-uncertain-reservation', branch: 'main' });
    assert.equal(recovery.readRefHead({ ontId: 'history-uncertain-reservation', branch: 'main' }).ref.commitSha256,
      commit.commitSha256);
  }

  {
    const data = openMemoryObjectBackend();
    const history = openMemoryObjectBackend();
    const store = openObjectOntStore({
      backend: mutateThenThrowBackend(data, { casAt: [1], keyPrefix: 'refs/' }), historyBackend: history,
    });
    const manifest = manifestFor(store);
    const commit = commitFor(store, manifest, 'history-uncertain-data');
    assert.throws(() => store.compareAndSwapRefMetadata({
      ontId: 'history-uncertain-data', branch: 'main', commitSha256: commit.commitSha256,
    }), { code: 'OBJECT_BACKEND_UNCERTAIN' });
    const recovery = openObjectOntStore({ backend: data, historyBackend: history });
    recovery.recoverRefHistory({ ontId: 'history-uncertain-data', branch: 'main' });
    assert.equal(recovery.readRefHead({ ontId: 'history-uncertain-data', branch: 'main' }).ref.commitSha256,
      commit.commitSha256);
  }

  {
    const data = openMemoryObjectBackend();
    const history = openMemoryObjectBackend();
    const store = openObjectOntStore({
      backend: data,
      historyBackend: mutateThenThrowBackend(history, { casAt: [2], keyPrefix: 'ref-history/' }),
    });
    const manifest = manifestFor(store);
    const commit = commitFor(store, manifest, 'history-uncertain-finalization');
    assert.throws(() => store.compareAndSwapRefMetadata({
      ontId: 'history-uncertain-finalization', branch: 'main', commitSha256: commit.commitSha256,
    }), { code: 'OBJECT_BACKEND_UNCERTAIN' });
    const recovery = openObjectOntStore({ backend: data, historyBackend: history });
    assert.equal(recovery.readRefHead({ ontId: 'history-uncertain-finalization', branch: 'main' }).ref.commitSha256,
      commit.commitSha256);
    recovery.recoverRefHistory({ ontId: 'history-uncertain-finalization', branch: 'main' });
  }

  const pendingFixture = (label) => {
    const data = openMemoryObjectBackend();
    const history = openMemoryObjectBackend();
    const baseStore = openObjectOntStore({ backend: data, historyBackend: history });
    const manifest = manifestFor(baseStore);
    const first = commitFor(baseStore, manifest, label);
    const second = commitFor(baseStore, manifest, label, [first.commitSha256]);
    const firstResult = baseStore.compareAndSwapRefMetadata({
      ontId: label, branch: 'main', commitSha256: first.commitSha256,
    });
    const failedData = openObjectOntStore({
      backend: faultBackend(data, { failCasAt: [1], keyPrefix: 'refs/' }), historyBackend: history,
    });
    assert.throws(() => failedData.compareAndSwapRefMetadata({
      ontId: label, branch: 'main', expectedVersion: firstResult.version, commitSha256: second.commitSha256,
    }), { code: 'OBJECT_BACKEND_PRECONDITION' });
    return { data, history, first, second, firstResult };
  };

  {
    const fixture = pendingFixture('history-uncertain-recovery-data');
    const recovering = openObjectOntStore({
      backend: mutateThenThrowBackend(fixture.data, { casAt: [1], keyPrefix: 'refs/' }),
      historyBackend: fixture.history,
    });
    assert.throws(() => recovering.recoverRefHistory({ ontId: 'history-uncertain-recovery-data', branch: 'main' }), {
      code: 'OBJECT_BACKEND_UNCERTAIN',
    });
    const clean = openObjectOntStore({ backend: fixture.data, historyBackend: fixture.history });
    clean.recoverRefHistory({ ontId: 'history-uncertain-recovery-data', branch: 'main' });
    assert.equal(clean.readRefHead({ ontId: 'history-uncertain-recovery-data', branch: 'main' }).ref.commitSha256,
      fixture.second.commitSha256);
  }

  {
    const fixture = pendingFixture('history-uncertain-recovery-finalization');
    const cleanStore = openObjectOntStore({ backend: fixture.data, historyBackend: fixture.history });
    const targetRef = {
      ...fixture.firstResult.ref,
      commitSha256: fixture.second.commitSha256,
      replaySha256: cleanStore.replayMetadata(fixture.second.commitSha256).replaySha256,
    };
    fixture.data.overwrite(
      'refs/history-uncertain-recovery-finalization/main.json',
      Buffer.from(stableObjectText(targetRef)),
    );
    const recovering = openObjectOntStore({
      backend: fixture.data,
      historyBackend: mutateThenThrowBackend(fixture.history, { casAt: [1], keyPrefix: 'ref-history/' }),
    });
    assert.throws(() => recovering.recoverRefHistory({
      ontId: 'history-uncertain-recovery-finalization', branch: 'main',
    }), { code: 'OBJECT_BACKEND_UNCERTAIN' });
    const clean = openObjectOntStore({ backend: fixture.data, historyBackend: fixture.history });
    assert.equal(clean.readRefHead({ ontId: 'history-uncertain-recovery-finalization', branch: 'main' }).ref.commitSha256,
      fixture.second.commitSha256);
  }
});

test('a concurrent original writer cannot advance while recovery finalizes a pending target', () => {
  const data = openMemoryObjectBackend();
  const history = openMemoryObjectBackend();
  const base = openObjectOntStore({ backend: data, historyBackend: history });
  const manifest = manifestFor(base);
  const first = commitFor(base, manifest, 'history-concurrent-recovery');
  const second = commitFor(base, manifest, 'history-concurrent-recovery', [first.commitSha256]);
  const third = commitFor(base, manifest, 'history-concurrent-recovery', [second.commitSha256]);
  const firstResult = base.compareAndSwapRefMetadata({
    ontId: 'history-concurrent-recovery', branch: 'main', commitSha256: first.commitSha256,
  });
  const failed = openObjectOntStore({
    backend: faultBackend(data, { failCasAt: [1], keyPrefix: 'refs/' }), historyBackend: history,
  });
  assert.throws(() => failed.compareAndSwapRefMetadata({
    ontId: 'history-concurrent-recovery', branch: 'main',
    expectedVersion: firstResult.version, commitSha256: second.commitSha256,
  }), { code: 'OBJECT_BACKEND_PRECONDITION' });

  const originalWriter = openObjectOntStore({ backend: data, historyBackend: history });
  let writerError = null;
  const racingHistory = {
    capabilities: history.capabilities,
    head: (...args) => history.head(...args),
    get: (...args) => history.get(...args),
    putIfAbsent: (...args) => history.putIfAbsent(...args),
    compareAndSwap(key, options) {
      if (key === 'ref-history/history-concurrent-recovery/main.json') {
        try {
          originalWriter.compareAndSwapRefMetadata({
            ontId: 'history-concurrent-recovery', branch: 'main',
            expectedVersion: firstResult.version, commitSha256: third.commitSha256,
          });
        } catch (error) {
          writerError = error;
        }
      }
      return history.compareAndSwap(key, options);
    },
  };
  const recovery = openObjectOntStore({ backend: data, historyBackend: racingHistory });
  recovery.recoverRefHistory({ ontId: 'history-concurrent-recovery', branch: 'main' });
  assert.equal(writerError?.code, 'OBJECT_ONT_HISTORY_PENDING');
  assert.equal(recovery.readRefHead({ ontId: 'history-concurrent-recovery', branch: 'main' }).ref.commitSha256,
    second.commitSha256);
});
