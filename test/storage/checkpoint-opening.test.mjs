import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { openCanonicalObjectBackend } from '../../dist/storage/canonical-backend.js';
import {
  objectBytesSha256,
  stableObjectSha256,
  stableObjectText,
} from '../../dist/canonical-content.js';
import { openObjectOntStore } from '../../dist/storage/ont-store.js';
import {
  materializeSourceNativeObjectOnt,
  openSourceNativeObjectOnt,
  openSourceNativeObjectOntAtCut,
  openSourceNativeObjectOntRefAtCut,
} from '../../dist/source/object-ont.js';

function input(values = ['Alpha']) {
  const rows = values.map((value, index) => ({
    relativePath: `clickup/acme/rev-${index + 1}.md`,
    occurredAt: `2026-0${index + 1}-01T00:00:00.000Z`,
    content: value,
  }));
  return {
    sources: rows.map((row) => ({
      relativePath: row.relativePath,
      sourceType: 'clickup',
      occurredAt: row.occurredAt,
      content: row.content,
      sourceSha256: objectBytesSha256(Buffer.from(row.content)),
    })),
    nativeObjectInputs: rows.map((row) => ({
      relativePath: row.relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'task',
        namespace: 'acme',
        externalId: 'task-1',
      },
      fields: [{ fieldPath: 'title', value: row.content, codeUnitStart: 0 }],
    })),
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oont-checkpoint-opening-'));
  const backend = openCanonicalObjectBackend({
    uri: pathToFileURL(join(root, 'backend')).href,
  }).backend;
  const store = openObjectOntStore({ backend });
  const materialize = (values, expectedVersion = null, targetBackend = backend) =>
    materializeSourceNativeObjectOnt({
      backend: targetBackend,
      ontId: 'checkpoint-opening-fixture',
      branch: 'main',
      expectedVersion,
      ...input(values),
    });
  return { backend, materialize, root, store };
}

function checkpointFor(store, receipt) {
  return store.readReplayIndexCheckpoint({
    ontId: receipt.ontId,
    tipCommitSha256: receipt.commitSha256,
    replaySha256: receipt.replaySha256,
  });
}

function commitKey(commitSha256) {
  return `commits/sha256/${commitSha256.slice(7)}.json`;
}

function rehashedTimestampMismatch({ store, receipt, expectedVersion, occurredAt }) {
  const originalCommit = store.readCommit(receipt.commitSha256).commit;
  const originalReplay = store.replayMetadata(receipt.commitSha256);
  const originalMapDescriptor = originalReplay.blobDescriptors.find((descriptor) =>
    descriptor.logicalPath.startsWith('blobs/source-native/maps/sha256/'));
  assert.ok(originalMapDescriptor);
  const originalMap = JSON.parse(store.readBlob(originalMapDescriptor).bytes.toString('utf8'));
  const nativeObjects = originalMap.nativeObjects.map((object, index) => {
    if (index !== 0) return object;
    const { nativeObjectSha256: _oldObjectHash, ...objectCore } = { ...object, occurredAt };
    return { ...objectCore, nativeObjectSha256: stableObjectSha256(objectCore) };
  });
  const { nativeObjectMapSha256: _oldHash, ...mapCore } = {
    ...originalMap,
    nativeObjects,
  };
  const nativeObjectMapSha256 = stableObjectSha256(mapCore);
  const map = { ...mapCore, nativeObjectMapSha256 };
  const mapBlob = store.putBlob({
    logicalPath: `blobs/source-native/maps/sha256/${nativeObjectMapSha256.slice(7)}.json`,
    bytes: Buffer.from(stableObjectText(map)),
    mediaType: 'application/json',
  });
  const originalManifest = JSON.parse(store.readBlob(originalCommit.ontManifest, { manifest: true }).bytes.toString('utf8'));
  const manifest = {
    ...originalManifest,
    nativeObjectMapSha256,
    mapBlobLogicalPath: mapBlob.logicalPath,
    mapBlobStoredSha256: mapBlob.storedSha256,
  };
  const manifestBlob = store.putBlob({
    logicalPath: 'oont.json',
    bytes: Buffer.from(stableObjectText(manifest)),
    mediaType: 'application/json',
  });
  const blobs = originalCommit.blobs
    .filter((descriptor) => descriptor.logicalPath !== originalMapDescriptor.logicalPath)
    .concat(mapBlob);
  const commit = store.writeCommitMetadata({
    ontId: receipt.ontId,
    parents: [receipt.commitSha256],
    ontManifest: manifestBlob,
    blobs,
  });
  const activated = store.compareAndSwapRefMetadataCheckpointed({
    ontId: receipt.ontId,
    branch: 'main',
    expectedVersion,
    commitSha256: commit.commitSha256,
  });
  return { commit, activated };
}

test('present checkpoint corruption fails ordinary and exact opens without graph fallback', () => {
  const { backend, materialize, root, store } = fixture();
  try {
    const first = materialize(['Alpha']);
    const checkpoint = checkpointFor(store, first.receipt);
    assert.ok(checkpoint);
    backend.compareAndSwap(checkpoint.key, {
      expectedVersion: checkpoint.version,
      bytes: Buffer.from('corrupt checkpoint'),
    });
    assert.throws(() => openSourceNativeObjectOntRefAtCut({
      backend,
      ontId: first.receipt.ontId,
      branch: 'main',
    }), { code: 'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_READ' });
    assert.throws(() => openSourceNativeObjectOntAtCut({
      backend,
      ontId: first.receipt.ontId,
      commitSha256: first.receipt.commitSha256,
      replaySha256: first.receipt.replaySha256,
    }), { code: 'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_READ' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint publication failure leaves the previous ref byte and version unchanged', () => {
  const { backend, materialize, root, store } = fixture();
  try {
    const first = materialize(['Alpha']);
    const before = store.readRefMetadata({
      ontId: first.receipt.ontId,
      branch: 'main',
    });
    const failedBackend = {
      ...backend,
      putIfAbsent(key, bytes) {
        if (key.startsWith('replay-indexes/')) {
          const error = new Error('TEST_CHECKPOINT_WRITE');
          error.code = error.message;
          throw error;
        }
        return backend.putIfAbsent(key, bytes);
      },
    };
    assert.throws(() => materialize(['Alpha', 'Beta'], first.receipt.refVersion, failedBackend), {
      code: 'TEST_CHECKPOINT_WRITE',
    });
    const after = store.readRefMetadata({
      ontId: first.receipt.ontId,
      branch: 'main',
    });
    assert.equal(stableObjectText(after), stableObjectText(before));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('changed source materialization rejects a stale expected ref version', () => {
  const { materialize, root, store } = fixture();
  try {
    const first = materialize(['Alpha']);
    const second = materialize(['Alpha', 'Beta'], first.receipt.refVersion);
    const before = store.readRefMetadata({
      ontId: second.receipt.ontId,
      branch: 'main',
    });
    assert.throws(() => materialize(['Alpha', 'Beta', 'Gamma'], first.receipt.refVersion), {
      code: 'SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT',
    });
    const after = store.readRefMetadata({
      ontId: second.receipt.ontId,
      branch: 'main',
    });
    assert.equal(stableObjectText(after), stableObjectText(before));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkpointed cut openings avoid ancestor commit reads and still fetch source packs', () => {
  const { backend, materialize, root, store } = fixture();
  try {
    const first = materialize(['Alpha']);
    const second = materialize(['Alpha', 'Beta'], first.receipt.refVersion);
    const third = materialize(['Alpha', 'Beta', 'Gamma'], second.receipt.refVersion);
    const thirdCommit = store.readCommit(third.receipt.commitSha256).commit;
    const sourcePack = thirdCommit.blobs.find((blob) =>
      blob.logicalPath.includes('/source-packs/'));
    assert.ok(sourcePack);
    const reads = [];
    const instrumented = {
      ...backend,
      get(key, ...args) {
        reads.push(key);
        return backend.get(key, ...args);
      },
    };
    const exact = openSourceNativeObjectOntAtCut({
      backend: instrumented,
      ontId: third.receipt.ontId,
      commitSha256: third.receipt.commitSha256,
      replaySha256: third.receipt.replaySha256,
    });
    assert.equal(exact.replayMetadataSource, 'checkpoint');
    assert.equal(exact.objectOnt.sources.length, 3);
    const exactCommitReads = reads.filter((key) => key.startsWith('commits/'));
    assert.ok(exactCommitReads.length >= 1 && exactCommitReads.length <= 2);
    assert.deepEqual([...new Set(exactCommitReads)], [commitKey(third.receipt.commitSha256)]);
    assert.ok(reads.includes(sourcePack.key));

    reads.length = 0;
    const current = openSourceNativeObjectOntRefAtCut({
      backend: instrumented,
      ontId: third.receipt.ontId,
      branch: 'main',
    });
    assert.equal(current.replayMetadataSource, 'checkpoint');
    assert.equal(current.objectOnt.sources.length, 3);
    const currentCommitReads = reads.filter((key) => key.startsWith('commits/'));
    assert.ok(currentCommitReads.length >= 1 && currentCommitReads.length <= 2);
    assert.deepEqual([...new Set(currentCommitReads)], [commitKey(third.receipt.commitSha256)]);
    assert.ok(reads.includes(sourcePack.key));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('catalog occurredAt binds ordinary and checkpoint-backed map openings', () => {
  const { backend, materialize, root, store } = fixture();
  try {
    const first = materialize(['Alpha']);
    const ordinary = openSourceNativeObjectOnt({
      backend,
      ontId: first.receipt.ontId,
      commitSha256: first.receipt.commitSha256,
    });
    assert.equal(ordinary.sources[0].occurredAt, '2026-01-01T00:00:00.000Z');
    const checkpoint = checkpointFor(store, first.receipt);
    assert.ok(checkpoint);
    const checkpointed = openSourceNativeObjectOntAtCut({
      backend,
      ontId: first.receipt.ontId,
      commitSha256: first.receipt.commitSha256,
      replaySha256: first.receipt.replaySha256,
    });
    assert.equal(checkpointed.replayMetadataSource, 'checkpoint');
    assert.equal(checkpointed.objectOnt.sources[0].occurredAt, '2026-01-01T00:00:00.000Z');

    const tampered = rehashedTimestampMismatch({
      store,
      receipt: first.receipt,
      expectedVersion: first.receipt.refVersion,
      occurredAt: '2026-02-01T00:00:00.000Z',
    });
    assert.throws(() => openSourceNativeObjectOnt({
      backend,
      ontId: first.receipt.ontId,
      commitSha256: tampered.commit.commitSha256,
    }), { code: 'SOURCE_NATIVE_OBJECT_ONT_CATALOG' });
    assert.throws(() => openSourceNativeObjectOntAtCut({
      backend,
      ontId: first.receipt.ontId,
      commitSha256: tampered.commit.commitSha256,
      replaySha256: tampered.activated.ref.replaySha256,
    }), { code: 'SOURCE_NATIVE_OBJECT_ONT_CATALOG' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
