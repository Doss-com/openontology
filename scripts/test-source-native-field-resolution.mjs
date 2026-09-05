import assert from 'node:assert/strict';
import test from 'node:test';

import { objectBytesSha256 } from '../dist/src/canonical-content.mjs';
import { compileSourceNativeObjectMap } from '../dist/src/source-native-object-map.mjs';
import {
  resolveSourceNativeField,
  resolveSourceNativeFieldSuccessor,
} from '../dist/src/source-native-field-resolution.mjs';

function source(relativePath, occurredAt, content, sourceType = 'clickup') {
  return {
    relativePath,
    sourceType,
    occurredAt,
    content,
    sourceSha256: objectBytesSha256(Buffer.from(content)),
  };
}

function nativeObject(sourceRow, externalId, value, namespace = 'acme', {
  sourceSystem = 'clickup',
  objectType = 'task',
  fieldPath = 'title',
} = {}) {
  return {
    relativePath: sourceRow.relativePath,
    objectIdentity: {
      home: 'ObjectDef/InstanceRef',
      sourceSystem,
      objectType,
      namespace,
      externalId,
    },
    fields: [{
      fieldPath,
      value,
      codeUnitStart: sourceRow.content.indexOf(value),
    }],
  };
}

test('uses a stale seed to traverse one native identity to its current field', () => {
  const oldSource = source(
    'clickup/acme/old.md',
    '2026-01-01T00:00:00.000Z',
    '# Obsolete title\n',
  );
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

test('refuses an explicit identity that retrieval did not seed', () => {
  const seeded = source('clickup/acme/seed.md', '2026-01-01T00:00:00.000Z', '# Seeded object\n');
  const requested = source('clickup/acme/requested.md', '2026-02-01T00:00:00.000Z', '# Requested object\n');
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
  assert.equal(result.state, 'unavailable-native-object-not-seeded');
  assert.equal(result.current, null);
});

test('binds a large revision closure without emitting every intermediate revision', () => {
  const sources = Array.from({ length: 40 }, (_, index) => source(
    `clickup/acme/version-${String(index).padStart(2, '0')}.md`,
    new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    `# State ${index}\n`,
  ));
  const map = compileSourceNativeObjectMap({
    sources,
    nativeObjectInputs: sources.map((row, index) =>
      nativeObject(row, 'task-1', `State ${index}`)),
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
