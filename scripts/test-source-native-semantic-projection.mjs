import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildSourceNativeProduct,
  compileProofSufficiencyContract,
  compileSourceNativeProofAuthorityProjection,
  evaluateProofSufficiencyContract,
  objectBytesSha256,
  openProductState,
  proofAuthorityForProjection,
  stableObjectSha256,
} from '../dist/src/kernel.mjs';

const CONTENT = 'Validation status: passed.';
const VALUE = 'passed';

function buildFixture(artifactRoot, { withCounterevidence = false } = {}) {
  const statusPath = withCounterevidence
    ? 'linear/northwind/issue-1-status.txt' : 'linear/northwind/issue-1.txt';
  const exceptionContent = 'Exception: payment evidence remained unreviewed.';
  const exceptionValue = 'payment evidence remained unreviewed';
  const identity = {
    home: 'ObjectDef/InstanceRef', sourceSystem: 'linear', objectType: 'issue',
    namespace: 'northwind', externalId: 'issue-1',
  };
  const sources = [{
    relativePath: statusPath,
    sourceType: 'linear',
    occurredAt: '2026-09-01T10:00:00.000Z',
    content: CONTENT,
  }];
  const nativeObjectInputs = [{
    relativePath: statusPath,
    objectIdentity: identity,
    businessEntityKeys: ['issue:issue-1'],
    fields: [{
      fieldPath: 'validationStatus', propositionFamilyKey: 'issue-validation',
      businessEntityKeys: ['issue:issue-1'], value: VALUE,
      codeUnitStart: CONTENT.indexOf(VALUE),
      validAt: '2026-09-01T09:59:00.000Z', knownAt: '2026-09-01T10:00:00.000Z',
      canonicalProposition: {
        kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
        propositionKey: 'issue-1-validation-passed',
        actorHome: 'ObjectDef/InstanceRef',
        stateHome: 'Claim/PropositionRevision-payload',
        actorKind: 'issue', predicate: 'has-validation-status', state: 'passed',
        dimension: 'issue-validation', canonicalRoles: ['state'],
        modality: 'observed', polarity: 'positive',
        businessEntityKeys: ['issue:issue-1'],
        extractionAuthority: 'deterministic-source-adapter-v1',
        relations: [],
      },
    }],
  }];
  if (withCounterevidence) {
    sources.push({
      relativePath: 'linear/northwind/issue-1-exception.txt',
      sourceType: 'linear',
      occurredAt: '2026-09-01T10:01:00.000Z',
      content: exceptionContent,
    });
    nativeObjectInputs.push({
      relativePath: 'linear/northwind/issue-1-exception.txt',
      objectIdentity: identity,
      businessEntityKeys: ['issue:issue-1'],
      fields: [{
        fieldPath: 'validationException',
        propositionFamilyKey: 'issue-validation-exception',
        businessEntityKeys: ['issue:issue-1'], value: exceptionValue,
        codeUnitStart: exceptionContent.indexOf(exceptionValue),
        validAt: '2026-09-01T09:58:00.000Z', knownAt: '2026-09-01T10:01:00.000Z',
        canonicalProposition: {
          kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
          propositionKey: 'issue-1-payment-unreviewed',
          actorHome: 'ObjectDef/InstanceRef',
          stateHome: 'Claim/PropositionRevision-payload',
          actorKind: 'issue', predicate: 'has-validation-exception',
          state: 'payment evidence remained unreviewed',
          dimension: 'issue-validation-exception',
          canonicalRoles: ['counterevidence'], modality: 'observed', polarity: 'negative',
          businessEntityKeys: ['issue:issue-1'],
          extractionAuthority: 'deterministic-source-adapter-v1',
          relations: [{
            kind: 'OpenOntologySourceNativePropositionRelationV1',
            type: 'qualifies',
            targetPropositionKey: 'issue-1-validation-passed',
          }],
        },
      }],
    });
  }
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
        fields: [{ fieldPath: 'validationStatus', aliases: ['validation status'] },
          ...(withCounterevidence ? [{
            fieldPath: 'validationException', aliases: ['validation exception'],
          }] : [])],
      }],
      sources,
      nativeObjectInputs,
    },
  });
  return openProductState({ artifactRoot });
}

function rehashFieldMutation(map, objectIndex, fieldIndex) {
  const field = map.nativeObjects[objectIndex].fields[fieldIndex];
  const { fieldSha256: _fieldSha256, ...fieldCore } = field;
  field.fieldSha256 = stableObjectSha256(fieldCore);
  const object = map.nativeObjects[objectIndex];
  const { nativeObjectSha256: _objectSha256, ...objectCore } = object;
  object.nativeObjectSha256 = stableObjectSha256(objectCore);
  const { nativeObjectMapSha256: _mapSha256, ...mapCore } = map;
  map.nativeObjectMapSha256 = stableObjectSha256(mapCore);
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
    rehashFieldMutation(map, 0, 0);

    assert.throws(() => compileSourceNativeProofAuthorityProjection({
      sourceNativeObjectMap: map,
      namespace: 'northwind',
    }), { code: 'SOURCE_NATIVE_MAP_FIELD' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compiles a typed counterevidence relation between exact propositions', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-relation-'));
  try {
    const state = buildFixture(root, { withCounterevidence: true });
    const projection = compileSourceNativeProofAuthorityProjection({
      sourceNativeObjectMap: state.objectOnt.map,
      namespace: 'northwind',
    });

    assert.deepEqual(projection.relations, [{
      type: 'qualifies',
      sourceProjectionItemId: 'issue-1-payment-unreviewed',
      targetProjectionItemId: 'issue-1-validation-passed',
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('closes a qualified proof from the source-native relation census', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-proof-'));
  try {
    const projection = compileSourceNativeProofAuthorityProjection({
      sourceNativeObjectMap: buildFixture(root, { withCounterevidence: true }).objectOnt.map,
      namespace: 'northwind',
    });
    const contract = compileProofSufficiencyContract({
      questionKind: 'issue-validation-state',
      obligations: [{
        obligationId: 'state', propositionFamily: 'state', role: 'support',
        required: true, relationshipAnyOf: [], description: 'Current validation state.',
      }, {
        obligationId: 'exact', propositionFamily: 'exact-support', role: 'support',
        required: true, relationshipAnyOf: [], description: 'Exact source bytes.',
      }, {
        obligationId: 'counter', propositionFamily: 'counterevidence',
        role: 'invalidator', required: true, minimumCount: 0,
        relationshipAnyOf: ['contradicts', 'qualifies'],
        relationshipDirection: 'outbound',
        relationshipTargetPropositionFamily: 'state',
        description: 'Complete counterevidence census.',
      }],
      sourceProjectionAuthority: proofAuthorityForProjection(projection),
      sufficiencyRule: 'close when support and complete invalidator census close',
      stopWhen: 'proof is closed or one required obligation remains unresolved',
    });
    const propositions = projection.items.map((item) => ({
      revisionId: `revision:${item.sourceProjectionItemId}`,
      ...item,
    }));
    const relations = projection.relations.map((relation) => ({
      type: relation.type,
      sourceRevisionId: `revision:${relation.sourceProjectionItemId}`,
      targetRevisionId: `revision:${relation.targetProjectionItemId}`,
    }));
    const result = evaluateProofSufficiencyContract({
      contract, propositions, relations, authorityProjection: projection,
    });

    assert.equal(result.proofClosed, true);
    assert.equal(result.proofDisposition, 'qualified');
    assert.equal(result.projectionRelationCensus.state, 'closed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a relation whose target is outside the namespace projection', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-dangling-'));
  try {
    const map = structuredClone(buildFixture(root, { withCounterevidence: true }).objectOnt.map);
    const counterevidence = map.nativeObjects[1].fields[0].canonicalProposition;
    counterevidence.relations[0].targetPropositionKey = 'other-customer-proposition';
    rehashFieldMutation(map, 1, 0);

    assert.throws(() => compileSourceNativeProofAuthorityProjection({
      sourceNativeObjectMap: map,
      namespace: 'northwind',
    }), { code: 'SOURCE_NATIVE_SEMANTIC_PROJECTION_RELATION_TARGET' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds a root proposition to its inbound counterevidence closure', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-root-'));
  try {
    const map = buildFixture(root, { withCounterevidence: true }).objectOnt.map;
    const projection = compileSourceNativeProofAuthorityProjection({
      sourceNativeObjectMap: map,
      namespace: 'northwind',
      rootPropositionKeys: ['issue-1-validation-passed'],
    });

    assert.deepEqual(projection.items.map((item) => item.sourceProjectionItemId), [
      'issue-1-payment-unreviewed',
      'issue-1-validation-passed',
    ]);
    assert.throws(() => compileSourceNativeProofAuthorityProjection({
      sourceNativeObjectMap: map,
      namespace: 'northwind',
      rootPropositionKeys: ['missing-proposition'],
    }), { code: 'SOURCE_NATIVE_SEMANTIC_PROJECTION_ROOT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
