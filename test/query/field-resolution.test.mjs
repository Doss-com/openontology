import assert from 'node:assert/strict';
import test from 'node:test';

import { objectBytesSha256 } from '../../dist/canonical-content.js';
import { compileSourceNativeObjectMap } from '../../dist/source/object-map.js';
import {
  resolveSourceNativeField,
  resolveSourceNativeFieldSuccessor,
} from '../../dist/query/field-resolution.js';
import { compileSourceNativeCurrentFieldChronologyVerification } from '../../dist/query/verification/current-field.js';

function source(relativePath, occurredAt, content, sourceType = 'clickup') {
  return {
    relativePath,
    sourceType,
    occurredAt,
    content,
    sourceSha256: objectBytesSha256(Buffer.from(content)),
  };
}

function nativeObject(
  sourceRow,
  externalId,
  value,
  namespace = 'acme',
  { sourceSystem = 'clickup', objectType = 'task', fieldPath = 'title' } = {},
) {
  return {
    relativePath: sourceRow.relativePath,
    objectIdentity: {
      home: 'ObjectDef/InstanceRef',
      sourceSystem,
      objectType,
      namespace,
      externalId,
    },
    fields: [
      {
        fieldPath,
        value,
        codeUnitStart: sourceRow.content.indexOf(value),
      },
    ],
  };
}

test('uses a stale seed to traverse one native identity to its current field', () => {
  const oldSource = source('clickup/acme/old.md', '2026-01-01T00:00:00.000Z', '# Obsolete title\n');
  const currentSource = source(
    'clickup/acme/current.md',
    '2026-02-01T00:00:00.000Z',
    '# Current title\n',
  );
  const otherTenantSource = source(
    'clickup/other/later.md',
    '2026-03-01T00:00:00.000Z',
    '# Other tenant title\n',
  );
  const map = compileSourceNativeObjectMap({
    sources: [oldSource, currentSource, otherTenantSource],
    nativeObjectInputs: [
      nativeObject(oldSource, 'task-1', 'Obsolete title'),
      nativeObject(currentSource, 'task-1', 'Current title'),
      nativeObject(otherTenantSource, 'task-1', 'Other tenant title', 'other'),
    ],
  });

  const result = resolveSourceNativeField({
    sourceNativeObjectMap: map,
    seedRelativePaths: [otherTenantSource.relativePath, oldSource.relativePath],
    query: {
      namespace: 'acme',
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'task-1',
      fieldPath: 'title',
    },
  });

  assert.equal(result.state, 'resolved-current-field');
  assert.equal(result.current.objectIdentity.namespace, 'acme');
  assert.equal(result.current.value, 'Current title');
  assert.deepEqual(result.expandedRelativePaths, [currentSource.relativePath]);
  assert.deepEqual(result.suppressedRelativePaths, [oldSource.relativePath]);
  assert.equal(result.revisionPath[0].relationType, 'supersedes');
});

test('uses a unique typed scope when retrieval misses, but refuses an ambiguous scope', () => {
  const analyticsOld = source(
    'supabase/acme/analytics-old.md',
    '2026-01-01T00:00:00.000Z',
    'userEvents: 212207\n',
    'supabase',
  );
  const analyticsCurrent = source(
    'supabase/acme/analytics-current.md',
    '2026-02-01T00:00:00.000Z',
    'userEvents: 75721\n',
    'supabase',
  );
  const unrelated = source(
    'clickup/other/plan.md',
    '2026-03-01T00:00:00.000Z',
    '# Customer analytics rollout plan\n',
  );
  const uniqueMap = compileSourceNativeObjectMap({
    sources: [analyticsOld, analyticsCurrent, unrelated],
    nativeObjectInputs: [
      nativeObject(analyticsOld, 'customer-analytics', '212207', 'acme', {
        sourceSystem: 'supabase',
        objectType: 'customer-analytics',
        fieldPath: 'userEvents',
      }),
      nativeObject(analyticsCurrent, 'customer-analytics', '75721', 'acme', {
        sourceSystem: 'supabase',
        objectType: 'customer-analytics',
        fieldPath: 'userEvents',
      }),
      nativeObject(unrelated, 'plan-1', 'Customer analytics rollout plan', 'other'),
    ],
  });

  const resolved = resolveSourceNativeField({
    sourceNativeObjectMap: uniqueMap,
    seedRelativePaths: [unrelated.relativePath],
    query: {
      namespace: 'acme',
      sourceSystem: 'supabase',
      objectType: 'customer-analytics',
      fieldPath: 'userEvents',
    },
  });
  assert.equal(resolved.state, 'resolved-current-field');
  assert.equal(resolved.query.externalId, 'customer-analytics');
  assert.equal(resolved.current.value, '75721');

  const other = source(
    'supabase/acme/other.md',
    '2026-02-02T00:00:00.000Z',
    'userEvents: 19\n',
    'supabase',
  );
  const ambiguousMap = compileSourceNativeObjectMap({
    sources: [analyticsCurrent, other, unrelated],
    nativeObjectInputs: [
      nativeObject(analyticsCurrent, 'customer-analytics', '75721', 'acme', {
        sourceSystem: 'supabase',
        objectType: 'customer-analytics',
        fieldPath: 'userEvents',
      }),
      nativeObject(other, 'other-analytics', '19', 'acme', {
        sourceSystem: 'supabase',
        objectType: 'customer-analytics',
        fieldPath: 'userEvents',
      }),
      nativeObject(unrelated, 'plan-1', 'Customer analytics rollout plan', 'other'),
    ],
  });
  const refused = resolveSourceNativeField({
    sourceNativeObjectMap: ambiguousMap,
    seedRelativePaths: [unrelated.relativePath],
    query: {
      namespace: 'acme',
      sourceSystem: 'supabase',
      objectType: 'customer-analytics',
      fieldPath: 'userEvents',
    },
  });
  assert.equal(refused.state, 'unavailable-native-object-scope-ambiguous');
  assert.equal(refused.current, null);
});

test('counts every scoped identity instead of trusting a singleton seed', () => {
  const selected = source(
    'clickup/acme/selected.md',
    '2026-01-01T00:00:00.000Z',
    '# Selected title\n',
  );
  const missingField = source(
    'clickup/acme/missing-field.md',
    '2026-01-02T00:00:00.000Z',
    '# Owner beta\n',
  );
  const competing = source(
    'clickup/acme/competing.md',
    '2026-01-03T00:00:00.000Z',
    '# Competing title\n',
  );
  const map = compileSourceNativeObjectMap({
    sources: [selected, missingField, competing],
    nativeObjectInputs: [
      nativeObject(selected, 'zone-a', 'Selected title', 'acme', {
        sourceSystem: 'clickup',
        objectType: 'zone',
        fieldPath: 'title',
      }),
      nativeObject(missingField, 'zone-b', 'Owner beta', 'acme', {
        sourceSystem: 'clickup',
        objectType: 'zone',
        fieldPath: 'owner',
      }),
      nativeObject(competing, 'zone-c', 'Competing title', 'acme', {
        sourceSystem: 'clickup',
        objectType: 'zone',
        fieldPath: 'title',
      }),
    ],
  });
  const singletonSeed = resolveSourceNativeField({
    sourceNativeObjectMap: map,
    seedRelativePaths: [selected.relativePath],
    query: {
      namespace: 'acme',
      sourceSystem: 'clickup',
      objectType: 'zone',
      fieldPath: 'title',
    },
  });
  const emptySeed = resolveSourceNativeField({
    sourceNativeObjectMap: map,
    seedRelativePaths: [],
    query: {
      namespace: 'acme',
      sourceSystem: 'clickup',
      objectType: 'zone',
      fieldPath: 'title',
    },
  });
  assert.equal(singletonSeed.state, 'unavailable-native-object-scope-ambiguous');
  assert.equal(emptySeed.state, 'unavailable-native-object-scope-ambiguous');
  assert.equal(singletonSeed.policy, 'unique-source-native-object-scope-then-field-revision-v1');
  assert.equal(singletonSeed.policy, emptySeed.policy);
  assert.equal(singletonSeed.current, null);
});

test('omitted namespace counts duplicate external IDs across namespaces', () => {
  const alpha = source('clickup/alpha/task.md', '2026-01-01T00:00:00.000Z', '# Shared title\n');
  const beta = source('clickup/beta/task.md', '2026-01-02T00:00:00.000Z', '# Shared title\n');
  const map = compileSourceNativeObjectMap({
    sources: [alpha, beta],
    nativeObjectInputs: [
      nativeObject(alpha, 'shared', 'Shared title', 'alpha'),
      nativeObject(beta, 'shared', 'Shared title', 'beta'),
    ],
  });
  const omittedNamespace = resolveSourceNativeField({
    sourceNativeObjectMap: map,
    seedRelativePaths: [alpha.relativePath],
    query: {
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'shared',
      fieldPath: 'title',
    },
  });
  assert.equal(omittedNamespace.state, 'unavailable-native-object-scope-ambiguous');
  const boundNamespace = resolveSourceNativeField({
    sourceNativeObjectMap: map,
    seedRelativePaths: [],
    query: {
      namespace: 'alpha',
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'shared',
      fieldPath: 'title',
    },
  });
  assert.equal(boundNamespace.state, 'resolved-current-field');
  assert.equal(boundNamespace.current.value, 'Shared title');
});

test('resolves only the immediate field successor and refuses multiple anchors', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# First title\n');
  const second = source('clickup/acme/second.md', '2026-02-01T00:00:00.000Z', '# Second title\n');
  const third = source('clickup/acme/third.md', '2026-03-01T00:00:00.000Z', '# Third title\n');
  const map = compileSourceNativeObjectMap({
    sources: [first, second, third],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'First title'),
      nativeObject(second, 'task-1', 'Second title'),
      nativeObject(third, 'task-1', 'Third title'),
    ],
  });
  const query = {
    namespace: 'acme',
    sourceSystem: 'clickup',
    objectType: 'task',
    externalId: 'task-1',
    fieldPath: 'title',
  };

  const resolved = resolveSourceNativeFieldSuccessor({
    sourceNativeObjectMap: map,
    seedRelativePaths: [first.relativePath],
    query,
  });
  assert.equal(resolved.state, 'resolved-next-field-revision');
  assert.equal(resolved.successor.value, 'Second title');
  assert.notEqual(resolved.successor.value, 'Third title');

  const refused = resolveSourceNativeFieldSuccessor({
    sourceNativeObjectMap: map,
    seedRelativePaths: [first.relativePath, second.relativePath],
    query,
  });
  assert.equal(refused.state, 'unavailable-native-field-successor-ambiguous');
  assert.equal(refused.successor, null);
});

test('resolves an explicit identity that retrieval did not seed', () => {
  const seeded = source('clickup/acme/seed.md', '2026-01-01T00:00:00.000Z', '# Seeded object\n');
  const requested = source(
    'clickup/acme/requested.md',
    '2026-02-01T00:00:00.000Z',
    '# Requested object\n',
  );
  const map = compileSourceNativeObjectMap({
    sources: [seeded, requested],
    nativeObjectInputs: [
      nativeObject(seeded, 'task-1', 'Seeded object'),
      nativeObject(requested, 'task-2', 'Requested object'),
    ],
  });
  const result = resolveSourceNativeField({
    sourceNativeObjectMap: map,
    seedRelativePaths: [seeded.relativePath],
    query: {
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'task-2',
      fieldPath: 'title',
    },
  });
  assert.equal(result.state, 'resolved-current-field');
  assert.equal(result.current.value, 'Requested object');
});

test('binds a large revision closure without emitting every intermediate revision', () => {
  const sources = Array.from({ length: 40 }, (_, index) =>
    source(
      `clickup/acme/version-${String(index).padStart(2, '0')}.md`,
      new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      `# State ${index}\n`,
    ),
  );
  const map = compileSourceNativeObjectMap({
    sources,
    nativeObjectInputs: sources.map((row, index) => nativeObject(row, 'task-1', `State ${index}`)),
  });
  const result = resolveSourceNativeField({
    sourceNativeObjectMap: map,
    seedRelativePaths: [sources[0].relativePath],
    query: {
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'task-1',
      fieldPath: 'title',
    },
  });

  assert.equal(result.revisionClosureCount, 39);
  assert.equal(result.revisionPath.length, 1);
  assert.equal(result.revisionPath[0].targetField.value, 'State 0');
  assert.equal(result.revisionPath[0].sourceField.value, 'State 39');
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 5000);
});

test('verifies current field chronology only over a complete bound source cut', () => {
  const first = source('clickup/acme/first.md', '2026-01-01T00:00:00.000Z', '# First title\n');
  const current = source(
    'clickup/acme/current.md',
    '2026-02-01T00:00:00.000Z',
    '# Current title\n',
  );
  const unsupported = source(
    'slack/acme/unmapped.md',
    '2026-03-01T00:00:00.000Z',
    'Mentioned task-1.\n',
    'slack',
  );
  const query = {
    namespace: 'acme',
    sourceSystem: 'clickup',
    objectType: 'task',
    externalId: 'task-1',
    fieldPath: 'title',
  };
  const completeMap = compileSourceNativeObjectMap({
    sources: [first, current],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'First title'),
      nativeObject(current, 'task-1', 'Current title'),
    ],
  });
  const completeResolution = resolveSourceNativeField({
    sourceNativeObjectMap: completeMap,
    seedRelativePaths: [first.relativePath],
    query,
  });
  const binding = (sourceRows) => ({
    sourceCommitSha256: objectBytesSha256(Buffer.from('commit')),
    sourceReplaySha256: objectBytesSha256(Buffer.from('replay')),
    sourceCatalogSha256: objectBytesSha256(Buffer.from('catalog')),
    sourceHandles: sourceRows.map((row, sourceMessageId) => ({
      sourceMessageId,
      relativePath: row.relativePath,
    })),
  });
  const verified = compileSourceNativeCurrentFieldChronologyVerification({
    sourceNativeObjectMap: completeMap,
    resolution: completeResolution,
    ...binding([first, current]),
  });
  assert.equal(verified.proofDisposition, 'sufficient');
  assert.equal(verified.state, 'verified-complete-recorded-field-chronology');
  assert.equal(verified.identityObservationCount, 2);
  assert.equal(verified.fieldObservationCount, 2);
  assert.equal(verified.fieldRevisionCount, 1);
  assert.equal(verified.currentFieldSha256, completeResolution.current.fieldSha256);
  assert.equal(verified.fieldResolutionSha256, completeResolution.resolutionSha256);
  assert.deepEqual(verified.unmetRequirements, []);
  assert.match(verified.verificationSha256, /^sha256:[0-9a-f]{64}$/u);

  const wrongHandles = binding([first, current]);
  wrongHandles.sourceHandles[1] = {
    sourceMessageId: 1,
    relativePath: 'clickup/acme/not-the-bound-source.md',
  };
  const handleMismatch = compileSourceNativeCurrentFieldChronologyVerification({
    sourceNativeObjectMap: completeMap,
    resolution: completeResolution,
    ...wrongHandles,
  });
  assert.equal(handleMismatch.proofDisposition, 'insufficient');
  assert.deepEqual(handleMismatch.unmetRequirements, ['complete-source-coverage']);

  const incompleteMap = compileSourceNativeObjectMap({
    sources: [first, current, unsupported],
    nativeObjectInputs: [
      nativeObject(first, 'task-1', 'First title'),
      nativeObject(current, 'task-1', 'Current title'),
    ],
  });
  const incompleteResolution = resolveSourceNativeField({
    sourceNativeObjectMap: incompleteMap,
    seedRelativePaths: [first.relativePath],
    query,
  });
  const insufficient = compileSourceNativeCurrentFieldChronologyVerification({
    sourceNativeObjectMap: incompleteMap,
    resolution: incompleteResolution,
    ...binding([first, current, unsupported]),
  });
  assert.equal(insufficient.proofDisposition, 'insufficient');
  assert.equal(insufficient.state, 'unverified-incomplete-recorded-field-chronology');
  assert.deepEqual(insufficient.unmetRequirements, ['complete-source-coverage']);
  assert.equal(insufficient.currentFieldSha256, incompleteResolution.current.fieldSha256);

  const tiedLeft = source(
    'clickup/acme/tied-left.md',
    '2026-04-01T00:00:00.000Z',
    '# Display left\n',
  );
  const tiedRight = source(
    'clickup/acme/tied-right.md',
    '2026-04-01T00:00:00.000Z',
    '# Display right\n',
  );
  const tiedObjects = [
    nativeObject(tiedLeft, 'task-1', 'Display left'),
    nativeObject(tiedRight, 'task-1', 'Display right'),
  ];
  tiedObjects[0].fields[0].canonicalValue = { normalized: 'same' };
  tiedObjects[1].fields[0].canonicalValue = { normalized: 'same' };
  const tiedMap = compileSourceNativeObjectMap({
    sources: [tiedLeft, tiedRight],
    nativeObjectInputs: tiedObjects,
  });
  const tiedResolution = resolveSourceNativeField({
    sourceNativeObjectMap: tiedMap,
    seedRelativePaths: [tiedLeft.relativePath],
    query,
  });
  const tied = compileSourceNativeCurrentFieldChronologyVerification({
    sourceNativeObjectMap: tiedMap,
    resolution: tiedResolution,
    ...binding([tiedLeft, tiedRight]),
  });
  assert.equal(tied.proofDisposition, 'insufficient');
  assert.deepEqual(tied.unmetRequirements, ['unique-latest-field-value']);

  const duplicateA = source('clickup/acme/a.md', '2026-05-01T00:00:00.000Z', '# Same title\n');
  const duplicateB = source('clickup/acme/B.md', '2026-05-01T00:00:00.000Z', '# Same title\n');
  const duplicateMap = compileSourceNativeObjectMap({
    sources: [duplicateA, duplicateB],
    nativeObjectInputs: [
      nativeObject(duplicateA, 'task-1', 'Same title'),
      nativeObject(duplicateB, 'task-1', 'Same title'),
    ],
  });
  const duplicateResolution = resolveSourceNativeField({
    sourceNativeObjectMap: duplicateMap,
    seedRelativePaths: [duplicateB.relativePath],
    query,
  });
  const duplicate = compileSourceNativeCurrentFieldChronologyVerification({
    sourceNativeObjectMap: duplicateMap,
    resolution: duplicateResolution,
    ...binding([duplicateA, duplicateB]),
  });
  assert.equal(duplicate.proofDisposition, 'sufficient');
});
