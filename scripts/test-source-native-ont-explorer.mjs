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
const at = (day) => `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const prefix = 'blobs/knowledge-ledger/construction/';
const signature = (statement, key) => sign(null, Buffer.from(kernel.stableObjectText(statement)), key).toString('base64');
const pageBytes = 256 * 1024;

function fixture(t, { names = ['AllocationException', 'DocumentedTask'], protectedHistory = false,
  extraText = '', longExternalId = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oont-ont-explorer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { artifactRoot: join(root, 'ont') };
  const objectBackendUri = pathToFileURL(join(root, 'objects')).href;
  const docsText = `${names.join(' means documented concept. ')}. allocation mismatch. ${extraText}`;
  const sources = [
    { relativePath: 'docs/guide.txt', sourceType: 'docs', occurredAt: at(1), content: docsText },
    { relativePath: 'clickup/CT-17.txt', sourceType: 'clickup', occurredAt: at(1),
      content: `ClickupTask CT-17: allocation mismatch. ${names[0]}.` },
    { relativePath: 'clickup/CT-18.txt', sourceType: 'clickup', occurredAt: at(1),
      content: `ClickupTask CT-18: allocation mismatch. ${names[1] ?? names[0]}.` },
  ];
  const input = {
    schemaVersion: 1, kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'ont-explorer-example', namespace: 'example', sources,
    querySchemas: [
      { sourceSystem: 'docs', objectType: 'Document', aliases: ['document'],
        fields: [{ fieldPath: 'body', aliases: ['body'] }] },
      { sourceSystem: 'clickup', objectType: 'ClickupTask', aliases: ['ClickupTask'],
        fields: [{ fieldPath: 'body', aliases: ['body'] }] },
    ],
    nativeObjectInputs: sources.map((source, index) => ({ relativePath: source.relativePath,
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: source.sourceType,
        objectType: index === 0 ? 'Document' : 'ClickupTask', namespace: 'example',
        externalId: longExternalId !== null && index === 1 ? longExternalId
          : index === 0 ? 'guide' : `CT-${16 + index}` },
      fields: [{ fieldPath: 'body', value: source.content }] })),
  };
  kernel.buildSourceNativeProduct({ ...options, objectBackendUri, input,
    ...(protectedHistory ? { historyBackendUri: pathToFileURL(join(root, 'history')).href } : {}) });
  const state = kernel.openProductState(options);
  const objectByPath = new Map(state.objectOnt.map.nativeObjects.map((object) => [object.relativePath, object]));
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  const witness = (relativePath) => {
    const object = objectByPath.get(relativePath);
    const source = sourceByPath.get(relativePath);
    return { nativeObjectSha256: object.nativeObjectSha256, evidence: {
      sourceRef: relativePath, sourceSha256: object.sourceSha256, byteStart: 0,
      byteEnd: Buffer.byteLength(source.content), textSha256: object.sourceSha256,
    } };
  };
  const baseInput = (definitions = names.map((name, index) => ({ id: `concept-${index}`, name }))) => ({
    proposedBy: 'constructor', proposedAt: at(2), method: 'authored',
    objectDefs: definitions.map((definition) => {
      const aliases = definition.aliases ?? (definition.alias === undefined ? [] : [definition.alias]);
      return { kind: 'ObjectDef', id: definition.id, name: definition.name, source: witness('docs/guide.txt'),
        aliases: aliases.map((value) => ({ value, sourceSystem: 'clickup',
          source: witness(definition.aliasSource ?? 'clickup/CT-17.txt') })) };
    }),
    claims: definitions.map((definition, index) => ({ kind: 'Claim', id: `claim-${definition.id}-${index}`,
      about: definition.id, predicate: index === 0 ? 'defines' : 'mentions',
      source: witness(definition.claimSource ?? 'docs/guide.txt') })),
    coverage: state.objectOnt.sources.map((source) => ({ sourceRef: source.relativePath,
      sourceSha256: source.sourceSha256, disposition: 'examined' })),
  });
  const keys = Object.fromEntries(['constructor', 'reviewer', 'reviewer-two'].map((id) => [id, generateKeyPairSync('ed25519')]));
  const trustRegistry = Object.entries(keys).map(([issuerId, pair]) => ({ issuerId,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: [issuerId === 'constructor' ? 'proposer' : 'reviewer'] }));
  const configuration = { trustRegistry };
  const compile = (value = baseInput()) => kernel.compileSourceNativeSemanticConstruction({ options, input: value });
  const admit = (construction = compile(), { issuerId = 'reviewer', day = 3, targets = [] } = {}) => {
    const proposalStatement = kernel.sourceNativeConstructionProposalStatement({ construction });
    const statement = kernel.sourceNativeConstructionAdmissionStatement({ construction, issuerId,
      admittedAt: at(day), supersedesRecordSha256s: targets });
    return kernel.compileSourceNativeConstructionAdmissionRecord({ construction, proposalStatement, statement,
      proposalSignatureBase64: signature(proposalStatement, keys.constructor.privateKey),
      signatureBase64: signature(statement, keys[issuerId].privateKey) });
  };
  const write = (record, extra = {}) => kernel.writeSourceNativeConstructionAdmission({
    options, trustRegistry, record, ...extra });
  const route = { ontId: state.descriptor.ontId,
    branch: `knowledge-${state.objectOnt.commitSha256.slice(7, 23)}` };
  const plant = (value, logicalPath = `${prefix}${value.recordSha256.slice(7)}.json`) => {
    const snapshot = state.store.readRefMetadataSnapshot(route);
    const parent = snapshot?.ref.commitSha256 ?? state.objectOnt.commitSha256;
    const blob = state.store.putBlob({ logicalPath, bytes: Buffer.from(kernel.stableObjectText(value)),
      mediaType: 'application/json' });
    const commit = state.store.writeCommitMetadata({ ontId: route.ontId, parents: [parent],
      ontManifest: state.store.readCommit(parent).commit.ontManifest, blobs: [blob] });
    state.store.compareAndSwapRefMetadata({ ...route, expectedVersion: snapshot?.version ?? null,
      commitSha256: commit.commitSha256 });
    return blob;
  };
  const open = (config = configuration) => kernel.openSourceNativeOntExplorer(options, config);
  const openConstruction = (config = configuration) => kernel.openSourceNativeProductWithConstruction(options, config);
  return { root, options, state, sourceByPath, objectByPath, input, keys, trustRegistry, configuration,
    compile, baseInput, admit, write, plant, open, openConstruction, route,
    backend: openCanonicalObjectBackend({ uri: objectBackendUri }).backend };
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function allPages(fetchFirst, fetchNext, key) {
  const items = [];
  const pages = [];
  let page = fetchFirst();
  pages.push(page);
  items.push(...page[key]);
  while (page.nextCursor !== null) {
    page = fetchNext(page.nextCursor);
    pages.push(page);
    items.push(...page[key]);
  }
  return { first: pages[0], items, pages };
}

test('source-only Ont exposes native nodes, identity, coverage and unknown freshness', (t) => {
  const f = fixture(t);
  const explorer = f.open();
  const status = explorer.status();
  assert.equal(status.kind, 'OpenOntologySourceNativeOntExplorerStatusV1');
  assert.equal(status.state, 'ready');
  assert.equal(status.availability, 'ready');
  assert.equal(status.binding.ontId, 'ont-explorer-example');
  assert.equal(status.binding.namespace, 'example');
  assert.equal(status.binding.sourceCommitSha256, f.state.objectOnt.commitSha256);
  assert.equal(status.coverage.sourceCount, 3);
  assert.equal(status.coverage.nativeObjectCount, 3);
  assert.equal(status.freshness.state, 'unknown');
  assert.equal(status.recordCount, 0);
  const page = explorer.nodes({ limit: 2 });
  assert.equal(page.totalCount, 3);
  assert.equal(page.returnedCount, 2);
  assert(page.nodes.every((node) => node.kind === 'native-object'));
  assert.equal(JSON.stringify(page).includes('allocation mismatch'), false);
  assert.equal(JSON.stringify(page).includes('content'), false);
  const scoped = explorer.nodes({ scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' }, limit: 64 });
  assert.equal(scoped.totalCount, 2);
  assert(scoped.nodes.every((node) => node.kind === 'native-object'
    && node.nativeObject?.identity.sourceSystem === 'clickup'));
});

test('canonical graph preserves Claim IDs and passage-to-ObjectDef direction', (t) => {
  const f = fixture(t, { names: ['AllocationException', 'DocumentedTask'] });
  const construction = f.compile(f.baseInput([
    { id: 'allocation-exception', name: 'AllocationException', alias: 'allocation mismatch' },
    { id: 'documented-task', name: 'DocumentedTask' },
  ]));
  const admission = f.admit(construction);
  f.write(admission);
  const explorer = f.open();
  const nodes = allPages(() => explorer.nodes({ limit: 64 }), (cursor) => explorer.nodes({ cursor, limit: 64 }), 'nodes').items;
  const edges = allPages(() => explorer.edges({ limit: 128 }), (cursor) => explorer.edges({ cursor, limit: 128 }), 'edges').items;
  const objectDef = nodes.find((node) => node.kind === 'object-def' && node.objectDef?.id === 'allocation-exception');
  const passage = nodes.find((node) => node.kind === 'passage');
  assert(objectDef && passage);
  const claim = edges.find((edge) => edge.kind === 'claim' && edge.about === 'allocation-exception');
  assert(claim);
  assert.equal(claim.from, passage.id);
  assert.equal(claim.to, objectDef.id);
  assert.equal(claim.predicate, 'defines');
  assert.equal(claim.claimId, 'claim-allocation-exception-0');
  assert.equal(claim.evidence.sourceRef, 'docs/guide.txt');
  assert.equal(JSON.stringify(nodes).includes('sourceText'), false);
  assert.equal(JSON.stringify(nodes).includes('signatureBase64'), false);
  assert.equal(JSON.stringify(edges).includes('proofDisposition'), false);
  assert(edges.some((edge) => edge.kind === 'native-observation'));
  assert(edges.some((edge) => edge.kind === 'name-witness'));
});

test('reviewer agreement is deduplicated while same-name distinct definitions remain separate', (t) => {
  const f = fixture(t, { names: ['SharedConcept'] });
  const first = f.admit(f.compile(f.baseInput([{ id: 'same-a', name: 'SharedConcept', alias: 'allocation mismatch' }])));
  const secondReviewer = f.admit(f.compile(f.baseInput([{ id: 'same-a', name: 'SharedConcept', alias: 'allocation mismatch' }])), { issuerId: 'reviewer-two' });
  const distinct = f.admit(f.compile(f.baseInput([{ id: 'same-b', name: 'SharedConcept' }])), { day: 4 });
  f.write(first); f.write(secondReviewer); f.write(distinct);
  const explorer = f.open();
  const graphPage = explorer.nodes({ term: ' sharedconcept ', limit: 64 });
  assert.equal(graphPage.totalCount, 2);
  assert.deepEqual(graphPage.nodes.filter((node) => node.kind === 'object-def')
    .map((node) => node.objectDef.id).sort(), ['same-a', 'same-b']);
  const edges = allPages(() => explorer.edges(), (cursor) => explorer.edges({ cursor }), 'edges').items;
  assert.equal(edges.filter((edge) => edge.kind === 'claim').length, 2);
  const records = explorer.records({ limit: 64 });
  assert.equal(records.totalCount, 3);
  assert.equal(records.records.filter((record) => record.constructionSha256 === first.construction.constructionSha256).length, 2);
  const cursorPage = explorer.nodes({ term: ' SHAREDCONCEPT ', limit: 1 });
  assert(cursorPage.nextCursor);
  assert.doesNotThrow(() => explorer.nodes({ term: 'sharedconcept', cursor: cursorPage.nextCursor, limit: 1 }));
});

test('scoped aliases, explicit IDs and one-hop focus keep identities distinct', async (t) => {
  const f = fixture(t, { names: ['ScopedConcept'] });
  const construction = f.admit(f.compile(f.baseInput([
    { id: 'scoped-concept', name: 'ScopedConcept', alias: 'allocation mismatch' },
  ])));
  f.write(construction);
  const explorer = f.open();
  assert.equal(explorer.nodes({ term: 'allocation mismatch', scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' } }).totalCount, 1);
  assert.equal(explorer.nodes({ term: 'ScopedConcept', scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' } }).totalCount, 1);
  const scopedNodes = explorer.nodes({ scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' } });
  assert(scopedNodes.totalCount > 1);
  assert(scopedNodes.nodes.some((node) => node.kind === 'object-def'));
  assert(scopedNodes.nodes.filter((node) => node.kind === 'native-object')
    .every((node) => node.nativeObject?.identity.sourceSystem === 'clickup'));
  assert.equal(explorer.nodes({ term: 'allocation mismatch', scope: { sourceSystem: 'docs' } }).totalCount, 0);
  const mismatchedAlias = f.admit(f.compile(f.baseInput([
    { id: 'mismatched-alias', name: 'ScopedConcept', alias: 'allocation mismatch',
      aliasSource: 'docs/guide.txt', claimSource: 'clickup/CT-17.txt' },
  ])), { day: 4 });
  f.write(mismatchedAlias);
  const afterMismatch = f.open();
  const scopedAlias = afterMismatch.nodes({ term: 'allocation mismatch',
    scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' } });
  assert(scopedAlias.totalCount >= 2);
  assert(scopedAlias.nodes.some((node) => node.objectDef?.id === 'mismatched-alias'));
  const navigation = await f.openConstruction().search({ term: 'allocation mismatch',
    scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' }, limit: 64 });
  assert.equal(scopedAlias.totalCount, navigation.totalMatches);
  assert.equal(afterMismatch.nodes({ term: 'allocation mismatch', scope: { sourceSystem: 'docs' } }).totalCount, 0);
  const objectDef = explorer.nodes({ term: 'ScopedConcept' }).nodes.find((node) => node.kind === 'object-def');
  assert(objectDef);
  const focused = explorer.nodes({ focusId: objectDef.id, limit: 64 });
  assert(focused.nodes.some((node) => node.id === objectDef.id));
  assert(focused.nodes.some((node) => node.kind === 'passage'));
  const selected = explorer.nodes({ ids: [objectDef.id], limit: 64 });
  assert.deepEqual(selected.nodes.map((node) => node.id), [objectDef.id]);
  assert.throws(() => explorer.nodes({ ids: [objectDef.id], focusId: objectDef.id }), { code: 'SOURCE_NATIVE_EXPLORER_INPUT' });
  assert.throws(() => explorer.nodes({ focusId: 'object-def:unknown' }), { code: 'SOURCE_NATIVE_EXPLORER_FOCUS' });
});

test('node, edge and record pages exhaust with bounded counts and bytes', (t) => {
  const names = Array.from({ length: 40 }, (_, index) => `SyntheticConcept${index}`);
  const f = fixture(t, { names });
  const admission = f.admit(f.compile(f.baseInput(names.map((name, index) => ({ id: `concept-${index}`, name })))));
  f.write(admission);
  const explorer = f.open();
  const nodePages = allPages(() => explorer.nodes({ limit: 7 }), (cursor) => explorer.nodes({ limit: 7, cursor }), 'nodes');
  const edgePages = allPages(() => explorer.edges({ limit: 11 }), (cursor) => explorer.edges({ limit: 11, cursor }), 'edges');
  const recordPages = allPages(() => explorer.records({ limit: 1 }), (cursor) => explorer.records({ limit: 1, cursor }), 'records');
  const status = explorer.status();
  assert.equal(nodePages.items.length, nodePages.first.totalCount);
  assert.equal(edgePages.items.length, edgePages.first.totalCount);
  assert.equal(recordPages.items.length, recordPages.first.totalCount);
  assert(new Set(nodePages.items.map((node) => node.id)).size === nodePages.items.length);
  assert(new Set(edgePages.items.map((edge) => edge.id)).size === edgePages.items.length);
  assert(jsonBytes(nodePages.first) <= pageBytes);
  assert(jsonBytes(edgePages.first) <= pageBytes);
  assert(jsonBytes(recordPages.first) <= pageBytes);
  assert(nodePages.pages.every((page) => jsonBytes(page) <= pageBytes));
  assert(edgePages.pages.every((page) => jsonBytes(page) <= pageBytes));
  assert(recordPages.pages.every((page) => jsonBytes(page) <= pageBytes));
  assert(jsonBytes(status) <= pageBytes);
  assert.throws(() => explorer.nodes({ limit: 65 }), { code: 'SOURCE_NATIVE_EXPLORER_INPUT' });
  assert.throws(() => explorer.edges({ limit: 129 }), { code: 'SOURCE_NATIVE_EXPLORER_INPUT' });
  assert.throws(() => explorer.records({ limit: 65 }), { code: 'SOURCE_NATIVE_EXPLORER_INPUT' });
  assert(recordPages.items.every((record) => !Object.hasOwn(record, 'sourceResults')));
  assert(recordPages.items.some((record) => record.constructionCoverage?.examinedSourceCount === 3));
});

test('boundary-sized valid metadata pages include cursor overhead in their byte bound', (t) => {
  const names = Array.from({ length: 64 }, (_, index) => `BoundaryConcept${index}`);
  const aliases = Array.from({ length: 16 }, (_, aliasIndex) => `BoundaryAlias${aliasIndex}-${'a'.repeat(220)}`);
  const definitions = names.map((name, index) => ({ id: `boundary-${index}`, name, aliases,
    aliasSource: 'docs/guide.txt' }));
  const extraText = aliases.join(' ');
  const f = fixture(t, { names, extraText });
  assert(definitions.every((definition) => f.sourceByPath.get('docs/guide.txt').content.includes(definition.name)));
  f.write(f.admit(f.compile(f.baseInput(definitions))));
  const explorer = f.open();
  const pages = allPages(() => explorer.nodes({ limit: 64 }),
    (cursor) => explorer.nodes({ limit: 64, cursor }), 'nodes');
  assert(pages.pages.every((page) => jsonBytes(page) <= pageBytes));
  assert(pages.items.length === pages.first.totalCount);
  assert.equal(new Set(pages.items.map((node) => node.id)).size, pages.items.length);
  assert(pages.pages.some((page) => page.nextCursor !== null && page.returnedCount < 64));
});

test('a valid oversized native identity refuses as one item without an empty cursor page', (t) => {
  const longExternalId = `oversized-${'x'.repeat(300_000)}`;
  const f = fixture(t, { longExternalId });
  const explorer = f.open();
  assert.equal(explorer.status().state, 'ready');
  const nativeObject = f.state.objectOnt.map.nativeObjects.find((object) =>
    object.objectIdentity.externalId === longExternalId);
  assert(nativeObject);
  const nodeId = `native-object:${kernel.stableObjectSha256({
    sourceCommitSha256: f.state.objectOnt.commitSha256,
    nativeObjectSha256: nativeObject.nativeObjectSha256,
  })}`;
  assert.throws(() => explorer.nodes({ ids: [nodeId], limit: 64 }),
    { code: 'SOURCE_NATIVE_EXPLORER_ITEM_BYTES' });
});

test('records retain conflict, correction and ineligible states without entering current graph', (t) => {
  const f = fixture(t, { names: ['Correctable', 'Alternate', 'CorrectableNow'] });
  const original = f.admit(f.compile(f.baseInput([{ id: 'correctable', name: 'Correctable' }])));
  const alternate = f.admit(f.compile(f.baseInput([{ id: 'correctable', name: 'Alternate' }])), { day: 4 });
  f.write(original); f.write(alternate);
  const conflictExplorer = f.open();
  const conflicts = conflictExplorer.records({ state: 'conflicting', limit: 64 });
  assert.equal(conflicts.totalCount, 2);
  assert(jsonBytes(conflictExplorer.status()) <= pageBytes);
  assert(conflictExplorer.status().ledger.conflictingObjectDefIds.length <= 128);
  assert.equal(conflictExplorer.nodes({ limit: 64 }).nodes.filter((node) => node.kind === 'object-def').length, 0);
  const correction = f.admit(f.compile(f.baseInput([{ id: 'correctable', name: 'CorrectableNow' }])), {
    day: 5, targets: [original.recordSha256, alternate.recordSha256] });
  f.write(correction);
  const corrected = f.open();
  assert.equal(corrected.records({ state: 'superseded', limit: 64 }).totalCount, 2);
  assert.equal(corrected.records({ state: 'active', limit: 64 }).totalCount, 1);
  assert.equal(corrected.nodes({ term: 'CorrectableNow' }).totalCount, 1);

  const revoked = f.open({ trustRegistry: f.trustRegistry.filter((entry) => entry.issuerId !== 'reviewer') });
  const ineligible = revoked.records({ state: 'ineligible', limit: 64 });
  assert(ineligible.totalCount >= 1);
  assert(ineligible.records.every((record) => record.reasonCodes.length > 0));
  assert.equal(revoked.nodes({ limit: 64 }).nodes.filter((node) => node.kind === 'object-def').length, 0);
});

test('malformed construction metadata remains bounded and valid graph items survive', (t) => {
  const f = fixture(t);
  const original = f.admit();
  f.write(original);
  const malformed = clone(original);
  malformed.kind = 'UnknownFutureRecordV99';
  const blob = f.plant(malformed, `${prefix}malformed-explorer.json`);
  const explorer = f.open();
  const records = explorer.records({ limit: 64 });
  const invalid = records.records.find((item) => item.blobSha256 === blob.storedSha256);
  assert.equal(invalid?.state, 'invalid');
  assert.equal(invalid?.recordSha256, null);
  assert.equal(invalid?.constructionSha256, null);
  assert(invalid?.reasonCodes.length > 0);
  assert.equal(JSON.stringify(invalid).includes('signatureBase64'), false);
  assert.equal(explorer.nodes({ limit: 64 }).nodes.filter((node) => node.kind === 'object-def').length, 2);
});

test('foreign and filter-mismatched cursors are refused, and projection changes stale cursors', (t) => {
  const f = fixture(t, { names: ['AllocationException', 'NewConcept'] });
  f.write(f.admit());
  const a = f.open();
  const b = f.open();
  const first = a.nodes({ limit: 1 });
  assert(first.nextCursor);
  assert.throws(() => b.nodes({ cursor: first.nextCursor, limit: 1 }), { code: 'SOURCE_NATIVE_EXPLORER_CURSOR' });
  assert.throws(() => a.nodes({ cursor: first.nextCursor, term: 'AllocationException', limit: 1 }), { code: 'SOURCE_NATIVE_EXPLORER_CURSOR_STALE' });
  const record = f.admit(f.compile(f.baseInput([{ id: 'new-concept', name: 'NewConcept' }])), { day: 4 });
  f.write(record);
  assert.throws(() => a.nodes({ cursor: first.nextCursor, limit: 1 }), { code: 'SOURCE_NATIVE_EXPLORER_CURSOR_STALE' });
});

test('pinned reviewer configuration and source cut stay stable after caller mutation', (t) => {
  const f = fixture(t);
  f.write(f.admit());
  const explorer = f.open();
  const before = explorer.status();
  f.trustRegistry[0].roles = ['reviewer'];
  f.trustRegistry[1].publicKeyPem = 'mutated-after-open';
  const after = explorer.status();
  assert.equal(after.binding.reviewerConfigurationSha256, before.binding.reviewerConfigurationSha256);
  assert.equal(after.binding.sourceCommitSha256, before.binding.sourceCommitSha256);
  assert.equal(after.state, 'ready');
});

test('reviewer configuration binds public key identity and edge IDs ignore agreement representative', (t) => {
  const f = fixture(t, { names: ['StableConcept'] });
  const first = f.admit(f.compile(f.baseInput([{ id: 'stable', name: 'StableConcept' }])));
  const second = f.admit(f.compile(f.baseInput([{ id: 'stable', name: 'StableConcept' }])) , { issuerId: 'reviewer-two', day: 4 });
  const larger = first.recordSha256 > second.recordSha256 ? first : second;
  const smaller = larger === first ? second : first;
  f.write(larger);
  const before = f.open();
  const beforeIds = before.edges({ limit: 128 }).edges.map((edge) => edge.id);
  f.write(smaller);
  const explorer = f.open();
  const reversed = f.open({ trustRegistry: [...f.trustRegistry].reverse() });
  assert.notEqual(explorer.status().binding.reviewerConfigurationSha256, '');
  assert.equal(explorer.status().binding.reviewerConfigurationSha256,
    reversed.status().binding.reviewerConfigurationSha256);
  assert.deepEqual(beforeIds, explorer.edges({ limit: 128 }).edges.map((edge) => edge.id));
  const rotated = generateKeyPairSync('ed25519');
  const rotatedRegistry = f.trustRegistry.map((entry) => entry.issuerId === 'reviewer'
    ? { ...entry, publicKeyPem: rotated.publicKey.export({ type: 'spki', format: 'pem' }) } : entry);
  assert.notEqual(explorer.status().binding.reviewerConfigurationSha256,
    f.open({ trustRegistry: rotatedRegistry }).status().binding.reviewerConfigurationSha256);
});

test('cursor retention is bounded and evicts the oldest cursor', (t) => {
  const f = fixture(t);
  f.write(f.admit());
  const explorer = f.open();
  const first = explorer.nodes({ limit: 1 });
  assert(first.nextCursor);
  for (let index = 0; index < 128; index += 1) {
    const page = explorer.nodes({ limit: 1 });
    assert(page.nextCursor);
  }
  assert.throws(() => explorer.nodes({ cursor: first.nextCursor, limit: 1 }), { code: 'SOURCE_NATIVE_EXPLORER_CURSOR' });
});

test('history failure suppresses cached pages and recovery restores the same reader', (t) => {
  const f = fixture(t, { protectedHistory: true, names: ['AllocationException', 'RecoveredConcept'] });
  const original = f.admit(f.compile(f.baseInput([{ id: 'concept-0', name: 'AllocationException' }])));
  f.write(original);
  const explorer = f.open();
  assert.equal(explorer.status().state, 'ready');
  const stale = explorer.nodes({ limit: 1 });
  assert(stale.nextCursor);
  const first = f.state.store.readRefMetadata(f.route);
  const correction = f.admit(f.compile(f.baseInput([{ id: 'concept-0', name: 'RecoveredConcept' }])), { day: 4,
    targets: [original.recordSha256] });
  f.write(correction);
  const current = f.state.store.readRefMetadata(f.route);
  f.backend.compareAndSwap(current.key, { expectedVersion: current.version,
    bytes: Buffer.from(kernel.stableObjectText(first.ref)) });
  const unavailable = explorer.status();
  assert.equal(unavailable.state, 'unavailable');
  assert(jsonBytes(unavailable) <= pageBytes);
  assert.equal(explorer.nodes({ limit: 64 }).totalCount, null);
  assert.equal(explorer.edges({ limit: 128 }).totalCount, null);
  assert.equal(explorer.records({ limit: 64 }).totalCount, null);
  f.state.store.recoverRefHistory(f.route);
  const recovered = explorer.status();
  assert.equal(recovered.state, 'ready');
  assert.throws(() => explorer.nodes({ cursor: stale.nextCursor, limit: 1 }), { code: 'SOURCE_NATIVE_EXPLORER_CURSOR' });
  assert.equal(explorer.nodes({ term: 'RecoveredConcept' }).totalCount, 1);
});

test('unknown and unsupported explorer inputs refuse before page projection', (t) => {
  const f = fixture(t); const explorer = f.open();
  assert.throws(() => explorer.nodes({ nope: true }), { code: 'SOURCE_NATIVE_EXPLORER_INPUT' });
  assert.throws(() => explorer.nodes({ term: '' }), { code: 'SOURCE_NATIVE_EXPLORER_INPUT' });
  assert.throws(() => explorer.nodes({ ids: Array.from({ length: 65 }, () => 'x') }), { code: 'SOURCE_NATIVE_EXPLORER_INPUT' });
  assert.throws(() => explorer.records({ state: 'ready' }), { code: 'SOURCE_NATIVE_EXPLORER_INPUT' });
  assert.throws(() => explorer.edges({ focusId: 'not-a-node' }), { code: 'SOURCE_NATIVE_EXPLORER_FOCUS' });
  assert.equal('read' in explorer, false);
});
