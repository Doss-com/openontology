import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openOntology } from '../../dist/openontology.js';
import { buildSourceNativeProduct } from '../../dist/product/runtime.js';

function sourceRow(relativePath, occurredAt, content, objectType, externalId, fields) {
  return {
    relativePath,
    sourceType: 'synthetic',
    occurredAt,
    content,
    nativeObjectInput: {
      relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'synthetic',
        objectType,
        namespace: 'fixture',
        externalId,
      },
      fields: fields.map(([fieldPath, value]) => ({
        fieldPath,
        value,
        codeUnitStart: content.indexOf(value),
      })),
    },
  };
}

function buildInput() {
  const rows = [
    sourceRow(
      'synthetic/fixture/task-1-r1.txt',
      '2026-01-01T00:00:00.000Z',
      'Title: Alpha\nStatus: Draft\n',
      'task',
      'task-1',
      [
        ['title', 'Alpha'],
        ['status', 'Draft'],
      ],
    ),
    sourceRow(
      'synthetic/fixture/task-1-r2.txt',
      '2026-02-01T00:00:00.000Z',
      'Title: Alpha\nStatus: Ready\n',
      'task',
      'task-1',
      [
        ['title', 'Alpha'],
        ['status', 'Ready'],
      ],
    ),
    sourceRow(
      'synthetic/fixture/customer-1.txt',
      '2026-02-01T00:00:00.000Z',
      'PM: Amanda\n',
      'customer',
      'customer-1',
      [['pm', 'Amanda']],
    ),
  ];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'question-coverage-fixture',
    namespace: 'fixture',
    querySchemas: [
      {
        sourceSystem: 'synthetic',
        objectType: 'customer',
        aliases: ['customer'],
        fields: [{ fieldPath: 'pm', aliases: ['pm'] }],
      },
      {
        sourceSystem: 'synthetic',
        objectType: 'task',
        aliases: ['task'],
        fields: [
          { fieldPath: 'status', aliases: ['status'] },
          { fieldPath: 'title', aliases: ['title'] },
        ],
      },
    ],
    sources: rows.map(({ nativeObjectInput: _nativeObjectInput, ...source }) => source),
    nativeObjectInputs: rows.map(({ nativeObjectInput }) => nativeObjectInput),
  };
}

function buildDecisionInput() {
  const row = sourceRow(
    'synthetic/fixture/decision-1.txt',
    '2026-03-01T00:00:00.000Z',
    'Statement: Target early April go-live for SFTP updates\nDate: 2026-04-07\n',
    'decision',
    'decision-1',
    [
      ['statement', 'Target early April go-live for SFTP updates'],
      ['date', '2026-04-07'],
    ],
  );
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'question-coverage-decision-fixture',
    namespace: 'fixture',
    querySchemas: [
      {
        sourceSystem: 'synthetic',
        objectType: 'decision',
        aliases: ['decision'],
        fields: [
          { fieldPath: 'statement', aliases: ['statement', 'text'] },
          { fieldPath: 'date', aliases: ['date'] },
        ],
      },
    ],
    sources: [
      {
        relativePath: row.relativePath,
        sourceType: row.sourceType,
        occurredAt: row.occurredAt,
        content: row.content,
      },
    ],
    nativeObjectInputs: [row.nativeObjectInput],
  };
}

async function withProduct(callback) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'oont-question-coverage-'));
  try {
    buildSourceNativeProduct({ artifactRoot, input: buildInput() });
    return await callback(openOntology({ artifactRoot }));
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
}

test('explicit scoped field wins before the residual coverage refusal', async () => {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'oont-question-coverage-f6-'));
  try {
    buildSourceNativeProduct({ artifactRoot, input: buildDecisionInput() });
    const result = await openOntology({ artifactRoot }).verify({
      question: 'What is the date of decision decision-1?',
      scope: {
        sourceSystem: 'synthetic',
        objectType: 'decision',
        externalId: 'decision-1',
        field: 'statement',
      },
    });
    assert.equal(result.state, 'unavailable-native-question-residual-not-declared');
    assert.equal(result.answerable, false);
    assert.equal(result.query.fieldPath, 'statement');
    assert.deepEqual(result.uncoveredWords, ['date']);
    assert.deepEqual(result.context, []);
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('refuses unsupported residual meaning on the real verify and search paths', async () => {
  await withProduct(async (product) => {
    const email = await product.verify('What is the email of the PM for customer customer-1?');
    assert.equal(email.state, 'unavailable-native-question-residual-not-declared');
    assert.equal(email.answerable, false);
    assert.deepEqual(email.context, []);
    assert.deepEqual(email.uncoveredWords, ['email']);
    assert.equal(email.query.fieldPath, 'pm');

    const changed = await product.search('Who changed the status of task task-1?');
    assert.equal(changed.state, 'unavailable-native-question-residual-not-declared');
    assert.deepEqual(changed.matches, []);
    assert.deepEqual(changed.uncoveredWords, ['changed']);

    const why = await product.verify('Why is the status of task task-1?');
    assert.equal(why.state, 'unavailable-native-question-residual-not-declared');
    assert.deepEqual(why.uncoveredWords, ['why']);

    const negation = await product.verify('What is not the status of task task-1?');
    assert.equal(negation.state, 'unavailable-native-question-residual-not-declared');
    assert.deepEqual(negation.uncoveredWords, ['not']);

    for (const question of [
      "What is the 'email' of the PM for customer customer-1?",
      'What is the ‘email’ of the PM for customer customer-1?',
    ]) {
      const quotedUnsupported = await product.verify(question);
      assert.equal(quotedUnsupported.state, 'unavailable-native-question-residual-not-declared');
      assert.deepEqual(quotedUnsupported.uncoveredWords, ['email']);
    }

    for (const question of [
      'What is the root-cause of the status for task task-1?',
      'What is the not-open status for task task-1?',
    ]) {
      const hyphenated = await product.verify(question);
      assert.equal(hyphenated.state, 'unavailable-native-question-residual-not-declared');
      assert.equal(hyphenated.answerable, false);
      assert.deepEqual(hyphenated.context, []);
      assert.ok(hyphenated.uncoveredWords.length > 0);
    }
  });
});

test('preserves current, historical, successor, scoped and quoted-title selectors', async () => {
  await withProduct(async (product) => {
    const current = await product.verify('What is the current status for task task-1?');
    assert.equal(current.state, 'resolved-current-field');
    assert.equal(current.answerable, true);
    assert.deepEqual(
      current.context.map((row) => row.exactText),
      ['Ready'],
    );

    const historical = await product.verify({
      question: 'What was the status for task task-1?',
      at: '2026-01-15T00:00:00.000Z',
    });
    assert.equal(historical.state, 'resolved-historical-field');
    assert.equal(historical.answerable, true);
    assert.deepEqual(
      historical.context.map((row) => row.exactText),
      ['Draft'],
    );

    const successor = await product.verify({
      question: 'What status immediately followed Draft for task task-1?',
      intent: 'next',
    });
    assert.equal(successor.state, 'resolved-next-field-revision');
    assert.equal(successor.answerable, true);
    assert.deepEqual(
      successor.context.map((row) => row.exactText),
      ['Ready', 'Draft'],
    );

    const scoped = await product.verify({
      question: 'What is the current value?',
      scope: {
        sourceSystem: 'synthetic',
        objectType: 'task',
        externalId: 'task-1',
        field: 'status',
      },
    });
    assert.equal(scoped.state, 'resolved-current-field');
    assert.equal(scoped.answerable, true);
    assert.deepEqual(
      scoped.context.map((row) => row.exactText),
      ['Ready'],
    );

    const titled = await product.verify('What is the current status of the task titled "Alpha"?');
    assert.equal(titled.state, 'resolved-current-field');
    assert.equal(titled.answerable, true);
    assert.equal(titled.query.externalId, 'task-1');

    const scopeConflict = await product.verify({
      question: 'What is the current title of task-1?',
      scope: {
        sourceSystem: 'synthetic',
        objectType: 'task',
        externalId: 'task-1',
        field: 'status',
      },
    });
    assert.equal(scopeConflict.state, 'unavailable-native-question-residual-not-declared');
    assert.equal(scopeConflict.answerable, false);
    assert.equal(scopeConflict.query.fieldPath, 'status');
    assert.deepEqual(scopeConflict.uncoveredWords, ['title']);
    assert.deepEqual(scopeConflict.context, []);
  });
});
