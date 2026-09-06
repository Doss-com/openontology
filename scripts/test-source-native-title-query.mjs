import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { openOntology } from '../dist/src/openontology.mjs';
import { buildSourceNativeProduct, openSourceNativeProduct } from '../dist/src/source-native-product.mjs';
import { createSourceNativeProductMcpHandler } from '../dist/src/source-native-product-mcp.mjs';

const publicCli = resolve(import.meta.dirname, '..', 'dist', 'bin', 'oont.mjs');

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
    assert.deepEqual(result.context.map((row) => row.exactText), ['Done']);
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
    assert.equal(typedVisibleId.verification.queryPlanSha256,
      visibleId.verification.queryPlanSha256);
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
        sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1',
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
    assert.equal(typedKnownConflictWithoutTitle.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(typedKnownConflictWithoutTitle.answerable, false);
    assert.deepEqual(typedKnownConflictWithoutTitle.context, []);
    assert.equal(typedKnownConflictWithoutTitle.verification.absenceReceipt, null);

    const typedUnknownConflictWithoutTitle = await product.verify({
      question: 'What is the current status of task-999?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(typedUnknownConflictWithoutTitle.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(typedUnknownConflictWithoutTitle.answerable, false);
    assert.deepEqual(typedUnknownConflictWithoutTitle.context, []);

    const typedMultipleConflictWithoutTitle = await product.verify({
      question: 'What is the current status of task-1 and task-2?',
      scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
    });
    assert.equal(typedMultipleConflictWithoutTitle.state, 'unavailable-native-multiple-object-identifiers');
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
          scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
        },
      },
    });
    assert.equal(mcpResponse.result.isError, undefined);
    const mcpConflict = JSON.parse(mcpResponse.result.content[0].text);
    assert.equal(mcpConflict.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(mcpConflict.answerable, false);
    assert.deepEqual(mcpConflict.context, []);

    const cliConflict = spawnSync(process.execPath, [
      publicCli, 'verify', artifactRoot, 'What is the current status of task-2?',
      '--source-system', 'clickup', '--object-type', 'task', '--external-id', 'task-1',
      '--field', 'status',
    ], { encoding: 'utf8' });
    assert.equal(cliConflict.status, 0, cliConflict.stderr);
    const cliConflictResult = JSON.parse(cliConflict.stdout);
    assert.equal(cliConflictResult.state, 'unavailable-native-multiple-object-identifiers');
    assert.equal(cliConflictResult.answerable, false);
    assert.deepEqual(cliConflictResult.context, []);

    const overlappingId = sourceRow({
      relativePath: 'clickup/acme/task-10.md',
      occurredAt: '2026-02-03T00:00:00.000Z',
      externalId: 'task-10', title: 'Long identifier', status: 'Ready',
    });
    await withProduct(buildInput({ extraRows: [overlappingId] }), async (overlapProduct) => {
      const overlapConflict = await overlapProduct.verify({
        question: 'What is the current status of task-10?',
        scope: { sourceSystem: 'clickup', objectType: 'task', field: 'status', externalId: 'task-1' },
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
