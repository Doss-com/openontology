/** Question-derived proof obligations shared across Terrain Adapters. */
import { stableObjectSha256, stableObjectText } from '../canonical-content.js';
import { normalizeSourceProjectionAuthority } from './authority-projection.js';
import type { SourceProjectionAuthority } from './authority-projection.js';

export type ProofObligationRole = 'invalidator' | 'support';
export type ProofRelationDirection = 'either' | 'inbound' | 'outbound';

export interface ProofSufficiencyObligation {
  obligationId: string;
  propositionFamily: string;
  role: ProofObligationRole;
  required: boolean;
  relationshipAnyOf: readonly string[];
  description: string;
  allowedModalities?: readonly string[];
  allowedPolarities?: readonly string[];
  expectedSourceProjectionItemIds?: readonly string[];
  minimumCount?: number;
  relationshipDirection?: ProofRelationDirection;
  relationshipTargetPropositionFamily?: string;
  sameFamilyAsObligationId?: string;
}

export interface ProofSufficiencyContract {
  schemaVersion: 1;
  kind: 'OpenOntologyProofSufficiencyContractV1';
  questionKind: string;
  requiredPropositionFamilies: readonly string[];
  obligations: readonly ProofSufficiencyObligation[];
  sufficiencyRule: string;
  stopWhen: string;
  sourceProjectionAuthority?: SourceProjectionAuthority;
  questionOnly: boolean;
  exactEvidenceRequired: true;
  navigationOnly: true;
  exactSourcesRemainAuthority: true;
  contractSha256: string;
}

export interface CompileProofSufficiencyContractInput {
  questionKind?: unknown;
  obligations?: unknown;
  sourceProjectionAuthority?: unknown;
  sufficiencyRule?: unknown;
  stopWhen?: unknown;
}

type UnknownRecord = Record<string, unknown>;

const ROLES = new Set<ProofObligationRole>(['invalidator', 'support']);
const RELATION_DIRECTIONS = new Set<ProofRelationDirection>(['either', 'inbound', 'outbound']);
const INVALIDATOR_RELATION_TYPES = new Set(['contradicts', 'qualifies']);
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (): never => {
  const error = new TypeError('PROOF_SUFFICIENCY_CONTRACT') as TypeError & { code: string };
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
const stringList = (value: unknown): string[] => Array.isArray(value)
  && value.every((item) => typeof item === 'string' && item.length > 0)
  ? [...new Set(value)].sort(compare) : fail();

function normalizeObligation(value: unknown): ProofSufficiencyObligation {
  const row = plain(value) ? value : fail();
  if (Object.keys(row).some((key) => ![
      'allowedModalities', 'allowedPolarities', 'description',
      'expectedSourceProjectionItemIds', 'minimumCount', 'obligationId',
      'propositionFamily', 'relationshipAnyOf', 'relationshipDirection',
      'relationshipTargetPropositionFamily', 'required', 'role',
      'sameFamilyAsObligationId',
    ].includes(key))
    || typeof row.obligationId !== 'string' || !row.obligationId
    || typeof row.propositionFamily !== 'string' || !row.propositionFamily
    || !ROLES.has(row.role as ProofObligationRole)
    || typeof row.required !== 'boolean'
    || typeof row.description !== 'string' || !row.description
    || row.description.length > 1200
    || row.relationshipAnyOf !== undefined && !Array.isArray(row.relationshipAnyOf)
    || row.allowedModalities !== undefined && !Array.isArray(row.allowedModalities)
    || row.allowedPolarities !== undefined && !Array.isArray(row.allowedPolarities)
    || Array.isArray(row.allowedModalities) && row.allowedModalities.length === 0
    || Array.isArray(row.allowedPolarities) && row.allowedPolarities.length === 0
    || row.expectedSourceProjectionItemIds !== undefined
      && !Array.isArray(row.expectedSourceProjectionItemIds)
    || row.minimumCount !== undefined
      && (!Number.isSafeInteger(row.minimumCount)
        || (row.minimumCount as number) < 0 || (row.minimumCount as number) > 128)
    || row.required === true && row.role === 'support' && row.minimumCount === 0
    || row.relationshipDirection !== undefined
      && !RELATION_DIRECTIONS.has(row.relationshipDirection as ProofRelationDirection)
    || row.relationshipTargetPropositionFamily !== undefined
      && (typeof row.relationshipTargetPropositionFamily !== 'string'
        || !row.relationshipTargetPropositionFamily)
    || row.sameFamilyAsObligationId !== undefined
      && (typeof row.sameFamilyAsObligationId !== 'string'
        || !row.sameFamilyAsObligationId)) fail();
  const relationshipAnyOf = stringList(row.relationshipAnyOf ?? []);
  const allowedModalities = stringList(row.allowedModalities ?? []);
  const allowedPolarities = stringList(row.allowedPolarities ?? []);
  const expectedSourceProjectionItemIdValues = row.expectedSourceProjectionItemIds;
  const expectedSourceProjectionItemIds = expectedSourceProjectionItemIdValues === undefined
    ? null : stringList(expectedSourceProjectionItemIdValues);
  if (expectedSourceProjectionItemIdValues !== undefined
      && (!Array.isArray(expectedSourceProjectionItemIdValues)
        || expectedSourceProjectionItemIds === null
        || expectedSourceProjectionItemIds.length
          !== expectedSourceProjectionItemIdValues.length)
    || row.minimumCount !== undefined && expectedSourceProjectionItemIds !== null
      && (row.minimumCount as number) > expectedSourceProjectionItemIds.length
    || relationshipAnyOf.length === 0
      && (row.relationshipDirection !== undefined
        || row.relationshipTargetPropositionFamily !== undefined)) fail();
  const normalized: ProofSufficiencyObligation = {
    obligationId: row.obligationId as string,
    propositionFamily: row.propositionFamily as string,
    role: row.role as ProofObligationRole,
    required: row.required as boolean,
    relationshipAnyOf: freeze(relationshipAnyOf),
    description: row.description as string,
  };
  if (row.allowedModalities !== undefined) normalized.allowedModalities = freeze(allowedModalities);
  if (row.allowedPolarities !== undefined) normalized.allowedPolarities = freeze(allowedPolarities);
  if (expectedSourceProjectionItemIds !== null) {
    normalized.expectedSourceProjectionItemIds = freeze(expectedSourceProjectionItemIds);
  }
  if (row.minimumCount !== undefined) normalized.minimumCount = row.minimumCount as number;
  if (row.relationshipDirection !== undefined) {
    normalized.relationshipDirection = row.relationshipDirection as ProofRelationDirection;
  }
  if (typeof row.relationshipTargetPropositionFamily === 'string') {
    normalized.relationshipTargetPropositionFamily = row.relationshipTargetPropositionFamily;
  }
  if (typeof row.sameFamilyAsObligationId === 'string') {
    normalized.sameFamilyAsObligationId = row.sameFamilyAsObligationId;
  }
  return freeze(normalized);
}

export function compileProofSufficiencyContract({
  questionKind,
  obligations,
  sourceProjectionAuthority,
  sufficiencyRule,
  stopWhen,
}: CompileProofSufficiencyContractInput = {}): ProofSufficiencyContract {
  const exactQuestionKind = typeof questionKind === 'string' && questionKind
    ? questionKind : fail();
  const exactSufficiencyRule = typeof sufficiencyRule === 'string' && sufficiencyRule
    ? sufficiencyRule : fail();
  const exactStopWhen = typeof stopWhen === 'string' && stopWhen ? stopWhen : fail();
  const obligationValues: unknown[] = Array.isArray(obligations) ? obligations : fail();
  if (obligationValues.length < 1 || obligationValues.length > 128) fail();
  const normalized = obligationValues.map(normalizeObligation);
  const authority = sourceProjectionAuthority === undefined
    ? null : normalizeSourceProjectionAuthority(sourceProjectionAuthority);
  if (new Set(normalized.map((row) => row.obligationId)).size !== normalized.length
    || !normalized.some((row) => row.required)
    || !normalized.some((row) => row.required && row.role === 'support'
      && row.propositionFamily === 'exact-support')
    || normalized.some((row) => row.role === 'invalidator' && !row.required)
    || normalized.some((row) => row.role === 'invalidator'
      && (row.propositionFamily !== 'counterevidence'
        || row.minimumCount !== 0
        || row.relationshipAnyOf.length !== INVALIDATOR_RELATION_TYPES.size
        || row.relationshipAnyOf.some((type) => !INVALIDATOR_RELATION_TYPES.has(type))
        || row.relationshipDirection !== 'outbound'
        || row.relationshipTargetPropositionFamily === undefined
        || row.allowedModalities !== undefined
        || row.allowedPolarities !== undefined))
    || authority === null && normalized.some((row) => row.role === 'invalidator')) fail();
  if (authority !== null && !normalized.some((row) => row.role === 'invalidator')) fail();
  const obligationIndexById = new Map(normalized.map((row, index) => [row.obligationId, index]));
  if (normalized.some((row, index) => row.sameFamilyAsObligationId !== undefined
    && (obligationIndexById.get(row.sameFamilyAsObligationId) === undefined
      || (obligationIndexById.get(row.sameFamilyAsObligationId) as number) >= index
      || normalized[obligationIndexById.get(row.sameFamilyAsObligationId) as number]
        .sameFamilyAsObligationId !== undefined))
    || normalized.some((row) => row.expectedSourceProjectionItemIds !== undefined)
      && authority === null) fail();
  const requiredPropositionFamilies = [...new Set(normalized
    .filter((row) => row.required)
    .map((row) => row.propositionFamily))].sort(compare);
  const core = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologyProofSufficiencyContractV1' as const,
    questionKind: exactQuestionKind,
    requiredPropositionFamilies: freeze(requiredPropositionFamilies),
    obligations: freeze(normalized),
    sufficiencyRule: exactSufficiencyRule,
    stopWhen: exactStopWhen,
    ...(authority === null ? {} : { sourceProjectionAuthority: authority }),
    questionOnly: authority === null,
    exactEvidenceRequired: true as const,
    navigationOnly: true as const,
    exactSourcesRemainAuthority: true as const,
  };
  return freeze({ ...core, contractSha256: stableObjectSha256(core) });
}

export function validateProofSufficiencyContract(value: unknown): ProofSufficiencyContract {
  const row = plain(value) ? value : fail();
  const expected = compileProofSufficiencyContract({
    questionKind: row.questionKind,
    obligations: row.obligations,
    sourceProjectionAuthority: row.sourceProjectionAuthority,
    sufficiencyRule: row.sufficiencyRule,
    stopWhen: row.stopWhen,
  });
  if (stableObjectText(row) !== stableObjectText(expected)) fail();
  return freeze(structuredClone(expected));
}
