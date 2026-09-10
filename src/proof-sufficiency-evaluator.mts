/** Execute one validated proof contract over canonical proposition and relation views. */
import { stableObjectText } from './canonical-content.mjs';
import {
  normalizeProofAuthorityItem,
  proofAuthorityForProjection,
  validateProofAuthorityProjection,
} from './proof-authority-projection.mjs';
import type {
  ProofAuthorityItem,
  ProofAuthorityProjection,
  ProofAuthorityRelation,
  SourceProjectionAuthority,
} from './proof-authority-projection.mjs';
import { validateProofSufficiencyContract } from './proof-sufficiency-contract.mjs';
import type {
  ProofSufficiencyContract,
  ProofSufficiencyObligation,
} from './proof-sufficiency-contract.mjs';

export interface ProofProposition extends ProofAuthorityItem {
  revisionId: string;
}

export interface ProofRelation {
  type: string;
  sourceRevisionId: string;
  targetRevisionId: string;
}

export interface ProofRelationView {
  type: string;
  sourceProjectionItemId: string;
  targetProjectionItemId: string;
}

export interface ProjectionRelationCensusEvaluation {
  schemaVersion: 1;
  kind: 'OpenOntologyProjectionRelationCensusEvaluationV1';
  state: 'closed' | 'mismatch';
  sourceProjectionAuthority: SourceProjectionAuthority;
  authoritativeSourceProjectionRelations: readonly ProofRelationView[];
  matchedSourceProjectionRelations: readonly ProofRelationView[];
}

export interface ProofObligationEvaluation {
  obligationId: string;
  propositionFamily: string;
  role: 'invalidator' | 'support';
  required: boolean;
  relationshipAnyOf: readonly string[];
  allowedModalities?: readonly string[];
  allowedPolarities?: readonly string[];
  expectedSourceProjectionItemIds?: readonly string[];
  authoritativeSourceProjectionItemIds?: readonly string[];
  matchedSourceProjectionItemIds: readonly string[];
  authoritativeSourceProjectionRelations?: readonly ProofRelationView[];
  matchedSourceProjectionRelations?: readonly ProofRelationView[];
  minimumCount?: number;
  relationshipDirection?: 'either' | 'inbound' | 'outbound';
  relationshipTargetPropositionFamily?: string;
  sameFamilyAsObligationId?: string;
  state: 'closed' | 'unresolved';
  propositionRevisionIds: readonly string[];
}

export interface ProofSufficiencyEvaluation {
  schemaVersion: 1;
  kind: 'OpenOntologyProofSufficiencyEvaluationV1';
  contractSha256: string;
  proofClosed: boolean;
  proofDisposition: 'contradicted' | 'qualified' | 'supported' | 'unresolved';
  sourceProjectionAuthority: SourceProjectionAuthority | null;
  projectionRelationCensus: ProjectionRelationCensusEvaluation | null;
  obligations: readonly ProofObligationEvaluation[];
}

export interface EvaluateProjectionRelationCensusInput {
  propositions?: unknown;
  relations?: unknown;
  authorityProjection?: unknown;
}

export interface EvaluateProofSufficiencyContractInput {
  contract?: unknown;
  propositions?: unknown;
  relations?: unknown;
  authorityProjection?: unknown;
}

type UnknownRecord = Record<string, unknown>;
type MatchableRow = ProofProposition | ProofAuthorityItem;

const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (): never => {
  const error = new TypeError('PROOF_SUFFICIENCY_EVALUATOR') as TypeError & { code: string };
  error.code = error.message;
  throw error;
};
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const plain = (value: unknown): value is UnknownRecord => value !== null
  && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (row: UnknownRecord, keys: string[]): boolean =>
  Object.keys(row).length === keys.length
  && Object.keys(row).every((key) => keys.includes(key));
const unknownList = (value: unknown): unknown[] => Array.isArray(value) ? value : fail();
const nonemptyString = (value: unknown): string => typeof value === 'string' && value.length > 0
  ? value : fail();

function authorityItemFromProposition(row: ProofProposition): ProofAuthorityItem {
  return freeze({
    sourceProjectionItemId: row.sourceProjectionItemId,
    familyId: row.familyId,
    canonicalRoles: row.canonicalRoles,
    modality: row.modality,
    polarity: row.polarity,
    actorRef: row.actorRef,
    validAt: row.validAt,
    knownAt: row.knownAt,
    exactEvidenceReferences: row.exactEvidenceReferences,
  });
}

function validateProposition(value: unknown): ProofProposition {
  const row = plain(value) ? value : fail();
  const { revisionId, ...authorityValue } = row;
  const exactRevisionId = nonemptyString(revisionId);
  const authorityItem = normalizeProofAuthorityItem(authorityValue);
  return freeze({ revisionId: exactRevisionId, ...authorityItem });
}

function validateProofRelation(value: unknown,
  propositionById: Map<string, ProofProposition>): ProofRelation {
  const row = plain(value) ? value : fail();
  if (!exactKeys(row, ['type', 'sourceRevisionId', 'targetRevisionId'])) fail();
  const type = nonemptyString(row.type);
  const sourceRevisionId = nonemptyString(row.sourceRevisionId);
  const targetRevisionId = nonemptyString(row.targetRevisionId);
  if (!propositionById.has(sourceRevisionId)
    || !propositionById.has(targetRevisionId)
    || sourceRevisionId === targetRevisionId) fail();
  return freeze({
    type,
    sourceRevisionId,
    targetRevisionId,
  });
}

function normalizePropositions(value: unknown): {
  propositions: ProofProposition[];
  propositionById: Map<string, ProofProposition>;
} {
  const propositions = unknownList(value).map(validateProposition);
  const propositionById = new Map<string, ProofProposition>(
    propositions.map((row) => [row.revisionId, row]),
  );
  if (propositionById.size !== propositions.length
    || new Set(propositions.map((row) => row.sourceProjectionItemId)).size
      !== propositions.length) fail();
  return { propositions, propositionById };
}

function normalizeRelations(value: unknown,
  propositionById: Map<string, ProofProposition>): ProofRelation[] {
  return unknownList(value).map((row) => validateProofRelation(row, propositionById));
}

function assertPropositionsMatchAuthority(propositions: ProofProposition[],
  authorityProjection: ProofAuthorityProjection): void {
  const authorityById = new Map(authorityProjection.items.map((row) =>
    [row.sourceProjectionItemId, row]));
  for (const proposition of propositions) {
    const authoritative = authorityById.get(proposition.sourceProjectionItemId);
    if (authoritative === undefined
      || stableObjectText(authorityItemFromProposition(proposition))
        !== stableObjectText(authoritative)) fail();
  }
}

function matchesFamily(row: MatchableRow, propositionFamily: string): boolean {
  if (row.exactEvidenceReferences.length === 0) return false;
  if (propositionFamily === 'actor') return row.actorRef !== null;
  if (propositionFamily === 'chronology') return row.validAt !== null && row.knownAt !== null;
  if (propositionFamily === 'exact-support') return true;
  return row.canonicalRoles.includes(propositionFamily);
}

function matchesAuthorityFamily(row: ProofAuthorityItem, propositionFamily: string): boolean {
  if (propositionFamily === 'actor') return row.actorRef !== null;
  if (propositionFamily === 'chronology') return row.validAt !== null && row.knownAt !== null;
  if (propositionFamily === 'exact-support') return row.exactEvidenceReferences.length > 0;
  return row.canonicalRoles.includes(propositionFamily);
}

function matchesConstraints(row: MatchableRow, obligation: ProofSufficiencyObligation): boolean {
  return (obligation.allowedModalities === undefined
      || obligation.allowedModalities.includes(row.modality))
    && (obligation.allowedPolarities === undefined
      || obligation.allowedPolarities.includes(row.polarity));
}

function matchesRequiredTargetConstraints<T extends MatchableRow>(row: T,
  targetFamily: string,
  obligations: readonly ProofSufficiencyObligation[]): boolean {
  return obligations
    .filter((obligation) => obligation.required
      && obligation.role === 'support'
      && obligation.propositionFamily === targetFamily)
    .every((obligation) => matchesConstraints(row, obligation));
}

function relationMatchesCandidate<T extends MatchableRow>({
  relation,
  candidateId,
  sourceId,
  targetId,
  rowById,
  obligation,
  obligations,
  familyMatcher,
}: {
  relation: { type: string };
  candidateId: string;
  sourceId: string;
  targetId: string;
  rowById: Map<string, T>;
  obligation: ProofSufficiencyObligation;
  obligations: readonly ProofSufficiencyObligation[];
  familyMatcher: (row: T, family: string) => boolean;
}): boolean {
  if (obligation.relationshipAnyOf.length > 0
    && !obligation.relationshipAnyOf.includes(relation.type)) return false;
  const outbound = sourceId === candidateId;
  const inbound = targetId === candidateId;
  const direction = obligation.relationshipDirection ?? 'either';
  if (direction === 'outbound' && !outbound
    || direction === 'inbound' && !inbound
    || direction === 'either' && !outbound && !inbound) return false;
  if (obligation.relationshipTargetPropositionFamily === undefined) return true;
  const related = rowById.get(outbound ? targetId : sourceId);
  return related !== undefined
    && familyMatcher(related, obligation.relationshipTargetPropositionFamily)
    && matchesRequiredTargetConstraints(related,
      obligation.relationshipTargetPropositionFamily, obligations);
}

function relationView(type: string, sourceProjectionItemId: string,
  targetProjectionItemId: string): ProofRelationView {
  return freeze({ type, sourceProjectionItemId, targetProjectionItemId });
}

function sortRelationViews(rows: ProofRelationView[]): ProofRelationView[] {
  return rows.sort((left, right) => compare(stableObjectText(left), stableObjectText(right)));
}

function relationCensusEvaluation(propositions: ProofProposition[],
  propositionById: Map<string, ProofProposition>, relations: ProofRelation[],
  authorityProjection: ProofAuthorityProjection): ProjectionRelationCensusEvaluation {
  const matched = sortRelationViews(relations.map((relation) => {
    const source = propositionById.get(relation.sourceRevisionId) ?? fail();
    const target = propositionById.get(relation.targetRevisionId) ?? fail();
    return relationView(relation.type, source.sourceProjectionItemId,
      target.sourceProjectionItemId);
  }));
  const authoritative = sortRelationViews(authorityProjection.relations.map((relation) =>
    relationView(relation.type, relation.sourceProjectionItemId,
      relation.targetProjectionItemId)));
  assertPropositionsMatchAuthority(propositions, authorityProjection);
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyProjectionRelationCensusEvaluationV1',
    state: stableObjectText(matched) === stableObjectText(authoritative)
      ? 'closed' : 'mismatch',
    sourceProjectionAuthority: proofAuthorityForProjection(authorityProjection),
    authoritativeSourceProjectionRelations: freeze(authoritative),
    matchedSourceProjectionRelations: freeze(matched),
  });
}

export function evaluateProjectionRelationCensus({
  propositions: inputPropositions,
  relations: inputRelations,
  authorityProjection: inputAuthorityProjection,
}: EvaluateProjectionRelationCensusInput = {}): ProjectionRelationCensusEvaluation {
  const authorityProjection = validateProofAuthorityProjection(inputAuthorityProjection);
  const { propositions, propositionById } = normalizePropositions(inputPropositions);
  const relations = normalizeRelations(inputRelations, propositionById);
  return relationCensusEvaluation(propositions, propositionById, relations, authorityProjection);
}

function authorityBindingMatches(contract: ProofSufficiencyContract,
  authorityProjection: ProofAuthorityProjection | null): boolean {
  if (contract.sourceProjectionAuthority === undefined) return authorityProjection === null;
  return authorityProjection !== null
    && stableObjectText(contract.sourceProjectionAuthority)
      === stableObjectText(proofAuthorityForProjection(authorityProjection));
}

export function evaluateProofSufficiencyContract({
  contract: inputContract,
  propositions: inputPropositions,
  relations: inputRelations,
  authorityProjection: inputAuthorityProjection = null,
}: EvaluateProofSufficiencyContractInput = {}): ProofSufficiencyEvaluation {
  const contract = validateProofSufficiencyContract(inputContract);
  const authorityProjection = inputAuthorityProjection === null ? null
    : validateProofAuthorityProjection(inputAuthorityProjection);
  if (!authorityBindingMatches(contract, authorityProjection)) fail();
  const { propositions, propositionById } = normalizePropositions(inputPropositions);
  const relations = normalizeRelations(inputRelations, propositionById);
  if (authorityProjection !== null) {
    assertPropositionsMatchAuthority(propositions, authorityProjection);
  }
  const authorityById = authorityProjection === null ? null
    : new Map<string, ProofAuthorityItem>(authorityProjection.items.map((row) =>
      [row.sourceProjectionItemId, row]));
  const matchesByObligationId = new Map<string, ProofProposition[]>();
  for (const obligation of contract.obligations) {
    let matches = propositions.filter((row) => matchesFamily(row, obligation.propositionFamily)
      && matchesConstraints(row, obligation));
    if (obligation.relationshipAnyOf.length > 0 && matches.length > 0) {
      matches = matches.filter((row) => relations.some((relation) =>
        relationMatchesCandidate({
          relation,
          candidateId: row.revisionId,
          sourceId: relation.sourceRevisionId,
          targetId: relation.targetRevisionId,
          rowById: propositionById,
          obligation,
          obligations: contract.obligations,
          familyMatcher: matchesFamily,
        })));
    }
    matchesByObligationId.set(obligation.obligationId, matches);
  }
  const obligationEvaluations = contract.obligations.map(
    (obligation): ProofObligationEvaluation => {
      let matches = matchesByObligationId.get(obligation.obligationId) ?? [];
      if (obligation.sameFamilyAsObligationId !== undefined) {
        const referenceFamilies = new Set((matchesByObligationId
          .get(obligation.sameFamilyAsObligationId) ?? []).map((row) => row.familyId));
        matches = matches.filter((row) => referenceFamilies.has(row.familyId));
      }
      const matchedSourceProjectionItemIds = matches
        .map((row) => row.sourceProjectionItemId).sort(compare);
      const expected = obligation.expectedSourceProjectionItemIds;
      const authoritativeCensusRequired = expected !== undefined
        || obligation.role === 'invalidator';
      const authoritative = !authoritativeCensusRequired || authorityProjection === null ? null
        : authorityProjection.items.filter((row) =>
          matchesAuthorityFamily(row, obligation.propositionFamily)
            && matchesConstraints(row, obligation))
          .map((row) => row.sourceProjectionItemId).sort(compare);
      const expectedMatchesAuthority = expected === undefined
        || authoritative !== null
          && stableObjectText(expected) === stableObjectText(authoritative);
      const exactCensus = !authoritativeCensusRequired
        || authoritative !== null && expectedMatchesAuthority
          && matches.length === authoritative.length
          && stableObjectText(matchedSourceProjectionItemIds) === stableObjectText(authoritative);
      const authoritativeRelationCensusRequired = obligation.role === 'invalidator';
      let authoritativeSourceProjectionRelations: ProofRelationView[] | null = null;
      let matchedSourceProjectionRelations: ProofRelationView[] | null = null;
      if (authoritativeRelationCensusRequired && authorityProjection !== null
        && authorityById !== null) {
        const authoritativeCandidateIds = new Set(authoritative ?? []);
        authoritativeSourceProjectionRelations = sortRelationViews(authorityProjection.relations
          .filter((relation: ProofAuthorityRelation) =>
            [...authoritativeCandidateIds].some((candidateId) =>
              relationMatchesCandidate({
                relation,
                candidateId,
                sourceId: relation.sourceProjectionItemId,
                targetId: relation.targetProjectionItemId,
                rowById: authorityById,
                obligation,
                obligations: contract.obligations,
                familyMatcher: matchesAuthorityFamily,
              })))
          .map((relation) => relationView(relation.type,
            relation.sourceProjectionItemId, relation.targetProjectionItemId)));
        const matchedRevisionIds = new Set(matches.map((row) => row.revisionId));
        matchedSourceProjectionRelations = sortRelationViews(relations
          .filter((relation) => [...matchedRevisionIds].some((candidateId) =>
            relationMatchesCandidate({
              relation,
              candidateId,
              sourceId: relation.sourceRevisionId,
              targetId: relation.targetRevisionId,
              rowById: propositionById,
              obligation,
              obligations: contract.obligations,
              familyMatcher: matchesFamily,
            })))
          .map((relation) => relationView(
            relation.type,
            (propositionById.get(relation.sourceRevisionId) ?? fail()).sourceProjectionItemId,
            (propositionById.get(relation.targetRevisionId) ?? fail()).sourceProjectionItemId,
          )));
      }
      const exactRelationCensus = !authoritativeRelationCensusRequired
        || authoritativeSourceProjectionRelations !== null
          && matchedSourceProjectionRelations !== null
          && stableObjectText(matchedSourceProjectionRelations)
            === stableObjectText(authoritativeSourceProjectionRelations);
      const minimumCount = obligation.minimumCount ?? 1;
      const closed = matches.length >= minimumCount && exactCensus && exactRelationCensus;
      return freeze({
        obligationId: obligation.obligationId,
        propositionFamily: obligation.propositionFamily,
        role: obligation.role,
        required: obligation.required,
        relationshipAnyOf: obligation.relationshipAnyOf,
        matchedSourceProjectionItemIds: freeze(matchedSourceProjectionItemIds),
        ...(obligation.allowedModalities === undefined ? {} : {
          allowedModalities: obligation.allowedModalities,
        }),
        ...(obligation.allowedPolarities === undefined ? {} : {
          allowedPolarities: obligation.allowedPolarities,
        }),
        ...(!authoritativeCensusRequired || authoritative === null ? {} : {
          ...(expected === undefined ? {} : { expectedSourceProjectionItemIds: expected }),
          authoritativeSourceProjectionItemIds: freeze(authoritative),
        }),
        ...(!authoritativeRelationCensusRequired
          || authoritativeSourceProjectionRelations === null
          || matchedSourceProjectionRelations === null ? {} : {
            authoritativeSourceProjectionRelations:
              freeze(authoritativeSourceProjectionRelations),
            matchedSourceProjectionRelations: freeze(matchedSourceProjectionRelations),
          }),
        ...(obligation.minimumCount === undefined ? {} : { minimumCount }),
        ...(obligation.relationshipDirection === undefined ? {} : {
          relationshipDirection: obligation.relationshipDirection,
        }),
        ...(obligation.relationshipTargetPropositionFamily === undefined ? {} : {
          relationshipTargetPropositionFamily: obligation.relationshipTargetPropositionFamily,
        }),
        ...(obligation.sameFamilyAsObligationId === undefined ? {} : {
          sameFamilyAsObligationId: obligation.sameFamilyAsObligationId,
        }),
        state: closed ? 'closed' : 'unresolved',
        propositionRevisionIds: freeze(matches.map((row) => row.revisionId).sort(compare)),
      });
    },
  );
  const projectionRelationCensus = authorityProjection === null ? null
    : relationCensusEvaluation(propositions, propositionById, relations, authorityProjection);
  const proofClosed = obligationEvaluations.every((row) => !row.required || row.state === 'closed')
    && (projectionRelationCensus === null || projectionRelationCensus.state === 'closed');
  const invalidatorRelationTypes = new Set(
    (projectionRelationCensus?.matchedSourceProjectionRelations ?? [])
      .filter((row) => row.type === 'contradicts' || row.type === 'qualifies')
      .map((row) => row.type),
  );
  const proofDisposition = !proofClosed ? 'unresolved'
    : invalidatorRelationTypes.has('contradicts') ? 'contradicted'
      : invalidatorRelationTypes.has('qualifies') ? 'qualified' : 'supported';
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyProofSufficiencyEvaluationV1',
    contractSha256: contract.contractSha256,
    proofClosed,
    proofDisposition,
    sourceProjectionAuthority: authorityProjection === null
      ? null : proofAuthorityForProjection(authorityProjection),
    projectionRelationCensus,
    obligations: freeze(obligationEvaluations),
  });
}
