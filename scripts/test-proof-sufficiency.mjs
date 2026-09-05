#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileProofAuthorityProjection,
  compileProofSufficiencyContract,
  evaluateProjectionRelationCensus,
  evaluateProofSufficiencyContract,
  proofAuthorityForProjection,
  stableObjectSha256,
  validateProofAuthorityProjection,
  validateProofSufficiencyContract,
} from '../dist/src/kernel.mjs';

const TIME = '2026-09-01T00:00:00.000Z';
const SOURCE_PROJECTION_KIND = 'fixture-semantic-projection-v1';

function obligation({
  id,
  family,
  role = 'support',
  required = true,
  ...rest
}) {
  return {
    obligationId: id,
    propositionFamily: family,
    role,
    required,
    relationshipAnyOf: [],
    description: `Close ${family}.`,
    ...rest,
  };
}

function invalidator({ id = 'counter', ...rest } = {}) {
  return obligation({
    id,
    family: 'counterevidence',
    role: 'invalidator',
    minimumCount: 0,
    relationshipAnyOf: ['contradicts', 'qualifies'],
    relationshipDirection: 'outbound',
    relationshipTargetPropositionFamily: 'outcome',
    ...rest,
  });
}

function evidence(id) {
  return {
    sourceRef: `fixture/${id}.json`,
    sourceSha256: stableObjectSha256({ source: id }),
    byteStart: 0,
    byteEnd: 1,
    textSha256: stableObjectSha256({ text: id }),
  };
}

function proposition({
  id,
  familyId = 'validation',
  roles,
  modality = 'observed',
  polarity = 'positive',
  actorBound = true,
  chronologyBound = true,
  exactSupport = true,
}) {
  return {
    revisionId: id,
    sourceProjectionItemId: id,
    familyId,
    canonicalRoles: roles,
    modality,
    polarity,
    actorRef: actorBound ? `actor:${id}` : null,
    validAt: chronologyBound ? TIME : null,
    knownAt: chronologyBound ? TIME : null,
    exactEvidenceReferences: exactSupport ? [evidence(id)] : [],
  };
}

function authorityItem({ revisionId: _revisionId, ...item }) {
  return item;
}

function authorityRelation(row) {
  return {
    type: row.type,
    sourceProjectionItemId: row.sourceRevisionId,
    targetProjectionItemId: row.targetRevisionId,
  };
}

function projection(items, relations = []) {
  return compileProofAuthorityProjection({
    sourceProjectionKind: SOURCE_PROJECTION_KIND,
    sourceProjectionSha256: stableObjectSha256({
      sourceProjectionKind: SOURCE_PROJECTION_KIND,
      itemIds: items.map((row) => row.sourceProjectionItemId).sort(),
      relations,
    }),
    items: items.map(authorityItem),
    relations: relations.map(authorityRelation),
  });
}

function contract(obligations, { authorityProjection = null } = {}) {
  const authorityObligations = authorityProjection !== null
    && !obligations.some((row) => row.role === 'invalidator')
    ? [...obligations, invalidator()]
    : obligations;
  const completeObligations = authorityObligations.some((row) =>
    row.propositionFamily === 'exact-support' && row.required)
    ? authorityObligations
    : [...authorityObligations, obligation({ id: 'exact-support', family: 'exact-support' })];
  return compileProofSufficiencyContract({
    questionKind: 'validation-outcome',
    obligations: completeObligations,
    ...(authorityProjection === null ? {} : {
      sourceProjectionAuthority: proofAuthorityForProjection(authorityProjection),
    }),
    sufficiencyRule: 'Every required obligation and the projection relation census must close.',
    stopWhen: 'Stop when proof closes or one required obligation remains unresolved.',
  });
}

function obligationResult(evaluation, obligationId) {
  return evaluation.obligations.find((row) => row.obligationId === obligationId);
}

test('compiles a content-bound projection-aware proof contract', () => {
  const action = proposition({ id: 'action-1', roles: ['action'] });
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const authorityProjection = projection([action, outcome]);
  const result = contract([
    obligation({ id: 'action', family: 'action' }),
    obligation({ id: 'outcome', family: 'outcome', sameFamilyAsObligationId: 'action' }),
  ], { authorityProjection });

  assert.equal(result.kind, 'OpenOntologyProofSufficiencyContractV1');
  assert.equal(result.questionOnly, false);
  assert.deepEqual(result.requiredPropositionFamilies,
    ['action', 'counterevidence', 'exact-support', 'outcome']);
  assert.equal(result.sourceProjectionAuthority.proofCensusSha256,
    authorityProjection.proofCensusSha256);
  assert.match(result.contractSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.obligations), true);
});

test('rejects contract shapes that can silently weaken proof', () => {
  const counter = proposition({ id: 'counter-1', roles: ['counterevidence'] });
  const authorityProjection = projection([counter]);
  assert.throws(() => contract([
    obligation({ id: 'same', family: 'action' }),
    obligation({ id: 'same', family: 'outcome' }),
  ]), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    obligation({ id: 'support', family: 'outcome', minimumCount: 0 }),
  ]), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    invalidator(),
  ]), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    invalidator({ expectedSourceProjectionItemIds: ['counter-1', 'counter-1'] }),
  ], { authorityProjection }), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    invalidator({ relationshipAnyOf: [] }),
  ], { authorityProjection }), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    invalidator({ relationshipAnyOf: ['mentions'] }),
  ], { authorityProjection }), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    invalidator({ relationshipAnyOf: ['qualifies'] }),
  ], { authorityProjection }), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    invalidator({ allowedModalities: ['observed'] }),
  ], { authorityProjection }), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    obligation({ id: 'outcome', family: 'outcome', sameFamilyAsObligationId: 'action' }),
    obligation({ id: 'action', family: 'action' }),
  ]), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => contract([
    obligation({ id: 'outcome', family: 'outcome', allowedModalities: [] }),
  ]), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => compileProofSufficiencyContract({
    questionKind: 'state',
    obligations: [obligation({ id: 'state', family: 'state' })],
    sufficiencyRule: 'State must close.',
    stopWhen: 'Stop after closure.',
  }), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => compileProofSufficiencyContract({
    questionKind: 'state',
    obligations: [
      obligation({ id: 'state', family: 'state' }),
      obligation({ id: 'exact-support', family: 'exact-support' }),
    ],
    sourceProjectionAuthority: proofAuthorityForProjection(authorityProjection),
    sufficiencyRule: 'State must close.',
    stopWhen: 'Stop after closure.',
  }), /PROOF_SUFFICIENCY_CONTRACT/u);
});

test('rejects contract and authority content that no longer matches its identity', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const otherOutcome = proposition({ id: 'outcome-2', roles: ['outcome'] });
  const authorityProjection = projection([outcome]);
  const original = contract([obligation({ id: 'outcome', family: 'outcome' })], {
    authorityProjection,
  });
  assert.throws(() => validateProofSufficiencyContract({
    ...original,
    obligations: original.obligations.map((row) => row.obligationId === 'outcome'
      ? { ...row, description: 'Weaker.' } : row),
  }), /PROOF_SUFFICIENCY_CONTRACT/u);
  assert.throws(() => validateProofAuthorityProjection({
    ...authorityProjection,
    items: [],
  }), /PROOF_AUTHORITY_PROJECTION/u);
  assert.throws(() => projection([outcome, otherOutcome], [{
    type: 'contradicts', sourceRevisionId: 'outcome-1', targetRevisionId: 'outcome-2',
  }]), /PROOF_AUTHORITY_PROJECTION/u);
});

test('closes coherent action, outcome, actor, chronology, and exact support', () => {
  const action = proposition({ id: 'action-1', roles: ['action'] });
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const proofContract = contract([
    obligation({ id: 'actor', family: 'actor' }),
    obligation({ id: 'action', family: 'action', allowedModalities: ['observed'] }),
    obligation({ id: 'outcome', family: 'outcome', sameFamilyAsObligationId: 'action' }),
    obligation({ id: 'chronology', family: 'chronology' }),
  ]);
  const result = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [action, outcome],
    relations: [],
  });

  assert.equal(result.proofClosed, true);
  assert.equal(result.proofDisposition, 'supported');
  assert.equal(result.obligations.every((row) => row.state === 'closed'), true);
  assert.deepEqual(obligationResult(result, 'outcome').matchedSourceProjectionItemIds,
    ['outcome-1']);
  assert.equal(result.projectionRelationCensus, null);
});

test('does not close actor, chronology, or exact support from boolean assertions', () => {
  const unbound = proposition({
    id: 'outcome-1', roles: ['outcome'], actorBound: false,
    chronologyBound: false, exactSupport: false,
  });
  const result = evaluateProofSufficiencyContract({
    contract: contract([
      obligation({ id: 'actor', family: 'actor' }),
      obligation({ id: 'chronology', family: 'chronology' }),
    ]),
    propositions: [unbound],
    relations: [],
  });

  assert.equal(result.proofClosed, false);
  assert.equal(obligationResult(result, 'actor').state, 'unresolved');
  assert.equal(obligationResult(result, 'chronology').state, 'unresolved');
  assert.equal(obligationResult(result, 'exact-support').state, 'unresolved');
});

test('enforces the immutable invalidator census when expected IDs are omitted', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const counter = proposition({ id: 'counter-1', roles: ['counterevidence'] });
  const qualifies = {
    type: 'qualifies', sourceRevisionId: 'counter-1', targetRevisionId: 'outcome-1',
  };
  const authorityProjection = projection([outcome, counter], [qualifies]);
  const proofContract = contract([
    obligation({ id: 'outcome', family: 'outcome' }),
    invalidator(),
  ], { authorityProjection });
  const result = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome],
    relations: [],
    authorityProjection,
  });

  assert.equal(result.proofClosed, false);
  assert.equal(result.projectionRelationCensus.state, 'mismatch');
  assert.equal(obligationResult(result, 'counter').state, 'unresolved');
  assert.deepEqual(obligationResult(result, 'counter').authoritativeSourceProjectionItemIds,
    ['counter-1']);
});

test('requires the exact authority projection bound by the contract', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const counter = proposition({ id: 'counter-1', roles: ['counterevidence'] });
  const authorityProjection = projection([outcome, counter]);
  const proofContract = contract([
    invalidator(),
  ], { authorityProjection });

  assert.throws(() => evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome],
    relations: [],
  }), /PROOF_SUFFICIENCY_EVALUATOR/u);
  assert.throws(() => evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome],
    relations: [],
    authorityProjection: { ...authorityProjection, items: [authorityItem(outcome)] },
  }), /PROOF_AUTHORITY_PROJECTION/u);
  assert.throws(() => evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [{ ...outcome, validAt: '2026-09-02T00:00:00.000Z' }, counter],
    relations: [],
    authorityProjection,
  }), /PROOF_SUFFICIENCY_EVALUATOR/u);
  assert.throws(() => evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [{
      ...outcome, revisionId: 'missing', sourceProjectionItemId: 'missing',
    }, counter],
    relations: [],
    authorityProjection,
  }), /PROOF_SUFFICIENCY_EVALUATOR/u);
  assert.throws(() => evaluateProofSufficiencyContract({
    contract: contract([obligation({ id: 'outcome', family: 'outcome' })]),
    propositions: [outcome],
    relations: [],
    authorityProjection: projection([outcome]),
  }), /PROOF_SUFFICIENCY_EVALUATOR/u);
});

test('refuses a caller-supplied expected census that disagrees with authority', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const counter = proposition({ id: 'counter-1', roles: ['counterevidence'] });
  const authorityProjection = projection([outcome, counter]);
  const proofContract = contract([
    invalidator({
      expectedSourceProjectionItemIds: [],
    }),
  ], { authorityProjection });
  const result = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, counter],
    relations: [],
    authorityProjection,
  });

  assert.equal(result.proofClosed, false);
  assert.equal(obligationResult(result, 'counter').state, 'unresolved');
});

test('supports an authoritative empty counterevidence census', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const authorityProjection = projection([outcome]);
  const proofContract = contract([
    obligation({ id: 'outcome', family: 'outcome' }),
    invalidator(),
  ], { authorityProjection });
  const result = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome],
    relations: [],
    authorityProjection,
  });

  assert.equal(result.proofClosed, true);
  assert.equal(result.proofDisposition, 'supported');
  assert.deepEqual(obligationResult(result, 'counter').authoritativeSourceProjectionItemIds, []);
});

test('does not close live counterevidence without a canonical disposition relation', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const counter = proposition({ id: 'counter-1', roles: ['counterevidence'] });
  const authorityProjection = projection([outcome, counter]);
  const proofContract = contract([
    obligation({ id: 'outcome', family: 'outcome' }),
    invalidator(),
  ], { authorityProjection });
  const result = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, counter],
    relations: [],
    authorityProjection,
  });

  assert.equal(result.proofClosed, false);
  assert.equal(result.proofDisposition, 'unresolved');
  assert.equal(obligationResult(result, 'counter').state, 'unresolved');
});

test('does not hide evidence-free counterevidence from the authority census', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const counter = proposition({
    id: 'counter-1', roles: ['counterevidence'], exactSupport: false,
  });
  const authorityProjection = projection([outcome, counter]);
  const proofContract = contract([
    obligation({ id: 'outcome', family: 'outcome' }),
    invalidator(),
  ], { authorityProjection });
  const result = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, counter],
    relations: [],
    authorityProjection,
  });

  assert.equal(result.proofClosed, false);
  assert.equal(result.proofDisposition, 'unresolved');
  assert.deepEqual(obligationResult(result, 'counter').authoritativeSourceProjectionItemIds,
    ['counter-1']);
  assert.deepEqual(obligationResult(result, 'counter').matchedSourceProjectionItemIds, []);
});

test('requires the configured relation direction and target family', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const counter = proposition({ id: 'counter-1', roles: ['counterevidence'] });
  const state = proposition({ id: 'state-1', roles: ['state'] });
  const qualifies = {
    type: 'qualifies', sourceRevisionId: 'counter-1', targetRevisionId: 'outcome-1',
  };
  const authorityProjection = projection([outcome, counter, state], [qualifies]);
  const proofContract = contract([
    obligation({ id: 'outcome', family: 'outcome' }),
    invalidator(),
  ], { authorityProjection });
  const wrongTarget = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, counter, state],
    relations: [{
      type: 'qualifies', sourceRevisionId: 'counter-1', targetRevisionId: 'state-1',
    }],
    authorityProjection,
  });
  const wrongDirection = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, counter, state],
    relations: [{
      type: 'qualifies', sourceRevisionId: 'outcome-1', targetRevisionId: 'counter-1',
    }],
    authorityProjection,
  });
  const correct = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, counter, state],
    relations: [qualifies],
    authorityProjection,
  });

  assert.equal(obligationResult(wrongTarget, 'counter').state, 'unresolved');
  assert.equal(obligationResult(wrongDirection, 'counter').state, 'unresolved');
  assert.equal(correct.proofClosed, true);
  assert.equal(correct.proofDisposition, 'qualified');
});

test('requires every authoritative relation that disposes counterevidence', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const counter = proposition({ id: 'counter-1', roles: ['counterevidence'] });
  const qualifies = {
    type: 'qualifies', sourceRevisionId: 'counter-1', targetRevisionId: 'outcome-1',
  };
  const contradicts = {
    type: 'contradicts', sourceRevisionId: 'counter-1', targetRevisionId: 'outcome-1',
  };
  const authorityProjection = projection([outcome, counter], [qualifies, contradicts]);
  const proofContract = contract([
    obligation({ id: 'outcome', family: 'outcome' }),
    invalidator(),
  ], { authorityProjection });
  const partial = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, counter],
    relations: [qualifies],
    authorityProjection,
  });
  const complete = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, counter],
    relations: [qualifies, contradicts],
    authorityProjection,
  });

  assert.equal(obligationResult(partial, 'counter').state, 'unresolved');
  assert.equal(obligationResult(partial, 'counter')
    .authoritativeSourceProjectionRelations.length, 2);
  assert.equal(obligationResult(partial, 'counter').matchedSourceProjectionRelations.length, 1);
  assert.equal(complete.proofClosed, true);
  assert.equal(complete.proofDisposition, 'contradicted');
});

test('uses the strongest counterevidence disposition across target families', () => {
  const action = proposition({ id: 'action-1', roles: ['action'] });
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const counter = proposition({ id: 'counter-1', roles: ['counterevidence'] });
  const relations = [{
    type: 'contradicts', sourceRevisionId: 'counter-1', targetRevisionId: 'action-1',
  }, {
    type: 'qualifies', sourceRevisionId: 'counter-1', targetRevisionId: 'outcome-1',
  }];
  const authorityProjection = projection([action, outcome, counter], relations);
  const proofContract = contract([
    obligation({ id: 'action', family: 'action' }),
    obligation({ id: 'outcome', family: 'outcome', sameFamilyAsObligationId: 'action' }),
    invalidator(),
  ], { authorityProjection });
  const result = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [action, outcome, counter],
    relations,
    authorityProjection,
  });

  assert.equal(result.proofClosed, true);
  assert.equal(result.proofDisposition, 'contradicted');
  assert.deepEqual(result.projectionRelationCensus.matchedSourceProjectionRelations
    .map((row) => row.type), ['contradicts', 'qualifies']);
});

test('requires same-family coherence between action and outcome', () => {
  const action = proposition({ id: 'action-1', familyId: 'migration', roles: ['action'] });
  const unrelatedOutcome = proposition({
    id: 'outcome-1', familyId: 'deployment', roles: ['outcome'],
  });
  const proofContract = contract([
    obligation({ id: 'action', family: 'action' }),
    obligation({ id: 'outcome', family: 'outcome', sameFamilyAsObligationId: 'action' }),
  ]);
  const unrelated = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [action, unrelatedOutcome],
    relations: [],
  });
  const related = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [action, { ...unrelatedOutcome, familyId: 'migration' }],
    relations: [],
  });

  assert.equal(unrelated.proofClosed, false);
  assert.equal(obligationResult(unrelated, 'outcome').state, 'unresolved');
  assert.equal(related.proofClosed, true);
});

test('gates proof closure on whole-projection relation direction and multiplicity', () => {
  const prior = proposition({ id: 'prior', roles: ['outcome'] });
  const current = proposition({ id: 'current', roles: ['outcome'] });
  const supersedes = {
    type: 'supersedes', sourceRevisionId: 'current', targetRevisionId: 'prior',
  };
  const authorityProjection = projection([prior, current], [supersedes]);
  const proofContract = contract([
    obligation({ id: 'outcome', family: 'outcome' }),
  ], { authorityProjection });
  const flippedRelation = {
    type: 'supersedes', sourceRevisionId: 'prior', targetRevisionId: 'current',
  };
  const flipped = evaluateProjectionRelationCensus({
    propositions: [prior, current],
    relations: [flippedRelation],
    authorityProjection,
  });
  const duplicated = evaluateProjectionRelationCensus({
    propositions: [prior, current],
    relations: [supersedes, supersedes],
    authorityProjection,
  });
  const changedDisposition = evaluateProjectionRelationCensus({
    propositions: [prior, current],
    relations: [{ type: 'qualifies', sourceRevisionId: 'current', targetRevisionId: 'prior' }],
    authorityProjection,
  });
  const faithful = evaluateProjectionRelationCensus({
    propositions: [prior, current],
    relations: [supersedes],
    authorityProjection,
  });
  const proofWithFlippedRelation = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [prior, current],
    relations: [flippedRelation],
    authorityProjection,
  });

  assert.equal(flipped.state, 'mismatch');
  assert.equal(duplicated.state, 'mismatch');
  assert.equal(changedDisposition.state, 'mismatch');
  assert.equal(faithful.state, 'closed');
  assert.equal(proofWithFlippedRelation.proofClosed, false);
});

test('rejects malformed proposition and relation inputs at the kernel boundary', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const proofContract = contract([obligation({ id: 'outcome', family: 'outcome' })]);

  assert.throws(() => evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [{ ...outcome, validAt: 'yesterday' }],
    relations: [],
  }), /PROOF_AUTHORITY_PROJECTION/u);
  assert.throws(() => evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome],
    relations: [{
      type: 'qualifies', sourceRevisionId: 'outcome-1', targetRevisionId: 'missing',
    }],
  }), /PROOF_SUFFICIENCY_EVALUATOR/u);
  assert.throws(() => evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome, { ...outcome, revisionId: 'outcome-2' }],
    relations: [],
  }), /PROOF_SUFFICIENCY_EVALUATOR/u);
});

test('returns deeply immutable contracts, projections, and evaluations', () => {
  const outcome = proposition({ id: 'outcome-1', roles: ['outcome'] });
  const authorityProjection = projection([outcome]);
  const proofContract = contract([obligation({ id: 'outcome', family: 'outcome' })], {
    authorityProjection,
  });
  const result = evaluateProofSufficiencyContract({
    contract: proofContract,
    propositions: [outcome],
    relations: [],
    authorityProjection,
  });

  assert.throws(() => proofContract.obligations[0].relationshipAnyOf.push('qualifies'), TypeError);
  assert.throws(() => authorityProjection.items.push(authorityItem(outcome)), TypeError);
  assert.throws(() => result.obligations[0].propositionRevisionIds.push('forged'), TypeError);
});
