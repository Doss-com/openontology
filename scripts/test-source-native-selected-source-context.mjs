import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildSourceNativeProduct,
  compileSourceNativeSemanticConstruction,
  objectBytesSha256,
  openProductState,
  openSourceNativeConstructionReview,
  stableObjectSha256,
} from '../dist/src/kernel.mjs';

const NODE_VERSION = process.versions.node;
const SELECTED_REF = 'docs/selected.md';
const UNRELATED_REF = 'docs/unrelated.md';
const OCCURRED_AT = '2026-09-08T00:00:00.000Z';
const SOURCE_PACK_BYTES = 8 * 1024 * 1024;

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'oont-selected-source-context-'));
  const options = { artifactRoot: join(root, 'ont') };
  const selectedContent = 'Selected concept is defined by this source. UTF-8: café and café.\n';
  const unrelatedContent = `Unrelated source content ${'u'.repeat(SOURCE_PACK_BYTES + 1)}\n`;
  const sources = [
    { relativePath: SELECTED_REF, sourceType: 'docs', occurredAt: OCCURRED_AT, content: selectedContent },
    { relativePath: UNRELATED_REF, sourceType: 'docs', occurredAt: OCCURRED_AT, content: unrelatedContent },
  ];
  const input = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'selected-source-context-fixture',
    namespace: 'selected-source-context-fixture',
    querySchemas: [{
      sourceSystem: 'docs', objectType: 'Document', aliases: ['document'],
      fields: [{ fieldPath: 'body', aliases: ['body'] }],
    }],
    sources,
    nativeObjectInputs: sources.map((source, index) => ({
      relativePath: source.relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'docs',
        objectType: 'Document',
        namespace: 'selected-source-context-fixture',
        externalId: index === 0 ? 'selected' : 'unrelated',
      },
      fields: [{
        fieldPath: 'body',
        value: index === 0 ? source.content : 'Unrelated source content',
        codeUnitStart: 0,
      }],
    })),
  };
  buildSourceNativeProduct({ ...options, input });
  const state = openProductState(options);
  const sourceByRef = new Map(state.objectOnt.sources.map((source) => [source.relativePath, source]));
  const objectByRef = new Map(state.objectOnt.map.nativeObjects.map((object) => [object.relativePath, object]));
  const witness = (sourceRef, start = 0, end = null) => {
    const source = sourceByRef.get(sourceRef);
    const object = objectByRef.get(sourceRef);
    assert(source);
    assert(object);
    const bytes = Buffer.from(source.content);
    const byteEnd = end ?? bytes.length;
    const exact = bytes.subarray(start, byteEnd);
    return {
      nativeObjectSha256: object.nativeObjectSha256,
      evidence: {
        sourceRef,
        sourceSha256: source.sourceSha256,
        byteStart: start,
        byteEnd,
        textSha256: objectBytesSha256(exact),
      },
    };
  };
  const selectedSource = sourceByRef.get(SELECTED_REF);
  const selectedInput = {
    proposedBy: 'selected-source-context-test',
    proposedAt: OCCURRED_AT,
    method: 'authored',
    objectDefs: [{
      kind: 'ObjectDef',
      id: 'selected-concept',
      name: 'Selected concept',
      source: witness(SELECTED_REF),
      aliases: [],
    }],
    claims: [{
      kind: 'Claim',
      id: 'selected-definition',
      about: 'selected-concept',
      predicate: 'defines',
      source: witness(SELECTED_REF),
    }],
    coverage: [{
      sourceRef: SELECTED_REF,
      sourceSha256: selectedSource.sourceSha256,
      disposition: 'examined',
    }],
  };
  const construction = compileSourceNativeSemanticConstruction({ options, input: selectedInput });
  const selectedPackKey = selectedSource.blobDescriptor.key;
  const unrelatedSource = sourceByRef.get(UNRELATED_REF);
  assert.notEqual(selectedPackKey, unrelatedSource.blobDescriptor.key);
  assert.equal(state.objectOnt.catalog.sourcePackCount, 2);
  return {
    root,
    options,
    input,
    selectedInput,
    construction,
    selectedContent,
    selectedPackKey,
    unrelatedPackKey: unrelatedSource.blobDescriptor.key,
    sourceByRef,
    objectByRef,
  };
}

let fixture;
test.before(() => {
  fixture = makeFixture();
});
test.after(() => {
  rmSync(fixture.root, { recursive: true, force: true });
});

function observeSourcePackReads(callback, sourcePackKeysOfInterest) {
  const originalReadFileSync = fs.readFileSync;
  const sourcePackKeys = new Set();
  fs.readFileSync = function observedReadFileSync(path, ...args) {
    const value = Reflect.apply(originalReadFileSync, this, [path, ...args]);
    if (typeof path === 'string' && path.includes('/objects/')) {
      try {
        const envelope = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
        if (envelope?.kind === 'OpenOntologyFileObjectV1'
          && sourcePackKeysOfInterest.has(envelope.key)) {
          sourcePackKeys.add(envelope.key);
        }
      } catch {
        // Non-object files are outside this bounded observation.
      }
    }
    return value;
  };
  syncBuiltinESMExports();
  try {
    return { value: callback(), sourcePackKeys: [...sourcePackKeys] };
  } finally {
    fs.readFileSync = originalReadFileSync;
    syncBuiltinESMExports();
  }
}

function clone(value) {
  return structuredClone(value);
}

test('compiler selected-source scope does not hydrate an unrelated source pack', () => {
  const sourcePackKeys = new Set([fixture.selectedPackKey, fixture.unrelatedPackKey]);
  const observed = observeSourcePackReads(() =>
    compileSourceNativeSemanticConstruction({ options: fixture.options, input: fixture.selectedInput }),
  sourcePackKeys);
  assert.deepEqual(observed.sourcePackKeys, [fixture.selectedPackKey]);
});

test('review selected-source scope does not hydrate an unrelated source pack', () => {
  const sourcePackKeys = new Set([fixture.selectedPackKey, fixture.unrelatedPackKey]);
  const observed = observeSourcePackReads(() =>
    openSourceNativeConstructionReview({ options: fixture.options, construction: fixture.construction }),
  sourcePackKeys);
  assert.deepEqual(observed.sourcePackKeys, [fixture.selectedPackKey]);
});

test('scoped construction remains distinct from whole-Ont state', () => {
  assert.equal(fixture.construction.coverage.sourceCount, 2);
  assert.equal(fixture.construction.coverage.examinedSourceCount, 1);
  assert.equal(fixture.construction.coverage.unexaminedSourceCount, 1);
  const state = openProductState(fixture.options);
  assert.deepEqual(state.objectOnt.sources.map((source) => source.relativePath),
    [SELECTED_REF, UNRELATED_REF]);
  assert.equal(state.objectOnt.sources.find((source) => source.relativePath === UNRELATED_REF).content,
    fixture.input.sources.find((source) => source.relativePath === UNRELATED_REF).content);
});

test('review packet includes the complete cited document, not a selected snippet', () => {
  const session = openSourceNativeConstructionReview({
    options: fixture.options,
    construction: fixture.construction,
  });
  assert.deepEqual(session.packet.sources.map((source) => source.relativePath), [SELECTED_REF]);
  assert.equal(session.packet.sources[0].content, fixture.selectedContent);
  assert.equal(session.packet.sources[0].sourceSha256,
    fixture.sourceByRef.get(SELECTED_REF).sourceSha256);
});

test('wrong selected bytes, hash, UTF-8 span and native field are refused', () => {
  const wrongBytes = clone(fixture.selectedInput);
  wrongBytes.objectDefs[0].source.evidence.textSha256 = objectBytesSha256(Buffer.from('wrong bytes'));
  assert.throws(() => compileSourceNativeSemanticConstruction({
    options: fixture.options, input: wrongBytes,
  }), { code: 'SEMANTIC_CONSTRUCTION_EVIDENCE' });

  const wrongHash = clone(fixture.selectedInput);
  wrongHash.objectDefs[0].source.evidence.sourceSha256 = objectBytesSha256(Buffer.from('wrong source'));
  assert.throws(() => compileSourceNativeSemanticConstruction({
    options: fixture.options, input: wrongHash,
  }), { code: 'SEMANTIC_CONSTRUCTION_SOURCE' });

  const wrongUtf8 = clone(fixture.selectedInput);
  const bytes = Buffer.from(fixture.selectedContent);
  const utf8Start = bytes.indexOf(Buffer.from('é')) + 1;
  const utf8Span = bytes.subarray(utf8Start, utf8Start + 1);
  wrongUtf8.objectDefs[0].source.evidence.byteStart = utf8Start;
  wrongUtf8.objectDefs[0].source.evidence.byteEnd = utf8Start + 1;
  wrongUtf8.objectDefs[0].source.evidence.textSha256 = objectBytesSha256(utf8Span);
  assert.throws(() => compileSourceNativeSemanticConstruction({
    options: fixture.options, input: wrongUtf8,
  }), { code: 'SEMANTIC_CONSTRUCTION_EVIDENCE' });

  const wrongField = clone(fixture.selectedInput);
  wrongField.objectDefs[0].source.nativeObjectSha256 =
    fixture.objectByRef.get(UNRELATED_REF).nativeObjectSha256;
  assert.throws(() => compileSourceNativeSemanticConstruction({
    options: fixture.options, input: wrongField,
  }), { code: 'SEMANTIC_CONSTRUCTION_SOURCE' });
});

test('stale current-cut identity is refused by the existing review API', () => {
  const stale = clone(fixture.construction);
  stale.sourceBinding.sourceCommitSha256 = objectBytesSha256(Buffer.from('stale ref'));
  const { constructionSha256: _constructionSha256, ...core } = stale;
  stale.constructionSha256 = stableObjectSha256(core);
  assert.throws(() => openSourceNativeConstructionReview({
    options: fixture.options,
    construction: stale,
  }), { code: 'SEMANTIC_CONSTRUCTION_BINDING' });
});

test('unknown source refs are refused rather than discovered from the whole Ont', () => {
  const unknown = clone(fixture.selectedInput);
  unknown.coverage = [{
    sourceRef: 'docs/unknown.md',
    sourceSha256: objectBytesSha256(Buffer.from('unknown source')),
    disposition: 'examined',
  }];
  assert.throws(() => compileSourceNativeSemanticConstruction({
    options: fixture.options, input: unknown,
  }), { code: 'SEMANTIC_CONSTRUCTION_COVERAGE' });
});

test('Node runtime identity is explicit for this public control', () => {
  assert.match(NODE_VERSION, /^24\./u);
});
