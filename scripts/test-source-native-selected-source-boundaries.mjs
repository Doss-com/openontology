import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import * as kernel from '../dist/src/kernel.mjs';
import { openGcsObjectBackend } from '../dist/src/gcs-object-storage-backend.mjs';
import { createSourceNativeObjectOntSourceReader } from '../dist/src/source-native-object-ont.mjs';

const SELECTED_REF = 'docs/selected.md';
const UNRELATED_REF = 'docs/unrelated.md';
const OCCURRED_AT = '2026-09-08T00:00:00.000Z';
const SELECTED_WITNESS = 'Selected concept';
const SOURCE_PACK_BYTES = 8 * 1024 * 1024;
const clone = structuredClone;

function source(relativePath, content) {
  return { relativePath, sourceType: 'docs', occurredAt: OCCURRED_AT, content };
}

function buildInput({ selectedContent, unrelatedContent, extraSelectedObjects = 0 }) {
  const sources = [
    source(SELECTED_REF, selectedContent),
    source(UNRELATED_REF, unrelatedContent),
  ];
  const selectedObjects = Array.from({ length: extraSelectedObjects + 1 }, (_, index) => ({
    relativePath: SELECTED_REF,
    objectIdentity: {
      home: 'ObjectDef/InstanceRef',
      sourceSystem: 'docs',
      objectType: 'Document',
      namespace: 'selected-source-boundaries',
      externalId: `selected-${index}`,
    },
    fields: [{ fieldPath: 'body', value: selectedContent, codeUnitStart: 0 }],
  }));
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'selected-source-boundaries-fixture',
    namespace: 'selected-source-boundaries',
    querySchemas: [{ sourceSystem: 'docs', objectType: 'Document', aliases: ['document'],
      fields: [{ fieldPath: 'body', aliases: ['body'] }] }],
    sources,
    nativeObjectInputs: [
      ...selectedObjects,
      {
        relativePath: UNRELATED_REF,
        objectIdentity: {
          home: 'ObjectDef/InstanceRef',
          sourceSystem: 'docs',
          objectType: 'Document',
          namespace: 'selected-source-boundaries',
          externalId: 'unrelated',
        },
        fields: [{ fieldPath: 'body', value: unrelatedContent, codeUnitStart: 0 }],
      },
    ],
  };
}

function makeFixture(t, {
  selectedContent = `${SELECTED_WITNESS} is defined by this source.\n`,
  unrelatedContent = 'Unrelated source content.\n',
  extraSelectedObjects = 0,
  protectedHistory = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oont-selected-source-boundaries-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const objectRoot = join(root, 'objects');
  const historyRoot = join(root, 'history');
  const artifactRoot = join(root, 'artifact');
  const objectBackendUri = pathToFileURL(objectRoot).href;
  const historyBackendUri = pathToFileURL(historyRoot).href;
  const options = {
    artifactRoot,
    objectBackendUri,
    ...(protectedHistory ? { historyBackendUri } : {}),
  };
  const input = buildInput({ selectedContent, unrelatedContent, extraSelectedObjects });
  kernel.buildSourceNativeProduct({
    ...options,
    input,
  });
  const state = kernel.openProductState(options);
  return {
    root,
    objectRoot,
    historyRoot,
    artifactRoot,
    objectBackendUri,
    historyBackendUri,
    options,
    input,
    state,
  };
}

function sourceRow(fixture, sourceRef) {
  return fixture.state.objectOnt.sources.find((sourceValue) => sourceValue.relativePath === sourceRef)
    ?? assert.fail(`missing source ${sourceRef}`);
}

function nativeObject(fixture, sourceRef, index = 0) {
  const rows = fixture.state.objectOnt.map.nativeObjects
    .filter((object) => object.relativePath === sourceRef);
  return rows[index] ?? assert.fail(`missing native object ${sourceRef} #${index}`);
}

function witness(fixture, sourceRef, index = 0) {
  const sourceValue = sourceRow(fixture, sourceRef);
  const object = nativeObject(fixture, sourceRef, index);
  return {
    nativeObjectSha256: object.nativeObjectSha256,
    evidence: {
      sourceRef,
      sourceSha256: sourceValue.sourceSha256,
      byteStart: 0,
      byteEnd: Buffer.byteLength(sourceValue.content),
      textSha256: sourceValue.sourceSha256,
    },
  };
}

function selectedConstructionInput(fixture) {
  const sourceValue = sourceRow(fixture, SELECTED_REF);
  return {
    proposedBy: 'constructor',
    proposedAt: OCCURRED_AT,
    method: 'authored',
    objectDefs: [{ kind: 'ObjectDef', id: 'selected-concept', name: SELECTED_WITNESS,
      source: witness(fixture, SELECTED_REF), aliases: [] }],
    claims: [{ kind: 'Claim', id: 'selected-definition', about: 'selected-concept',
      predicate: 'defines', source: witness(fixture, SELECTED_REF) }],
    coverage: [{ sourceRef: SELECTED_REF, sourceSha256: sourceValue.sourceSha256, disposition: 'examined' }],
  };
}

function at(day) {
  return `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`;
}

function signature(statement, privateKey) {
  return sign(null, Buffer.from(kernel.stableObjectText(statement)), privateKey).toString('base64');
}

function admissionFixture(fixture, construction) {
  const keys = Object.fromEntries(['constructor', 'reviewer'].map((id) => [id, generateKeyPairSync('ed25519')]));
  const trustRegistry = Object.entries(keys).map(([issuerId, pair]) => ({
    issuerId,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: [issuerId === 'constructor' ? 'proposer' : 'reviewer'],
  }));
  const proposalStatement = kernel.sourceNativeConstructionProposalStatement({ construction });
  const statement = kernel.sourceNativeConstructionAdmissionStatement({
    construction,
    issuerId: 'reviewer',
    admittedAt: at(9),
  });
  const record = kernel.compileSourceNativeConstructionAdmissionRecord({
    construction,
    proposalStatement,
    statement,
    proposalSignatureBase64: signature(proposalStatement, keys.constructor.privateKey),
    signatureBase64: signature(statement, keys.reviewer.privateKey),
  });
  return { keys, trustRegistry, record };
}

function envelopePath(objectRoot, key) {
  const keySha256 = kernel.objectBytesSha256(Buffer.from(key)).slice(7);
  return join(objectRoot, 'objects', keySha256.slice(0, 2), `${keySha256.slice(2)}.json`);
}

function corruptFileEnvelope(fixture, key) {
  const path = envelopePath(fixture.objectRoot, key);
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  const last = envelope.bytesBase64.at(-1);
  envelope.bytesBase64 = `${envelope.bytesBase64.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
  writeFileSync(path, `${JSON.stringify(envelope)}\n`);
}

function rehashField(field, value) {
  const { fieldSha256: _fieldSha256, ...core } = field;
  return { ...core, value, fieldSha256: kernel.stableObjectSha256({ ...core, value }) };
}

function rehashObject(object, fields) {
  const { nativeObjectSha256: _nativeObjectSha256, ...core } = object;
  return { ...core, fields, nativeObjectSha256: kernel.stableObjectSha256({ ...core, fields }) };
}

function variantMap(fixture, name, mutate) {
  const map = clone(fixture.state.objectOnt.map);
  mutate(map);
  const { nativeObjectMapSha256: _nativeObjectMapSha256, ...mapCore } = map;
  const mapSha256 = kernel.stableObjectSha256(mapCore);
  map.nativeObjectMapSha256 = mapSha256;
  const mapBlob = fixture.state.store.putBlob({
    logicalPath: `blobs/source-native/maps/sha256/${mapSha256.slice(7)}.json`,
    bytes: Buffer.from(kernel.stableObjectText(map)),
    mediaType: 'application/json',
  });
  const currentCommit = fixture.state.store.readCommit(fixture.state.objectOnt.commitSha256).commit;
  const oldManifest = JSON.parse(fixture.state.store.readBlob(currentCommit.ontManifest, { manifest: true }).bytes);
  const manifestValue = {
    ...oldManifest,
    nativeObjectMapSha256: mapSha256,
    mapBlobLogicalPath: mapBlob.logicalPath,
    mapBlobStoredSha256: mapBlob.storedSha256,
  };
  const manifest = fixture.state.store.putBlob({
    logicalPath: 'oont.json',
    bytes: Buffer.from(kernel.stableObjectText(manifestValue)),
    mediaType: 'application/json',
  });
  const blobs = [
    ...currentCommit.blobs.filter((blob) => blob.logicalPath !== oldManifest.mapBlobLogicalPath),
    mapBlob,
  ];
  const commit = fixture.state.store.writeCommitMetadata({
    ontId: fixture.state.descriptor.ontId,
    parents: [fixture.state.objectOnt.commitSha256],
    ontManifest: manifest,
    blobs,
  });
  const currentRef = fixture.state.store.readRefMetadata({
    ontId: fixture.state.descriptor.ontId,
    branch: fixture.state.descriptor.branch,
  });
  assert(currentRef);
  const ref = fixture.state.store.compareAndSwapRefMetadataCheckpointed({
    ontId: fixture.state.descriptor.ontId,
    branch: fixture.state.descriptor.branch,
    expectedVersion: currentRef.version,
    commitSha256: commit.commitSha256,
  });
  const artifactRoot = join(fixture.root, name);
  mkdirSync(artifactRoot, { recursive: true });
  const { artifactSha256: _artifactSha256, ...descriptorCore } = fixture.state.descriptor;
  const descriptor = {
    ...descriptorCore,
    sourceCommitSha256: commit.commitSha256,
    sourceReplaySha256: ref.ref.replaySha256,
    nativeObjectMapSha256: mapSha256,
    artifactSha256: kernel.stableObjectSha256({
      ...descriptorCore,
      sourceCommitSha256: commit.commitSha256,
      sourceReplaySha256: ref.ref.replaySha256,
      nativeObjectMapSha256: mapSha256,
    }),
  };
  writeFileSync(join(artifactRoot, 'source-native.json'), `${kernel.stableObjectText(descriptor)}\n`);
  return {
    artifactRoot,
    options: {
      artifactRoot,
      objectBackendUri: fixture.objectBackendUri,
      ...(fixture.options.historyBackendUri === undefined ? {} : {
        historyBackendUri: fixture.historyBackendUri,
      }),
    },
    map,
    commit,
    ref,
  };
}

function corruptMapField(map, sourceRef, objectIndex, value) {
  const objectIndexes = map.nativeObjects
    .map((object, index) => object.relativePath === sourceRef ? index : -1)
    .filter((index) => index >= 0);
  const index = objectIndexes[objectIndex] ?? assert.fail(`missing map object ${sourceRef} #${objectIndex}`);
  const object = map.nativeObjects[index];
  const fields = object.fields.map((field) => field.fieldPath === 'body'
    ? rehashField(field, value) : field);
  map.nativeObjects[index] = rehashObject(object, fields);
}

test('stale pre-advance construction is refused by canonical compile, review, and Admission', (t) => {
  const fixture = makeFixture(t);
  const input = selectedConstructionInput(fixture);
  const construction = kernel.compileSourceNativeSemanticConstruction({ options: fixture.options, input });
  assert.doesNotThrow(() => kernel.openSourceNativeConstructionReview({
    options: fixture.options,
    construction,
  }));
  const admission = admissionFixture(fixture, construction);
  const successorInput = clone(fixture.input);
  successorInput.sources[1].content = `${successorInput.sources[1].content} successor\n`;
  successorInput.nativeObjectInputs.at(-1).fields[0].value = successorInput.sources[1].content;
  const successorRoot = join(fixture.root, 'successor');
  const successorOptions = {
    artifactRoot: successorRoot,
    objectBackendUri: fixture.objectBackendUri,
    historyBackendUri: fixture.historyBackendUri,
  };
  kernel.buildSourceNativeProduct({ ...successorOptions, input: successorInput });
  assert.throws(() => kernel.compileSourceNativeSemanticConstruction({
    options: fixture.options,
    input,
  }), { code: 'SOURCE_NATIVE_PRODUCT_REF' });
  assert.throws(() => kernel.openSourceNativeConstructionReview({
    options: successorOptions,
    construction,
  }), { code: 'SEMANTIC_CONSTRUCTION_BINDING' });
  assert.throws(() => kernel.writeSourceNativeConstructionAdmission({
    options: successorOptions,
    trustRegistry: admission.trustRegistry,
    record: admission.record,
  }), { code: 'SEMANTIC_CONSTRUCTION_BINDING' });
});

test('same-pack nonselected corruption distinguishes file envelopes from native range delivery', (t) => {
  const fileFixture = makeFixture(t, {
    unrelatedContent: 'Unrelated source in the same pack.\n',
    protectedHistory: true,
  });
  const selected = sourceRow(fileFixture, SELECTED_REF);
  const unrelated = sourceRow(fileFixture, UNRELATED_REF);
  assert.equal(selected.blobDescriptor.key, unrelated.blobDescriptor.key);
  corruptFileEnvelope(fileFixture, selected.blobDescriptor.key);
  assert.throws(() => kernel.compileSourceNativeSemanticConstruction({
    options: fileFixture.options,
    input: selectedConstructionInput(fileFixture),
  }), { code: 'OBJECT_BACKEND_CORRUPT' });

  const rangeFixture = makeFixture(t, {
    unrelatedContent: 'Unrelated source in the same pack.\n',
    protectedHistory: true,
  });
  const fileSelection = kernel.openCanonicalObjectBackend({ uri: rangeFixture.objectBackendUri });
  const fileIndex = kernel.openSourceNativeObjectOntRefIndex({
    backend: fileSelection.backend,
    historyBackend: kernel.openCanonicalObjectBackend({ uri: rangeFixture.historyBackendUri }).backend,
    ontId: rangeFixture.state.descriptor.ontId,
    branch: rangeFixture.state.descriptor.branch,
  });
  assert(fileIndex);
  const selectedRange = fileIndex.objectOnt.sources.find((sourceValue) => sourceValue.relativePath === SELECTED_REF);
  const unrelatedRange = fileIndex.objectOnt.sources.find((sourceValue) => sourceValue.relativePath === UNRELATED_REF);
  assert(selectedRange);
  assert(unrelatedRange);
  assert.equal(selectedRange.blobDescriptor.key, unrelatedRange.blobDescriptor.key);
  const originalPack = fileSelection.backend.get(selectedRange.blobDescriptor.key).bytes;
  const corruptPack = Buffer.from(originalPack);
  corruptPack[unrelatedRange.blobByteStart] ^= 0xff;
  assert.notEqual(corruptPack[unrelatedRange.blobByteStart], originalPack[unrelatedRange.blobByteStart]);
  const requests = [];
  const gcsBackend = openGcsObjectBackend({
    bucket: 'selected-source-boundaries',
    accessToken: 'fixture-token',
    transport: (request) => {
      requests.push(request);
      const match = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? '');
      assert(match, 'selected reader must request a bounded native range');
      const start = Number(match[1]);
      const end = Number(match[2]) + 1;
      const bytes = corruptPack.subarray(start, end);
      return {
        status: 206,
        headers: {
          'content-length': String(bytes.length),
          'content-range': `bytes ${start}-${end - 1}/${selectedRange.blobDescriptor.byteLength}`,
          'x-goog-generation': '1700000000000000',
          'x-goog-meta-oont-byte-length': String(selectedRange.blobDescriptor.byteLength),
          'x-goog-meta-oont-sha256': selectedRange.blobDescriptor.storedSha256,
        },
        body: bytes,
      };
    },
  });
  const reader = createSourceNativeObjectOntSourceReader({
    store: kernel.openObjectOntStore({ backend: gcsBackend }),
    index: fileIndex.objectOnt,
  });
  assert.equal(reader(SELECTED_REF).content, rangeFixture.input.sources[0].content);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.range,
    `bytes=${selectedRange.blobByteStart}-${selectedRange.blobByteEnd - 1}`);
  assert.equal(requests[0].headers.range.includes(String(unrelatedRange.blobByteStart)), false);
});

test('a selected source validates every native object attached to that source', (t) => {
  const fixture = makeFixture(t, { extraSelectedObjects: 1 });
  const variant = variantMap(fixture, 'selected-field-invalid', (map) => {
    corruptMapField(map, SELECTED_REF, 1, 'not present in selected source');
  });
  assert.throws(() => kernel.compileSourceNativeSemanticConstruction({
    options: variant.options,
    input: selectedConstructionInput(fixture),
  }), { code: 'SOURCE_NATIVE_OBJECT_ONT_FIELD_EVIDENCE' });
});

test('structurally valid invalid field evidence on an uncited source stays scoped, while full open refuses', (t) => {
  const fixture = makeFixture(t);
  const variant = variantMap(fixture, 'uncited-field-invalid', (map) => {
    corruptMapField(map, UNRELATED_REF, 0, 'not present in unrelated source');
  });
  assert.doesNotThrow(() => kernel.compileSourceNativeSemanticConstruction({
    options: variant.options,
    input: selectedConstructionInput(fixture),
  }));
  assert.throws(() => kernel.openProductState(variant.options), {
    code: 'SOURCE_NATIVE_OBJECT_ONT_FIELD_EVIDENCE',
  });
});

test('structurally corrupt native metadata refuses the whole source index', (t) => {
  const fixture = makeFixture(t);
  const variant = variantMap(fixture, 'structurally-corrupt-map', (map) => {
    map.nativeObjects = null;
  });
  assert.throws(() => kernel.openProductSourceContext(variant.options), {
    code: 'SOURCE_NATIVE_OBJECT_ONT_MAP',
  });
  assert.throws(() => kernel.openProductState(variant.options), {
    code: 'SOURCE_NATIVE_OBJECT_ONT_MAP',
  });
});

test('protected Admission refuses when an unrelated source pack is unavailable', (t) => {
  const fixture = makeFixture(t, {
    unrelatedContent: `Unrelated source ${'u'.repeat(SOURCE_PACK_BYTES + 1)}\n`,
    protectedHistory: true,
  });
  const construction = kernel.compileSourceNativeSemanticConstruction({
    options: fixture.options,
    input: selectedConstructionInput(fixture),
  });
  const admission = admissionFixture(fixture, construction);
  const unrelated = sourceRow(fixture, UNRELATED_REF);
  assert.notEqual(unrelated.blobDescriptor.key, sourceRow(fixture, SELECTED_REF).blobDescriptor.key);
  unlinkSync(envelopePath(fixture.objectRoot, unrelated.blobDescriptor.key));
  assert.throws(() => kernel.writeSourceNativeConstructionAdmission({
    options: fixture.options,
    trustRegistry: admission.trustRegistry,
    record: admission.record,
  }), { code: 'OBJECT_ONT_HISTORY_TARGET' });
});
