import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { openCanonicalObjectBackend } from '../dist/src/canonical-object-backend.mjs';
import { openOntology } from '../dist/src/openontology.mjs';
import {
  bindSourceNativeProductResource,
  buildSourceNativeProduct,
  createSourceNativeProductResource,
  openObjectOntStore,
  openSourceNativeObjectOntRefIndex,
} from '../dist/src/kernel.mjs';

test('kernel resource binding uses a validated checkpoint without changing verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-resource-checkpoint-'));
  try {
    const initial = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const input = JSON.parse(readFileSync(new URL('../examples/quickstart/source-native-input.json', import.meta.url), 'utf8'));
    const built = buildSourceNativeProduct({ artifactRoot: initial, input });
    createSourceNativeProductResource({ artifactRoot: initial, resourceRoot });
    const uri = pathToFileURL(join(initial, 'objects')).href;
    const backend = openCanonicalObjectBackend({ uri }).backend;
    const store = openObjectOntStore({ backend });
    const before = store.readRefMetadata({ ontId: input.ontId, branch: 'main' });
    const checkpoint = store.compareAndSwapRefMetadataCheckpointed({
      ontId: input.ontId,
      branch: 'main',
      expectedVersion: before.version,
      commitSha256: built.receipt.commitSha256,
    });
    const reads = [];
    const instrumented = {
      ...backend,
      get(key, ...args) { reads.push(key); return backend.get(key, ...args); },
    };
    const index = openSourceNativeObjectOntRefIndex({ backend: instrumented, ontId: input.ontId, branch: 'main' });
    assert.equal(index.replayMetadataSource, 'checkpoint');
    assert.equal(index.replayIndexCheckpointSha256, checkpoint.replayIndexCheckpointSha256);
    assert.equal(reads.filter((key) => key.startsWith('commits/')).length, 2);
    assert.equal(index.objectOnt.sources.every((source) => source.content === undefined), true);
    const bound = join(root, 'bound');
    const binding = bindSourceNativeProductResource({ resourceRoot, artifactRoot: bound });
    assert.equal(binding.replayMetadataSource, 'checkpoint');
    assert.equal(binding.replayIndexCheckpointSha256, checkpoint.replayIndexCheckpointSha256);
    assert.equal(binding.sourceCommitSha256, built.receipt.commitSha256);
    const result = await openOntology({ artifactRoot: bound }).verify('What is the current title of task-1?');
    assert.equal(result.answerable, true);
    assert.equal(result.context[0].exactText, 'Ship verified context');
    assert.equal(result.verification.sourceCommitSha256, binding.sourceCommitSha256);

    const poisoned = {
      ...backend,
      get(key, ...args) {
        const result = backend.get(key, ...args);
        return key.startsWith('replay-indexes/') ? { ...result, bytes: Buffer.from('poison') } : result;
      },
    };
    assert.throws(() => openSourceNativeObjectOntRefIndex({ backend: poisoned, ontId: input.ontId, branch: 'main' }), {
      code: 'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_READ',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
