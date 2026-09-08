import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import * as kernel from '../dist/src/kernel.mjs';
import { createConstructionLedgerReader } from '../dist/src/source-native-construction-admission.mjs';
import { openCanonicalObjectBackend } from '../dist/src/canonical-object-backend.mjs';
import {
  materializeSourceNativeObjectOnt,
  openSourceNativeObjectOntRefAtCut,
} from '../dist/src/source-native-object-ont.mjs';

const clone = structuredClone;
const digest = kernel.objectBytesSha256(Buffer.from('not present'));
const prefix = 'blobs/knowledge-ledger/construction/';
const pathFor = (sha) => `${prefix}${sha.slice(7)}.json`;
const at = (day) => `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const signature = (statement, key) => sign(null, Buffer.from(kernel.stableObjectText(statement)), key).toString('base64');
const fileObjectPath = (objectBackendUri, key) => {
  const keySha256 = kernel.objectBytesSha256(Buffer.from(key)).slice(7);
  return join(fileURLToPath(objectBackendUri), 'objects', keySha256.slice(0, 2), `${keySha256.slice(2)}.json`);
};
const corruptFileObjectEnvelope = (objectBackendUri, key) => {
  writeFileSync(fileObjectPath(objectBackendUri, key), Buffer.from('{corrupt envelope\n'));
};
function treeSnapshot(root) {
  const entries = [];
  const visit = (directory, relative = '') => {
    for (const name of readdirSync(directory).sort()) {
      const child = join(directory, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(child);
      if (stat.isDirectory()) {
        entries.push([`${childRelative}/`, 'directory']);
        visit(child, childRelative);
      } else {
        assert(stat.isFile(), `unexpected fixture entry: ${childRelative}`);
        entries.push([childRelative, kernel.objectBytesSha256(readFileSync(child))]);
      }
    }
  };
  visit(root);
  return kernel.stableObjectText(entries);
}

function fixture(t, { protectedHistory = false, namespace = 'example', multiSource = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oont-construction-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const objectBackendUri = pathToFileURL(join(root, 'objects')).href;
  const historyBackendUri = pathToFileURL(join(root, 'history')).href;
  const options = { artifactRoot: join(root, 'ont') };
  const buildInput = {
    schemaVersion: 1, kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'construction-admission-example', namespace,
    querySchemas: [{ sourceSystem: 'tracker', objectType: 'task', aliases: ['task'],
      fields: [{ fieldPath: 'body', aliases: ['body'] }, { fieldPath: 'status', aliases: ['status'] }] }],
    sources: [{ relativePath: 'tracker/task-1.txt', sourceType: 'tracker', occurredAt: at(1),
      content: 'AllocationException means allocation mismatch. Status: open.' }],
    nativeObjectInputs: [{ relativePath: 'tracker/task-1.txt',
      businessEntityKeys: ['task:task-1'],
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'tracker', objectType: 'task', namespace, externalId: 'task-1' },
      fields: [{ fieldPath: 'body', value: 'AllocationException means allocation mismatch. Status: open.' },
        { fieldPath: 'status', value: 'open', propositionFamilyKey: 'task-status',
          validAt: at(1), knownAt: at(1), businessEntityKeys: ['task:task-1'],
          canonicalProposition: { kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
            propositionKey: 'task-1-open', actorHome: 'ObjectDef/InstanceRef',
            stateHome: 'Claim/PropositionRevision-payload', actorKind: 'task', predicate: 'has-status',
            state: 'open', dimension: 'task-status', canonicalRoles: ['state'], modality: 'observed',
            polarity: 'positive', businessEntityKeys: ['task:task-1'],
            extractionAuthority: 'deterministic-source-adapter-v1', relations: [] } }],
    }],
  };
  if (multiSource) {
    buildInput.sources.push({ relativePath: 'tracker/task-2.txt', sourceType: 'tracker', occurredAt: at(1),
      content: 'Second allocation note. Status: open.' });
    buildInput.nativeObjectInputs.push({ relativePath: 'tracker/task-2.txt',
      businessEntityKeys: ['task:task-2'],
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'tracker', objectType: 'task', namespace, externalId: 'task-2' },
      fields: [{ fieldPath: 'body', value: 'Second allocation note. Status: open.' },
        { fieldPath: 'status', value: 'open', propositionFamilyKey: 'task-status',
          validAt: at(1), knownAt: at(1), businessEntityKeys: ['task:task-2'],
          canonicalProposition: { kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
            propositionKey: 'task-2-open', actorHome: 'ObjectDef/InstanceRef',
            stateHome: 'Claim/PropositionRevision-payload', actorKind: 'task', predicate: 'has-status',
            state: 'open', dimension: 'task-status', canonicalRoles: ['state'], modality: 'observed',
            polarity: 'positive', businessEntityKeys: ['task:task-2'],
            extractionAuthority: 'deterministic-source-adapter-v1', relations: [] } }],
    });
  }
  kernel.buildSourceNativeProduct({ ...options, objectBackendUri,
    ...(protectedHistory ? { historyBackendUri } : {}), input: buildInput });
  const state = kernel.openProductState(options);
  const object = state.objectOnt.map.nativeObjects[0];
  const source = state.objectOnt.sources[0];
  const witness = { nativeObjectSha256: object.nativeObjectSha256, evidence: {
    sourceRef: source.relativePath, sourceSha256: source.sourceSha256, byteStart: 0,
    byteEnd: Buffer.byteLength(source.content), textSha256: source.sourceSha256 } };
  const input = { proposedBy: 'constructor', proposedAt: at(2), method: 'authored',
    objectDefs: [{ kind: 'ObjectDef', id: 'allocation-exception', name: 'AllocationException',
      source: witness, aliases: [{ value: 'allocation mismatch', sourceSystem: 'tracker', source: witness }] }],
    claims: [{ kind: 'Claim', id: 'definition', about: 'allocation-exception', predicate: 'defines', source: witness }],
    coverage: [{ sourceRef: source.relativePath, sourceSha256: source.sourceSha256, disposition: 'examined' }],
  };
  const keys = Object.fromEntries(['constructor', 'reviewer', 'reviewer-two'].map((id) => [id, generateKeyPairSync('ed25519')]));
  const trust = Object.entries(keys).map(([issuerId, pair]) => ({ issuerId,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: [issuerId === 'constructor' ? 'proposer' : 'reviewer'] }));
  const compile = (value = input) => kernel.compileSourceNativeSemanticConstruction({ options, input: value });
  function admit(construction = compile(), { issuerId = 'reviewer', admittedAt = at(3), targets = [] } = {}) {
    const proposalStatement = kernel.sourceNativeConstructionProposalStatement({ construction });
    const statement = kernel.sourceNativeConstructionAdmissionStatement({ construction, issuerId, admittedAt,
      supersedesRecordSha256s: targets });
    return kernel.compileSourceNativeConstructionAdmissionRecord({ construction, proposalStatement, statement,
      proposalSignatureBase64: signature(proposalStatement, keys.constructor.privateKey),
      signatureBase64: signature(statement, keys[issuerId].privateKey) });
  }
  const branch = `knowledge-${state.objectOnt.commitSha256.slice(7, 23)}`;
  const route = { ontId: state.descriptor.ontId, branch };
  const sourceRoute = { ontId: state.descriptor.ontId, branch: state.descriptor.branch };
  const write = (record, extra = {}) => kernel.writeSourceNativeConstructionAdmission({ options, trustRegistry: trust, record, ...extra });
  const read = (extra = {}) => kernel.readSourceNativeConstructionLedger({ options, trustRegistry: trust, ...extra });
  function plant(value, logicalPath = pathFor(value.recordSha256)) {
    const snapshot = state.store.readRefMetadataSnapshot(route);
    const parent = snapshot?.ref.commitSha256 ?? state.objectOnt.commitSha256;
    const blob = state.store.putBlob({ logicalPath, bytes: Buffer.from(kernel.stableObjectText(value)), mediaType: 'application/json' });
    const commit = state.store.writeCommitMetadata({ ontId: route.ontId, parents: [parent],
      ontManifest: state.store.readCommit(parent).commit.ontManifest, blobs: [blob] });
    state.store.compareAndSwapRefMetadata({ ...route, expectedVersion: snapshot?.version ?? null, commitSha256: commit.commitSha256 });
    return blob;
  }
  return { root, options, objectBackendUri, historyBackendUri, buildInput, state, input, keys, trust, compile, admit,
    branch, route, sourceRoute, write, read, plant, backend: openCanonicalObjectBackend({ uri: objectBackendUri }).backend,
    historyBackend: protectedHistory
      ? openCanonicalObjectBackend({ uri: historyBackendUri }).backend : undefined };
}

function rehash(record) {
  const { recordSha256: _hash, ...core } = record;
  return { ...core, recordSha256: kernel.stableObjectSha256(core) };
}
function changed(f, { id, name, noAlias = false } = {}) {
  const input = clone(f.input);
  if (id) { input.objectDefs[0].id = id; input.claims[0].about = id; }
  if (name) input.objectDefs[0].name = name;
  if (noAlias) input.objectDefs[0].aliases = [];
  input.claims[0].predicate = 'mentions';
  return f.compile(input);
}
function sourceBinding(f) {
  return {
    ontId: f.state.descriptor.ontId,
    namespace: f.state.descriptor.namespace,
    artifactSha256: f.state.descriptor.artifactSha256,
    sourceCommitSha256: f.state.descriptor.sourceCommitSha256,
    sourceReplaySha256: f.state.descriptor.sourceReplaySha256,
    sourceCatalogSha256: f.state.descriptor.sourceCatalogSha256,
    nativeObjectMapSha256: f.state.descriptor.nativeObjectMapSha256,
  };
}
function readAtArtifact(f, extra = {}) {
  return kernel.readSourceNativeConstructionLedgerAtArtifact({
    options: f.options, trustRegistry: f.trust, expectedSourceBinding: sourceBinding(f), ...extra,
  });
}
function materializeInput(input) {
  const sources = input.sources.map((source) => ({ ...source,
    sourceSha256: kernel.objectBytesSha256(Buffer.from(source.content)) }));
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  return {
    ...input,
    sources,
    nativeObjectInputs: input.nativeObjectInputs.map((object) => {
      const source = sourceByPath.get(object.relativePath);
      assert(source, `missing source for ${object.relativePath}`);
      return {
        ...object,
        fields: object.fields.map((field) => ({ ...field,
          codeUnitStart: field.codeUnitStart ?? source.content.indexOf(field.value),
        })),
      };
    }),
  };
}
function advanceOnlySecondSource(f) {
  const input = clone(f.buildInput);
  const source = input.sources.find((item) => item.relativePath === 'tracker/task-2.txt');
  const object = input.nativeObjectInputs.find((item) => item.relativePath === 'tracker/task-2.txt');
  assert(source && object, 'multi-source fixture must include task-2');
  source.content = 'Second allocation note changed only at descendant B. Status: closed.';
  object.fields[0].value = source.content;
  object.fields[1].value = 'closed';
  object.fields[1].canonicalProposition.state = 'closed';
  object.fields[1].canonicalProposition.propositionKey = 'task-2-closed';
  const materializedInput = materializeInput(input);
  const before = f.state.store.readRefMetadata(f.sourceRoute);
  return materializeSourceNativeObjectOnt({
    backend: f.backend, historyBackend: f.historyBackend, ontId: f.state.descriptor.ontId,
    branch: f.sourceRoute.branch, expectedVersion: before.version,
    sources: materializedInput.sources, nativeObjectInputs: materializedInput.nativeObjectInputs,
  });
}
function mutateHistory(f, branch, mutate) {
  const key = `ref-history/${f.state.descriptor.ontId}/${branch}.json`;
  const head = f.historyBackend.head(key);
  const current = JSON.parse(f.historyBackend.get(key).bytes.toString('utf8'));
  mutate(current);
  const { historySha256: _historySha256, ...core } = current;
  f.historyBackend.compareAndSwap(key, {
    expectedVersion: head.version,
    bytes: Buffer.from(kernel.stableObjectText({ ...core, historySha256: kernel.stableObjectSha256(core) })),
  });
}

test('only independently signed navigation is written; cold retry preserves source and original bytes', (t) => {
  const f = fixture(t);
  const before = f.state.store.readRefMetadata({ ...f.route, branch: 'main' });
  assert.equal(f.read().activeRecords.length, 0);
  const record = f.admit();
  const canonical = kernel.stableObjectText(record);
  assert.equal(record.statement.decision, 'admitted-for-navigation');
  assert.equal(record.construction.reviewRequired, true);
  assert.deepEqual(kernel.validateSourceNativeConstructionAdmissionRecord(JSON.parse(canonical)), record);
  const first = f.write(record);
  assert.equal(first.replayed, false);
  const cold = f.read();
  assert.equal(cold.state, 'ready');
  assert.equal(cold.structuralRecordCount, 1);
  assert.equal(cold.eligibleRecordCount, 1);
  assert.deepEqual(cold.activeRecords, [record]);
  assert(Object.isFrozen(cold.activeRecords[0].construction.objectDefs[0].aliases));
  assert.equal('proofDisposition' in cold, false);
  const retry = f.write(JSON.parse(canonical));
  assert.deepEqual(retry, { ...first, replayed: true });
  assert.deepEqual(f.state.store.readRefMetadata({ ...f.route, branch: 'main' }), before);
  const replay = f.state.store.replayMetadata(first.commitSha256);
  const blob = replay.blobDescriptors.find((item) => item.logicalPath === pathFor(record.recordSha256));
  assert.equal(f.state.store.readBlob(blob).bytes.toString(), canonical);
});

test('empty extraction is a valid proposal, not an Admission', (t) => {
  const f = fixture(t);
  const empty = f.compile({ ...f.input, objectDefs: [], claims: [] });
  assert.equal(empty.objectDefs.length, 0);
  assert.throws(() => f.admit(empty), { code: 'CONSTRUCTION_ADMISSION_EMPTY' });
});

test('reviewer labels and signing times cannot claim independence', (t) => {
  const f = fixture(t);
  for (const [issuerId, admittedAt] of [['constructor', at(3)], ['reviewer', at(1)]]) {
    assert.throws(() => kernel.sourceNativeConstructionAdmissionStatement({
      construction: f.compile(), issuerId, admittedAt }), { code: 'CONSTRUCTION_ADMISSION_INDEPENDENCE' });
  }
  assert.throws(() => f.admit(f.compile(), { admittedAt: 'yesterday' }), { code: 'CONSTRUCTION_ADMISSION_TIME' });
});

for (const [name, mutate] of [
  ['unknown reviewer', (f) => { f.trust.pop(); f.trust.pop(); }],
  ['wrong reviewer role', (f) => { f.trust[1].roles = ['proposer']; }],
  ['wrong proposer role', (f) => { f.trust[0].roles = ['reviewer']; }],
  ['same actual key under two labels', (f) => { f.keys.reviewer = f.keys.constructor;
    f.trust[1].publicKeyPem = f.trust[0].publicKeyPem; }],
]) test(`write refuses ${name} without advancing knowledge`, (t) => {
  const f = fixture(t); mutate(f);
  assert.throws(() => f.write(f.admit()), { code: 'SOURCE_NATIVE_ADMISSION_AUTHENTICATION' });
  assert.equal(f.state.store.readRefMetadata(f.route), null);
});

for (const field of ['signatureBase64', 'proposalSignatureBase64']) {
  test(`structurally valid tampered ${field} never activates or supersedes`, (t) => {
    const f = fixture(t);
    const original = f.admit(); f.write(original);
    const candidate = clone(f.admit(changed(f), { admittedAt: at(4), targets: [original.recordSha256] }));
    candidate[field] = Buffer.alloc(64, 7).toString('base64');
    const bad = rehash(candidate);
    assert.equal(kernel.validateSourceNativeConstructionAdmissionRecord(bad).recordSha256, bad.recordSha256);
    assert.throws(() => f.write(bad), { code: 'SOURCE_NATIVE_ADMISSION_AUTHENTICATION' });
    f.plant(bad);
    const cold = f.read();
    assert.equal(cold.state, 'degraded');
    assert.equal(cold.invalidRecordCount, 1);
    assert.deepEqual(cold.activeRecords, [original]);
  });
}

for (const [name, mutate] of [
  ['old proof record kind', (r) => { r.kind = 'OpenOntologySourceNativeAdmissionRecordV1'; }],
  ['old reviewer statement kind', (r) => { r.statement.kind = 'OpenOntologySourceNativeAdmissionStatementV1'; }],
  ['old proposer statement kind', (r) => { r.proposalStatement.kind = 'OpenOntologySourceNativeProposalStatementV1'; }],
  ['proof decision', (r) => { r.statement.decision = 'admitted'; }],
  ['extra root property', (r) => { r.proofClosed = true; }],
  ['extra statement property', (r) => { r.statement.proofClosed = true; }],
  ['extra statement symbol', (r) => { r.statement[Symbol('authority')] = true; }],
  ['construction substitution', (r) => { r.construction = { ...r.construction, constructionSha256: digest }; }],
]) test(`record validation rejects ${name}`, (t) => {
  const f = fixture(t); const record = clone(f.admit()); mutate(record);
  assert.throws(() => kernel.validateSourceNativeConstructionAdmissionRecord(rehash(record)), TypeError);
});

test('revoked reviewer excludes but preserves structural history and allows a trusted correction', (t) => {
  const f = fixture(t);
  const original = f.admit(); f.write(original);
  const trustRegistry = f.trust.filter((entry) => entry.issuerId !== 'reviewer');
  const revoked = f.read({ trustRegistry });
  assert.equal(revoked.structuralRecordCount, 1);
  assert.equal(revoked.eligibleRecordCount, 0);
  assert.equal(revoked.activeRecords.length, 0);
  const correction = f.admit(changed(f, { noAlias: true }), {
    issuerId: 'reviewer-two', admittedAt: at(4), targets: [original.recordSha256] });
  f.write(correction, { trustRegistry });
  const cold = f.read({ trustRegistry });
  assert.equal(cold.invalidRecordCount, 1);
  assert.equal(cold.supersededRecordCount, 1);
  assert.deepEqual(cold.activeRecords, [correction]);
  assert.equal(cold.activeRecords[0].construction.objectDefs[0].aliases.length, 0);
});

test('same proposal multi-reviewer agreement, distinct disjoint batches, and equal names stay separate', (t) => {
  const f = fixture(t);
  const proposal = f.compile();
  const records = [f.admit(proposal), f.admit(proposal, { issuerId: 'reviewer-two' }),
    f.admit(changed(f, { id: 'another-definition' }))];
  records.forEach((record) => f.write(record));
  const cold = f.read();
  assert.equal(cold.state, 'ready');
  assert.equal(cold.activeRecords.length, 3);
  assert.equal(cold.conflictingRecordCount, 0);
});

test('conflicting constructions are quarantined until correction explicitly names every active conflict', (t) => {
  const f = fixture(t);
  const original = f.admit();
  const alternate = f.admit(changed(f));
  f.write(original); f.write(alternate);
  let cold = f.read();
  assert.deepEqual(cold.activeRecords, []);
  assert.equal(cold.conflictingRecordCount, 2);
  assert.deepEqual(cold.conflictingObjectDefIds, ['allocation-exception']);
  const partial = f.admit(changed(f, { noAlias: true }), { admittedAt: at(4), targets: [original.recordSha256] });
  f.write(partial);
  cold = f.read();
  assert.equal(cold.supersededRecordCount, 1);
  assert.equal(cold.conflictingRecordCount, 2);
  assert.equal(cold.activeRecords.length, 0);
  // Naming only the latest correction does not erase an unrelated active disagreement.
  const stillPartial = f.admit(f.compile(), { admittedAt: at(5), targets: [partial.recordSha256] });
  f.write(stillPartial);
  assert.equal(f.read().activeRecords.length, 0);
  const final = f.admit(changed(f, { noAlias: true }), { admittedAt: at(6),
    targets: [stillPartial.recordSha256, alternate.recordSha256] });
  f.write(final);
  cold = f.read();
  assert.deepEqual(cold.activeRecords, [final]);
  assert.equal(cold.supersededRecordCount, 4);
  assert.equal(cold.state, 'ready');
});

test('an overlapping batch is quarantined atomically; corrections cannot drop unrelated IDs', (t) => {
  const f = fixture(t);
  const input = clone(f.input);
  input.objectDefs.push({ ...clone(input.objectDefs[0]), id: 'other-concept' });
  const batch = f.admit(f.compile(input)); f.write(batch);
  const partial = f.admit(changed(f), { admittedAt: at(4), targets: [batch.recordSha256] });
  assert.throws(() => f.write(partial), { code: 'CONSTRUCTION_ADMISSION_SUPERSESSION' });
  f.write(f.admit(changed(f)));
  assert.equal(f.read().activeRecords.length, 0);
  assert.equal(f.read().conflictingRecordCount, 2);
  assert.deepEqual(f.read().conflictingObjectDefIds, ['allocation-exception']);
});

for (const targets of [[digest], [digest, digest], Array(129).fill(digest)]) {
  test(`rejects invalid correction target list length ${targets.length}`, (t) => {
    const f = fixture(t);
    assert.throws(() => f.write(f.admit(f.compile(), { targets })), { code: 'CONSTRUCTION_ADMISSION_SUPERSESSION' });
    assert.equal(f.state.store.readRefMetadata(f.route), null);
  });
}

test('newer or equal-time targets and different ID sets cannot be superseded', (t) => {
  const f = fixture(t); const original = f.admit(); f.write(original);
  for (const [construction, admittedAt] of [[changed(f), at(3)], [changed(f), at(2)],
    [changed(f, { id: 'different' }), at(4)]]) {
    assert.throws(() => f.write(f.admit(construction, { admittedAt, targets: [original.recordSha256] })),
      { code: 'CONSTRUCTION_ADMISSION_SUPERSESSION' });
  }
});

test('cold replay rejects planted dangling or out-of-scope corrections and preserves the valid map', (t) => {
  const f = fixture(t); const original = f.admit(); f.write(original);
  f.plant(f.admit(changed(f), { admittedAt: at(4), targets: [digest] }));
  f.plant(f.admit(changed(f, { id: 'different' }), { admittedAt: at(4), targets: [original.recordSha256] }));
  const cold = f.read();
  assert.equal(cold.invalidRecordCount, 2);
  assert.equal(cold.eligibleRecordCount, 1);
  assert.deepEqual(cold.activeRecords, [original]);
});

test('cold rebind excludes self-consistently rehashed false bytes, but allows correction of their structural history', (t) => {
  const f = fixture(t);
  const proposal = clone(f.compile());
  proposal.claims[0].source.evidence.textSha256 = digest;
  const { constructionSha256: _hash, ...core } = proposal;
  proposal.constructionSha256 = kernel.stableObjectSha256(core);
  const bad = f.admit(proposal);
  assert.throws(() => f.write(bad), { code: 'SEMANTIC_CONSTRUCTION_EVIDENCE' });
  f.plant(bad);
  const before = f.read();
  assert.equal(before.structuralRecordCount, 1);
  assert.equal(before.activeRecords.length, 0);
  const correction = f.admit(f.compile(), { admittedAt: at(4), targets: [bad.recordSha256] });
  f.write(correction);
  assert.deepEqual(f.read().activeRecords, [correction]);
  assert.equal(f.read().invalidRecordCount, 1);
  assert.equal(f.read().supersededRecordCount, 1);
});

test('correction cannot target a structurally valid record from another binding', (t) => {
  const f = fixture(t);
  const proposal = clone(f.compile());
  proposal.sourceBinding.namespace = 'other-namespace';
  const { constructionSha256: _hash, ...core } = proposal;
  proposal.constructionSha256 = kernel.stableObjectSha256(core);
  const foreign = f.admit(proposal); f.plant(foreign);
  const correction = f.admit(f.compile(), { admittedAt: at(4), targets: [foreign.recordSha256] });
  assert.throws(() => f.write(correction), { code: 'CONSTRUCTION_ADMISSION_SUPERSESSION' });
  f.plant(correction);
  const cold = f.read();
  assert.equal(cold.structuralRecordCount, 2);
  assert.equal(cold.invalidRecordCount, 2);
  assert.equal(cold.activeRecords.length, 0);
});

test('no source-cut substitution or cross-cut correction even when bytes and names match', (t) => {
  const f = fixture(t); const original = f.admit(); f.write(original);
  const nextOptions = { artifactRoot: join(f.root, 'next') };
  const nextInput = clone(f.buildInput); nextInput.sources[0].occurredAt = at(4);
  kernel.buildSourceNativeProduct({ ...nextOptions, objectBackendUri: f.objectBackendUri, input: nextInput });
  assert.throws(() => f.write(original, { options: nextOptions }), { code: 'SEMANTIC_CONSTRUCTION_BINDING' });
  const nextState = kernel.openProductState(nextOptions);
  const input = clone(f.input); input.proposedAt = at(5);
  const witness = { ...input.objectDefs[0].source, nativeObjectSha256: nextState.objectOnt.map.nativeObjects[0].nativeObjectSha256 };
  input.objectDefs[0].source = witness; input.objectDefs[0].aliases[0].source = witness; input.claims[0].source = witness;
  const construction = kernel.compileSourceNativeSemanticConstruction({ options: nextOptions, input });
  const correction = f.admit(construction, { admittedAt: at(6), targets: [original.recordSha256] });
  assert.throws(() => f.write(correction, { options: nextOptions, knowledgeBranch: f.branch }),
    { code: 'CONSTRUCTION_ADMISSION_BRANCH' });
  assert.equal(f.read({ options: nextOptions }).activeRecords.length, 0);
  assert.equal(kernel.validateSourceNativeConstructionAdmissionRecord(original).recordSha256, original.recordSha256);
});

for (const [name, mutate, alternatePath] of [
  ['unknown kind', (r) => { r.kind = 'UnknownFutureRecordV99'; }, false],
  ['wrong logical path', () => {}, true],
]) test(`cold ledger degrades for ${name} without poisoning a valid disjoint batch`, (t) => {
  const f = fixture(t); const original = f.admit(); f.write(original);
  const bad = clone(f.admit(changed(f, { id: 'other' }))); mutate(bad);
  f.plant(bad, alternatePath ? pathFor(digest) : pathFor(bad.recordSha256));
  const cold = f.read();
  assert.equal(cold.invalidRecordCount, 1);
  assert.deepEqual(cold.activeRecords, [original]);
});

test('knowledge cannot write onto the source branch, and custom branches stay explicit', (t) => {
  const f = fixture(t); const record = f.admit();
  assert.throws(() => f.write(record, { knowledgeBranch: 'main' }), { code: 'CONSTRUCTION_ADMISSION_BRANCH' });
  const result = f.write(record, { knowledgeBranch: 'reviewed-navigation' });
  assert.equal(result.branch, 'reviewed-navigation');
  assert.equal(f.read().activeRecords.length, 0);
  assert.deepEqual(f.read({ knowledgeBranch: result.branch }).activeRecords, [record]);
});

test('protected cold history refuses a raw rewind and recovers without resurrecting the old map', (t) => {
  const f = fixture(t, { protectedHistory: true });
  const original = f.admit(); f.write(original);
  const first = f.state.store.readRefMetadata(f.route);
  const correction = f.admit(changed(f), { admittedAt: at(4), targets: [original.recordSha256] });
  f.write(correction);
  const current = f.state.store.readRefMetadata(f.route);
  f.backend.compareAndSwap(current.key, { expectedVersion: current.version, bytes: Buffer.from(kernel.stableObjectText(first.ref)) });
  const rewound = f.read();
  assert.equal(rewound.state, 'degraded');
  assert.equal(rewound.activeRecords.length, 0);
  assert(rewound.diagnosticCodes.some((code) => code.startsWith('OBJECT_ONT_HISTORY_')));
  f.state.store.recoverRefHistory(f.route);
  assert.deepEqual(f.read().activeRecords, [correction]);
});

test('unreadable metadata disables all navigation rather than reusing cached content', (t) => {
  const f = fixture(t); f.write(f.admit());
  const current = f.state.store.readRefMetadata(f.route);
  f.backend.compareAndSwap(current.key, { expectedVersion: current.version, bytes: Buffer.from('not-json') });
  assert.equal(f.read().state, 'degraded');
  assert.equal(f.read().activeRecords.length, 0);
});

test('internal reader pins source context and observes changed knowledge on each read', (t) => {
  const f = fixture(t);
  let metadataReads = 0;
  const sourceStore = f.state.store;
  const pinnedStore = {
    ...sourceStore,
    readRefMetadataSnapshot: (input) => {
      metadataReads += 1;
      return sourceStore.readRefMetadataSnapshot(input);
    },
  };
  const reader = createConstructionLedgerReader({
    descriptor: f.state.descriptor,
    objectOnt: f.state.objectOnt,
    store: pinnedStore,
  }, f.trust);
  assert.equal(reader.read().activeRecords.length, 0);
  const original = f.admit();
  f.write(original);
  assert.deepEqual(reader.read().activeRecords, [original]);
  const correction = f.admit(changed(f), { admittedAt: at(4), targets: [original.recordSha256] });
  f.write(correction);
  assert.deepEqual(reader.read().activeRecords, [correction]);
  assert.equal(metadataReads, 3);
});

test('selected source I/O failures propagate their exact diagnostic through ledger catches', (t) => {
  const f = fixture(t);
  f.write(f.admit());
  const sourceError = new Error('selected source backend unavailable');
  const reader = createConstructionLedgerReader({
    ...f.state,
    readSource() {
      throw sourceError;
    },
  }, f.trust);
  assert.throws(() => reader.read(), (error) => error === sourceError);
});

test('canonical source-envelope corruption propagates through repeated and standalone ledger reads', (t) => {
  const f = fixture(t);
  const record = f.admit();
  f.write(record);
  const context = kernel.openProductSourceContext(f.options);
  const reader = createConstructionLedgerReader(context, f.trust);
  assert.deepEqual(reader.read().activeRecords, [record]);
  corruptFileObjectEnvelope(f.objectBackendUri, f.state.objectOnt.sources[0].blobDescriptor.key);
  const isBackendCorruption = (error) => error?.code === 'OBJECT_BACKEND_CORRUPT';
  assert.throws(() => reader.read(), isBackendCorruption);
  assert.throws(() => kernel.readSourceNativeConstructionLedger({
    options: f.options, trustRegistry: f.trust,
  }), isBackendCorruption);
});

test('corrupt Admission envelopes remain degraded invalid records on a clean source cut', (t) => {
  const f = fixture(t);
  const record = f.admit();
  f.write(record);
  const context = kernel.openProductSourceContext(f.options);
  const reader = createConstructionLedgerReader(context, f.trust);
  assert.deepEqual(reader.read().activeRecords, [record]);
  const snapshot = f.state.store.readRefMetadataSnapshot(f.route);
  const descriptor = snapshot.replayMetadata.blobDescriptors.find((item) =>
    item.logicalPath === pathFor(record.recordSha256));
  assert(descriptor);
  corruptFileObjectEnvelope(f.objectBackendUri, descriptor.key);
  const degraded = reader.readSnapshot();
  assert.equal(degraded.ledger.state, 'degraded');
  assert.equal(degraded.ledger.invalidRecordCount, 1);
  assert.equal(degraded.ledger.activeRecords.length, 0);
  assert.equal(degraded.records.length, 1);
  assert.equal(degraded.records[0].state, 'invalid');
  assert(degraded.records[0].reasonCodes.includes('CONSTRUCTION_ADMISSION_RECORD'));
});

test('ledger reads revalidate source bytes instead of reusing a prior verified result', (t) => {
  const f = fixture(t);
  f.write(f.admit());
  let reads = 0;
  const source = f.state.objectOnt.sources[0];
  const reader = createConstructionLedgerReader({
    ...f.state,
    readSource() {
      reads += 1;
      return reads === 1 ? source : { ...source, content: 'tampered source text' };
    },
  }, f.trust);
  assert.equal(reader.read().activeRecords.length, 1);
  const second = reader.read();
  assert.equal(reads, 2);
  assert.equal(second.activeRecords.length, 0);
  assert.equal(second.eligibleRecordCount, 0);
  assert(second.diagnosticCodes.includes('SEMANTIC_CONSTRUCTION_SOURCE'));
});

test('internal reader keeps its commit floor through missing and rewound metadata, then recovers to a descendant', (t) => {
  const f = fixture(t);
  const original = f.admit();
  f.write(original);
  const earlier = f.state.store.readRefMetadataSnapshot(f.route);
  const sourceStore = f.state.store;
  let forcedSnapshot = undefined;
  const pinnedStore = {
    ...sourceStore,
    readRefMetadataSnapshot: (input) => forcedSnapshot === undefined
      ? sourceStore.readRefMetadataSnapshot(input) : forcedSnapshot,
  };
  const reader = createConstructionLedgerReader({
    descriptor: f.state.descriptor,
    objectOnt: f.state.objectOnt,
    store: pinnedStore,
  }, f.trust);
  assert.deepEqual(reader.read().activeRecords, [original]);
  const correction = f.admit(changed(f), { admittedAt: at(4), targets: [original.recordSha256] });
  f.write(correction);
  assert.deepEqual(reader.read().activeRecords, [correction]);
  forcedSnapshot = null;
  const missing = reader.read();
  assert.equal(missing.state, 'degraded');
  assert.deepEqual(missing.activeRecords, []);
  assert(missing.diagnosticCodes.includes('CONSTRUCTION_ADMISSION_MISSING'));
  forcedSnapshot = earlier;
  const rewound = reader.read();
  assert.equal(rewound.state, 'degraded');
  assert.deepEqual(rewound.activeRecords, []);
  assert(rewound.diagnosticCodes.includes('CONSTRUCTION_ADMISSION_ROLLBACK'));
  const successor = f.admit(changed(f, { id: 'successor' }), { admittedAt: at(5) });
  f.write(successor);
  forcedSnapshot = undefined;
  const recovered = reader.read();
  assert.equal(recovered.state, 'ready');
  assert.deepEqual(recovered.activeRecords.map((record) => record.recordSha256).sort(),
    [correction.recordSha256, successor.recordSha256].sort());
});

test('internal reader pins trust independently of later trust input mutation', (t) => {
  const f = fixture(t);
  const record = f.admit();
  f.write(record);
  const reader = createConstructionLedgerReader(f.state, f.trust);
  assert.deepEqual(reader.read().activeRecords, [record]);
  f.trust[0].publicKeyPem = 'mutated-after-open';
  f.trust[1].roles = ['proposer'];
  f.trust.splice(0);
  const retained = reader.read();
  assert.equal(retained.state, 'ready');
  assert.deepEqual(retained.activeRecords, [record]);
});

test('readSnapshot exposes active agreement, correction and conflict states without raw records', (t) => {
  const f = fixture(t);
  const agreement = f.admit();
  const agreementBySecondReviewer = f.admit(agreement.construction, { issuerId: 'reviewer-two' });
  f.write(agreement); f.write(agreementBySecondReviewer);
  let snapshot = createConstructionLedgerReader(f.state, f.trust).readSnapshot();
  assert.equal(snapshot.ledger.activeRecords.length, 2);
  assert.equal(snapshot.records.length, 2);
  assert.deepEqual(snapshot.records.map((record) => record.state), ['active', 'active']);
  assert(snapshot.records.every((record) => record.recordSha256 && record.blobSha256.startsWith('sha256:')));
  assert(snapshot.records.every((record) => !('construction' in record) && !('statement' in record)));

  const correction = f.admit(changed(f, { noAlias: true }), {
    admittedAt: at(4), targets: [agreement.recordSha256, agreementBySecondReviewer.recordSha256] });
  f.write(correction);
  snapshot = createConstructionLedgerReader(f.state, f.trust).readSnapshot();
  const corrected = snapshot.records.find((record) => record.recordSha256 === correction.recordSha256);
  assert.equal(corrected?.state, 'active');
  for (const target of [agreement, agreementBySecondReviewer]) {
    const disposition = snapshot.records.find((record) => record.recordSha256 === target.recordSha256);
    assert.equal(disposition?.state, 'superseded');
    assert.deepEqual(disposition?.supersededByRecordSha256s, [correction.recordSha256]);
  }

  const conflict = f.admit(changed(f, { name: 'allocation mismatch' }), { admittedAt: at(5) });
  f.write(conflict);
  snapshot = createConstructionLedgerReader(f.state, f.trust).readSnapshot();
  const conflicting = snapshot.records.filter((record) => record.state === 'conflicting');
  assert.equal(conflicting.length, 2);
  assert(conflicting.every((record) => record.conflictingObjectDefIds.includes('allocation-exception')));
  assert(conflicting.every((record) => !Object.hasOwn(record, 'conflictingRecordSha256s')));
  assert.equal(snapshot.ledger.conflictingRecordCount, 2);
});

test('superseded records do not inherit current conflict annotations', (t) => {
  const f = fixture(t);
  const agreement = f.admit();
  const agreementBySecondReviewer = f.admit(agreement.construction, { issuerId: 'reviewer-two' });
  f.write(agreement); f.write(agreementBySecondReviewer);
  const conflict = f.admit(changed(f, { name: 'allocation mismatch' }), { admittedAt: at(4) });
  f.write(conflict);
  const correction = f.admit(changed(f, { noAlias: true }), {
    admittedAt: at(5), targets: [agreement.recordSha256, agreementBySecondReviewer.recordSha256] });
  f.write(correction);
  const snapshot = createConstructionLedgerReader(f.state, f.trust).readSnapshot();
  for (const target of [agreement, agreementBySecondReviewer]) {
    const disposition = snapshot.records.find((record) => record.recordSha256 === target.recordSha256);
    assert.equal(disposition?.state, 'superseded');
    assert.deepEqual(disposition?.conflictingObjectDefIds, []);
  }
  const currentConflicts = snapshot.records.filter((record) => record.state === 'conflicting');
  assert.equal(currentConflicts.length, 2);
  assert(currentConflicts.every((record) => record.conflictingObjectDefIds.includes('allocation-exception')));
});

test('a larger planted conflict group keeps per-record conflict metadata linear and bounded', (t) => {
  const f = fixture(t);
  const groupSize = 24;
  for (let index = 0; index < groupSize; index += 1) {
    const input = clone(f.input);
    input.claims[0].id = `definition-${index}`;
    f.plant(f.admit(f.compile(input), { admittedAt: at(4) }));
  }
  const snapshot = createConstructionLedgerReader(f.state, f.trust).readSnapshot();
  assert.equal(snapshot.records.length, groupSize);
  assert.equal(snapshot.ledger.conflictingRecordCount, groupSize);
  assert.equal(snapshot.ledger.activeRecords.length, 0);
  assert(snapshot.records.every((record) => record.state === 'conflicting'));
  assert(snapshot.records.every((record) => record.conflictingObjectDefIds.length === 1
    && record.conflictingObjectDefIds[0] === 'allocation-exception'));
  assert(snapshot.records.every((record) => !Object.hasOwn(record, 'conflictingRecordSha256s')));
});

test('readSnapshot keeps ineligible history distinct from supersession and source binding', (t) => {
  const f = fixture(t);
  const original = f.admit(); f.write(original);
  const revoked = f.read({ trustRegistry: f.trust.filter((entry) => entry.issuerId !== 'reviewer') });
  assert.equal(revoked.activeRecords.length, 0);
  const revokedSnapshot = createConstructionLedgerReader(f.state,
    f.trust.filter((entry) => entry.issuerId !== 'reviewer')).readSnapshot();
  const revokedRecord = revokedSnapshot.records.find((record) => record.recordSha256 === original.recordSha256);
  assert.equal(revokedRecord?.state, 'ineligible');
  assert(revokedRecord?.reasonCodes.includes('SOURCE_NATIVE_ADMISSION_AUTHENTICATION'));
  assert.deepEqual(revokedRecord?.supersededByRecordSha256s, []);

  const correction = f.admit(changed(f, { noAlias: true }), {
    issuerId: 'reviewer-two', admittedAt: at(4), targets: [original.recordSha256] });
  f.write(correction, { trustRegistry: f.trust.filter((entry) => entry.issuerId !== 'reviewer') });
  const correctedSnapshot = createConstructionLedgerReader(f.state,
    f.trust.filter((entry) => entry.issuerId !== 'reviewer')).readSnapshot();
  const ineligibleTarget = correctedSnapshot.records.find((record) => record.recordSha256 === original.recordSha256);
  assert.equal(ineligibleTarget?.state, 'ineligible');
  assert.deepEqual(ineligibleTarget?.supersededByRecordSha256s, [correction.recordSha256]);
  assert.equal(correctedSnapshot.records.find((record) => record.recordSha256 === correction.recordSha256)?.state, 'active');

  const foreignConstruction = clone(changed(f, { id: 'foreign' }));
  foreignConstruction.sourceBinding.namespace = 'other-namespace';
  const { constructionSha256: _hash, ...foreignCore } = foreignConstruction;
  foreignConstruction.constructionSha256 = kernel.stableObjectSha256(foreignCore);
  const foreignRecord = f.admit(foreignConstruction);
  const blob = f.plant(foreignRecord);
  const bindingSnapshot = createConstructionLedgerReader(f.state, f.trust).readSnapshot();
  const bindingRecord = bindingSnapshot.records.find((record) => record.blobSha256 === blob.storedSha256);
  assert.equal(bindingRecord?.state, 'ineligible');
  assert(bindingRecord?.reasonCodes.includes('SEMANTIC_CONSTRUCTION_BINDING'));
});

test('readSnapshot uses the blob identity for malformed records without exposing untrusted fields', (t) => {
  const f = fixture(t);
  const original = f.admit(); f.write(original);
  const malformed = clone(f.admit(changed(f, { id: 'malformed' })));
  malformed.kind = 'UnknownFutureRecordV99';
  const blob = f.plant(malformed, pathFor(malformed.recordSha256));
  const snapshot = createConstructionLedgerReader(f.state, f.trust).readSnapshot();
  const disposition = snapshot.records.find((record) => record.blobSha256 === blob.storedSha256);
  assert.equal(disposition?.state, 'invalid');
  assert.equal(disposition?.recordSha256, null);
  assert.equal(disposition?.constructionSha256, null);
  assert(disposition?.reasonCodes.includes('CONSTRUCTION_ADMISSION_RECORD'));
  assert.equal('construction' in disposition, false);
  assert.deepEqual(snapshot.ledger.activeRecords, [original]);
});

test('malformed core hash cannot overwrite a valid record disposition', (t) => {
  const f = fixture(t);
  const original = f.admit();
  f.write(original);
  const { recordSha256: _recordSha256, ...malformedCore } = original;
  const malformedBlob = f.plant(malformedCore, `${prefix}malformed-core.json`);
  assert.equal(malformedBlob.storedSha256, original.recordSha256);
  const snapshot = createConstructionLedgerReader(f.state, f.trust).readSnapshot();
  assert.equal(snapshot.records.length, 2);
  const valid = snapshot.records.find((record) => record.recordSha256 === original.recordSha256);
  assert.equal(valid?.state, 'active');
  const malformed = snapshot.records.find((record) => record.blobSha256 === malformedBlob.storedSha256
    && record.recordSha256 === null);
  assert.equal(malformed?.state, 'invalid');
  assert(malformed?.reasonCodes.length > 0);
  assert.deepEqual(snapshot.ledger.activeRecords, [original]);
});

test('reader diagnostics normalize arbitrary backend codes in record and history failures', (t) => {
  const f = fixture(t);
  f.write(f.admit());
  const sourceStore = f.state.store;
  const recordStore = {
    ...sourceStore,
    readBlob() {
      const error = new Error('private backend detail');
      error.code = 'SECRET_RECORD_BACKEND_TOKEN_9f3a';
      throw error;
    },
  };
  const recordReader = createConstructionLedgerReader({ ...f.state, store: recordStore }, f.trust);
  const recordSnapshot = recordReader.readSnapshot();
  assert(recordSnapshot.ledger.diagnosticCodes.includes('CONSTRUCTION_ADMISSION_RECORD'));
  assert(recordSnapshot.records.some((record) => record.reasonCodes.includes('CONSTRUCTION_ADMISSION_RECORD')));
  assert(recordSnapshot.ledger.diagnosticCodes.every((code) => !code.includes('SECRET')));
  assert(recordSnapshot.records.every((record) => record.reasonCodes.every((code) => !code.includes('SECRET'))));

  const historyStore = {
    ...sourceStore,
    readRefMetadataSnapshot() {
      const error = new Error('private history backend detail');
      error.code = 'SECRET_HISTORY_BACKEND_TOKEN_4b2e';
      throw error;
    },
  };
  const historyReader = createConstructionLedgerReader({ ...f.state, store: historyStore }, f.trust);
  const historySnapshot = historyReader.readSnapshot();
  assert(historySnapshot.ledger.diagnosticCodes.includes('CONSTRUCTION_ADMISSION_HISTORY'));
  assert.deepEqual(historySnapshot.records, []);
  assert(historySnapshot.ledger.diagnosticCodes.every((code) => !code.includes('SECRET')));
});

test('ordinary read shares store reads with readSnapshot on active and degraded paths', (t) => {
  const f = fixture(t);
  f.write(f.admit());
  const sourceStore = f.state.store;
  const instrumented = () => {
    const counts = { metadata: 0, blobs: 0 };
    const store = {
      ...sourceStore,
      readRefMetadataSnapshot(input) {
        counts.metadata += 1;
        return sourceStore.readRefMetadataSnapshot(input);
      },
      readBlob(input) {
        counts.blobs += 1;
        return sourceStore.readBlob(input);
      },
    };
    return { reader: createConstructionLedgerReader({ ...f.state, store }, f.trust), counts };
  };
  const ordinary = instrumented();
  const snapshot = instrumented();
  assert.deepEqual(ordinary.reader.read(), snapshot.reader.readSnapshot().ledger);
  assert.deepEqual(ordinary.counts, { metadata: 1, blobs: 1 });
  assert.deepEqual(snapshot.counts, { metadata: 1, blobs: 1 });

  const degraded = () => {
    const counts = { metadata: 0, blobs: 0 };
    const store = {
      ...sourceStore,
      readRefMetadataSnapshot() {
        counts.metadata += 1;
        const error = new Error('history unavailable');
        error.code = 'SECRET_HISTORY_BACKEND_TOKEN_4b2e';
        throw error;
      },
      readBlob(input) {
        counts.blobs += 1;
        return sourceStore.readBlob(input);
      },
    };
    return { reader: createConstructionLedgerReader({ ...f.state, store }, f.trust), counts };
  };
  const degradedOrdinary = degraded();
  const degradedSnapshot = degraded();
  const degradedLedger = degradedOrdinary.reader.read();
  const degradedValue = degradedSnapshot.reader.readSnapshot();
  assert.deepEqual(degradedLedger, degradedValue.ledger);
  assert.deepEqual(degradedValue.records, []);
  assert.deepEqual(degradedOrdinary.counts, { metadata: 1, blobs: 0 });
  assert.deepEqual(degradedSnapshot.counts, { metadata: 1, blobs: 0 });
});

test('readSnapshot returns no cached records for missing or rewound history and recovers at a descendant', (t) => {
  const f = fixture(t);
  const original = f.admit(); f.write(original);
  const earlier = f.state.store.readRefMetadataSnapshot(f.route);
  const sourceStore = f.state.store;
  let forcedSnapshot = undefined;
  const reader = createConstructionLedgerReader({ ...f.state,
    store: { ...sourceStore, readRefMetadataSnapshot: (input) => forcedSnapshot === undefined
      ? sourceStore.readRefMetadataSnapshot(input) : forcedSnapshot },
  }, f.trust);
  assert.equal(reader.readSnapshot().records.length, 1);
  const correction = f.admit(changed(f), { admittedAt: at(4), targets: [original.recordSha256] });
  f.write(correction);
  assert.equal(reader.readSnapshot().records.length, 2);
  forcedSnapshot = null;
  const missing = reader.readSnapshot();
  assert.equal(missing.ledger.state, 'degraded');
  assert.deepEqual(missing.records, []);
  forcedSnapshot = earlier;
  const rewound = reader.readSnapshot();
  assert.equal(rewound.ledger.state, 'degraded');
  assert.deepEqual(rewound.records, []);
  assert(rewound.ledger.diagnosticCodes.includes('CONSTRUCTION_ADMISSION_ROLLBACK'));
  const successor = f.admit(changed(f, { id: 'successor' }), { admittedAt: at(5) });
  f.write(successor);
  forcedSnapshot = undefined;
  const recovered = reader.readSnapshot();
  assert.equal(recovered.ledger.state, 'ready');
  assert.deepEqual(recovered.records.map((record) => record.recordSha256).sort(),
    [original.recordSha256, correction.recordSha256, successor.recordSha256].sort());
});

for (const historicalFirst of [false, true]) {
  test(`mixed current/historical reads preserve the rollback floor, historical first: ${historicalFirst}`, (t) => {
    const f = fixture(t);
    const original = f.admit(); f.write(original);
    const earlier = f.state.store.readRefMetadataSnapshot(f.route);
    const correction = f.admit(changed(f), { admittedAt: at(4), targets: [original.recordSha256] });
    f.write(correction);
    const sourceStore = f.state.store;
    let forcedSnapshot;
    const reader = createConstructionLedgerReader({ ...f.state, store: { ...sourceStore,
      readRefMetadataSnapshot: input => input.branch === f.branch && forcedSnapshot !== undefined
        ? forcedSnapshot : sourceStore.readRefMetadataSnapshot(input),
    } }, f.trust);
    const selected = { commitSha256: earlier.ref.commitSha256,
      replaySha256: earlier.ref.replaySha256, recordSha256: original.recordSha256 };
    if (!historicalFirst) {
      assert.deepEqual(reader.read().activeRecords, [correction]);
      assert.equal(reader.readSnapshot().records.length, 2);
    }
    const old = reader.readSnapshotAt(selected);
    assert.deepEqual(old.selectedRecord, original);
    assert.equal(old.ledger.commitSha256, earlier.ref.commitSha256);
    assert.equal(old.selectedDisposition.state, 'active');
    // Selecting the ancestor must retain the latest observed head as the floor.
    forcedSnapshot = earlier;
    const rewound = reader.read();
    assert.equal(rewound.state, 'degraded');
    assert(rewound.diagnosticCodes.includes('CONSTRUCTION_ADMISSION_ROLLBACK'));
    assert.deepEqual(rewound.activeRecords, []);
    assert.deepEqual(reader.readSnapshot().records, []);
    assert.throws(() => reader.readSnapshotAt(selected), { code: 'CONSTRUCTION_ADMISSION_RECORD' });
    forcedSnapshot = undefined;
    assert.deepEqual(reader.read().activeRecords, [correction]);
    assert.deepEqual(reader.readSnapshotAt(selected).selectedRecord, original);
    assert.equal(reader.readSnapshot().records.length, 2);
  });
}

test('readSnapshot projects the same ledger as read and the one-shot API', (t) => {
  const f = fixture(t);
  const original = f.admit(); f.write(original);
  const reader = createConstructionLedgerReader(f.state, f.trust);
  const snapshot = reader.readSnapshot();
  assert.deepEqual(snapshot.ledger, reader.read());
  assert.deepEqual(snapshot.ledger, f.read());
  assert.deepEqual(snapshot.ledger, kernel.readSourceNativeConstructionLedger({
    options: f.options, trustRegistry: f.trust,
  }));
});

test('one-shot construction ledger API remains source-bound and unchanged', (t) => {
  const f = fixture(t);
  const record = f.admit();
  f.write(record);
  const ledger = kernel.readSourceNativeConstructionLedger({
    options: f.options,
    trustRegistry: f.trust,
  });
  assert.equal(ledger.kind, 'OpenOntologySourceNativeConstructionLedgerV1');
  assert.equal(ledger.state, 'ready');
  assert.deepEqual(ledger.activeRecords, [record]);
  assert.equal(ledger.navigationOnly, true);
  assert.equal(ledger.exactSourcesRemainAuthority, true);
});

test('historical ledger read accepts a protected descendant and returns the complete A construction', (t) => {
  const f = fixture(t, { protectedHistory: true, multiSource: true });
  const original = f.admit();
  f.write(original);
  const record = f.admit(changed(f, { noAlias: true }), {
    admittedAt: at(4), targets: [original.recordSha256],
  });
  f.write(record);
  const expected = sourceBinding(f);
  const originalSource = f.buildInput.sources[0].content;
  const originalSourceHash = f.state.objectOnt.sources[0].sourceSha256;
  const sourceBefore = f.state.store.readRefMetadata(f.sourceRoute);
  const knowledgeRoute = { ontId: f.state.descriptor.ontId, branch: f.branch };
  const knowledgeBefore = f.state.store.readRefMetadata(knowledgeRoute);

  const descendant = advanceOnlySecondSource(f);
  assert.notEqual(descendant.receipt.commitSha256, sourceBefore.ref.commitSha256);
  assert.equal(f.buildInput.sources[0].content, originalSource);
  assert.equal(f.state.objectOnt.sources[0].sourceSha256, originalSourceHash);
  const currentB = openSourceNativeObjectOntRefAtCut({
    backend: f.backend, historyBackend: f.historyBackend,
    ontId: f.state.descriptor.ontId, branch: f.sourceRoute.branch,
  });
  assert(currentB);
  assert.equal(currentB.objectOnt.sources[0].content, originalSource);
  assert.notEqual(currentB.objectOnt.sources[1].sourceSha256, f.state.objectOnt.sources[1].sourceSha256);
  assert.throws(() => f.read(), { code: 'SOURCE_NATIVE_PRODUCT_REF' });

  const storageBefore = treeSnapshot(f.root);
  const historical = kernel.readSourceNativeConstructionLedgerAtArtifact({
    options: f.options, trustRegistry: f.trust, expectedSourceBinding: expected,
  });
  assert.equal(historical.state, 'ready');
  assert.deepEqual(historical.activeRecords, [record]);
  assert.deepEqual(historical.activeRecords[0].construction.objectDefs, record.construction.objectDefs);
  assert.deepEqual(historical.activeRecords[0].construction.claims, record.construction.claims);
  assert.deepEqual(historical.activeRecords[0].construction.coverage, record.construction.coverage);
  assert.equal(historical.navigationOnly, true);
  assert.equal(historical.exactSourcesRemainAuthority, true);
  assert.equal(treeSnapshot(f.root), storageBefore);
  assert.notDeepEqual(f.state.store.readRefMetadata(f.sourceRoute), sourceBefore);
  assert.deepEqual(f.state.store.readRefMetadata(knowledgeRoute), knowledgeBefore);
});

test('a B artifact does not inherit A knowledge records on its default branch', (t) => {
  const f = fixture(t, { protectedHistory: true, multiSource: true });
  const record = f.admit();
  f.write(record);
  const input = clone(f.buildInput);
  input.sources[1].content = 'Second allocation note changed only at descendant B. Status: closed.';
  input.nativeObjectInputs[1].fields[0].value = input.sources[1].content;
  input.nativeObjectInputs[1].fields[1].value = 'closed';
  input.nativeObjectInputs[1].fields[1].canonicalProposition.state = 'closed';
  input.nativeObjectInputs[1].fields[1].canonicalProposition.propositionKey = 'task-2-closed';
  const materializedInput = materializeInput(input);
  materializeSourceNativeObjectOnt({
    backend: f.backend, historyBackend: f.historyBackend, ontId: f.state.descriptor.ontId,
    branch: f.state.descriptor.branch,
    expectedVersion: f.state.store.readRefMetadata(f.sourceRoute).version,
    sources: materializedInput.sources, nativeObjectInputs: materializedInput.nativeObjectInputs,
  });
  const bOptions = { artifactRoot: join(f.root, 'b-artifact') };
  kernel.buildSourceNativeProduct({ artifactRoot: bOptions.artifactRoot,
    objectBackendUri: f.objectBackendUri, historyBackendUri: f.historyBackendUri, input });
  const currentB = kernel.readSourceNativeConstructionLedger({ options: bOptions, trustRegistry: f.trust });
  assert.equal(currentB.activeRecords.length, 0);
  assert.equal(currentB.commitSha256, null);
  assert.throws(() => kernel.readSourceNativeConstructionLedgerAtArtifact({
    options: bOptions, trustRegistry: f.trust, expectedSourceBinding: sourceBinding(f),
  }), { code: 'CONSTRUCTION_ADMISSION_BINDING' });
});

test('a valid protected branch without A ancestry is refused', (t) => {
  const f = fixture(t, { protectedHistory: true });
  const unrelatedInput = clone(f.buildInput);
  unrelatedInput.sources[0].content = 'Independent unrelated branch content. Status: open.';
  unrelatedInput.nativeObjectInputs[0].fields[0].value = unrelatedInput.sources[0].content;
  const materializedInput = materializeInput(unrelatedInput);
  materializeSourceNativeObjectOnt({
    backend: f.backend, historyBackend: f.historyBackend, ontId: f.state.descriptor.ontId,
    branch: 'unrelated', expectedVersion: null, sources: materializedInput.sources,
    nativeObjectInputs: materializedInput.nativeObjectInputs,
  });
  const unrelatedSnapshot = f.state.store.readRefMetadataSnapshot({
    ontId: f.state.descriptor.ontId, branch: 'unrelated',
  });
  assert(unrelatedSnapshot);
  assert(!unrelatedSnapshot.replayMetadata.commitOrder.includes(f.state.objectOnt.commitSha256));
  const descriptorPath = join(f.options.artifactRoot, 'source-native.json');
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  const { artifactSha256: _artifactSha256, ...descriptorCore } = descriptor;
  descriptorCore.branch = 'unrelated';
  const resealed = { ...descriptorCore, artifactSha256: kernel.stableObjectSha256(descriptorCore) };
  writeFileSync(descriptorPath, kernel.stableObjectText(resealed));
  assert.throws(() => kernel.readSourceNativeConstructionLedgerAtArtifact({
    options: f.options, trustRegistry: f.trust, expectedSourceBinding: {
      ontId: resealed.ontId, namespace: resealed.namespace, artifactSha256: resealed.artifactSha256,
      sourceCommitSha256: resealed.sourceCommitSha256, sourceReplaySha256: resealed.sourceReplaySha256,
      sourceCatalogSha256: resealed.sourceCatalogSha256, nativeObjectMapSha256: resealed.nativeObjectMapSha256,
    },
  }), { code: 'CONSTRUCTION_ADMISSION_BRANCH' });
});

test('historical read requires protected v2 history and an exact seven-field source binding', (t) => {
  const unprotected = fixture(t);
  const binding = sourceBinding(unprotected);
  assert.throws(() => readAtArtifact(unprotected), { code: 'CONSTRUCTION_ADMISSION_HISTORY' });
  const protectedFixture = fixture(t, { protectedHistory: true });
  const mutations = [
    ['missing field', (value) => { delete value.namespace; }],
    ['extra field', (value) => { value.extra = true; }],
    ['wrong hash', (value) => { value.artifactSha256 = 'sha256:bad'; }],
    ['mismatched cut', (value) => { value.sourceCommitSha256 = digest; }],
  ];
  for (const [name, mutate] of mutations) {
    const candidate = { ...sourceBinding(protectedFixture) };
    mutate(candidate);
    assert.throws(() => kernel.readSourceNativeConstructionLedgerAtArtifact({
      options: protectedFixture.options, trustRegistry: protectedFixture.trust,
      expectedSourceBinding: candidate,
    }), TypeError, name);
  }
  assert.equal(binding.ontId, unprotected.state.descriptor.ontId);
});

test('stable absent knowledge is empty, while missing, corrupt, and pending protected history refuse', (t) => {
  const empty = fixture(t, { protectedHistory: true });
  assert.deepEqual(readAtArtifact(empty).activeRecords, []);

  const missingSource = fixture(t, { protectedHistory: true });
  unlinkSync(fileObjectPath(missingSource.historyBackendUri,
    `ref-history/${missingSource.state.descriptor.ontId}/main.json`));
  assert.throws(() => readAtArtifact(missingSource), { code: 'OBJECT_ONT_HISTORY_MISSING' });

  const corruptKnowledge = fixture(t, { protectedHistory: true });
  const corruptRecord = corruptKnowledge.admit();
  corruptKnowledge.write(corruptRecord);
  const knowledgeKey = `ref-history/${corruptKnowledge.state.descriptor.ontId}/${corruptKnowledge.branch}.json`;
  const knowledgeHead = corruptKnowledge.historyBackend.head(knowledgeKey);
  corruptKnowledge.historyBackend.compareAndSwap(knowledgeKey, {
    expectedVersion: knowledgeHead.version, bytes: Buffer.from('{"corrupt":true}'),
  });
  assert.throws(() => readAtArtifact(corruptKnowledge), { code: 'OBJECT_ONT_HISTORY_CORRUPT' });

  const pendingSource = fixture(t, { protectedHistory: true });
  const pendingBaseVersion = pendingSource.state.store.readRefMetadata(pendingSource.sourceRoute).version;
  mutateHistory(pendingSource, 'main', (history) => {
    history.pending = { schemaVersion: 1, kind: 'OpenOntologyRefHistoryPendingV1',
      baseRef: history.acceptedRef, baseVersion: pendingBaseVersion, targetRef: history.acceptedRef };
  });
  assert.throws(() => readAtArtifact(pendingSource), { code: 'OBJECT_ONT_HISTORY_PENDING' });
});

test('historical full-source corruption remains fatal rather than degrading one record', (t) => {
  const f = fixture(t, { protectedHistory: true });
  const record = f.admit();
  f.write(record);
  assert.deepEqual(readAtArtifact(f).activeRecords, [record]);
  corruptFileObjectEnvelope(f.objectBackendUri, f.state.objectOnt.sources[0].blobDescriptor.key);
  assert.throws(() => readAtArtifact(f), { code: 'OBJECT_BACKEND_CORRUPT' });
});

test('historical read keeps correction, conflict, and trust eligibility decisions current', (t) => {
  const f = fixture(t, { protectedHistory: true });
  const original = f.admit();
  f.write(original);
  const correction = f.admit(changed(f, { noAlias: true }), {
    admittedAt: at(4), targets: [original.recordSha256],
  });
  f.write(correction);
  assert.deepEqual(readAtArtifact(f).activeRecords, [correction]);

  const conflictFixture = fixture(t, { protectedHistory: true });
  const first = conflictFixture.admit();
  const second = conflictFixture.admit(changed(conflictFixture), {
    admittedAt: at(4),
  });
  conflictFixture.write(first);
  conflictFixture.write(second);
  const conflict = readAtArtifact(conflictFixture);
  assert.equal(conflict.conflictingRecordCount, 2);
  assert.deepEqual(conflict.activeRecords, []);

  const revoked = readAtArtifact(f, {
    trustRegistry: f.trust.filter((entry) => entry.issuerId !== 'reviewer'),
  });
  assert.equal(revoked.activeRecords.length, 0);
  assert.equal(revoked.state, 'degraded');
  const proposerRevoked = readAtArtifact(f, {
    trustRegistry: f.trust.filter((entry) => entry.issuerId !== 'constructor'),
  });
  assert.equal(proposerRevoked.activeRecords.length, 0);
  assert.equal(proposerRevoked.state, 'degraded');
});

test('old signed query proofs and new construction share the branch without reinterpretation', async (t) => {
  const f = fixture(t);
  const query = { question: 'What is the current status of task-1?', typedQuery: {
    sourceSystem: 'tracker', objectType: 'task', externalId: 'task-1', fieldPath: 'status' } };
  const bundle = await kernel.compileSourceNativeSemanticKnowledgeBundle({ options: f.options,
    query, proposedBy: 'constructor', proposedAt: at(2) });
  const proposalStatement = kernel.sourceNativeProposalStatement({ bundle });
  const statement = kernel.sourceNativeAdmissionStatement({ bundle, issuerId: 'reviewer', admittedAt: at(3) });
  const oldRecord = kernel.compileSourceNativeAdmissionRecord({ bundle, proposalStatement, statement,
    proposalSignatureBase64: signature(proposalStatement, f.keys.constructor.privateKey),
    signatureBase64: signature(statement, f.keys.reviewer.privateKey) });
  const originalBytes = kernel.stableObjectText(oldRecord);
  const oldWrite = kernel.writeSourceNativeAdmittedKnowledge({ options: f.options, record: oldRecord, trustRegistry: f.trust });
  assert.equal(oldWrite.branch, f.branch);
  const construction = f.admit(); f.write(construction);
  const proofClient = kernel.openSourceNativeProductWithAdmittedKnowledge(f.options, { trustRegistry: f.trust });
  const proof = await proofClient.verify(query);
  assert.equal(proof.kind, 'OpenOntologySourceNativeAdmittedKnowledgeVerificationV1');
  assert.equal(proof.answerable, true);
  assert.equal(proof.context[0].exactText, 'open');
  assert.equal(proofClient.status().admittedKnowledge.state, 'ready');
  assert.deepEqual(f.read().activeRecords, [construction]);
  const latest = f.state.store.readRefMetadataSnapshot(f.route);
  const oldBlob = latest.replayMetadata.blobDescriptors.find((item) => item.logicalPath.endsWith(`${oldRecord.recordSha256.slice(7)}.json`));
  assert.equal(f.state.store.readBlob(oldBlob).bytes.toString(), originalBytes);
  // The old writer can append after the construction record as well.
  const alternateStatement = kernel.sourceNativeAdmissionStatement({ bundle, issuerId: 'reviewer-two', admittedAt: at(3) });
  const oldSecond = kernel.compileSourceNativeAdmissionRecord({ bundle, proposalStatement, statement: alternateStatement,
    proposalSignatureBase64: oldRecord.proposalSignatureBase64,
    signatureBase64: signature(alternateStatement, f.keys['reviewer-two'].privateKey) });
  kernel.writeSourceNativeAdmittedKnowledge({ options: f.options, record: oldSecond, trustRegistry: f.trust });
  assert.equal(f.read().state, 'ready');
  assert.deepEqual(f.read().activeRecords, [construction]);
});
