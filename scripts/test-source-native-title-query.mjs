import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openOntology } from '../dist/src/openontology.mjs';
import { buildSourceNativeProduct } from '../dist/src/source-native-product.mjs';

function sourceRow({ relativePath, occurredAt, externalId, title, status, body = '', includeTitle = true }) {
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
        ...(includeTitle ? [{ fieldPath: 'title', value: title, codeUnitStart: content.indexOf(title) }] : []),
        { fieldPath: 'status', value: status, codeUnitStart: content.indexOf(status) },
      ],
    },
  };
}

function buildInput({ targetTitle = 'Quarterly status review', latestTargetTitle = targetTitle,
  extraRows = [], extraSources = [], adapterDiagnostics = [] } = {}) {
  const rows = [
    sourceRow({
      relativePath: 'clickup/acme/task-1-r1.md',
      occurredAt: '2026-01-01T00:00:00.000Z',
      externalId: 'task-1', title: targetTitle, status: 'Ready',
    }),
    sourceRow({
      relativePath: 'clickup/acme/task-1-r2.md',
      occurredAt: '2026-02-01T00:00:00.000Z',
      externalId: 'task-1', title: latestTargetTitle, status: 'Done',
    }),
    sourceRow({
      relativePath: 'clickup/acme/task-2.md',
      occurredAt: '2026-02-02T00:00:00.000Z',
      externalId: 'task-2', title: 'Dependency cleanup', status: 'Blocked',
      body: 'The Quarterly status review is mentioned in this dependency note.',
    }),
    ...extraRows,
  ];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'acme-title-binding',
    namespace: 'acme',
    querySchemas: [{
      sourceSystem: 'clickup',
      objectType: 'task',
      aliases: ['task'],
      fields: [
        { fieldPath: 'title', aliases: ['title'] },
        { fieldPath: 'status', aliases: ['status'] },
      ],
    }],
    sources: [
      ...rows.map(({ nativeObjectInput: _nativeObjectInput, ...source }) => source),
      ...extraSources,
    ],
    nativeObjectInputs: rows.map(({ nativeObjectInput }) => nativeObjectInput),
    adapterDiagnostics,
  };
}

async function withProduct(input, callback) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'oont-title-binding-case-'));
  try {
    buildSourceNativeProduct({ artifactRoot, input });
    return await callback(openOntology({ artifactRoot }));
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
    assert.deepEqual(result.context.map((row) => row.exactText), ['Done']);
    assert.equal(result.verification.currentFieldChronology.proofDisposition, 'sufficient');

    const typedReplay = await product.verify({
      question: 'What is the current status of the task titled "Quarterly status review"?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(typedReplay.state, 'resolved-current-field');
    assert.equal(typedReplay.answerable, true);
    assert.equal(typedReplay.verification.queryPlanSha256, result.verification.queryPlanSha256);
  });
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

  await withProduct(buildInput({ targetTitle: 'Legacy review', latestTargetTitle: 'Renamed review' }), async (product) => {
    const historicalAlias = await product.verify(
      'What is the current status of the task titled "Legacy review"?',
    );
    assert.equal(historicalAlias.state, 'resolved-current-field');
    assert.equal(historicalAlias.answerable, true);
    assert.equal(historicalAlias.query.externalId, 'task-1');
    assert.deepEqual(historicalAlias.context.map((row) => row.exactText), ['Done']);
  });

  const duplicate = sourceRow({
    relativePath: 'clickup/acme/task-3.md',
    occurredAt: '2026-02-03T00:00:00.000Z',
    externalId: 'task-3', title: 'Quarterly status review', status: 'In Progress',
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
    externalId: 'task-4', title: 'Unpublished title', status: 'Ready', includeTitle: false,
  });
  await withProduct(buildInput({ extraRows: [missingTitle] }), async (product) => {
    const result = await product.verify(
      'What is the current status of the task titled "Quarterly status review"?',
    );
    assert.equal(result.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(result.answerable, false);
    assert.equal(result.verification.absenceReceipt, null);
  });

  await withProduct(buildInput({ adapterDiagnostics: [{ code: 'PARSE_FAILURE' }] }), async (product) => {
    const result = await product.verify(
      'What is the current status of the task titled "Quarterly status review"?',
    );
    assert.equal(result.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(result.answerable, false);
    assert.equal(result.verification.absenceReceipt, null);
  });
});

test('keeps identity and namespace qualifiers coherent with a title', async () => {
  await withProduct(buildInput(), async (product) => {
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
        sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1',
      },
    });
    assert.equal(typedConflict.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(typedConflict.answerable, false);
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
    assert.deepEqual(current.context.map((row) => row.exactText), ['Done']);

    const historical = await product.verify({
      question: `What was the status of the task titled "${title}"?`,
      at: '2026-01-15T00:00:00.000Z',
    });
    assert.equal(historical.state, 'resolved-historical-field');
    assert.equal(historical.answerable, true);
    assert.equal(historical.query.externalId, 'task-1');
    assert.deepEqual(historical.context.map((row) => row.exactText), ['Ready']);
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
    assert.deepEqual(result.context.map((row) => row.exactText), ['Done']);
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
