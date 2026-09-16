import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openOntology } from '../../dist/openontology.js';
import { buildSourceNativeProduct } from '../../dist/product/runtime.js';

function historicalInput() {
  const rows = [
    ['draft', '2026-07-01T00:00:00.000Z', 'Draft'],
    ['ready', '2026-08-02T00:00:00.000Z', 'Ready'],
  ];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'historical-native-test',
    namespace: 'history',
    querySchemas: [
      {
        sourceSystem: 'tracker',
        objectType: 'ticket',
        aliases: ['ticket'],
        fields: [{ fieldPath: 'status', aliases: ['status'] }],
      },
    ],
    sources: rows.map(([name, occurredAt, value]) => ({
      relativePath: `tracker/${name}.txt`,
      sourceType: 'tracker',
      occurredAt,
      content: `Ticket H-1 status: ${value}.`,
    })),
    nativeObjectInputs: rows.map(([name, , value]) => ({
      relativePath: `tracker/${name}.txt`,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'tracker',
        objectType: 'ticket',
        namespace: 'history',
        externalId: 'H-1',
      },
      fields: [{ fieldPath: 'status', value }],
    })),
  };
}

function build(t, input = historicalInput()) {
  const root = mkdtempSync(join(tmpdir(), 'oont-point-in-time-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactRoot = join(root, 'ont');
  buildSourceNativeProduct({ artifactRoot, input });
  return { artifactRoot, product: openOntology({ artifactRoot }) };
}

test('verifies an earlier field from the complete bound source cut', async (t) => {
  const { product } = build(t);
  const historical = await product.verify({
    question: 'What was the status of ticket H-1?',
    at: '2026-07-15T00:00:00.000Z',
  });
  assert.equal(historical.answerable, true);
  assert.equal(historical.state, 'resolved-historical-field');
  assert.equal(historical.intent, 'at');
  assert.equal(historical.at, '2026-07-15T00:00:00.000Z');
  assert.deepEqual(
    historical.context.map((row) => row.exactText),
    ['Draft'],
  );
  assert.equal(historical.verification.historicalFieldChronology.proofDisposition, 'sufficient');
  const current = await product.verify('What is the current status of ticket H-1?');
  assert.deepEqual(
    current.context.map((row) => row.exactText),
    ['Ready'],
  );
});

test('public historical verification handles exact validity and source-horizon boundaries', async (t) => {
  const { product } = build(t);
  const query = (at) => ({ question: 'What was the status of ticket H-1?', at });
  const first = await product.verify(query('2026-07-01T00:00:00.000Z'));
  assert.equal(first.answerable, true);
  assert.deepEqual(
    first.context.map((row) => row.exactText),
    ['Draft'],
  );
  const last = await product.verify(query('2026-08-02T00:00:00.000Z'));
  assert.equal(last.answerable, true);
  assert.deepEqual(
    last.context.map((row) => row.exactText),
    ['Ready'],
  );
  for (const [at, state] of [
    ['2026-06-30T23:59:59.999Z', 'unavailable-native-historical-field-not-yet-valid'],
    ['2026-08-02T00:00:00.001Z', 'unavailable-native-historical-field-beyond-source-horizon'],
  ]) {
    const refused = await product.verify(query(at));
    assert.equal(refused.answerable, false);
    assert.equal(refused.state, state);
    assert.equal(refused.at, at);
    assert.deepEqual(refused.context, []);
  }
});
