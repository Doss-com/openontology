import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import * as kernel from '../dist/src/kernel.mjs';
import { openCanonicalObjectBackend } from '../dist/src/canonical-object-backend.mjs';

const clone = structuredClone;
const digest = kernel.objectBytesSha256(Buffer.from('not present'));
const prefix = 'blobs/knowledge-ledger/construction/';
const pathFor = (sha) => `${prefix}${sha.slice(7)}.json`;
const at = (day) => `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const signature = (statement, key) => sign(null, Buffer.from(kernel.stableObjectText(statement)), key).toString('base64');

function fixture(t, { protectedHistory = false, namespace = 'example' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oont-construction-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const objectBackendUri = pathToFileURL(join(root, 'objects')).href;
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
  kernel.buildSourceNativeProduct({ ...options, objectBackendUri,
    ...(protectedHistory ? { historyBackendUri: pathToFileURL(join(root, 'history')).href } : {}), input: buildInput });
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
  return { root, options, objectBackendUri, buildInput, state, input, keys, trust, compile, admit,
    branch, route, write, read, plant, backend: openCanonicalObjectBackend({ uri: objectBackendUri }).backend };
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
