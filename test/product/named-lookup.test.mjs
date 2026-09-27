import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openOntology } from '../../dist/openontology.js';
import { buildSourceNativeProduct } from '../../dist/product/runtime.js';

function personRow({
  relativePath,
  externalId,
  name,
  role,
  nameFieldPath = 'display_name',
  alternateName = null,
  title = null,
}) {
  const content = [
    `Name: ${name}`,
    ...(alternateName === null ? [] : [`Legal name: ${alternateName}`]),
    ...(title === null ? [] : [`Title: ${title}`]),
    `Role: ${role}`,
  ].join('\n');
  return {
    relativePath,
    sourceType: 'directory',
    occurredAt: '2026-09-01T00:00:00.000Z',
    content,
    nativeObjectInput: {
      relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'directory',
        objectType: 'person',
        namespace: 'synthetic',
        externalId,
      },
      fields: [
        {
          fieldPath: nameFieldPath,
          value: name,
          codeUnitStart: content.indexOf(name),
        },
        ...(alternateName === null
          ? []
          : [
              {
                fieldPath: 'legal_name',
                value: alternateName,
                codeUnitStart: content.indexOf(alternateName),
              },
            ]),
        ...(title === null
          ? []
          : [{ fieldPath: 'title', value: title, codeUnitStart: content.indexOf(title) }]),
        { fieldPath: 'role', value: role, codeUnitStart: content.indexOf(role) },
      ],
    },
  };
}

function buildInput({
  rows,
  nameAliases = ['name', 'full name'],
  includeTitle = false,
  includeAlternateName = false,
}) {
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'synthetic-named-lookup',
    namespace: 'synthetic',
    querySchemas: [
      {
        sourceSystem: 'directory',
        objectType: 'person',
        aliases: ['person', 'people'],
        fields: [
          {
            fieldPath: 'display_name',
            aliases: nameAliases,
          },
          ...(includeAlternateName ? [{ fieldPath: 'legal_name', aliases: ['full name'] }] : []),
          ...(includeTitle ? [{ fieldPath: 'title', aliases: ['title'] }] : []),
          { fieldPath: 'role', aliases: ['role'] },
        ],
      },
    ],
    sources: rows.map(({ nativeObjectInput: _nativeObjectInput, ...source }) => source),
    nativeObjectInputs: rows.map(({ nativeObjectInput }) => nativeObjectInput),
  };
}

async function withProduct(input, callback) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'oont-named-lookup-'));
  try {
    buildSourceNativeProduct({ artifactRoot, input });
    return await callback(openOntology({ artifactRoot }));
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
}

test('named lookup binds a uniquely declared name field through its aliases', async () => {
  const row = personRow({
    relativePath: 'directory/synthetic/person-1.md',
    externalId: 'person-1',
    name: 'Ada Lovelace',
    role: 'Analyst',
  });
  await withProduct(buildInput({ rows: [row] }), async (product) => {
    const result = await product.verify('What is the role of the person named "Ada Lovelace"?');
    assert.equal(result.state, 'resolved-current-field');
    assert.equal(result.answerable, true);
    assert.equal(result.query.externalId, 'person-1');
    assert.equal(result.query.fieldPath, 'role');
    assert.deepEqual(
      result.context.map((item) => item.exactText),
      ['Analyst'],
    );
  });
});

test('named lookup accepts a full-name alias but titled remains title-only', async () => {
  const row = personRow({
    relativePath: 'directory/synthetic/person-1.md',
    externalId: 'person-1',
    name: 'Ada Lovelace',
    role: 'Analyst',
  });
  await withProduct(buildInput({ rows: [row], nameAliases: ['full name'] }), async (product) => {
    const named = await product.verify('What is the role of the person named "Ada Lovelace"?');
    assert.equal(named.state, 'resolved-current-field');
    assert.equal(named.query.externalId, 'person-1');

    const titled = await product.verify('What is the role of the person titled "Ada Lovelace"?');
    assert.equal(titled.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(titled.answerable, false);
    assert.deepEqual(titled.context, []);
  });
});

test('named lookup prefers a declared name field over title and refuses undeclared aliases', async () => {
  const namedPerson = personRow({
    relativePath: 'directory/synthetic/person-1.md',
    externalId: 'person-1',
    name: 'Ada Lovelace',
    title: 'Directory record one',
    role: 'Analyst',
  });
  const titledPerson = personRow({
    relativePath: 'directory/synthetic/person-2.md',
    externalId: 'person-2',
    name: 'Grace Hopper',
    title: 'Ada Lovelace',
    role: 'Engineer',
  });
  await withProduct(
    buildInput({ rows: [namedPerson, titledPerson], includeTitle: true }),
    async (product) => {
      const result = await product.verify('What is the role of the person named "Ada Lovelace"?');
      assert.equal(result.state, 'resolved-current-field');
      assert.equal(result.query.externalId, 'person-1');
      assert.deepEqual(
        result.context.map((item) => item.exactText),
        ['Analyst'],
      );
    },
  );

  const noDeclaredName = personRow({
    relativePath: 'directory/synthetic/person-1.md',
    externalId: 'person-1',
    name: 'Ada Lovelace',
    role: 'Analyst',
  });
  await withProduct(
    buildInput({ rows: [noDeclaredName], nameAliases: ['display name'] }),
    async (product) => {
      const result = await product.verify('What is the role of the person named "Ada Lovelace"?');
      assert.equal(result.state, 'unavailable-native-object-identifier-not-declared');
      assert.equal(result.answerable, false);
      assert.deepEqual(result.context, []);
    },
  );
});

test('named lookup refuses when two fields claim name aliases', async () => {
  const row = personRow({
    relativePath: 'directory/synthetic/person-1.md',
    externalId: 'person-1',
    name: 'Ada Lovelace',
    alternateName: 'Ada L.',
    role: 'Analyst',
  });
  await withProduct(
    buildInput({ rows: [row], nameAliases: ['name'], includeAlternateName: true }),
    async (product) => {
      const result = await product.verify('What is the role of the person named "Ada Lovelace"?');
      assert.equal(result.state, 'unavailable-native-object-identifier-not-declared');
      assert.equal(result.answerable, false);
      assert.deepEqual(result.context, []);
    },
  );
});

test('named lookup preserves duplicate-name, namespace, and complete-census refusals', async () => {
  const first = personRow({
    relativePath: 'directory/synthetic/person-1.md',
    externalId: 'person-1',
    name: 'Ada Lovelace',
    role: 'Analyst',
  });
  const duplicate = personRow({
    relativePath: 'directory/synthetic/person-2.md',
    externalId: 'person-2',
    name: 'Ada Lovelace',
    role: 'Engineer',
  });
  await withProduct(buildInput({ rows: [first, duplicate] }), async (product) => {
    const result = await product.verify('What is the role of the person named "Ada Lovelace"?');
    assert.equal(result.state, 'unavailable-native-object-seed-ambiguous');
    assert.equal(result.answerable, false);
    assert.deepEqual(result.context, []);

    const wrongNamespace = await product.verify(
      'For other, what is the role of the person named "Ada Lovelace"?',
    );
    assert.equal(wrongNamespace.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(wrongNamespace.answerable, false);
  });

  const missingName = personRow({
    relativePath: 'directory/synthetic/person-2.md',
    externalId: 'person-2',
    name: 'Grace Hopper',
    role: 'Engineer',
  });
  missingName.nativeObjectInput.fields = missingName.nativeObjectInput.fields.filter(
    (field) => field.fieldPath !== 'display_name',
  );
  await withProduct(buildInput({ rows: [first, missingName] }), async (product) => {
    const result = await product.verify('What is the role of the person named "Ada Lovelace"?');
    assert.equal(result.state, 'unavailable-native-object-identifier-not-declared');
    assert.equal(result.answerable, false);
    assert.deepEqual(result.context, []);
  });
});
