import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  buildSourceNativeProduct,
  compileSourceNativeSemanticConstruction,
  openProductState,
  openSourceNativeConstructionReview,
  objectBytesSha256,
  stableObjectSha256,
} from '../dist/src/kernel.mjs';
import { constructionInputFor, reviewCases } from './lib/construction-review-fixtures.mjs';

const clone = structuredClone;
const cases = reviewCases();

function materialize(t, fixture) {
  const root = mkdtempSync(join(tmpdir(), 'oont-construction-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { artifactRoot: join(root, 'ont') };
  buildSourceNativeProduct({ ...options, input: fixture.buildInput });
  const state = openProductState(options);
  const input = constructionInputFor(state, fixture.specification);
  const construction = compileSourceNativeSemanticConstruction({ options, input });
  return { root, options, state, input, construction };
}

function expectedItemSources(fixture) {
  return [
    fixture.specification.nameSourceRef,
    ...fixture.specification.aliases.map((alias) => alias.sourceRef),
    ...[...fixture.specification.claims].sort((left, right) =>
      Buffer.compare(Buffer.from(left.id), Buffer.from(right.id))).map((claim) => claim.sourceRef),
  ];
}

function responseFor(session, fixture, decisionOverride = null) {
  const sourceByRef = new Map(session.packet.sources.map((source) => [source.relativePath, source]));
  const sources = expectedItemSources(fixture);
  return {
    packetSha256: session.packet.packetSha256,
    decisions: session.packet.items.map((item, index) => {
      const sourceRef = sources[index];
      const source = sourceByRef.get(sourceRef);
      assert(source, `packet did not include ${sourceRef}`);
      return {
        itemSha256: item.itemSha256,
        decision: decisionOverride ?? fixture.expected[index],
        reason: 'Synthetic protocol judgment with an exact source quotation.',
        citations: [{ sourceRef, quote: source.content }],
      };
    }),
  };
}

function dispositionFor(expected) {
  if (expected.includes('reject')) return 'rejected';
  if (expected.includes('abstain')) return 'needs-review';
  return 'accepted';
}

function assertPacket(t, fixture, materialized, session) {
  const { packet } = session;
  const { construction, state } = materialized;
  assert.equal(packet.schemaVersion, 1);
  assert.equal(packet.kind, 'OpenOntologyConstructionReviewPacketV1');
  assert.equal(packet.constructionSha256, construction.constructionSha256);
  assert.equal(packet.navigationOnly, true);
  assert.equal(packet.exactSourcesRemainAuthority, true);
  assert.deepEqual(packet.coverage, construction.coverage);

  const expectedCount = construction.objectDefs.reduce(
    (count, object) => count + 1 + object.aliases.length, construction.claims.length,
  );
  assert.equal(packet.items.length, expectedCount);
  assert.deepEqual(packet.items.map((item) => item.source.evidence.sourceRef), expectedItemSources(fixture));
  assert.deepEqual(packet.items.map((item) => item.kind), [
    'preferred-name',
    ...fixture.specification.aliases.map(() => 'scoped-alias'),
    ...fixture.specification.claims.map((claim) => claim.predicate),
  ]);

  const sourceByRef = new Map(state.objectOnt.sources.map((source) => [source.relativePath, source]));
  assert.equal(packet.sources.length, new Set(packet.sources.map((source) => source.relativePath)).size);
  for (const source of packet.sources) {
    const original = sourceByRef.get(source.relativePath);
    assert(original, `unknown packet source ${source.relativePath}`);
    assert.equal(source.sourceType, original.sourceType);
    assert.equal(source.occurredAt, original.occurredAt);
    assert.equal(source.sourceSha256, original.sourceSha256);
    assert.equal(source.content, original.content);
  }
  for (const item of packet.items) {
    const { itemSha256: _itemSha256, ...core } = item;
    assert.equal(item.itemSha256, stableObjectSha256(core));
    const native = state.objectOnt.map.nativeObjects.find((object) =>
      object.nativeObjectSha256 === item.source.nativeObjectSha256);
    assert(native);
    assert.deepEqual(item.nativeObject, native.objectIdentity);
  }
  const { packetSha256: _packetSha256, ...packetCore } = packet;
  assert.equal(packet.packetSha256, stableObjectSha256(packetCore));
  assert.equal(Object.isFrozen(packet), true);
  assert.equal(Object.isFrozen(packet.items[0]), true);
  assert.equal(Object.isFrozen(packet.sources[0]), true);
}

test('development cases materialize and compile as source-bound constructions', (t) => {
  assert(cases.length >= 12);
  for (const fixture of cases) {
    const materialized = materialize(t, fixture);
    assert.equal(materialized.construction.objectDefs.length, 1, fixture.id);
    assert.equal(materialized.construction.objectDefs[0].aliases.length, fixture.specification.aliases.length, fixture.id);
    assert.deepEqual(materialized.construction.claims.map((claim) => claim.id),
      fixture.specification.claims.map((claim) => claim.id).sort(), fixture.id);
    assert.equal(materialized.construction.coverage.examinedSourceCount,
      fixture.buildInput.sources.length, fixture.id);
    assert.equal(materialized.construction.coverage.unexaminedSourceCount, 0, fixture.id);
  }
});

test('packets include complete cited source context and a complete item census', (t) => {
  for (const fixture of cases) {
    const materialized = materialize(t, fixture);
    const session = openSourceNativeConstructionReview({
      options: materialized.options,
      construction: materialized.construction,
    });
    assertPacket(t, fixture, materialized, session);
  }
});

test('review sessions expose an immutable response schema bound to one packet', (t) => {
  const fixture = cases.find((item) => item.id === 'explicit-clickup-alias');
  const materialized = materialize(t, fixture);
  const session = openSourceNativeConstructionReview({
    options: materialized.options,
    construction: materialized.construction,
  });
  const schema = session.responseSchema;
  const decisionSchema = schema.properties.decisions.items;
  const citationSchema = decisionSchema.properties.citations.items;
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['packetSha256', 'decisions']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.packetSha256.enum, [session.packet.packetSha256]);
  assert.equal(session.packet.items.length > 1, true);
  assert.equal(session.packet.sources.length > 1, true);
  assert.equal(schema.properties.decisions.type, 'array');
  assert.equal(decisionSchema.type, 'object');
  assert.equal(schema.properties.decisions.minItems, session.packet.items.length);
  assert.equal(schema.properties.decisions.maxItems, session.packet.items.length);
  assert.deepEqual(decisionSchema.required, ['itemSha256', 'decision', 'reason', 'citations']);
  assert.equal(decisionSchema.additionalProperties, false);
  assert.deepEqual(decisionSchema.properties.itemSha256.enum,
    session.packet.items.map((item) => item.itemSha256));
  assert.deepEqual(decisionSchema.properties.decision.enum, ['accept', 'reject', 'abstain']);
  assert.equal(decisionSchema.properties.reason.maxLength, 2048);
  assert.equal(citationSchema.additionalProperties, false);
  assert.equal(decisionSchema.properties.citations.minItems, 1);
  assert.equal(decisionSchema.properties.citations.maxItems, 8);
  assert.deepEqual(citationSchema.properties.sourceRef.enum,
    session.packet.sources.map((source) => source.relativePath));
  assert.equal(citationSchema.properties.quote.maxLength, 4096);
  assert.doesNotMatch(JSON.stringify(schema), /expected|gold|judgment|answer/iu);
  assert.equal(Object.isFrozen(schema), true);
  assert.equal(Object.isFrozen(schema.properties), true);
  assert.equal(Object.isFrozen(decisionSchema.properties.itemSha256.enum), true);
  assert.equal(Object.isFrozen(citationSchema.properties.sourceRef.enum), true);
  assert.throws(() => { schema.properties.packetSha256.enum[0] = 'mutated'; }, TypeError);
  assert.throws(() => { schema.properties.decisions.minItems = 0; }, TypeError);
});

test('synthetic protocol replies produce accepted, rejected and needs-review outcomes', (t) => {
  const observed = new Map();
  for (const fixture of cases) {
    const materialized = materialize(t, fixture);
    const session = openSourceNativeConstructionReview({ options: materialized.options,
      construction: materialized.construction });
    const response = responseFor(session, fixture);
    const result = session.evaluate(response);
    assert.deepEqual(result.decisions.map((decision) => decision.decision), fixture.expected, fixture.id);
    assert.equal(result.acceptedItemCount, fixture.expected.filter((value) => value === 'accept').length, fixture.id);
    assert.equal(result.rejectedItemCount, fixture.expected.filter((value) => value === 'reject').length, fixture.id);
    assert.equal(result.abstainedItemCount, fixture.expected.filter((value) => value === 'abstain').length, fixture.id);
    assert.equal(result.disposition, dispositionFor(fixture.expected), fixture.id);
    assert.equal(result.admissionGranted, false);
    assert.equal(result.navigationOnly, true);
    assert.equal(result.exactSourcesRemainAuthority, true);
    observed.set(fixture.id, result.disposition);
  }
  assert.equal([...observed.values()].filter((value) => value === 'accepted').length > 0, true);
  assert.equal([...observed.values()].filter((value) => value === 'rejected').length > 0, true);
  assert.equal([...observed.values()].filter((value) => value === 'needs-review').length > 0, true);
  assert.equal(observed.size, cases.length);
});

test('review protocol requires the exact packet and complete one-per-item decisions', (t) => {
  const fixture = cases.find((item) => item.id === 'explicit-clickup-alias');
  const materialized = materialize(t, fixture);
  const session = openSourceNativeConstructionReview({ options: materialized.options,
    construction: materialized.construction });
  const valid = responseFor(session, fixture);

  const missing = clone(valid);
  missing.decisions.pop();
  assert.throws(() => session.evaluate(missing), { code: 'CONSTRUCTION_REVIEW_INCOMPLETE' });

  const duplicate = clone(valid);
  duplicate.decisions.push(clone(duplicate.decisions[0]));
  assert.throws(() => session.evaluate(duplicate), { code: 'CONSTRUCTION_REVIEW_DUPLICATE' });

  const unknown = clone(valid);
  unknown.decisions[0].itemSha256 = stableObjectSha256('unknown-review-item');
  assert.throws(() => session.evaluate(unknown), { code: 'CONSTRUCTION_REVIEW_ITEM' });

  const badDecision = clone(valid);
  badDecision.decisions[0].decision = 'maybe';
  assert.throws(() => session.evaluate(badDecision), { code: 'CONSTRUCTION_REVIEW_DECISION' });

  const badQuote = clone(valid);
  badQuote.decisions[0].citations[0].quote = 'not present in this source';
  assert.throws(() => session.evaluate(badQuote), { code: 'CONSTRUCTION_REVIEW_CITATION' });

  const wrongSource = clone(valid);
  const otherSource = session.packet.sources.find(source =>
    source.relativePath !== session.packet.items[0].source.evidence.sourceRef);
  wrongSource.decisions[0].citations = [{ sourceRef: otherSource.relativePath, quote: otherSource.content }];
  assert.throws(() => session.evaluate(wrongSource), { code: 'CONSTRUCTION_REVIEW_CITATION' });

  const wrongPacket = clone(valid);
  wrongPacket.packetSha256 = stableObjectSha256('different-packet');
  assert.throws(() => session.evaluate(wrongPacket), { code: 'CONSTRUCTION_REVIEW_PACKET' });

  const forgedPacket = clone(session.packet);
  forgedPacket.sources[0].content += ' caller mutation';
  const { packetSha256: _forgedHash, ...forgedCore } = forgedPacket;
  forgedPacket.packetSha256 = stableObjectSha256(forgedCore);
  assert.notEqual(forgedPacket.packetSha256, session.packet.packetSha256);
  assert.throws(() => { session.packet.sources[0].content = 'caller mutation'; }, TypeError);
  assert.throws(() => session.evaluate({ ...valid, packetSha256: forgedPacket.packetSha256 }),
    { code: 'CONSTRUCTION_REVIEW_PACKET' });

  const result = session.evaluate(valid);
  assert.deepEqual(session.evaluate({ ...valid, decisions: [...valid.decisions].reverse() }), result);
  valid.decisions[0].citations[0].quote = 'mutated after evaluation';
  assert.notEqual(result.decisions[0].citations[0].quote, valid.decisions[0].citations[0].quote);
  assert.throws(() => { result.decisions[0].citations[0].quote = 'mutation'; }, TypeError);
});

test('empty constructions are not reviewable batches', (t) => {
  const fixture = cases[0];
  const materialized = materialize(t, fixture);
  const empty = compileSourceNativeSemanticConstruction({ options: materialized.options,
    input: { ...materialized.input, objectDefs: [], claims: [] } });
  assert.throws(() => openSourceNativeConstructionReview({ options: materialized.options,
    construction: empty }), { code: 'CONSTRUCTION_REVIEW_EMPTY' });
});

function bodyWitness(state, sourceRef) {
  const objects = state.objectOnt.map.nativeObjects.filter((object) => object.relativePath === sourceRef);
  assert.equal(objects.length, 1);
  const fields = objects[0].fields.filter((field) => field.fieldPath === 'body');
  assert.equal(fields.length, 1);
  const { relativePath, ...evidence } = fields[0].evidence;
  return { nativeObjectSha256: objects[0].nativeObjectSha256,
    evidence: { sourceRef: relativePath, ...evidence } };
}

function allExamined(state) {
  return state.objectOnt.sources.map((source) => ({ sourceRef: source.relativePath,
    sourceSha256: source.sourceSha256, disposition: 'examined' }));
}

test('review limits refuse oversized item, source-document and raw-source budgets', (t) => {
  const base = cases[0];
  const materialized = materialize(t, base);
  const repeatedObjects = Array.from({ length: 64 }, (_, index) => ({
    kind: 'ObjectDef', id: `concept-${String(index).padStart(3, '0')}`,
    name: base.specification.name, source: bodyWitness(materialized.state, base.specification.nameSourceRef), aliases: [],
  }));
  const repeatedClaims = Array.from({ length: 65 }, (_, index) => ({
    kind: 'Claim', id: `claim-${String(index).padStart(3, '0')}`, about: repeatedObjects[0].id,
    predicate: 'defines', source: bodyWitness(materialized.state, base.specification.nameSourceRef),
  }));
  const oversizedItems = compileSourceNativeSemanticConstruction({ options: materialized.options,
    input: { ...materialized.input, objectDefs: repeatedObjects, claims: repeatedClaims } });
  assert.throws(() => openSourceNativeConstructionReview({ options: materialized.options,
    construction: oversizedItems }), { code: 'CONSTRUCTION_REVIEW_LIMIT' });
  const atItemLimit = compileSourceNativeSemanticConstruction({ options: materialized.options,
    input: { ...materialized.input, objectDefs: repeatedObjects, claims: repeatedClaims.slice(0, 64) } });
  assert.equal(openSourceNativeConstructionReview({ options: materialized.options,
    construction: atItemLimit }).packet.items.length, 128);

  const manySources = clone(base.buildInput);
  manySources.sources = [...manySources.sources,
    ...Array.from({ length: 33 }, (_, index) => ({
      relativePath: `docs/census-${String(index).padStart(3, '0')}.md`, sourceType: 'docs',
      occurredAt: '2026-09-01T00:00:00.000Z', content: `Census Concept ${String(index).padStart(3, '0')} is recorded here.`,
    }))];
  manySources.nativeObjectInputs = [...manySources.nativeObjectInputs,
    ...manySources.sources.slice(2).map((source, index) => ({
      relativePath: source.relativePath,
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'docs', objectType: 'Document',
        namespace: 'fixture-namespace', externalId: `census-${String(index).padStart(3, '0')}` },
      fields: [{ fieldPath: 'body', value: source.content, codeUnitStart: 0 }],
    }))];
  const manyRoot = mkdtempSync(join(tmpdir(), 'oont-construction-review-sources-'));
  t.after(() => rmSync(manyRoot, { recursive: true, force: true }));
  const manyOptions = { artifactRoot: join(manyRoot, 'ont') };
  buildSourceNativeProduct({ ...manyOptions, input: manySources });
  const manyState = openProductState(manyOptions);
  const manyObjects = manySources.sources.slice(2).map((source, index) => ({
    kind: 'ObjectDef', id: `census-${String(index).padStart(3, '0')}`,
    name: `Census Concept ${String(index).padStart(3, '0')}`, source: bodyWitness(manyState, source.relativePath), aliases: [],
  }));
  const manyClaims = manyObjects.map((object, index) => ({ kind: 'Claim', id: `definition-${String(index).padStart(3, '0')}`,
    about: object.id, predicate: 'defines', source: object.source }));
  const manyInput = { proposedBy: 'constructor', proposedAt: '2026-09-02T00:00:00.000Z', method: 'authored',
    objectDefs: manyObjects, claims: manyClaims, coverage: allExamined(manyState) };
  const manyConstruction = compileSourceNativeSemanticConstruction({ options: manyOptions, input: manyInput });
  assert.throws(() => openSourceNativeConstructionReview({ options: manyOptions,
    construction: manyConstruction }), { code: 'CONSTRUCTION_REVIEW_LIMIT' });

  const large = clone(base.buildInput);
  const largeRows = Array.from({ length: 5 }, (_, index) => {
    const name = `Context Concept ${String(index).padStart(2, '0')}`;
    return {
      name,
      relativePath: `docs/context-${String(index).padStart(2, '0')}.md`,
      content: `${name} is recorded in this source. ${'context '.repeat(7_500)}`,
    };
  });
  large.sources = [...large.sources, ...largeRows.map((row) => ({
    relativePath: row.relativePath, sourceType: 'docs', occurredAt: '2026-09-01T00:00:00.000Z', content: row.content,
  }))];
  large.nativeObjectInputs = [...large.nativeObjectInputs, ...largeRows.map((row, index) => ({
    relativePath: row.relativePath,
    objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'docs', objectType: 'Document',
      namespace: 'fixture-namespace', externalId: `context-${String(index).padStart(2, '0')}` },
    fields: [{ fieldPath: 'body', value: row.content, codeUnitStart: 0 }],
  }))];
  const largeRoot = mkdtempSync(join(tmpdir(), 'oont-construction-review-bytes-'));
  t.after(() => rmSync(largeRoot, { recursive: true, force: true }));
  const largeOptions = { artifactRoot: join(largeRoot, 'ont') };
  buildSourceNativeProduct({ ...largeOptions, input: large });
  const largeState = openProductState(largeOptions);
  const largeObjects = largeRows.map((row, index) => ({
    kind: 'ObjectDef', id: `concept-large-${String(index).padStart(2, '0')}`,
    name: row.name, source: bodyWitness(largeState, row.relativePath), aliases: [],
  }));
  const largeClaims = largeObjects.map((object, index) => ({ kind: 'Claim',
    id: `claim-large-${String(index).padStart(2, '0')}`, about: object.id,
    predicate: 'defines', source: object.source }));
  const largeInput = { proposedBy: 'constructor', proposedAt: '2026-09-02T00:00:00.000Z', method: 'authored',
    objectDefs: largeObjects, claims: largeClaims, coverage: allExamined(largeState) };
  const largeConstruction = compileSourceNativeSemanticConstruction({ options: largeOptions, input: largeInput });
  assert(largeRows.reduce((total, row) => total + Buffer.byteLength(row.content), 0) > 256 * 1024);
  assert.throws(() => openSourceNativeConstructionReview({ options: largeOptions,
    construction: largeConstruction }), { code: 'CONSTRUCTION_REVIEW_LIMIT' });
});

test('review supplies qualifications outside the exact proposer-selected witness', (t) => {
  const fixture = cases.find(item => item.id === 'negated-equivalence');
  const materialized = materialize(t, fixture);
  const input = clone(materialized.input);
  const definition = input.objectDefs[0];
  const source = materialized.state.objectOnt.sources.find(item => item.relativePath === fixture.specification.nameSourceRef);
  const start = Buffer.byteLength(source.content.slice(0, source.content.indexOf(definition.name)));
  definition.source.evidence = { ...definition.source.evidence, byteStart: start,
    byteEnd: start + Buffer.byteLength(definition.name), textSha256: objectBytesSha256(Buffer.from(definition.name)) };
  const construction = compileSourceNativeSemanticConstruction({ options: materialized.options, input });
  const { packet } = openSourceNativeConstructionReview({ options: materialized.options, construction });
  assert.equal(packet.items[0].source.evidence.byteEnd - packet.items[0].source.evidence.byteStart,
    Buffer.byteLength(definition.name));
  assert.equal(packet.sources[0].content, source.content);
  assert(packet.sources[0].content.includes('not'));
  assert(packet.sources[0].content.length > definition.name.length);
});

test('an open review stays pinned but cannot rebind its construction to an advanced source', (t) => {
  const fixture = cases[0];
  const materialized = materialize(t, fixture);
  const session = openSourceNativeConstructionReview({ options: materialized.options, construction: materialized.construction });
  const response = responseFor(session, fixture);
  const before = session.evaluate(response);
  const nextInput = clone(fixture.buildInput);
  nextInput.sources.forEach(source => { source.occurredAt = '2026-09-03T00:00:00.000Z'; });
  const nextOptions = { artifactRoot: join(materialized.root, 'next'),
    objectBackendUri: pathToFileURL(join(materialized.options.artifactRoot, 'objects')).href };
  buildSourceNativeProduct({ ...nextOptions, input: nextInput });
  assert.throws(() => openSourceNativeConstructionReview({ options: nextOptions,
    construction: materialized.construction }), { code: 'SEMANTIC_CONSTRUCTION_BINDING' });
  assert.throws(() => openSourceNativeConstructionReview({ options: materialized.options,
    construction: materialized.construction }), { code: 'SOURCE_NATIVE_PRODUCT_REF' });
  assert.deepEqual(session.evaluate(response), before);
  assert.equal(before.admissionGranted, false);
});

test('serialized packet budget accounts for JSON expansion without cropping full sources', (t) => {
  const fixture = clone(cases[0]);
  const body = fixture.buildInput.sources[0].content;
  fixture.buildInput.sources[0].content = body + '\u0000'.repeat(200_000);
  // Only the original body is an extracted field. Review still receives the complete source.
  const materialized = materialize(t, fixture);
  assert(Buffer.byteLength(fixture.buildInput.sources[0].content) < 256 * 1024);
  assert.throws(() => openSourceNativeConstructionReview({ options: materialized.options,
    construction: materialized.construction }), { code: 'CONSTRUCTION_REVIEW_LIMIT' });
});

test('serialized response budget applies even when every individual citation is valid', (t) => {
  const fixture = clone(cases[0]);
  const quote = 'x'.repeat(4096);
  fixture.buildInput.sources[0].content += ` ${quote}`;
  fixture.buildInput.nativeObjectInputs[0].fields[0].value = fixture.buildInput.sources[0].content;
  const materialized = materialize(t, fixture);
  const definition = materialized.input.objectDefs[0];
  const construction = compileSourceNativeSemanticConstruction({ options: materialized.options,
    input: { ...materialized.input, objectDefs: Array.from({ length: 32 }, (_, index) =>
      ({ ...definition, id: `concept-${index}`, aliases: [] })), claims: [] } });
  const session = openSourceNativeConstructionReview({ options: materialized.options, construction });
  const response = { packetSha256: session.packet.packetSha256,
    decisions: session.packet.items.map(item => ({ itemSha256: item.itemSha256,
      decision: 'accept', reason: 'Synthetic size control, not semantic judgment.',
      citations: Array.from({ length: 8 }, () => ({ sourceRef: item.source.evidence.sourceRef, quote })) })) };
  assert.throws(() => session.evaluate(response), { code: 'CONSTRUCTION_REVIEW_LIMIT' });
});
