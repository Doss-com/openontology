import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { openCanonicalObjectBackend } from '../dist/src/canonical-object-backend.mjs';
import { objectBytesSha256, stableObjectText } from '../dist/src/canonical-content.mjs';
import { openObjectOntStore } from '../dist/src/object-ont-store.mjs';
import {
  materializeSourceNativeObjectOnt,
  openSourceNativeObjectOntAtCut,
  openSourceNativeObjectOntRefAtCut,
} from '../dist/src/source-native-object-ont.mjs';

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
