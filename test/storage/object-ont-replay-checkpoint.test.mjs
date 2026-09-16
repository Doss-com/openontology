#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import { entry } from '../../dist/storage/assertion-envelope.js';
import {
  objectBytesSha256,
  openObjectOntStore,
  stableObjectSha256,
  stableObjectText,
} from '../../dist/storage/ont-store.js';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function openMemoryObjectBackend() {
  const objects = new Map();
  const receipt = (key, object, extra = {}) =>
    Object.freeze({
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
      if (object === undefined) fail('OBJECT_BACKEND_NOT_FOUND');
      const finalEnd = end ?? object.bytes.length;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(finalEnd) ||
        start < 0 ||
        finalEnd < start ||
        finalEnd > object.bytes.length
      ) {
        fail('OBJECT_BACKEND_RANGE');
      }
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
        if (!existing.bytes.equals(bytes)) fail('OBJECT_BACKEND_PRECONDITION');
        return receipt(key, existing, { created: false, replayed: true });
      }
      const object = Object.freeze({ bytes, generation: 1 });
      objects.set(key, object);
      return receipt(key, object, { created: true, replayed: false });
    },
    compareAndSwap(key, { expectedVersion = null, bytes: bytesInput } = {}) {
      const existing = objects.get(key);
      const version = existing === undefined ? null : `memory-v1:${existing.generation}`;
      if (version !== expectedVersion) fail('OBJECT_BACKEND_PRECONDITION');
      const object = Object.freeze({
        bytes: Buffer.from(bytesInput),
        generation: existing === undefined ? 1 : existing.generation + 1,
      });
      objects.set(key, object);
      return receipt(key, object, { previousVersion: version });
    },
  };
}

function instrumentBackend(
  raw,
  { heads = [], reads = [], onHead = null, onGet = null, onPut = null, onCas = null } = {},
) {
  return {
    capabilities: raw.capabilities,
    head(key, ...args) {
      heads.push(key);
      if (onHead) return onHead(key, args, raw);
      return raw.head(key, ...args);
    },
    get(key, ...args) {
      reads.push(key);
      let result;
      try {
        result = raw.get(key, ...args);
      } catch (error) {
        if (onGet) return onGet(key, null, raw, error);
        throw error;
      }
      return onGet ? onGet(key, result, raw) : result;
    },
    putIfAbsent(key, bytes, ...args) {
      if (onPut) onPut(key, bytes, raw);
      return raw.putIfAbsent(key, bytes, ...args);
    },
    compareAndSwap(key, options, ...args) {
      if (onCas) onCas(key, options, raw);
      return raw.compareAndSwap(key, options, ...args);
    },
  };
}

function checkpointBytes(raw, key) {
  return raw.get(key).bytes;
}

function rewriteCheckpoint(result, mutate) {
  const value = JSON.parse(result.bytes.toString('utf8'));
  mutate(value);
  const bytes = Buffer.from(stableObjectText(value));
  return Object.freeze({
    ...result,
    bytes,
    byteLength: bytes.length,
    checksumSha256: objectBytesSha256(bytes),
  });
}

function manifestFor(store) {
  return store.putBlob({
    logicalPath: 'oont.json',
    bytes: Buffer.from('{}'),
    mediaType: 'application/json',
  });
}

function commitFor(store, manifest, ontId, { parents = [], blobs = [], segments = [] } = {}) {
  return store.writeCommitMetadata({ ontId, parents, ontManifest: manifest, blobs, segments });
}

function basicCheckpointFixture({ payloads = true } = {}) {
  const raw = openMemoryObjectBackend();
  const store = openObjectOntStore({ backend: raw });
  const manifest = manifestFor(store);
  const blobs = payloads
    ? [
        store.putBlob({
          logicalPath: 'blobs/a.json',
          bytes: Buffer.from('{"a":1}'),
          mediaType: 'application/json',
        }),
        store.putBlob({
          logicalPath: 'blobs/b.json',
          bytes: Buffer.from('{"b":2}'),
          mediaType: 'application/json',
        }),
      ]
    : [];
  const commit = commitFor(store, manifest, 'checkpoint-fixture', { blobs });
  const activated = store.compareAndSwapRefMetadataCheckpointed({
    ontId: 'checkpoint-fixture',
    branch: 'main',
    commitSha256: commit.commitSha256,
  });
  return { raw, store, manifest, blobs, commit, activated };
}

function expectCode(fn, code) {
  assert.throws(fn, { code });
}

test('publishes managed-compatible checkpoint bytes, hashes, and object key', () => {
  const { raw, store, commit, activated } = basicCheckpointFixture();
  const replay = store.replayMetadata(commit.commitSha256);
  const checkpointKey = `replay-indexes/sha256/${replay.replaySha256.slice(7)}.json`;
  const bytes = checkpointBytes(raw, checkpointKey);
  const checkpoint = JSON.parse(bytes.toString('utf8'));
  const { checkpointSha256, ...core } = checkpoint;

  assert.equal(checkpoint.schemaVersion, 1);
  assert.equal(checkpoint.kind, 'OpenOntologyObjectReplayIndexCheckpointV1');
  assert.deepEqual(Object.keys(checkpoint).sort(), [
    'blobDescriptors',
    'checkpointSha256',
    'kind',
    'manifestDescriptor',
    'replayIdentity',
    'schemaVersion',
  ]);
  assert.equal(checkpointSha256, stableObjectSha256(core));
  assert.equal(checkpoint.replayIdentity.kind, 'OpenOntologyObjectReplayV1');
  assert.equal(stableObjectSha256(checkpoint.replayIdentity), replay.replaySha256);
  assert.equal(checkpoint.manifestDescriptor.storedSha256, replay.ontManifestSha256);
  assert.deepEqual(
    checkpoint.blobDescriptors.map((row) => row.key),
    replay.blobKeys,
  );
  assert.equal(stableObjectText(checkpoint), bytes.toString('utf8'));
  assert.equal(activated.key, 'refs/checkpoint-fixture/main.json');
  assert.equal(activated.replayIndexCheckpointSha256, checkpointSha256);
  assert.equal(
    store.readReplayIndexCheckpoint({
      ontId: 'checkpoint-fixture',
      tipCommitSha256: commit.commitSha256,
      replaySha256: replay.replaySha256,
    }).checksumSha256,
    objectBytesSha256(bytes),
  );
  assert.equal(activated.replayMetadataSource, 'graph');
});

test('returns equivalent graph metadata and preserves legacy missing-checkpoint fallback', () => {
  const { raw, store, commit } = basicCheckpointFixture({ payloads: false });
  const graphMetadata = store.replayMetadata(commit.commitSha256);
  const checkpointSnapshot = store.readRefMetadataCheckpointSnapshot({
    ontId: 'checkpoint-fixture',
    branch: 'main',
  });
  assert.equal(checkpointSnapshot.replayMetadataSource, 'checkpoint');
  assert.deepEqual(checkpointSnapshot.replayMetadata, graphMetadata);
  assert.deepEqual(
    store.readRefMetadataSnapshot({ ontId: 'checkpoint-fixture', branch: 'main' }).replayMetadata,
    graphMetadata,
  );

  const legacyCommit = commitFor(
    store,
    store.readCommit(commit.commitSha256).commit.ontManifest,
    'checkpoint-fixture',
    {
      parents: [commit.commitSha256],
    },
  );
  store.compareAndSwapRefMetadata({
    ontId: 'checkpoint-fixture',
    branch: 'legacy',
    commitSha256: legacyCommit.commitSha256,
  });
  const legacy = store.readRefMetadataCheckpointSnapshot({
    ontId: 'checkpoint-fixture',
    branch: 'legacy',
  });
  assert.equal(legacy.replayMetadataSource, 'graph');
  assert.equal(legacy.replayIndexCheckpointSha256, null);
  assert.equal(legacy.replayIndexCheckpointByteLength, null);
  assert.equal(legacy.replayMetadata.commitOrder.length, 2);
  assert.equal(raw.head(legacy.key) !== null, true);
});

test('keeps all ref publication variants forward-only with stale-version precedence', () => {
  const variants = [
    ['ordinary', (store, input) => store.compareAndSwapRef(input)],
    ['metadata', (store, input) => store.compareAndSwapRefMetadata(input)],
    ['checkpointed', (store, input) => store.compareAndSwapRefMetadataCheckpointed(input)],
  ];
  for (const [name, publish] of variants) {
    const raw = openMemoryObjectBackend();
    const store = openObjectOntStore({ backend: raw });
    const manifest = manifestFor(store);
    const first = commitFor(store, manifest, `continuity-${name}-first`);
    const second = commitFor(store, manifest, `continuity-${name}-first`, {
      parents: [first.commitSha256],
    });
    const forkManifest = store.putBlob({
      logicalPath: 'oont.json',
      bytes: Buffer.from(`{"fork":"${name}"}`),
      mediaType: 'application/json',
    });
    const fork = commitFor(store, forkManifest, `continuity-${name}-first`);
    assert.notEqual(fork.commitSha256, first.commitSha256, name);
    assert.equal(
      store.replayMetadata(fork.commitSha256).commitOrder.includes(first.commitSha256),
      false,
      name,
    );
    const initial = publish(store, {
      ontId: `continuity-${name}-first`,
      branch: 'main',
      commitSha256: first.commitSha256,
    });
    const advanced = publish(store, {
      ontId: `continuity-${name}-first`,
      branch: 'main',
      expectedVersion: initial.version,
      commitSha256: second.commitSha256,
    });
    const equal = publish(store, {
      ontId: `continuity-${name}-first`,
      branch: 'main',
      expectedVersion: advanced.version,
      commitSha256: second.commitSha256,
    });
    assert.equal(equal.ref.commitSha256, second.commitSha256, name);
    expectCode(
      () =>
        publish(store, {
          ontId: `continuity-${name}-first`,
          branch: 'main',
          expectedVersion: equal.version,
          commitSha256: first.commitSha256,
        }),
      'OBJECT_ONT_REF_ROLLBACK',
    );
    expectCode(
      () =>
        publish(store, {
          ontId: `continuity-${name}-first`,
          branch: 'main',
          expectedVersion: initial.version,
          commitSha256: fork.commitSha256,
        }),
      'OBJECT_BACKEND_PRECONDITION',
    );
    expectCode(
      () =>
        publish(store, {
          ontId: `continuity-${name}-first`,
          branch: 'main',
          expectedVersion: equal.version,
          commitSha256: fork.commitSha256,
        }),
      'OBJECT_ONT_REF_ROLLBACK',
    );
    const fresh = publish(store, {
      ontId: `continuity-${name}-first`,
      branch: 'new',
      commitSha256: fork.commitSha256,
    });
    assert.equal(fresh.ref.commitSha256, fork.commitSha256, name);
  }
});

test('preserves the winning head when it advances between ancestry read and CAS', () => {
  const raw = openMemoryObjectBackend();
  const baseStore = openObjectOntStore({ backend: raw });
  const manifest = manifestFor(baseStore);
  const ontId = 'continuity-race-fixture';
  const first = commitFor(baseStore, manifest, ontId);
  const candidate = commitFor(baseStore, manifest, ontId, { parents: [first.commitSha256] });
  const winnerManifest = baseStore.putBlob({
    logicalPath: 'oont.json',
    bytes: Buffer.from('{"concurrentWinner":true}'),
    mediaType: 'application/json',
  });
  const winner = commitFor(baseStore, winnerManifest, ontId, { parents: [first.commitSha256] });
  assert.notEqual(candidate.commitSha256, winner.commitSha256);
  const initial = baseStore.compareAndSwapRefMetadata({
    ontId,
    branch: 'main',
    commitSha256: first.commitSha256,
  });
  const winnerReplay = baseStore.replayMetadata(winner.commitSha256);
  let injected = false;
  const refBackend = {
    capabilities: raw.capabilities,
    head: (...args) => raw.head(...args),
    get: (...args) => raw.get(...args),
    putIfAbsent: (...args) => raw.putIfAbsent(...args),
    compareAndSwap(key, options) {
      if (!injected && key === initial.key) {
        injected = true;
        raw.compareAndSwap(key, {
          expectedVersion: initial.version,
          bytes: Buffer.from(
            stableObjectText({
              ...initial.ref,
              commitSha256: winner.commitSha256,
              replayStatus: winnerReplay.status,
              replaySha256: winnerReplay.replaySha256,
            }),
          ),
        });
      }
      return raw.compareAndSwap(key, options);
    },
  };
  const raceStore = openObjectOntStore({ backend: refBackend });
  expectCode(
    () =>
      raceStore.compareAndSwapRefMetadata({
        ontId,
        branch: 'main',
        expectedVersion: initial.version,
        commitSha256: candidate.commitSha256,
      }),
    'OBJECT_BACKEND_PRECONDITION',
  );
  assert.equal(injected, true);
  assert.equal(
    baseStore.readRefMetadata({ ontId, branch: 'main' }).ref.commitSha256,
    winner.commitSha256,
  );
});

test('uses one ref, checkpoint, and tip commit read over a 10000-cut history', () => {
  const raw = openMemoryObjectBackend();
  const heads = [];
  const reads = [];
  const backend = instrumentBackend(raw, { heads, reads });
  const store = openObjectOntStore({ backend });
  const manifest = manifestFor(store);
  const depth = 10_000;
  let tipCommitSha256 = null;
  for (let index = 0; index < depth; index += 1) {
    tipCommitSha256 = commitFor(store, manifest, 'long-history-fixture', {
      parents: tipCommitSha256 === null ? [] : [tipCommitSha256],
    }).commitSha256;
  }
  const activated = store.compareAndSwapRefMetadataCheckpointed({
    ontId: 'long-history-fixture',
    branch: 'main',
    commitSha256: tipCommitSha256,
  });
  assert.equal(activated.replayMetadata.commitOrder.length, depth);

  heads.length = 0;
  reads.length = 0;
  const reopened = store.readRefMetadataCheckpointSnapshot({
    ontId: 'long-history-fixture',
    branch: 'main',
  });
  assert.equal(reopened.replayMetadataSource, 'checkpoint');
  assert.equal(reopened.replayMetadata.commitOrder.length, depth);
  assert.equal(heads.filter((key) => key.startsWith('refs/')).length, 1);
  assert.equal(heads.filter((key) => key.startsWith('replay-indexes/')).length, 1);
  assert.equal(reads.filter((key) => key.startsWith('refs/')).length, 1);
  assert.equal(reads.filter((key) => key.startsWith('replay-indexes/')).length, 1);
  assert.equal(reads.filter((key) => key.startsWith('commits/')).length, 1);
});

test('fails closed for poisoned, wrongly bound, and non-canonical checkpoints', () => {
  const { raw, store, commit, activated } = basicCheckpointFixture();
  const replay = store.replayMetadata(commit.commitSha256);

  const poisoned = instrumentBackend(raw, {
    onGet: (key, result) =>
      key.startsWith('replay-indexes/')
        ? rewriteCheckpoint(result, (value) => {
            value.checkpointSha256 = `sha256:${'0'.repeat(64)}`;
          })
        : result,
  });
  expectCode(
    () =>
      openObjectOntStore({ backend: poisoned }).readRefMetadataCheckpointSnapshot({
        ontId: 'checkpoint-fixture',
        branch: 'main',
      }),
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT',
  );

  const reordered = instrumentBackend(raw, {
    onGet: (key, result) =>
      key.startsWith('replay-indexes/')
        ? rewriteCheckpoint(result, (value) => {
            value.blobDescriptors.reverse();
          })
        : result,
  });
  expectCode(
    () =>
      openObjectOntStore({ backend: reordered }).readRefMetadataCheckpointSnapshot({
        ontId: 'checkpoint-fixture',
        branch: 'main',
      }),
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT',
  );

  const wrongOntStore = openObjectOntStore({ backend: raw });
  expectCode(
    () =>
      wrongOntStore.readReplayIndexCheckpoint({
        ontId: 'different-ont',
        tipCommitSha256: commit.commitSha256,
        replaySha256: replay.replaySha256,
      }),
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT',
  );
  expectCode(
    () =>
      wrongOntStore.readReplayIndexCheckpoint({
        ontId: 'checkpoint-fixture',
        tipCommitSha256: objectBytesSha256(Buffer.from('wrong-tip')),
        replaySha256: replay.replaySha256,
      }),
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT',
  );

  const wrongReplay = objectBytesSha256(Buffer.from('wrong-replay'));
  const aliased = instrumentBackend(raw, {
    onHead: (key, args, backend) =>
      key.startsWith('replay-indexes/')
        ? backend.head(`replay-indexes/sha256/${replay.replaySha256.slice(7)}.json`, ...args)
        : backend.head(key, ...args),
    onGet: (key, result, backend) => {
      if (!key.startsWith('replay-indexes/')) return result;
      return { ...backend.get(`replay-indexes/sha256/${replay.replaySha256.slice(7)}.json`), key };
    },
  });
  expectCode(
    () =>
      openObjectOntStore({ backend: aliased }).readReplayIndexCheckpoint({
        ontId: 'checkpoint-fixture',
        tipCommitSha256: commit.commitSha256,
        replaySha256: wrongReplay,
      }),
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT',
  );

  const originalCheckpointKey = `replay-indexes/sha256/${replay.replaySha256.slice(7)}.json`;
  const forgedCheckpoint = JSON.parse(checkpointBytes(raw, originalCheckpointKey).toString('utf8'));
  forgedCheckpoint.replayIdentity.assertionRows = [
    {
      assertionId: 'as_forged',
      lineSha256s: [`sha256:${'1'.repeat(64)}`],
    },
  ];
  const forgedReplaySha256 = stableObjectSha256(forgedCheckpoint.replayIdentity);
  const { checkpointSha256: _oldCheckpointSha256, ...forgedCore } = forgedCheckpoint;
  forgedCheckpoint.checkpointSha256 = stableObjectSha256(forgedCore);
  const forgedBytes = Buffer.from(stableObjectText(forgedCheckpoint));
  const forged = instrumentBackend(raw, {
    onHead: (key, args, backend) =>
      key.startsWith('replay-indexes/')
        ? backend.head(originalCheckpointKey, ...args)
        : backend.head(key, ...args),
    onGet: (key, result, backend) => {
      if (!key.startsWith('replay-indexes/')) return result;
      const original = result ?? backend.get(originalCheckpointKey);
      return Object.freeze({
        ...original,
        key,
        bytes: forgedBytes,
        byteLength: forgedBytes.length,
        checksumSha256: objectBytesSha256(forgedBytes),
      });
    },
  });
  expectCode(
    () =>
      openObjectOntStore({ backend: forged }).readReplayIndexCheckpoint({
        ontId: 'checkpoint-fixture',
        tipCommitSha256: commit.commitSha256,
        replaySha256: forgedReplaySha256,
      }),
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT',
  );
});

test('rejects assertion-bearing replay and publishes checkpoint before CAS', () => {
  const raw = openMemoryObjectBackend();
  const writer = openObjectOntStore({ backend: raw });
  const manifest = manifestFor(writer);
  const assertion = entry({ kind: 'note', about: 'fixture', body: { value: 1 }, producer: 'test' });
  const segment = writer.putAssertionSegment({
    logicalPath: 'ledger/main.jsonl',
    jsonlBytes: Buffer.from(`${JSON.stringify(assertion)}\n`),
  });
  const assertionCommit = commitFor(writer, manifest, 'assertion-fixture', { segments: [segment] });
  expectCode(
    () =>
      writer.compareAndSwapRefMetadataCheckpointed({
        ontId: 'assertion-fixture',
        branch: 'main',
        commitSha256: assertionCommit.commitSha256,
      }),
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_ELIGIBILITY',
  );
  assert.equal(raw.head('refs/assertion-fixture/main.json'), null);

  const failRaw = openMemoryObjectBackend();
  const failedWrites = instrumentBackend(failRaw, {
    onPut: (key) => {
      if (key.startsWith('replay-indexes/')) fail('TEST_CHECKPOINT_WRITE');
    },
  });
  const failedWriter = openObjectOntStore({ backend: failedWrites });
  const failedManifest = manifestFor(failedWriter);
  const failedCommit = commitFor(failedWriter, failedManifest, 'write-failure-fixture');
  expectCode(
    () =>
      failedWriter.compareAndSwapRefMetadataCheckpointed({
        ontId: 'write-failure-fixture',
        branch: 'main',
        commitSha256: failedCommit.commitSha256,
      }),
    'TEST_CHECKPOINT_WRITE',
  );
  assert.equal(failRaw.head('refs/write-failure-fixture/main.json'), null);

  const loserRaw = openMemoryObjectBackend();
  const loserWriter = openObjectOntStore({ backend: loserRaw });
  const loserManifest = manifestFor(loserWriter);
  const loserCommit = commitFor(loserWriter, loserManifest, 'cas-loser-fixture');
  const loserReplay = loserWriter.replayMetadata(loserCommit.commitSha256);
  expectCode(
    () =>
      loserWriter.compareAndSwapRefMetadataCheckpointed({
        ontId: 'cas-loser-fixture',
        branch: 'main',
        expectedVersion: 'memory-v1:99',
        commitSha256: loserCommit.commitSha256,
      }),
    'OBJECT_BACKEND_PRECONDITION',
  );
  assert.equal(loserRaw.head('refs/cas-loser-fixture/main.json'), null);
  assert.equal(
    loserRaw.head(`replay-indexes/sha256/${loserReplay.replaySha256.slice(7)}.json`) !== null,
    true,
  );
});

test('refuses checkpoint-key poisoning before advancing a ref', () => {
  const raw = openMemoryObjectBackend();
  const store = openObjectOntStore({ backend: raw });
  const manifest = manifestFor(store);
  const commit = commitFor(store, manifest, 'poison-fixture');
  const replay = store.replayMetadata(commit.commitSha256);
  raw.putIfAbsent(
    `replay-indexes/sha256/${replay.replaySha256.slice(7)}.json`,
    Buffer.from('poison'),
  );
  expectCode(
    () =>
      store.compareAndSwapRefMetadataCheckpointed({
        ontId: 'poison-fixture',
        branch: 'main',
        commitSha256: commit.commitSha256,
      }),
    'OBJECT_BACKEND_PRECONDITION',
  );
  assert.equal(raw.head('refs/poison-fixture/main.json'), null);
});
