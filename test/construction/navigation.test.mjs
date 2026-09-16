import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import * as kernel from '../../dist/kernel.js';
import { openCanonicalObjectBackend } from '../../dist/storage/canonical-backend.js';

const clone = structuredClone;
const at = (day) => `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const signature = (statement, key) =>
  sign(null, Buffer.from(kernel.stableObjectText(statement)), key).toString('base64');

function fixture(t, { taskCount = 2, protectedHistory = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oont-construction-navigation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { artifactRoot: join(root, 'ont') };
  const objectBackendUri = pathToFileURL(join(root, 'data')).href;
  const sources = [
    {
      relativePath: 'docs/guide.txt',
      sourceType: 'docs',
      occurredAt: at(1),
      content:
        'AllocationException means inventory allocation mismatch. The ClickUp label is allocation mismatch.',
    },
    ...Array.from({ length: taskCount }, (_, index) => ({
      relativePath: `clickup/CT-${17 + index}.txt`,
      sourceType: 'clickup',
      occurredAt: at(1),
      content: `ClickupTask CT-${17 + index}: allocation mismatch. Status: ${index ? 'closed' : 'open'}.`,
    })),
  ];
  const buildInput = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'construction-navigation-example',
    namespace: 'example',
    sources,
    querySchemas: [
      {
        sourceSystem: 'docs',
        objectType: 'Document',
        aliases: ['document'],
        fields: [{ fieldPath: 'body', aliases: ['body'] }],
      },
      {
        sourceSystem: 'clickup',
        objectType: 'ClickupTask',
        aliases: ['ClickupTask'],
        fields: [
          { fieldPath: 'body', aliases: ['body'] },
          { fieldPath: 'status', aliases: ['status'] },
        ],
      },
    ],
    nativeObjectInputs: sources.map((source, index) => ({
      relativePath: source.relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: source.sourceType,
        objectType: index ? 'ClickupTask' : 'Document',
        namespace: 'example',
        externalId: index ? `CT-${16 + index}` : 'guide',
      },
      fields: [
        { fieldPath: 'body', value: source.content },
        ...(index ? [{ fieldPath: 'status', value: index === 1 ? 'open' : 'closed' }] : []),
      ],
    })),
  };
  kernel.buildSourceNativeProduct({
    ...options,
    objectBackendUri,
    input: buildInput,
    ...(protectedHistory ? { historyBackendUri: pathToFileURL(join(root, 'history')).href } : {}),
  });
  const state = kernel.openProductState(options);
  const witness = (path) => {
    const object = state.objectOnt.map.nativeObjects.find((item) => item.relativePath === path);
    const source = sources.find((item) => item.relativePath === path);
    return {
      nativeObjectSha256: object.nativeObjectSha256,
      evidence: {
        sourceRef: path,
        sourceSha256: object.sourceSha256,
        byteStart: 0,
        byteEnd: Buffer.byteLength(source.content),
        textSha256: object.sourceSha256,
      },
    };
  };
  const input = {
    proposedBy: 'constructor',
    proposedAt: at(2),
    method: 'authored',
    objectDefs: [
      {
        kind: 'ObjectDef',
        id: 'allocation-exception',
        name: 'AllocationException',
        source: witness('docs/guide.txt'),
        aliases: [
          {
            value: 'allocation mismatch',
            sourceSystem: 'clickup',
            source: witness('docs/guide.txt'),
          },
        ],
      },
    ],
    claims: [
      {
        kind: 'Claim',
        id: 'definition',
        about: 'allocation-exception',
        predicate: 'defines',
        source: witness('docs/guide.txt'),
      },
      ...sources.slice(1).map((source, i) => ({
        kind: 'Claim',
        id: `mention-${i}`,
        about: 'allocation-exception',
        predicate: 'mentions',
        source: witness(source.relativePath),
      })),
    ],
    coverage: state.objectOnt.sources.map((source) => ({
      sourceRef: source.relativePath,
      sourceSha256: source.sourceSha256,
      disposition: 'examined',
    })),
  };
  const keys = Object.fromEntries(
    ['constructor', 'reviewer', 'reviewer-two'].map((id) => [id, generateKeyPairSync('ed25519')]),
  );
  const trustRegistry = Object.entries(keys).map(([issuerId, pair]) => ({
    issuerId,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: [issuerId === 'constructor' ? 'proposer' : 'reviewer'],
  }));
  const configuration = { trustRegistry };
  const compile = (value = input) =>
    kernel.compileSourceNativeSemanticConstruction({ options, input: value });
  function record(construction = compile(), { issuerId = 'reviewer', day = 3, targets = [] } = {}) {
    const proposalStatement = kernel.sourceNativeConstructionProposalStatement({ construction });
    const statement = kernel.sourceNativeConstructionAdmissionStatement({
      construction,
      issuerId,
      admittedAt: at(day),
      supersedesRecordSha256s: targets,
    });
    return kernel.compileSourceNativeConstructionAdmissionRecord({
      construction,
      proposalStatement,
      statement,
      proposalSignatureBase64: signature(proposalStatement, keys.constructor.privateKey),
      signatureBase64: signature(statement, keys[issuerId].privateKey),
    });
  }
  const write = (entry) =>
    kernel.writeSourceNativeConstructionAdmission({ options, trustRegistry, record: entry });
  const open = (config = configuration, lifecycle = null) =>
    kernel.openSourceNativeProductWithConstruction(options, config, lifecycle);
  const route = {
    ontId: state.descriptor.ontId,
    branch: `knowledge-${state.objectOnt.commitSha256.slice(7, 23)}`,
  };
  return {
    root,
    options,
    objectBackendUri,
    state,
    input,
    buildInput,
    configuration,
    trustRegistry,
    compile,
    record,
    write,
    open,
    witness,
    route,
    backend: openCanonicalObjectBackend({ uri: objectBackendUri }).backend,
  };
}

test('cold concept discovery, exact read, and explicit native verification use one client', async (t) => {
  const f = fixture(t);
  const record = f.record();
  f.write(record);
  const ont = f.open();
  const result = await ont.search({
    term: 'allocation mismatch',
    scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' },
  });
  assert.equal(result.kind, 'OpenOntologyConstructionSearchResultV1');
  assert.equal(result.state, 'resolved-construction-navigation');
  assert.equal(result.totalMatches, 2);
  assert.equal(result.absenceProven, false);
  assert.equal(JSON.stringify(result).includes('Status: open.'), false);
  assert.equal(JSON.stringify(result).includes('signatureBase64'), false);
  assert(
    result.matches.every(
      (match) => match.requiredForProof === false && match.nativeObject.sourceSystem === 'clickup',
    ),
  );
  const match = result.matches.find((item) => item.nativeObject.externalId === 'CT-17');
  const exact = await ont.read({ ref: match.ref });
  assert.equal(exact.kind, 'OpenOntologyConstructionReadResultV1');
  assert.equal(exact.exactText, 'ClickupTask CT-17: allocation mismatch. Status: open.');
  assert.equal(exact.binding.kind, 'OpenOntologyConstructionPassageBindingV1');
  assert.equal(exact.binding.admissionRecordSha256, record.recordSha256);
  assert.equal('proofDisposition' in exact, false);
  assert.equal(exact.binding.navigationOnly, true);
  const query = {
    question: 'What is the current status?',
    typedQuery: {
      sourceSystem: 'clickup',
      objectType: 'ClickupTask',
      fieldPath: 'status',
    },
  };
  const unbound = await ont.verify(query);
  assert.equal(unbound.answerable, false);
  const selected = await ont.verify({
    ...query,
    typedQuery: { ...query.typedQuery, externalId: exact.binding.nativeObject.externalId },
  });
  assert.equal(selected.answerable, true);
  assert.equal(selected.context[0].exactText, 'open');
  assert.equal(selected.context[0].binding.kind, 'OpenOntologyVerifiedSourceNativeFieldBindingV1');
});

test('canonical name crosses source systems while alias lookup respects explicit scope', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  const ont = f.open();
  const canonical = await ont.search({ term: '  allocationexception  ' });
  assert.equal(canonical.totalMatches, 3);
  const guide = canonical.matches.find((item) => item.relativePath === 'docs/guide.txt');
  assert.deepEqual(guide.roles, ['alias', 'defines', 'name']);
  const aliasWrongScope = await ont.search({
    term: 'allocation mismatch',
    scope: { sourceSystem: 'docs' },
  });
  assert.equal(aliasWrongScope.state, 'no-construction-match');
  assert.equal(aliasWrongScope.absenceProven, false);
  assert.equal(
    (await ont.search({ term: 'AllocationException', scope: { sourceSystem: 'docs' } }))
      .totalMatches,
    1,
  );
  assert.equal((await ont.search({ term: 'allocation' })).state, 'no-construction-match');
  assert.equal(
    (await ont.search({ term: 'What does allocation mismatch mean?' })).state,
    'no-construction-match',
  );
});

test('same-name distinct concepts stay ambiguous until explicitly selected', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  const input = clone(f.input);
  input.objectDefs[0].id = 'another-definition';
  input.claims.forEach((claim) => {
    claim.about = 'another-definition';
  });
  f.write(f.record(f.compile(input)));
  const ont = f.open();
  const ambiguous = await ont.search({ term: 'AllocationException', limit: 2 });
  assert.equal(ambiguous.state, 'ambiguous-construction-navigation');
  assert.equal(ambiguous.totalConcepts, 2);
  assert.equal(ambiguous.totalMatches, 6);
  assert.deepEqual(
    ambiguous.concepts.map((item) => item.id),
    ['allocation-exception'],
  );
  assert.equal(ambiguous.matches.length, 2);
  assert(ambiguous.matches.every((item) => item.conceptId === 'allocation-exception'));
  const firstRead = await ont.read({ ref: ambiguous.matches[0].ref });
  assert.equal(firstRead.binding.conceptId, 'allocation-exception');
  const secondPage = await ont.search({
    term: 'AllocationException',
    limit: 4,
    cursor: ambiguous.nextCursor,
  });
  assert.equal(secondPage.state, 'ambiguous-construction-navigation');
  assert.deepEqual(
    secondPage.concepts.map((item) => item.id),
    ['allocation-exception', 'another-definition'],
  );
  const otherMatch = secondPage.matches.find((item) => item.conceptId === 'another-definition');
  assert(otherMatch);
  const secondRead = await ont.read({ ref: otherMatch.ref });
  assert.equal(secondRead.binding.conceptId, 'another-definition');
  const unboundQuery = {
    question: 'What is the current status?',
    typedQuery: {
      sourceSystem: 'clickup',
      objectType: 'ClickupTask',
      fieldPath: 'status',
    },
  };
  assert.equal((await ont.verify(unboundQuery)).answerable, false);
  const candidatePage = await ont.search({
    term: 'AllocationException',
    conceptId: 'another-definition',
    scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' },
  });
  const candidate = candidatePage.matches.find((item) => item.nativeObject.externalId === 'CT-17');
  assert(candidate);
  const candidateRead = await ont.read({ ref: candidate.ref });
  const verified = await ont.verify({
    ...unboundQuery,
    typedQuery: {
      ...unboundQuery.typedQuery,
      externalId: candidateRead.binding.nativeObject.externalId,
    },
  });
  assert.equal(verified.answerable, true);
  assert.equal(verified.context[0].exactText, 'open');
  const selected = await ont.search({
    term: 'AllocationException',
    conceptId: 'another-definition',
  });
  assert.equal(selected.state, 'resolved-construction-navigation');
  assert(selected.matches.every((item) => item.conceptId === 'another-definition'));
  assert.equal(
    (await ont.search({ term: 'not that name', conceptId: 'another-definition' })).totalConcepts,
    0,
  );
});

test('reopening preserves deterministic metadata order while refs remain session-owned', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  const input = clone(f.input);
  input.objectDefs[0].id = 'another-definition';
  input.claims.forEach((claim) => {
    claim.about = 'another-definition';
  });
  f.write(f.record(f.compile(input)));
  const a = await f.open().search({ term: 'AllocationException', limit: 4 });
  const b = await f.open().search({ term: 'AllocationException', limit: 4 });
  const metadata = (page) => ({
    state: page.state,
    concepts: page.concepts,
    matches: page.matches.map(({ ref, ...match }) => match),
  });
  assert.deepEqual(metadata(a), metadata(b));
  assert.notDeepEqual(
    a.matches.map((item) => item.ref),
    b.matches.map((item) => item.ref),
  );
});

test('same-proposal multi-reviewer agreement does not duplicate passages', async (t) => {
  const f = fixture(t);
  const construction = f.compile();
  f.write(f.record(construction));
  f.write(f.record(construction, { issuerId: 'reviewer-two' }));
  const result = await f.open().search({ term: 'AllocationException' });
  assert.equal(result.totalMatches, 3);
  assert.equal(result.ledger.activeRecordCount, 2);
});

test('conflicting same-ID maps are unavailable, never resolved by recency', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  const input = clone(f.input);
  input.claims[0].predicate = 'mentions';
  f.write(f.record(f.compile(input), { day: 4 }));
  const result = await f.open().search({ term: 'AllocationException' });
  assert.equal(result.state, 'unavailable-construction-navigation');
  assert.equal(result.ledger.conflictingRecordCount, 2);
  assert.deepEqual(result.matches, []);
  assert.equal(result.absenceProven, false);
});

test('a warm client adopts new Admission and corrections invalidate offered passages', async (t) => {
  const f = fixture(t);
  const ont = f.open();
  assert.equal((await ont.search({ term: 'AllocationException' })).totalMatches, 0);
  const original = f.record();
  f.write(original);
  const first = await ont.search({ term: 'AllocationException', limit: 1 });
  assert.equal(first.totalMatches, 3);
  const input = clone(f.input);
  input.claims = input.claims.filter((claim) => claim.id !== 'mention-1');
  f.write(f.record(f.compile(input), { day: 4, targets: [original.recordSha256] }));
  await assert.rejects(ont.read({ ref: first.matches[0].ref }), {
    code: 'CONSTRUCTION_NAVIGATION_REFERENCE_INELIGIBLE',
  });
  await assert.rejects(
    ont.search({ term: 'AllocationException', limit: 1, cursor: first.nextCursor }),
    { code: 'CONSTRUCTION_NAVIGATION_CURSOR_STALE' },
  );
  const next = await ont.search({ term: 'AllocationException' });
  assert.equal(next.totalMatches, 2);
  assert.equal(next.ledger.supersededRecordCount, 1);
});

test('an ambiguous correction invalidates only the changed record and cursor', async (t) => {
  const f = fixture(t);
  const firstRecord = f.record();
  f.write(firstRecord);
  const secondInput = clone(f.input);
  secondInput.objectDefs[0].id = 'another-definition';
  secondInput.claims.forEach((claim) => {
    claim.about = 'another-definition';
  });
  const secondRecord = f.record(f.compile(secondInput));
  f.write(secondRecord);
  const ont = f.open();
  const first = await ont.search({ term: 'AllocationException', limit: 1 });
  assert.equal(first.state, 'ambiguous-construction-navigation');
  assert.equal(first.totalConcepts, 2);
  assert.equal(first.totalMatches, 6);
  const secondPage = await ont.search({
    term: 'AllocationException',
    limit: 4,
    cursor: first.nextCursor,
  });
  const unchanged = secondPage.matches.find((item) => item.conceptId === 'another-definition');
  assert(unchanged);
  const correctedInput = clone(f.input);
  correctedInput.claims = correctedInput.claims.filter((claim) => claim.id !== 'mention-1');
  f.write(f.record(f.compile(correctedInput), { day: 4, targets: [firstRecord.recordSha256] }));
  await assert.rejects(ont.read({ ref: first.matches[0].ref }), {
    code: 'CONSTRUCTION_NAVIGATION_REFERENCE_INELIGIBLE',
  });
  await assert.rejects(
    ont.search({ term: 'AllocationException', limit: 1, cursor: first.nextCursor }),
    { code: 'CONSTRUCTION_NAVIGATION_CURSOR_STALE' },
  );
  const unchangedRead = await ont.read({ ref: unchanged.ref });
  assert.equal(unchangedRead.binding.conceptId, 'another-definition');
  const current = await ont.search({ term: 'AllocationException' });
  assert.equal(current.state, 'ambiguous-construction-navigation');
  assert.equal(current.totalConcepts, 2);
  assert.equal(current.totalMatches, 5);
});

test('trust changes require reopen and revoked reviewer yields no construction refs', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  const ont = f.open();
  f.configuration.trustRegistry[1].roles = ['proposer'];
  assert.equal((await ont.search({ term: 'AllocationException' })).totalMatches, 3);
  const revoked = f.open(f.configuration);
  assert.equal(
    (await revoked.search({ term: 'AllocationException' })).state,
    'unavailable-construction-navigation',
  );
  const query = {
    question: 'What is the status of CT-17?',
    typedQuery: {
      sourceSystem: 'clickup',
      objectType: 'ClickupTask',
      externalId: 'CT-17',
      fieldPath: 'status',
    },
  };
  assert.equal((await revoked.verify(query)).answerable, true);
});

test('references are unforgeable by copying public metadata and cannot cross clients', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  const a = f.open();
  const b = f.open();
  const result = await a.search({ term: 'AllocationException' });
  await assert.rejects(b.read({ ref: result.matches[0].ref }), {
    code: 'CONSTRUCTION_NAVIGATION_REFERENCE',
  });
  await assert.rejects(a.read({ ref: 'construction:not-offered' }), {
    code: 'CONSTRUCTION_NAVIGATION_REFERENCE',
  });
  assert.throws(() => {
    result.matches[0].nativeObject.externalId = 'forged';
  }, TypeError);
  const read = await a.read({ ref: result.matches[0].ref });
  assert.equal(kernel.objectBytesSha256(Buffer.from(read.exactText)), read.evidence.textSha256);
});

test('counts and pagination expose every passage without pulling text into search context', async (t) => {
  const f = fixture(t, { taskCount: 70 });
  f.write(f.record());
  const ont = f.open();
  let cursor;
  const seen = [];
  do {
    const page = await ont.search({
      term: 'AllocationException',
      limit: 20,
      ...(cursor ? { cursor } : {}),
    });
    assert.equal(page.totalMatches, 71);
    assert(page.matches.length <= 20);
    assert.equal('exactText' in page.matches[0], false);
    seen.push(...page.matches.map((item) => item.relativePath));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 71);
  assert.equal(seen.length, 71);
});

test('cursors cannot cross clients or queries, and old cursor state is bounded', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  const ont = f.open();
  const first = await ont.search({ term: 'AllocationException', limit: 1 });
  await assert.rejects(f.open().search({ term: 'AllocationException', cursor: first.nextCursor }), {
    code: 'CONSTRUCTION_NAVIGATION_CURSOR',
  });
  await assert.rejects(ont.search({ term: 'allocation mismatch', cursor: first.nextCursor }), {
    code: 'CONSTRUCTION_NAVIGATION_CURSOR_STALE',
  });
  for (let i = 0; i < 130; i++) await ont.search({ term: 'AllocationException', limit: 1 });
  await assert.rejects(ont.search({ term: 'AllocationException', cursor: first.nextCursor }), {
    code: 'CONSTRUCTION_NAVIGATION_CURSOR',
  });
});

test('offered references have a bounded FIFO lifetime independent of source eligibility', async (t) => {
  const f = fixture(t, { taskCount: 70 });
  f.write(f.record());
  const ont = f.open();
  const first = await ont.search({ term: 'AllocationException', limit: 1 });
  assert.equal((await ont.read({ ref: first.matches[0].ref })).binding.navigationOnly, true);
  let latest;
  for (let i = 0; i < 16; i++)
    latest = await ont.search({ term: 'AllocationException', limit: 64 });
  await assert.rejects(ont.read({ ref: first.matches[0].ref }), {
    code: 'CONSTRUCTION_NAVIGATION_REFERENCE',
  });
  assert.equal((await ont.read({ ref: latest.matches[63].ref })).binding.navigationOnly, true);
  assert.equal((await ont.search({ term: 'AllocationException' })).totalMatches, 71);
});

test('more than 64 concepts remain ambiguous and fully pageable with bounded summaries', async (t) => {
  const f = fixture(t);
  for (const [start, count] of [
    [0, 64],
    [64, 1],
  ]) {
    const input = clone(f.input);
    input.objectDefs = Array.from({ length: count }, (_, index) => ({
      ...clone(f.input.objectDefs[0]),
      id: `concept-${start + index}`,
    }));
    input.claims = [];
    f.write(f.record(f.compile(input)));
  }
  const ont = f.open();
  let cursor;
  const seen = [];
  do {
    const page = await ont.search({
      term: 'AllocationException',
      limit: 17,
      ...(cursor ? { cursor } : {}),
    });
    assert.equal(page.state, 'ambiguous-construction-navigation');
    assert.equal(page.totalConcepts, 65);
    assert.equal(page.totalMatches, 65);
    assert(page.concepts.length <= 64);
    assert(page.matches.length <= 17);
    assert(page.matches.every((match) => !('exactText' in match)));
    seen.push(...page.matches.map((match) => `${match.conceptId}:${match.relativePath}`));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 65);
  assert.equal(seen.length, 65);
  const selected = await ont.search({ term: 'AllocationException', conceptId: 'concept-64' });
  assert.equal(selected.state, 'resolved-construction-navigation');
  assert.equal(selected.totalMatches, 1);
});

test('ordinary search/read/verify and lifecycle hooks retain their factual path', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  let searches = 0;
  let reads = 0;
  const ont = f.open(f.configuration, () => ({
    beginSearch: () => {
      searches++;
    },
    readEvidence: async () => {
      reads++;
      return {};
    },
  }));
  const query = {
    question: 'What is the status of CT-17?',
    typedQuery: {
      sourceSystem: 'clickup',
      objectType: 'ClickupTask',
      externalId: 'CT-17',
      fieldPath: 'status',
    },
  };
  const result = await ont.search(query);
  assert.equal(result.kind, 'OpenOntologySourceNativeProductSearchResultV2');
  assert.equal(result.matches[0].requiredForProof, true);
  assert.equal((await ont.read({ ref: result.matches[0].ref })).exactText, 'open');
  assert.equal((await ont.verify(query)).answerable, true);
  assert.equal(searches, 2);
  assert.equal(reads, 2);
  const status = ont.status();
  assert.equal(status.construction.activeRecordCount, 1);
  assert.equal('activeRecords' in status.construction, false);
  assert.equal(JSON.stringify(status).includes('signatureBase64'), false);
});

test('protected history rewind invalidates reads and explicit recovery restores accepted navigation', async (t) => {
  const f = fixture(t, { protectedHistory: true });
  const original = f.record();
  f.write(original);
  const old = f.state.store.readRefMetadata(f.route);
  const input = clone(f.input);
  input.claims = input.claims.slice(0, 2);
  f.write(f.record(f.compile(input), { day: 4, targets: [original.recordSha256] }));
  const ont = f.open();
  const offered = await ont.search({ term: 'AllocationException' });
  const current = f.state.store.readRefMetadata(f.route);
  f.backend.compareAndSwap(current.key, {
    expectedVersion: current.version,
    bytes: Buffer.from(kernel.stableObjectText(old.ref)),
  });
  await assert.rejects(ont.read({ ref: offered.matches[0].ref }), {
    code: 'CONSTRUCTION_NAVIGATION_REFERENCE_INELIGIBLE',
  });
  assert.equal(
    (await ont.search({ term: 'AllocationException' })).state,
    'unavailable-construction-navigation',
  );
  f.state.store.recoverRefHistory(f.route);
  assert.equal((await ont.search({ term: 'AllocationException' })).totalMatches, 2);
});

test('new source clients do not inherit prior-cut maps while an existing client remains explicitly pinned', async (t) => {
  const f = fixture(t);
  f.write(f.record());
  const pinned = f.open();
  const nextOptions = { artifactRoot: join(f.root, 'next') };
  const nextInput = clone(f.buildInput);
  nextInput.sources[0].occurredAt = at(4);
  kernel.buildSourceNativeProduct({
    ...nextOptions,
    objectBackendUri: f.objectBackendUri,
    input: nextInput,
  });
  const current = kernel.openSourceNativeProductWithConstruction(nextOptions, f.configuration);
  const result = await current.search({ term: 'AllocationException' });
  assert.equal(result.totalMatches, 0);
  const old = await pinned.search({ term: 'AllocationException' });
  assert.equal(old.totalMatches, 3);
  assert.notEqual(old.sourceCommitSha256, result.sourceCommitSha256);
});

test('historical construction navigation reopens A after the source client advances to B', async (t) => {
  const f = fixture(t);
  const original = f.record();
  f.write(original);
  const nextOptions = { artifactRoot: join(f.root, 'historical-next') };
  const nextInput = clone(f.buildInput);
  nextInput.sources[0] = { ...nextInput.sources[0], occurredAt: at(4) };
  kernel.buildSourceNativeProduct({
    ...nextOptions,
    objectBackendUri: f.objectBackendUri,
    input: nextInput,
  });

  const historical = kernel.openSourceNativeProductWithConstruction(f.options, {
    ...f.configuration,
    historical: true,
  });
  assert.equal(historical.status().cutSelection, 'exact-artifact');
  const page = await historical.search({ term: 'AllocationException', limit: 4 });
  assert.equal(page.state, 'resolved-construction-navigation');
  assert.equal(page.sourceCommitSha256, f.state.objectOnt.commitSha256);
  const exact = await historical.read({ ref: page.matches[0].ref });
  assert.equal(exact.binding.navigationOnly, true);
  assert.equal(exact.binding.admissionRecordSha256, original.recordSha256);
  assert.equal(
    exact.exactText,
    f.buildInput.sources.find((source) => source.relativePath === exact.evidence.sourceRef).content,
  );
});

for (const [name, input] of [
  ['empty term', { term: '' }],
  ['oversized term', { term: 'a'.repeat(257) }],
  ['mixed query', { term: 'AllocationException', question: 'What is true?' }],
  ['namespace override', { term: 'AllocationException', scope: { namespace: 'other' } }],
  [
    'object type without source',
    { term: 'AllocationException', scope: { objectType: 'ClickupTask' } },
  ],
  ['unknown key', { term: 'AllocationException', predicate: 'sameAs' }],
  ['oversized page', { term: 'AllocationException', limit: 65 }],
  ['zero page', { term: 'AllocationException', limit: 0 }],
  ['fractional page', { term: 'AllocationException', limit: 1.5 }],
  ['bad concept ID', { term: 'AllocationException', conceptId: '../other' }],
])
  test(`construction search refuses ${name}`, async (t) => {
    const f = fixture(t);
    await assert.rejects(f.open().search(input), { code: 'CONSTRUCTION_NAVIGATION_INPUT' });
  });
