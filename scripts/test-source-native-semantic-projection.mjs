import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildSourceNativeProduct,
  compileSourceNativeProofAuthorityProjection,
  objectBytesSha256,
  openProductState,
  stableObjectSha256,
} from '../dist/src/kernel.mjs';

const CONTENT = 'Validation status: passed.';
const VALUE = 'passed';

function buildFixture(artifactRoot) {
  buildSourceNativeProduct({
    artifactRoot,
    input: {
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeBuildInputV1',
      ontId: 'semantic-projection-fixture',
      namespace: 'northwind',
      querySchemas: [{
        sourceSystem: 'linear',
        objectType: 'issue',
        aliases: ['issue'],
        fields: [{ fieldPath: 'validationStatus', aliases: ['validation status'] }],
      }],
      sources: [{
        relativePath: 'linear/northwind/issue-1.txt',
        sourceType: 'linear',
        occurredAt: '2026-09-01T10:00:00.000Z',
        content: CONTENT,
      }],
      nativeObjectInputs: [{
        relativePath: 'linear/northwind/issue-1.txt',
        objectIdentity: {
          home: 'ObjectDef/InstanceRef',
          sourceSystem: 'linear',
          objectType: 'issue',
          namespace: 'northwind',
          externalId: 'issue-1',
        },
        businessEntityKeys: ['issue:issue-1'],
        fields: [{
          fieldPath: 'validationStatus',
          propositionFamilyKey: 'issue-validation',
          businessEntityKeys: ['issue:issue-1'],
          value: VALUE,
          codeUnitStart: CONTENT.indexOf(VALUE),
          validAt: '2026-09-01T09:59:00.000Z',
          knownAt: '2026-09-01T10:00:00.000Z',
          canonicalProposition: {
            kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
            propositionKey: 'issue-1-validation-passed',
            actorHome: 'ObjectDef/InstanceRef',
            stateHome: 'Claim/PropositionRevision-payload',
            actorKind: 'issue',
            predicate: 'has-validation-status',
            state: 'passed',
            dimension: 'issue-validation',
            canonicalRoles: ['state'],
            modality: 'observed',
            polarity: 'positive',
            businessEntityKeys: ['issue:issue-1'],
            extractionAuthority: 'deterministic-source-adapter-v1',
          },
        }],
      }],
    },
  });
  return openProductState({ artifactRoot });
}

test('compiles an exact source-native canonical proposition into the proof authority census', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-projection-'));
  try {
    const state = buildFixture(root);
    const projection = compileSourceNativeProofAuthorityProjection({
      sourceNativeObjectMap: state.objectOnt.map,
      namespace: 'northwind',
    });

    assert.equal(projection.kind, 'OpenOntologyProofAuthorityProjectionV1');
    assert.equal(projection.sourceProjectionKind,
      'OpenOntologySourceNativeSemanticProjectionV1');
    assert.equal(projection.items.length, 1);
    assert.equal(projection.relations.length, 0);
    assert.deepEqual(projection.items[0], {
      sourceProjectionItemId: 'issue-1-validation-passed',
      familyId: 'issue-validation',
      canonicalRoles: ['state'],
      modality: 'observed',
      polarity: 'positive',
      actorRef: state.objectOnt.map.nativeObjects[0].objectIdentitySha256,
      validAt: '2026-09-01T09:59:00.000Z',
      knownAt: '2026-09-01T10:00:00.000Z',
      exactEvidenceReferences: [{
        sourceRef: 'linear/northwind/issue-1.txt',
        sourceSha256: state.objectOnt.map.nativeObjects[0].sourceSha256,
        byteStart: Buffer.byteLength('Validation status: '),
        byteEnd: Buffer.byteLength('Validation status: passed'),
        textSha256: objectBytesSha256(Buffer.from('passed')),
      }],
    });
    assert.match(projection.sourceProjectionSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.match(projection.proofCensusSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.isFrozen(projection), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a self-consistently rehashed canonical proposition outside the locked taxonomy', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-tamper-'));
  try {
    const map = structuredClone(buildFixture(root).objectOnt.map);
    const field = map.nativeObjects[0].fields[0];
    field.canonicalProposition.canonicalRoles = ['fiction'];
    const { fieldSha256: _fieldSha256, ...fieldCore } = field;
    field.fieldSha256 = stableObjectSha256(fieldCore);
    const object = map.nativeObjects[0];
    const { nativeObjectSha256: _objectSha256, ...objectCore } = object;
    object.nativeObjectSha256 = stableObjectSha256(objectCore);
    const { nativeObjectMapSha256: _mapSha256, ...mapCore } = map;
    map.nativeObjectMapSha256 = stableObjectSha256(mapCore);

    assert.throws(() => compileSourceNativeProofAuthorityProjection({
      sourceNativeObjectMap: map,
      namespace: 'northwind',
    }), { code: 'SOURCE_NATIVE_MAP_FIELD' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
