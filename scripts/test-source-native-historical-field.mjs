import assert from 'node:assert/strict';
import test from 'node:test';

import { objectBytesSha256, stableObjectSha256 } from '../dist/src/canonical-content.mjs';
import { compileSourceNativeObjectMap } from '../dist/src/source-native-object-map.mjs';
import {
  normalizeSourceNativeHistoricalTime,
  resolveSourceNativeFieldAt,
} from '../dist/src/source-native-historical-field.mjs';

function source(relativePath, occurredAt, content, sourceType = 'clickup') {
  return {
    relativePath,
    sourceType,
    occurredAt,
    content,
    sourceSha256: objectBytesSha256(Buffer.from(content)),
  };
}

function nativeObject(sourceRow, externalId, value, namespace = 'acme', options = {}) {
  return {
    relativePath: sourceRow.relativePath,
    objectIdentity: {
      home: 'ObjectDef/InstanceRef',
      sourceSystem: options.sourceSystem ?? 'clickup',
      objectType: options.objectType ?? 'task',
      namespace,
      externalId,
    },
    fields: [{
      fieldPath: options.fieldPath ?? 'title',
      value,
      codeUnitStart: sourceRow.content.indexOf(value),
      ...(options.validAt === undefined ? {} : { validAt: options.validAt }),
      ...(options.knownAt === undefined ? {} : { knownAt: options.knownAt }),
      ...(options.propositionFamilyKey === undefined ? {} : { propositionFamilyKey: options.propositionFamilyKey }),
      ...(options.canonicalProposition === undefined ? {} : { canonicalProposition: options.canonicalProposition }),
      ...(options.canonicalValue === undefined ? {} : { canonicalValue: options.canonicalValue }),
    }],
  };
}

test('selects the field valid at the requested instant and reports the complete native closure', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# First title\n');
  const second = source('clickup/acme/second.md', '2026-02-01T00:00:00.000Z', '# Second title\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, second],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'First title'),
      nativeObject(second, 'task-1', 'Second title'),
    ],
  });
  const query = {
    namespace: 'acme',
    sourceSystem: 'clickup',
    objectType: 'task',
    externalId: 'task-1',
    fieldPath: 'title',
  };
  const at = '2026-01-15T00:00:00.000Z';

  const result = resolveSourceNativeFieldAt({ sourceNativeObjectMap: map, query, at });

  assert.equal(result.state, 'resolved-historical-field');
  assert.deepEqual(result.query, query);
  assert.equal(result.at, at);
  assert.equal(result.selected.value, 'First title');
  assert.equal(result.selected.validAt, first.occurredAt);
  assert.equal(result.selected.knownAt, first.occurredAt);
  assert.equal(result.sourceObservedThrough, second.occurredAt);
  assert.equal(result.observationClosureCount, 2);
  assert.equal(result.observationClosureSha256, stableObjectSha256(map.nativeObjects.map((row) => row.nativeObjectSha256)));
  assert.equal(result.revisionClosureCount, 1);
  assert.equal(result.revisionClosureSha256, stableObjectSha256(map.fieldRevisions.map((row) => row.revisionSha256)));
  assert.deepEqual(result.applicableRevisionSha256s, []);
  assert.deepEqual(result.activeSupersessionIds, []);
  assert.equal(result.complete, true);
  assert.equal(result.ambiguous, false);
  assert.equal(result.temporalProfile, 'source-native-basic-retrospective-v1');
  assert.equal(result.derivedValidAtFieldCount, 2);
  assert.match(result.resolutionSha256, /^sha256:[0-9a-f]{64}$/u);
});

test('uses observed time order rather than mutable native-object array order', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# First title\n');
  const second = source('clickup/acme/second.md', '2026-02-01T00:00:00.000Z', '# Second title\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, second],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'First title'),
      nativeObject(second, 'task-1', 'Second title'),
    ],
  });
  const { nativeObjectMapSha256: ignored, ...mapCore } = map;
  const reorderedCore = { ...mapCore, nativeObjects: [...map.nativeObjects].reverse() };
  const reorderedMap = {
    ...reorderedCore,
    nativeObjectMapSha256: stableObjectSha256(reorderedCore),
  };
  const query = { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' };
  const original = resolveSourceNativeFieldAt({ sourceNativeObjectMap: map, query, at: '2026-01-15T00:00:00.000Z' });
  const reordered = resolveSourceNativeFieldAt({ sourceNativeObjectMap: reorderedMap, query, at: '2026-01-15T00:00:00.000Z' });
  assert.equal(reordered.selected.relativePath, original.selected.relativePath);
  assert.equal(reordered.selected.value, original.selected.value);
  assert.equal(reordered.observationClosureSha256, original.observationClosureSha256);
  assert.equal(reordered.revisionClosureSha256, original.revisionClosureSha256);
});

test('normalizes only exact UTC millisecond timestamps', () => {
  assert.equal(normalizeSourceNativeHistoricalTime('2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
  assert.throws(() => normalizeSourceNativeHistoricalTime('2026-01-01T00:00:00Z'), /SOURCE_NATIVE_HISTORICAL_TIME/);
  assert.throws(() => normalizeSourceNativeHistoricalTime('2026-02-30T00:00:00.000Z'), /SOURCE_NATIVE_HISTORICAL_TIME/);
  assert.throws(() => normalizeSourceNativeHistoricalTime('2026-13-01T00:00:00.000Z'), /SOURCE_NATIVE_HISTORICAL_TIME/);
  assert.throws(() => normalizeSourceNativeHistoricalTime('2026-01-01T00:00:00.000+00:00'), /SOURCE_NATIVE_HISTORICAL_TIME/);
});

test('computes the native horizon by parsed source time, including offset timestamps', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T01:00:00.000+01:00', '# First title\n');
  const second = source('clickup/acme/second.md', '2026-01-01T00:30:00.000Z', '# Second title\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, second],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'First title'),
      nativeObject(second, 'task-1', 'Second title'),
    ],
  });
  const result = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map,
    query: { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' },
    at: '2026-01-01T00:30:00.000Z',
  });
  assert.equal(result.sourceObservedThrough, second.occurredAt);
  assert.equal(result.selected.value, 'Second title');
});

test('distinguishes not-yet-valid and beyond-source-horizon requests', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# First title\n');
  const last = source('clickup/acme/last.md', '2026-02-01T00:00:00.000Z', '# Last title\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, last],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'First title'),
      nativeObject(last, 'task-1', 'Last title'),
    ],
  });
  const query = { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' };

  const before = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map, query, at: '2025-12-31T23:59:59.999Z',
  });
  assert.equal(before.state, 'unavailable-native-historical-field-not-yet-valid');
  assert.equal(before.selected, null);

  const after = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map, query, at: '2026-02-01T00:00:00.001Z',
  });
  assert.equal(after.state, 'unavailable-native-historical-field-beyond-source-horizon');
  assert.equal(after.sourceObservedThrough, last.occurredAt);
  assert.equal(after.selected, null);
});

test('uses declared valid and known times while retaining a native observation horizon', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# First title\n');
  const correction = source('clickup/acme/correction.md', '2026-02-01T00:00:00.000Z', '# Corrected title\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, correction],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'First title', 'acme', {
        validAt: '2026-01-10T00:00:00.000Z',
        knownAt: '2026-01-20T00:00:00.000Z',
      }),
      nativeObject(correction, 'task-1', 'Corrected title', 'acme', {
        validAt: '2026-01-05T00:00:00.000Z',
        knownAt: '2026-02-02T00:00:00.000Z',
      }),
    ],
  });
  const query = { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' };
  const result = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map, query, at: '2026-01-07T00:00:00.000Z',
  });
  assert.equal(result.state, 'resolved-historical-field');
  assert.equal(result.selected.value, 'Corrected title');
  assert.equal(result.selected.validAt, '2026-01-05T00:00:00.000Z');
  assert.equal(result.selected.knownAt, '2026-02-02T00:00:00.000Z');
  assert.equal(result.derivedValidAtFieldCount, 0);
});

test('does not bridge an ineligible intermediate revision', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# A\n');
  const second = source('clickup/acme/second.md', '2026-01-11T00:00:00.000Z', '# B\n');
  const third = source('clickup/acme/third.md', '2026-01-12T00:00:00.000Z', '# C\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, second, third],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'A', 'acme', { validAt: '2026-01-01T00:00:00.000Z' }),
      nativeObject(second, 'task-1', 'B', 'acme', { validAt: '2026-01-10T00:00:00.000Z' }),
      nativeObject(third, 'task-1', 'C', 'acme', { validAt: '2026-01-05T00:00:00.000Z' }),
    ],
  });
  const query = { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' };
  const atSeven = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map, query, at: '2026-01-07T00:00:00.000Z',
  });
  assert.equal(atSeven.state, 'unavailable-native-historical-field-ambiguous');
  assert.equal(atSeven.ambiguous, true);

  const atTen = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map, query, at: '2026-01-10T00:00:00.000Z',
  });
  assert.equal(atTen.state, 'resolved-historical-field');
  assert.equal(atTen.selected.value, 'C');
  assert.equal(atTen.activeSupersessionIds.length, 2);
});

test('collapses only consecutive equivalent observations and chooses the latest eligible representative', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# A\n');
  const repeat = source('clickup/acme/repeat.md', '2026-01-02T00:00:00.000Z', '# A\n');
  const changed = source('clickup/acme/changed.md', '2026-01-03T00:00:00.000Z', '# B\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, repeat, changed],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'A'),
      nativeObject(repeat, 'task-1', 'A'),
      nativeObject(changed, 'task-1', 'B'),
    ],
  });
  const query = { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' };
  const before = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map, query, at: '2026-01-02T23:59:59.999Z',
  });
  assert.equal(before.selected.value, 'A');
  assert.equal(before.selected.relativePath, repeat.relativePath);

  const after = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map, query, at: '2026-01-03T00:00:00.000Z',
  });
  assert.equal(after.selected.value, 'B');
  assert.equal(after.activeSupersessionIds.length, 1);
});

test('retains a returned state after an intervening state and follows both eligible direct edges', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# A\n');
  const middle = source('clickup/acme/middle.md', '2026-01-02T00:00:00.000Z', '# B\n');
  const returned = source('clickup/acme/returned.md', '2026-01-03T00:00:00.000Z', '# A\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, middle, returned],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'A'),
      nativeObject(middle, 'task-1', 'B'),
      nativeObject(returned, 'task-1', 'A'),
    ],
  });
  const result = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map,
    query: { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' },
    at: returned.occurredAt,
  });
  assert.equal(result.state, 'resolved-historical-field');
  assert.equal(result.selected.relativePath, returned.relativePath);
  assert.equal(result.activeSupersessionIds.length, 2);
});

test('retains same-display observations with different canonical metadata as ambiguity', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# Same\n');
  const second = source('clickup/acme/second.md', '2026-01-02T00:00:00.000Z', '# Same\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, second],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'Same', 'acme', { canonicalValue: 'one' }),
      nativeObject(second, 'task-1', 'Same', 'acme', { canonicalValue: 'two' }),
    ],
  });
  const result = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: map,
    query: { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' },
    at: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(result.state, 'unavailable-native-historical-field-ambiguous');
  assert.equal(result.revisionClosureCount, 0);
});

test('refuses incomplete coverage, adapter diagnostics, and a hash-consistent missing revision', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# First title\n');
  const second = source('clickup/acme/second.md', '2026-02-01T00:00:00.000Z', '# Second title\n');
  const inputs = [nativeObject(first, 'task-1', 'First title'), nativeObject(second, 'task-1', 'Second title')];
  const incompleteMap = compileSourceNativeObjectMap({
    sources: [first, second], nativeObjectInputs: [inputs[0]],
  });
  const query = { namespace: 'acme', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title' };
  const incomplete = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: incompleteMap, query, at: '2026-01-15T00:00:00.000Z',
  });
  assert.equal(incomplete.state, 'unavailable-incomplete-recorded-field-chronology');
  assert.equal(incomplete.selected, null);
  assert.equal(incomplete.complete, false);

  const diagnosedMap = compileSourceNativeObjectMap({
    sources: [first, second], nativeObjectInputs: inputs, adapterDiagnostics: [{ code: 'ADAPTER_FAILURE' }],
  });
  const diagnosed = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: diagnosedMap, query, at: '2026-01-15T00:00:00.000Z',
  });
  assert.equal(diagnosed.state, 'unavailable-incomplete-recorded-field-chronology');

  const { nativeObjectMapSha256: ignored, ...mapCore } = diagnosedMap;
  const missingRevisionCore = { ...mapCore, adapterDiagnostics: [], parseFailureCount: 0,
    fieldRevisions: [], fieldRevisionCount: 0 };
  const missingRevisionMap = {
    ...missingRevisionCore,
    nativeObjectMapSha256: stableObjectSha256(missingRevisionCore),
  };
  const missingRevision = resolveSourceNativeFieldAt({
    sourceNativeObjectMap: missingRevisionMap, query, at: '2026-01-15T00:00:00.000Z',
  });
  assert.equal(missingRevision.state, 'unavailable-incomplete-recorded-field-chronology');
  assert.equal(missingRevision.selected, null);
});
