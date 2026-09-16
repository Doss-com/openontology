import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { openCanonicalObjectBackend } from '../../dist/storage/canonical-backend.js';
import { openOntology } from '../../dist/openontology.js';
import {
  bindSourceNativeProductResource,
  buildSourceNativeProduct,
  createSourceNativeProductResource,
  openObjectOntStore,
  openSourceNativeObjectOntRefIndex,
} from '../../dist/kernel.js';

function sourceVersionFixture() {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-version-'));
  const input = JSON.parse(readFileSync(new URL('../../examples/quickstart/source-native-input.json', import.meta.url), 'utf8'));
  const objectBackendUri = pathToFileURL(join(root, 'objects')).href;
  const build = (name, selectedInput = input, version = undefined) => buildSourceNativeProduct({
    artifactRoot: join(root, name), input: selectedInput, objectBackendUri,
    ...(version === undefined ? {} : { expectedSourceVersion: version }),
  });
  const successor = (value, date) => {
    const next = structuredClone(input);
    const relativePath = `tracker/demo/task-1-${date.slice(0, 10)}.txt`;
    next.sources.push({ relativePath, sourceType: 'tracker', occurredAt: date, content: value });
    next.nativeObjectInputs.push({ relativePath,
      objectIdentity: structuredClone(input.nativeObjectInputs[0].objectIdentity),
      fields: [{ fieldPath: 'title', value }] });
    return next;
  };
  return { root, input, objectBackendUri, build, successor };
}

test('the exported builder refuses changed input from a delayed source-version writer', async () => {
  const { root, objectBackendUri, build, successor } = sourceVersionFixture();
  try {
    const first = build('initial');
    const newerInput = successor('Keep context current', '2026-03-01T00:00:00.000Z');
    const newer = build('newer', newerInput, first.receipt.refVersion);
    const store = openObjectOntStore({ backend: openCanonicalObjectBackend({ uri: objectBackendUri }).backend });
    const before = store.readRefMetadata({ ontId: first.receipt.ontId, branch: 'main' });
    assert.throws(() => build('delayed', successor('Delayed obsolete input',
      '2026-02-15T00:00:00.000Z'), first.receipt.refVersion), {
      code: 'SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT',
    });
    assert.deepEqual(store.readRefMetadata({ ontId: first.receipt.ontId, branch: 'main' }), before);
    assert.equal(existsSync(join(root, 'delayed', 'source-native.json')), false);
    const result = await openOntology({ artifactRoot: join(root, 'newer') })
      .verify('What is the current title of task-1?');
    assert.equal(result.context[0].exactText, 'Keep context current');
    assert.equal(result.verification.sourceCommitSha256, newer.receipt.commitSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source-version publication keeps initial creation and identical-content retries idempotent', () => {
  const { root, input, build, successor } = sourceVersionFixture();
  try {
    const initial = build('initial', input, null);
    const changed = successor('Keep context current', '2026-03-01T00:00:00.000Z');
    assert.throws(() => build('create-only', changed, null), {
      code: 'SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT',
    });
    assert.equal(existsSync(join(root, 'create-only', 'source-native.json')), false);
    const next = build('next', changed, initial.receipt.refVersion);
    const retried = build('retried', changed, initial.receipt.refVersion);
    assert.equal(retried.receipt.replayed, true);
    assert.equal(retried.receipt.commitSha256, next.receipt.commitSha256);
    assert.equal(retried.receipt.refVersion, next.receipt.refVersion);
    const identicalCreate = build('identical-create', changed, null);
    assert.equal(identicalCreate.receipt.replayed, true);
    assert.equal(identicalCreate.receipt.refVersion, next.receipt.refVersion);
    const ordinary = build('ordinary', successor('Manual observed snapshot', '2026-04-01T00:00:00.000Z'));
    assert.notEqual(ordinary.receipt.commitSha256, next.receipt.commitSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid source-version inputs refuse before an output directory is created', () => {
  const { root, build } = sourceVersionFixture();
  try {
    for (const [index, value] of ['', 1, false, {}, []].entries()) {
      const name = `invalid-${index}`;
      assert.throws(() => build(name, undefined, value), { code: 'SOURCE_NATIVE_PRODUCT_SOURCE_VERSION' });
      assert.equal(existsSync(join(root, name)), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('kernel resource binding uses a validated checkpoint without changing verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-resource-checkpoint-'));
  try {
    const initial = join(root, 'initial');
    const resourceRoot = join(root, 'resource');
    const input = JSON.parse(readFileSync(new URL('../../examples/quickstart/source-native-input.json', import.meta.url), 'utf8'));
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
