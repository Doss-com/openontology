import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { openOntology } from '../../dist/openontology.js';
import { buildSourceNativeProduct, openSourceNativeProduct } from '../../dist/product/runtime.js';
import { createSourceNativeProductMcpHandler } from '../../dist/product/mcp.js';

const publicCli = resolve(import.meta.dirname, '..', '..', 'dist', 'cli', 'oont.js');

function sourceRow({
  relativePath,
  occurredAt,
  externalId,
  title,
  status,
  body = '',
  includeTitle = true,
}) {
  const content = `Title: ${title}\nStatus: ${status}. ${body}`;
  return {
    relativePath,
    sourceType: 'clickup',
    occurredAt,
    content,
    nativeObjectInput: {
      relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'task',
        namespace: 'acme',
        externalId,
      },
      fields: [
        ...(includeTitle
          ? [{ fieldPath: 'title', value: title, codeUnitStart: content.indexOf(title) }]
          : []),
        { fieldPath: 'status', value: status, codeUnitStart: content.indexOf(status) },
      ],
    },
  };
}

function buildInput({
  targetTitle = 'Quarterly status review',
  latestTargetTitle = targetTitle,
  targetStatus = 'Ready',
  latestStatus = 'Done',
  extraRows = [],
  extraSources = [],
  adapterDiagnostics = [],
} = {}) {
  const rows = [
    sourceRow({
      relativePath: 'clickup/acme/task-1-r1.md',
      occurredAt: '2026-01-01T00:00:00.000Z',
      externalId: 'task-1',
      title: targetTitle,
      status: targetStatus,
    }),
    sourceRow({
      relativePath: 'clickup/acme/task-1-r2.md',
      occurredAt: '2026-02-01T00:00:00.000Z',
      externalId: 'task-1',
      title: latestTargetTitle,
      status: latestStatus,
    }),
    sourceRow({
      relativePath: 'clickup/acme/task-2.md',
      occurredAt: '2026-02-02T00:00:00.000Z',
      externalId: 'task-2',
      title: 'Dependency cleanup',
      status: 'Blocked',
      body: 'The Quarterly status review is mentioned in this dependency note.',
    }),
    ...extraRows,
  ];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'acme-title-binding',
    namespace: 'acme',
    querySchemas: [
      {
        sourceSystem: 'clickup',
        objectType: 'task',
        aliases: ['task'],
        fields: [
          { fieldPath: 'title', aliases: ['title'] },
          { fieldPath: 'status', aliases: ['status'] },
        ],
      },
    ],
    sources: [
      ...rows.map(({ nativeObjectInput: _nativeObjectInput, ...source }) => source),
      ...extraSources,
    ],
    nativeObjectInputs: rows.map(({ nativeObjectInput }) => nativeObjectInput),
    adapterDiagnostics,
  };
}

function buildSingleObjectInput({
  title = 'Quarterly status review',
  status = 'Done',
  aliases = ['task', 'task+record'],
} = {}) {
  const row = sourceRow({
    relativePath: 'clickup/acme/task-1.md',
    occurredAt: '2026-02-01T00:00:00.000Z',
    externalId: 'task-1',
    title,
    status,
  });
  const { nativeObjectInput, ...source } = row;
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'acme-unknown-identifier',
    namespace: 'acme',
    querySchemas: [
      {
        sourceSystem: 'clickup',
        objectType: 'task',
        aliases,
        fields: [
          { fieldPath: 'title', aliases: ['title'] },
          { fieldPath: 'status', aliases: ['status'] },
        ],
      },
    ],
    sources: [source],
    nativeObjectInputs: [nativeObjectInput],
  };
}

async function withProduct(input, callback) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'oont-title-binding-case-'));
  try {
    buildSourceNativeProduct({ artifactRoot, input });
    return await callback(openOntology({ artifactRoot }), artifactRoot);
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
}

test('a declared title binds the intended identity and preserves exact proof', async () => {
  await withProduct(buildInput(), async (product) => {
    const result = await product.verify(
      'What is the current status of the task titled "Quarterly status review"?',
    );
    assert.equal(result.state, 'resolved-current-field');
    assert.equal(result.answerable, true);
    assert.equal(result.query.externalId, 'task-1');
    assert.deepEqual(result.mentionedExternalIds, []);
    assert.deepEqual(
      result.context.map((row) => row.exactText),
      ['Done'],
    );
    assert.equal(result.verification.currentFieldChronology.proofDisposition, 'sufficient');

    const typedReplay = await product.verify({
      question: 'What is the current status of the task titled "Quarterly status review"?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(typedReplay.state, 'resolved-current-field');
    assert.equal(typedReplay.answerable, true);
    assert.equal(typedReplay.verification.queryPlanSha256, result.verification.queryPlanSha256);

    const visibleId = await product.verify({
      question: 'What is the current status of task-1 titled "Quarterly status review"?',
    });
    const typedVisibleId = await product.verify({
      question: 'What is the current status of task-1 titled "Quarterly status review"?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(visibleId.state, 'resolved-current-field');
    assert.equal(typedVisibleId.state, 'resolved-current-field');
    assert.deepEqual(visibleId.mentionedExternalIds, ['task-1']);
    assert.deepEqual(typedVisibleId.mentionedExternalIds, ['task-1']);
    assert.equal(
      typedVisibleId.verification.queryPlanSha256,
      visibleId.verification.queryPlanSha256,
    );
  });
});

test('refuses an unknown direct identifier without breaking unique-object shorthand', async () => {
  await withProduct(buildSingleObjectInput(), async (product) => {
    const generic = await product.verify('What is the current status of task?');
    assert.equal(generic.state, 'resolved-current-field');
    assert.equal(generic.verification.currentFieldChronology.objectIdentity.externalId, 'task-1');
    assert.deepEqual(
      generic.context.map((row) => row.exactText),
      ['Done'],
    );

    const genericTyped = await product.verify({
      question: 'What is the current status?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(genericTyped.state, 'resolved-current-field');
    assert.equal(
      genericTyped.verification.currentFieldChronology.objectIdentity.externalId,
      'task-1',
    );

    const known = await product.verify('What is the current status of task task-1?');
    assert.equal(known.state, 'resolved-current-field');
    assert.equal(known.query.externalId, 'task-1');

    for (const question of [
      'What is the current status of task missing-task?',
      'What is the current status of task+record missing-task?',
    ]) {
      const unknown = await product.verify(question);
      assert.equal(unknown.state, 'unavailable-native-object-identifier-not-declared', question);
      assert.equal(unknown.answerable, false, question);
      assert.deepEqual(unknown.context, [], question);
      assert.deepEqual(unknown.unresolvedExternalIds, ['missing-task'], question);
    }

    const partialTyped = await product.verify({
      question: 'What is the current status of task missing-task?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(partialTyped.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(partialTyped.answerable, false);
    assert.deepEqual(partialTyped.context, []);
    assert.deepEqual(partialTyped.unresolvedExternalIds, ['missing-task']);

    const partialTypedWithoutAlias = await product.verify({
      question: 'What is the current status of missing-task?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(
      partialTypedWithoutAlias.state,
      'unavailable-native-object-identifier-not-declared',
    );
    assert.equal(partialTypedWithoutAlias.answerable, false);
    assert.deepEqual(partialTypedWithoutAlias.context, []);
    assert.deepEqual(partialTypedWithoutAlias.unresolvedExternalIds, ['missing-task']);

    const explicitAbsent = await product.verify({
      question: 'What is the current status of task missing-task?',
      scope: {
        sourceSystem: 'clickup',
        objectType: 'task',
        externalId: 'missing-task',
        field: 'status',
      },
    });
    assert.equal(explicitAbsent.state, 'verified-native-object-absent-from-bound-source-catalog');
    assert.equal(explicitAbsent.answerable, false);
    assert.deepEqual(explicitAbsent.context, []);
    assert.equal(
      explicitAbsent.verification.absenceReceipt.objectIdentity.externalId,
      'missing-task',
    );

    const explicitAbsentWithoutAlias = await product.verify({
      question: 'What is the current status of missing-task?',
      scope: {
        sourceSystem: 'clickup',
        objectType: 'task',
        externalId: 'missing-task',
        field: 'status',
      },
    });
    assert.equal(
      explicitAbsentWithoutAlias.state,
      'verified-native-object-absent-from-bound-source-catalog',
    );
    assert.equal(explicitAbsentWithoutAlias.answerable, false);
    assert.deepEqual(explicitAbsentWithoutAlias.context, []);
    assert.equal(
      explicitAbsentWithoutAlias.verification.absenceReceipt.objectIdentity.externalId,
      'missing-task',
    );

    const explicitKnownConflict = await product.verify({
      question: 'What is the current status of task missing-task?',
      scope: {
        sourceSystem: 'clickup',
        objectType: 'task',
        externalId: 'task-1',
        field: 'status',
      },
    });
    assert.equal(explicitKnownConflict.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(explicitKnownConflict.answerable, false);
    assert.deepEqual(explicitKnownConflict.context, []);
    assert.deepEqual(explicitKnownConflict.unresolvedExternalIds, ['missing-task']);

    const explicitKnownConflictWithoutAlias = await product.verify({
      question: 'What is the current status of missing-task?',
      scope: {
        sourceSystem: 'clickup',
        objectType: 'task',
        externalId: 'task-1',
        field: 'status',
      },
    });
    assert.equal(
      explicitKnownConflictWithoutAlias.state,
      'unavailable-native-object-identifier-not-declared',
    );
    assert.equal(explicitKnownConflictWithoutAlias.answerable, false);
    assert.deepEqual(explicitKnownConflictWithoutAlias.context, []);
    assert.deepEqual(explicitKnownConflictWithoutAlias.unresolvedExternalIds, ['missing-task']);

    const ordinaryHyphenatedProse = await product.verify(
      'What is the current status of task+record, with real-time updates?',
    );
    assert.equal(ordinaryHyphenatedProse.state, 'resolved-current-field');
    assert.equal(
      ordinaryHyphenatedProse.verification.currentFieldChronology.objectIdentity.externalId,
      'task-1',
    );

    const boundaryMiss = await product.verify(
      'What is the current status of taskrecord missing-task for task-1?',
    );
    assert.equal(boundaryMiss.state, 'resolved-current-field');
    assert.equal(boundaryMiss.query.externalId, 'task-1');
    assert.deepEqual(boundaryMiss.mentionedExternalIds, ['task-1']);
    assert.deepEqual(boundaryMiss.unresolvedExternalIds, []);

    const title = await product.verify(
      'What is the current status of the task titled "Quarterly status review"?',
    );
    assert.equal(title.state, 'resolved-current-field');
    assert.equal(title.query.externalId, 'task-1');
  });
});

test('keeps selector refusal bounded around aliases, values, dates, and anchors', async () => {
  await withProduct(buildSingleObjectInput({ aliases: ['task-record'] }), async (product) => {
    const knownAliasId = await product.verify({
      question: 'What is the current status of task-record task-1?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(knownAliasId.state, 'resolved-current-field');
    assert.equal(knownAliasId.query.externalId, 'task-1');

    const unknownAliasId = await product.verify({
      question: 'What is the current status of task-record missing-task?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(unknownAliasId.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(unknownAliasId.answerable, false);
    assert.deepEqual(unknownAliasId.context, []);
    assert.deepEqual(unknownAliasId.unresolvedExternalIds, ['missing-task']);
  });

  await withProduct(buildSingleObjectInput({ aliases: ['task record'] }), async (product) => {
    const knownMultiwordAlias = await product.verify({
      question: 'What is the current status of task record task-1?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(knownMultiwordAlias.state, 'resolved-current-field');
    assert.equal(knownMultiwordAlias.query.externalId, 'task-1');

    const unknownMultiwordAlias = await product.verify({
      question: 'What is the current status of task record missing-task?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(unknownMultiwordAlias.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(unknownMultiwordAlias.answerable, false);
    assert.deepEqual(unknownMultiwordAlias.context, []);
    assert.deepEqual(unknownMultiwordAlias.unresolvedExternalIds, ['missing-task']);
  });

  await withProduct(buildSingleObjectInput({ status: 'In Progress' }), async (product) => {
    const generic = await product.verify({
      question: 'What is the current status?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(generic.state, 'resolved-current-field');
    assert.deepEqual(
      generic.context.map((row) => row.exactText),
      ['In Progress'],
    );

    const statusValueSelector = await product.verify({
      question: 'What is the current status of in-progress?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(statusValueSelector.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(statusValueSelector.answerable, false);
    assert.deepEqual(statusValueSelector.context, []);
    assert.deepEqual(statusValueSelector.unresolvedExternalIds, ['in-progress']);

    const dateSelector = await product.verify({
      question: 'What is the current status of 2026-09-26?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status' },
    });
    assert.equal(dateSelector.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(dateSelector.answerable, false);
    assert.deepEqual(dateSelector.context, []);
    assert.deepEqual(dateSelector.unresolvedExternalIds, ['2026-09-26']);
  });

  await withProduct(
    buildInput({ targetStatus: 'waiting for follow-up', latestStatus: 'Done' }),
    async (product) => {
      const scope = { sourceSystem: 'clickup', objectType: 'task', field: 'status' };
      const successor = await product.verify({
        question: 'What status immediately followed waiting for follow-up for task-1?',
        intent: 'next',
        anchorValue: 'waiting for follow-up',
        scope,
      });
      assert.equal(successor.state, 'resolved-next-field-revision');
      assert.equal(successor.answerable, true);
      assert.equal(successor.query.externalId, 'task-1');
      assert.deepEqual(successor.context.map((row) => row.exactText).sort(), [
        'Done',
        'waiting for follow-up',
      ]);

      const missingSelector = await product.verify({
        question: 'What status immediately followed waiting for follow-up for missing-task?',
        intent: 'next',
        anchorValue: 'waiting for follow-up',
        scope,
      });
      assert.equal(missingSelector.state, 'unavailable-native-object-identifier-not-declared');
      assert.equal(missingSelector.answerable, false);
      assert.deepEqual(missingSelector.context, []);
      assert.deepEqual(missingSelector.unresolvedExternalIds, ['missing-task']);
    },
  );
  await withProduct(buildInput(), async (product) => {
    const anchorPhrase = await product.verify({
      question: 'What status immediately followed waiting for follow-up for task-1?',
      intent: 'next',
      anchorValue: 'waiting for follow-up',
    });
    assert.equal(anchorPhrase.state, 'unavailable-native-field-anchor-not-matched');
    assert.equal(anchorPhrase.answerable, false);
    assert.deepEqual(anchorPhrase.context, []);
    assert.deepEqual(anchorPhrase.unresolvedExternalIds, []);
  });
});

test('masks identifier-looking words inside a declared title', async () => {
  await withProduct(
    buildSingleObjectInput({ title: 'Quarterly task missing-task review' }),
    async (product) => {
      const result = await product.verify(
        'What is the current status of the task titled "Quarterly task missing-task review"?',
      );
      assert.equal(result.state, 'resolved-current-field');
      assert.equal(result.query.externalId, 'task-1');
      assert.deepEqual(result.mentionedExternalIds, []);
      assert.deepEqual(result.unresolvedExternalIds, []);
    },
  );
});

test('repeated title observations count once, while equal titles on two identities refuse', async () => {
  await withProduct(buildInput(), async (product) => {
    const result = await product.verify(
      'What is the current status of the task named "Quarterly status review"?',
    );
    assert.equal(result.state, 'resolved-current-field');
    assert.equal(result.answerable, true);
    assert.equal(result.query.externalId, 'task-1');
  });

  await withProduct(
    buildInput({ targetTitle: 'Legacy review', latestTargetTitle: 'Renamed review' }),
    async (product) => {
      const historicalAlias = await product.verify(
        'What is the current status of the task titled "Legacy review"?',
      );
      assert.equal(historicalAlias.state, 'resolved-current-field');
      assert.equal(historicalAlias.answerable, true);
      assert.equal(historicalAlias.query.externalId, 'task-1');
      assert.deepEqual(
        historicalAlias.context.map((row) => row.exactText),
        ['Done'],
      );
    },
  );

  const duplicate = sourceRow({
    relativePath: 'clickup/acme/task-3.md',
    occurredAt: '2026-02-03T00:00:00.000Z',
    externalId: 'task-3',
    title: 'Quarterly status review',
    status: 'In Progress',
  });
  await withProduct(buildInput({ extraRows: [duplicate] }), async (product) => {
    const result = await product.verify(
      'What is the current status of the task titled "Quarterly status review"?',
    );
    assert.equal(result.state, 'unavailable-native-object-seed-ambiguous');
    assert.equal(result.answerable, false);
    assert.equal(result.query, null);
    assert.equal(result.context.length, 0);
    assert.equal(result.verification.absenceReceipt, null);
  });
});

test('normalizes only NFKC, case and whitespace, and refuses unknown or body-only names', async () => {
  await withProduct(buildInput(), async (product) => {
    const normalized = await product.verify(
      'What is the current status of the task titled "  quarterly   STATUS review  "?',
    );
    assert.equal(normalized.state, 'resolved-current-field');
    assert.equal(normalized.answerable, true);
    assert.equal(normalized.query.externalId, 'task-1');

    const unknown = await product.verify(
      'What is the current status of the task titled "Quarterly status review dependency"?',
    );
    assert.equal(unknown.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(unknown.answerable, false);
    assert.equal(unknown.verification.absenceReceipt, null);

    const bodyOnly = await product.verify(
      'What is the current status of the task titled "The Quarterly status review is mentioned in this dependency note."?',
    );
    assert.equal(bodyOnly.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(bodyOnly.answerable, false);
    assert.equal(bodyOnly.verification.absenceReceipt, null);

    const punctuationChanged = await product.verify(
      'What is the current status of the task titled "Quarterly-status review"?',
    );
    assert.equal(punctuationChanged.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(punctuationChanged.answerable, false);
  });
});

test('requires complete declared title coverage before name binding', async () => {
  const missingTitle = sourceRow({
    relativePath: 'clickup/acme/task-4.md',
    occurredAt: '2026-02-04T00:00:00.000Z',
    externalId: 'task-4',
    title: 'Unpublished title',
    status: 'Ready',
    includeTitle: false,
  });
  await withProduct(buildInput({ extraRows: [missingTitle] }), async (product) => {
    const result = await product.verify(
      'What is the current status of the task titled "Quarterly status review"?',
    );
    assert.equal(result.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(result.answerable, false);
    assert.equal(result.verification.absenceReceipt, null);
  });

  await withProduct(
    buildInput({ adapterDiagnostics: [{ code: 'PARSE_FAILURE' }] }),
    async (product) => {
      const result = await product.verify(
        'What is the current status of the task titled "Quarterly status review"?',
      );
      assert.equal(result.state, 'unavailable-native-object-identifier-not-declared');
      assert.equal(result.answerable, false);
      assert.equal(result.verification.absenceReceipt, null);
    },
  );
});

test('keeps identity and namespace qualifiers coherent with a title', async () => {
  await withProduct(buildInput(), async (product, artifactRoot) => {
    const mismatchedId = await product.verify(
      'What is the current status of task-2 titled "Quarterly status review"?',
    );
    assert.equal(mismatchedId.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(mismatchedId.answerable, false);

    const unknownId = await product.verify(
      'What is the current status of task-999 titled "Quarterly status review"?',
    );
    assert.equal(unknownId.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(unknownId.answerable, false);

    const wrongNamespace = await product.verify(
      'For other, what is the current status of the task titled "Quarterly status review"?',
    );
    assert.equal(wrongNamespace.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(wrongNamespace.answerable, false);

    const typedConflict = await product.verify({
      question: 'What is the current status of the task titled "Dependency cleanup"?',
      scope: {
        sourceSystem: 'clickup',
        objectType: 'task',
        field: 'status',
        externalId: 'task-1',
      },
    });
    assert.equal(typedConflict.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(typedConflict.answerable, false);

    const typedKnownConflict = await product.verify({
      question: 'What is the current status of task-2 titled "Quarterly status review"?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(typedKnownConflict.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(typedKnownConflict.answerable, false);

    const typedKnownConflictWithoutTitle = await product.verify({
      question: 'What is the current status of task-2?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(
      typedKnownConflictWithoutTitle.state,
      'unavailable-native-multiple-object-identifiers',
    );
    assert.equal(typedKnownConflictWithoutTitle.answerable, false);
    assert.deepEqual(typedKnownConflictWithoutTitle.context, []);
    assert.equal(typedKnownConflictWithoutTitle.verification.absenceReceipt, null);

    const typedUnknownConflictWithoutTitle = await product.verify({
      question: 'What is the current status of task-999?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(
      typedUnknownConflictWithoutTitle.state,
      'unavailable-native-object-identifier-not-declared',
    );
    assert.equal(typedUnknownConflictWithoutTitle.answerable, false);
    assert.deepEqual(typedUnknownConflictWithoutTitle.context, []);

    const typedMultipleConflictWithoutTitle = await product.verify({
      question: 'What is the current status of task-1 and task-2?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(
      typedMultipleConflictWithoutTitle.state,
      'unavailable-native-multiple-object-identifiers',
    );
    assert.equal(typedMultipleConflictWithoutTitle.answerable, false);
    assert.deepEqual(typedMultipleConflictWithoutTitle.context, []);
    assert.deepEqual(typedMultipleConflictWithoutTitle.mentionedExternalIds, ['task-1', 'task-2']);

    const typedHistoricalConflict = await product.verify({
      question: 'What was the status of task-2?',
      at: '2026-01-15T00:00:00.000Z',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(typedHistoricalConflict.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(typedHistoricalConflict.answerable, false);
    assert.deepEqual(typedHistoricalConflict.context, []);

    const mcp = createSourceNativeProductMcpHandler(openSourceNativeProduct({ artifactRoot }));
    const mcpResponse = await mcp.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'verify',
        arguments: {
          question: 'What is the current status of task-2?',
          scope: {
            sourceSystem: 'clickup',
            objectType: 'task',
            field: 'status',
            externalId: 'task-1',
          },
        },
      },
    });
    assert.equal(mcpResponse.result.isError, undefined);
    const mcpConflict = JSON.parse(mcpResponse.result.content[0].text);
    assert.equal(mcpConflict.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(mcpConflict.answerable, false);
    assert.deepEqual(mcpConflict.context, []);

    const cliConflict = spawnSync(
      process.execPath,
      [
        publicCli,
        'verify',
        artifactRoot,
        'What is the current status of task-2?',
        '--source-system',
        'clickup',
        '--object-type',
        'task',
        '--external-id',
        'task-1',
        '--field',
        'status',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(cliConflict.status, 0, cliConflict.stderr);
    const cliConflictResult = JSON.parse(cliConflict.stdout);
    assert.equal(cliConflictResult.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(cliConflictResult.answerable, false);
    assert.deepEqual(cliConflictResult.context, []);

    const overlappingId = sourceRow({
      relativePath: 'clickup/acme/task-10.md',
      occurredAt: '2026-02-03T00:00:00.000Z',
      externalId: 'task-10',
      title: 'Long identifier',
      status: 'Ready',
    });
    await withProduct(buildInput({ extraRows: [overlappingId] }), async (overlapProduct) => {
      const overlapConflict = await overlapProduct.verify({
        question: 'What is the current status of task-10?',
        scope: {
          sourceSystem: 'clickup',
          objectType: 'task',
          field: 'status',
          externalId: 'task-1',
        },
      });
      assert.equal(overlapConflict.state, 'unavailable-native-multiple-object-identifiers');
      assert.equal(overlapConflict.answerable, false);
      assert.deepEqual(overlapConflict.context, []);
      assert.deepEqual(overlapConflict.mentionedExternalIds, ['task-10']);
    });

    const typedUnknownConflict = await product.verify({
      question: 'What is the current status of task-999 titled "Quarterly status review"?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(typedUnknownConflict.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(typedUnknownConflict.answerable, false);
  });
});

test('structured scopes preserve declared field intent and may fill missing selectors', async () => {
  await withProduct(buildInput(), async (product, artifactRoot) => {
    const scope = {
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'task-1',
      field: 'status',
    };
    for (const question of [
      'What is the current status of task-1?',
      'What is the current status?',
    ]) {
      const conflict = await product.verify({ question, scope: { ...scope, field: 'title' } });
      assert.equal(conflict.state, 'unavailable-native-field-ambiguous');
      assert.equal(conflict.answerable, false);
      assert.deepEqual(conflict.context, []);
      assert.equal(conflict.verification.absenceReceipt, null);
      const matching = await product.verify({ question, scope });
      assert.equal(matching.answerable, true);
      assert.deepEqual(
        matching.context.map((row) => row.exactText),
        ['Done'],
      );
    }
    for (const question of [
      'Inspect this object.',
      'Inspect task-1.',
      'What is the task status and title?',
    ]) {
      const narrowed = await product.verify({ question, scope });
      assert.equal(narrowed.answerable, true);
      assert.deepEqual(
        narrowed.context.map((row) => row.exactText),
        ['Done'],
      );
    }
    for (const question of ['Inspect this object.', 'What is the current status of task-999?']) {
      const absent = await product.verify({
        question,
        scope: { ...scope, externalId: 'task-999' },
      });
      assert.equal(absent.state, 'verified-native-object-absent-from-bound-source-catalog');
      assert.equal(absent.answerable, false);
      assert.deepEqual(absent.context, []);
      assert.equal(absent.verification.absenceReceipt.exactOccurrenceCount, 0);
      assert.equal(absent.verification.absenceReceipt.worldAbsenceAuthorized, false);
    }
    const extraId = await product.verify({
      question: 'What is the status of task-999 and task-998?',
      scope: { ...scope, externalId: 'task-999' },
    });
    assert.equal(extraId.state, 'unavailable-native-multiple-object-identifiers');
    assert.deepEqual(extraId.context, []);
    assert.equal(extraId.verification.absenceReceipt, null);
    const historical = await product.verify({
      question: 'What was the status of task-1?',
      at: '2026-01-15T00:00:00.000Z',
      scope: { ...scope, field: 'title' },
    });
    assert.equal(historical.state, 'unavailable-native-field-ambiguous');
    assert.deepEqual(historical.context, []);
    const mcp = createSourceNativeProductMcpHandler(openSourceNativeProduct({ artifactRoot }));
    const response = await mcp.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'verify',
        arguments: {
          question: 'What is the current status of task-1?',
          scope: { ...scope, field: 'title' },
        },
      },
    });
    const mcpResult = JSON.parse(response.result.content[0].text);
    assert.equal(mcpResult.state, 'unavailable-native-field-ambiguous');
    assert.equal(mcpResult.answerable, false);
    assert.deepEqual(mcpResult.context, []);
    const cli = spawnSync(
      process.execPath,
      [
        publicCli,
        'verify',
        artifactRoot,
        'What is the current status of task-1?',
        '--source-system',
        'clickup',
        '--object-type',
        'task',
        '--external-id',
        'task-1',
        '--field',
        'title',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(cli.status, 0, cli.stderr);
    const cliResult = JSON.parse(cli.stdout);
    assert.equal(cliResult.state, 'unavailable-native-field-ambiguous');
    assert.equal(cliResult.answerable, false);
    assert.deepEqual(cliResult.context, []);
  });
  await withProduct(
    buildInput({ adapterDiagnostics: [{ code: 'PARSE_FAILURE' }] }),
    async (product) => {
      const incomplete = await product.verify({
        question: 'What is the status of task-999?',
        scope: {
          sourceSystem: 'clickup',
          objectType: 'task',
          externalId: 'task-999',
          field: 'status',
        },
      });
      assert.equal(incomplete.state, 'unavailable-native-object-not-seeded');
      assert.equal(incomplete.answerable, false);
      assert.deepEqual(incomplete.context, []);
      assert.equal(incomplete.verification.absenceReceipt, null);
    },
  );
});

test('structured profiles disambiguate matching object aliases but cannot override another profile', async () => {
  const input = buildInput();
  input.querySchemas.push({
    sourceSystem: 'linear',
    objectType: 'issue',
    aliases: ['issue'],
    fields: [{ fieldPath: 'status', aliases: ['status'] }],
  });
  input.querySchemas.push({
    sourceSystem: 'other',
    objectType: 'task',
    aliases: ['task'],
    fields: [{ fieldPath: 'status', aliases: ['status'] }],
  });
  await withProduct(input, async (product) => {
    const scope = {
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'task-1',
      field: 'status',
    };
    const conflict = await product.verify({ question: 'What is the current issue status?', scope });
    assert.equal(conflict.state, 'unavailable-native-object-type-ambiguous');
    assert.equal(conflict.answerable, false);
    assert.deepEqual(conflict.context, []);
    assert.equal(conflict.verification.absenceReceipt, null);
    const unscoped = await product.verify('What is the current task status of task-1?');
    assert.equal(unscoped.state, 'unavailable-native-object-type-ambiguous');
    const narrowed = await product.verify({
      question: 'What is the current task status of task-1?',
      scope,
    });
    assert.equal(narrowed.answerable, true);
    assert.deepEqual(
      narrowed.context.map((row) => row.exactText),
      ['Done'],
    );
  });
});

test('does not scan title words as field, ID or temporal intent, including historical reads', async () => {
  const title = 'Status task-1 at 2026';
  await withProduct(buildInput({ targetTitle: title }), async (product) => {
    const current = await product.verify(
      `What is the current status of the task titled "${title}"?`,
    );
    assert.equal(current.state, 'resolved-current-field');
    assert.equal(current.answerable, true);
    assert.equal(current.query.externalId, 'task-1');
    assert.deepEqual(current.mentionedExternalIds, []);
    assert.deepEqual(
      current.context.map((row) => row.exactText),
      ['Done'],
    );

    const historical = await product.verify({
      question: `What was the status of the task titled "${title}"?`,
      at: '2026-01-15T00:00:00.000Z',
    });
    assert.equal(historical.state, 'resolved-historical-field');
    assert.equal(historical.answerable, true);
    assert.equal(historical.query.externalId, 'task-1');
    assert.deepEqual(
      historical.context.map((row) => row.exactText),
      ['Ready'],
    );
    assert.equal(historical.verification.historicalFieldChronology.proofDisposition, 'sufficient');
  });
});

test('supports escaped quotes without changing the exact declared title', async () => {
  const title = 'Review named "status" task-1';
  await withProduct(buildInput({ targetTitle: title }), async (product) => {
    const result = await product.verify(
      'What is the current status of the task titled "Review named \\"status\\" task-1"?',
    );
    assert.equal(result.state, 'resolved-current-field');
    assert.equal(result.answerable, true);
    assert.equal(result.query.externalId, 'task-1');
    assert.deepEqual(
      result.context.map((row) => row.exactText),
      ['Done'],
    );
  });
});

test('refuses malformed or multiple explicit title clauses', async () => {
  await withProduct(buildInput(), async (product) => {
    const malformed = await product.verify(
      'What is the current status of the task titled "Quarterly status review?',
    );
    assert.equal(malformed.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(malformed.answerable, false);

    const multiple = await product.verify(
      'What is the current status of the task titled "Quarterly status review" named "Dependency cleanup"?',
    );
    assert.equal(multiple.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(multiple.answerable, false);
  });
});
