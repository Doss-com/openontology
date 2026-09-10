import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { objectBytesSha256, stableObjectSha256 } from '../dist/src/canonical-content.mjs';
import { openFileObjectBackend } from '../dist/src/object-storage-backend.mjs';
import {
  compileSourceNativeObjectMap,
  materializeSourceNativeObjectMap,
  openSourceNativeObjectMap,
  validateSourceNativeObjectMap,
} from '../dist/src/source-native-object-map.mjs';

function source(relativePath, occurredAt, content) {
  return {
    relativePath,
    sourceType: relativePath.split('/')[0],
    occurredAt,
    content,
    sourceSha256: objectBytesSha256(Buffer.from(content)),
  };
}

function span(content, fieldPath, value) {
  return { fieldPath, value, codeUnitStart: content.indexOf(value) };
}

function compiledHeaderFixture() {
  const content = '# Header fixture\nStatus: open\n';
  const sources = [source('clickup/acme/header.md', '2026-01-01T00:00:00.000Z', content)];
  return compileSourceNativeObjectMap({
    sources,
    nativeObjectInputs: [{
      relativePath: sources[0].relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-header',
      },
      fields: [span(content, 'title', 'Header fixture')],
    }],
  });
}

test('rejects missing, malformed, and inherited map headers at the validator boundary', () => {
  const valid = compiledHeaderFixture();
  const mutations = [
    ['missing schema', (map) => { delete map.schema; }],
    ['null schema', (map) => { map.schema = null; }],
    ['undefined schema', (map) => { map.schema = undefined; }],
    ['wrong number schema', (map) => { map.schema = 2; }],
    ['wrong string schema', (map) => { map.schema = '1'; }],
    ['wrong object schema', (map) => { map.schema = {}; }],
    ['missing kind', (map) => { delete map.kind; }],
    ['null kind', (map) => { map.kind = null; }],
    ['undefined kind', (map) => { map.kind = undefined; }],
    ['wrong number kind', (map) => { map.kind = 1; }],
    ['wrong string kind', (map) => { map.kind = 'wrong'; }],
    ['wrong object kind', (map) => { map.kind = {}; }],
    ['inherited-only headers', (map) => {
      delete map.schema;
      delete map.kind;
      Object.setPrototypeOf(map, {
        schema: 1,
        kind: 'OpenOntologySourceNativeObjectMapV1',
      });
    }],
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.throws(() => validateSourceNativeObjectMap(candidate), {
      code: 'SOURCE_NATIVE_MAP',
    }, label);
  }
});

test('compiles exact source-native field revisions and duplicate evidence without making either authoritative', () => {
  const oldTask = '# Old task title\nStatus: open\n';
  const newTask = '# Current task title\nStatus: complete\n';
  const ticketA = '# Integration failure\nInvoice 1626 could not be pushed for SKU ABC.\n';
  const ticketB = '# Copied integration failure\nInvoice 1626 could not be pushed for SKU ABC.\n';
  const sources = [
    source('clickup/acme/old.md', '2026-01-01T00:00:00.000Z', oldTask),
    source('clickup/acme/new.md', '2026-02-01T00:00:00.000Z', newTask),
    source('pylon/acme/a.md', '2026-03-01T00:00:00.000Z', ticketA),
    source('pylon/acme/b.md', '2026-03-02T00:00:00.000Z', ticketB),
  ];
  const nativeObjectInputs = [
    {
      relativePath: 'clickup/acme/old.md',
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1' },
      fields: [span(oldTask, 'title', 'Old task title'), span(oldTask, 'status', 'open')],
    },
    {
      relativePath: 'clickup/acme/new.md',
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1' },
      fields: [span(newTask, 'title', 'Current task title'), span(newTask, 'status', 'complete')],
    },
    {
      relativePath: 'pylon/acme/a.md',
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'pylon', objectType: 'ticket', namespace: 'acme', externalId: 'ticket-a' },
      businessEntityKeys: ['invoice:1626', 'sku:abc'],
      fields: [span(ticketA, 'content', 'Invoice 1626 could not be pushed for SKU ABC.')],
      duplicateEvidenceFieldPaths: ['content'],
    },
    {
      relativePath: 'pylon/acme/b.md',
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'pylon', objectType: 'ticket', namespace: 'acme', externalId: 'ticket-b' },
      businessEntityKeys: ['invoice:1626', 'sku:abc'],
      fields: [span(ticketB, 'content', 'Invoice 1626 could not be pushed for SKU ABC.')],
      duplicateEvidenceFieldPaths: ['content'],
    },
  ];
  const map = compileSourceNativeObjectMap({ sources, nativeObjectInputs });
  assert.equal(map.kind, 'OpenOntologySourceNativeObjectMapV1');
  const roundTrip = validateSourceNativeObjectMap(JSON.parse(JSON.stringify(map)));
  assert.deepEqual(roundTrip, map);
  assert.equal(roundTrip.nativeObjectMapSha256, map.nativeObjectMapSha256);
  assert.equal(map.fieldRevisionCount, 2);
  assert.deepEqual(map.fieldRevisions.map((row) => row.fieldPath), ['status', 'title']);
  assert.ok(map.fieldRevisions.every((row) => row.relationType === 'supersedes'
    && row.admissionState === 'deterministic-source-native'
    && row.navigationOnly === true));
  assert.equal(map.duplicateEvidenceClusterCount, 1);
  assert.equal(map.duplicateEvidenceClusters[0].evidence.length, 2);
  assert.equal(map.duplicateEvidenceClusters[0].interpretation,
    'one-byte-identical-proposition-multiple-exact-evidence-references');
  assert.equal(map.modelCalls, 0);
  assert.equal(map.networkCalls, 0);
  assert.equal(map.navigationOnly, true);
  assert.equal(map.exactSourcesRemainAuthority, true);
  assert.equal(map.businessEntityEvidenceNeighborhoodCount, 2);
  assert.deepEqual(map.businessEntityEvidenceNeighborhoods.map((row) => row.businessEntityKey),
    ['invoice:1626', 'sku:abc']);
  assert.ok(map.businessEntityEvidenceNeighborhoods.every((row) => row.namespace === 'acme'
    && row.memberCount === 2 && row.interpretation === 'shared-business-entity-key-navigation-not-semantic-equivalence'));
});

test('uses a canonical field value to suppress presentation-only revisions while preserving exact Evidence', () => {
  const oldTask = 'Assignees: Amanda Wang\n';
  const newTask = 'Assignees: Amanda Wang <amanda@example.com>\n';
  const canonicalValue = {
    kind: 'OpenOntologyCanonicalActorSetV1',
    home: 'ObjectDef/InstanceRef',
    actors: [{ actorKind: 'person', canonicalLabel: 'amanda wang' }],
  };
  const sources = [
    source('clickup/acme/old-owner.md', '2026-01-01T00:00:00.000Z', oldTask),
    source('clickup/acme/new-owner.md', '2026-02-01T00:00:00.000Z', newTask),
  ];
  const map = compileSourceNativeObjectMap({ sources, nativeObjectInputs: [
    {
      relativePath: sources[0].relativePath,
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-owner' },
      fields: [{ ...span(oldTask, 'assignees', 'Amanda Wang'), canonicalValue }],
    },
    {
      relativePath: sources[1].relativePath,
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-owner' },
      fields: [{ ...span(newTask, 'assignees', 'Amanda Wang <amanda@example.com>'), canonicalValue }],
    },
  ] });
  assert.equal(map.fieldRevisionCount, 0);
  assert.deepEqual(map.nativeObjects.map((row) => row.fields[0].value).sort(),
    ['Amanda Wang', 'Amanda Wang <amanda@example.com>']);
  assert.ok(map.nativeObjects.every((row) => row.fields[0].canonicalValue.home
    === 'ObjectDef/InstanceRef'));
});

test('scopes duplicate Evidence and business-entity neighborhoods by namespace', () => {
  const body = 'Invoice 1626 could not be pushed.\n';
  const sources = [
    source('pylon/acme/a.md', '2026-03-01T00:00:00.000Z', body),
    source('slack/acme/a.md', '2026-03-02T00:00:00.000Z', body),
    source('slack/other/a.md', '2026-03-03T00:00:00.000Z', body),
  ];
  const nativeObjectInputs = sources.map((row, index) => ({
    relativePath: row.relativePath,
    objectIdentity: {
      home: 'ObjectDef/InstanceRef',
      sourceSystem: row.sourceType,
      objectType: 'message',
      namespace: row.relativePath.split('/')[1],
      externalId: `message-${index}`,
    },
    businessEntityKeys: ['invoice:1626'],
    ...(row.sourceType === 'pylon' ? { transportOriginSystem: 'slack' } : {}),
    fields: [span(body, 'messageText', 'Invoice 1626 could not be pushed.')],
    duplicateEvidenceFieldPaths: ['messageText'],
  }));
  const map = compileSourceNativeObjectMap({ sources, nativeObjectInputs });
  assert.equal(map.duplicateEvidenceClusterCount, 1);
  assert.equal(map.duplicateEvidenceClusters[0].namespace, 'acme');
  assert.equal(map.duplicateEvidenceClusters[0].evidence.length, 2);
  assert.equal(map.businessEntityEvidenceNeighborhoodCount, 1);
  assert.equal(map.businessEntityEvidenceNeighborhoods[0].namespace, 'acme');
  assert.equal(map.businessEntityEvidenceNeighborhoods[0].sourceSystemCount, 2);
  assert.equal(map.businessEntityEvidenceNeighborhoods[0].evidenceLineageCount, 1);
  assert.equal(map.businessEntityEvidenceNeighborhoods[0].dependentTransportCopyCount, 1);
  assert.deepEqual([...new Set(map.businessEntityEvidenceNeighborhoods[0].members
    .map((row) => row.evidenceLineageSha256))].length, 1);
  assert.deepEqual(map.businessEntityEvidenceNeighborhoods[0].members.map((row) => row.relativePath),
    ['pylon/acme/a.md', 'slack/acme/a.md']);
});

test('does not collapse distinct Slack-origin records into one lineage from transport type alone', () => {
  const sources = [
    source('pylon/acme/a.md', '2026-03-01T00:00:00.000Z', 'PO 3753778 was reported as blocked.\n'),
    source('pylon/acme/b.md', '2026-03-02T00:00:00.000Z', 'PO 3753778 had pallet quantity zero.\n'),
    source('pylon/acme/c.md', '2026-03-03T00:00:00.000Z', 'PO 3753778 retriggered successfully.\n'),
  ];
  const map = compileSourceNativeObjectMap({
    sources,
    nativeObjectInputs: sources.map((row, index) => ({
      relativePath: row.relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'pylon', objectType: 'ticket',
        namespace: 'acme', externalId: `ticket-${index}`,
      },
      businessEntityKeys: ['po:3753778'],
      transportOriginSystem: 'slack',
      fields: [span(row.content, 'content', row.content.trim())],
      duplicateEvidenceFieldPaths: ['content'],
    })),
  });
  assert.equal(map.duplicateEvidenceClusterCount, 0);
  assert.equal(map.businessEntityEvidenceNeighborhoodCount, 1);
  assert.equal(map.businessEntityEvidenceNeighborhoods[0].evidenceLineageCount, 3);
  assert.equal(map.businessEntityEvidenceNeighborhoods[0].dependentTransportCopyCount, 0);
  assert.equal(map.businessEntityEvidenceNeighborhoods[0].lineageResolution,
    'byte-identical-proposition-set-plus-transport-origin');
  assert.equal(map.businessEntityEvidenceNeighborhoods[0].transportOriginAloneCollapsesLineage, false);
});

test('persists the map as an immutable object and validates exact replay', () => {
  const content = '# Current task title\n';
  const sources = [source('clickup/acme/task.md', '2026-01-01T00:00:00.000Z', content)];
  const nativeObjectInputs = [{
    relativePath: sources[0].relativePath,
    objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1' },
    fields: [span(content, 'title', 'Current task title')],
  }];
  const backend = openFileObjectBackend({ root: mkdtempSync(join(tmpdir(), 'oont-native-object-map-')) });
  const materialized = materializeSourceNativeObjectMap({ backend, sources, nativeObjectInputs });
  const replay = materializeSourceNativeObjectMap({ backend, sources, nativeObjectInputs });
  const opened = openSourceNativeObjectMap({ backend, nativeObjectMapSha256: materialized.map.nativeObjectMapSha256 });
  assert.equal(replay.receipt.replayed, true);
  assert.deepEqual(opened.map, materialized.map);
  assert.equal(opened.key, materialized.receipt.key);
});

test('rejects adapter spans that are not exact source bytes and ambiguous revision chronology', () => {
  const content = '# Actual title\n';
  const sources = [source('clickup/acme/task.md', '2026-01-01T00:00:00.000Z', content)];
  assert.throws(() => compileSourceNativeObjectMap({ sources, nativeObjectInputs: [{
    relativePath: sources[0].relativePath,
    objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1' },
    fields: [{ fieldPath: 'title', value: 'Invented title', codeUnitStart: content.indexOf('Actual title') }],
  }] }), { code: 'SOURCE_NATIVE_FIELD_SPAN' });

  const left = '# Left title\n';
  const right = '# Right title\n';
  const tiedSources = [
    source('clickup/acme/left.md', '2026-01-01T00:00:00.000Z', left),
    source('clickup/acme/right.md', '2026-01-01T00:00:00.000Z', right),
  ];
  assert.throws(() => compileSourceNativeObjectMap({ sources: tiedSources, nativeObjectInputs: [
    {
      relativePath: tiedSources[0].relativePath,
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1' },
      fields: [span(left, 'title', 'Left title')],
    },
    {
      relativePath: tiedSources[1].relativePath,
      objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1' },
      fields: [span(right, 'title', 'Right title')],
    },
  ] }), { code: 'SOURCE_NATIVE_REVISION_ORDER' });
});

test('rejects a self-consistently rehashed map that violates compiled field invariants', () => {
  const content = '# Actual title\n';
  const sources = [source('clickup/acme/task.md', '2026-01-01T00:00:00.000Z', content)];
  const tampered = structuredClone(compileSourceNativeObjectMap({
    sources,
    nativeObjectInputs: [{
      relativePath: sources[0].relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1',
      },
      fields: [span(content, 'title', 'Actual title')],
    }],
  }));
  const field = tampered.nativeObjects[0].fields[0];
  field.fieldPath = 'invalid field path';
  const { fieldSha256: _fieldSha256, ...fieldCore } = field;
  field.fieldSha256 = stableObjectSha256(fieldCore);
  const object = tampered.nativeObjects[0];
  const { nativeObjectSha256: _nativeObjectSha256, ...objectCore } = object;
  object.nativeObjectSha256 = stableObjectSha256(objectCore);
  const { nativeObjectMapSha256: _nativeObjectMapSha256, ...mapCore } = tampered;
  tampered.nativeObjectMapSha256 = stableObjectSha256(mapCore);
  assert.throws(() => validateSourceNativeObjectMap(tampered), { code: 'SOURCE_NATIVE_MAP_FIELD' });
});
