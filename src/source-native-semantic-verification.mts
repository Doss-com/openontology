/** Query-scoped semantic navigation and proof closure over exact source-native fields. */
import { stableObjectSha256, stableObjectText } from './canonical-content.mjs';
import {
  proofAuthorityForProjection,
} from './proof-authority-projection.mjs';
import type {
  ProofAuthorityProjection,
  ProofEvidenceReference,
} from './proof-authority-projection.mjs';
import { compileProofSufficiencyContract } from './proof-sufficiency-contract.mjs';
import type { ProofSufficiencyContract } from './proof-sufficiency-contract.mjs';
import {
  evaluateProofSufficiencyContract,
} from './proof-sufficiency-evaluator.mjs';
import type {
  ProofProposition,
  ProofRelation,
  ProofSufficiencyEvaluation,
} from './proof-sufficiency-evaluator.mjs';
import type {
  SourceNativeField,
  SourceNativeObjectMap,
} from './source-native-object-map.mjs';
import { compileSourceNativeProofAuthorityProjection } from './source-native-semantic-projection.mjs';

export interface SourceNativeSemanticEvidenceOffer extends ProofEvidenceReference {
  role: 'answer' | 'counterevidence';
  sourceProjectionItemId: string;
  fieldSha256: string;
  fieldPath: string;
  propositionFamilyKey: string;
}

export interface SourceNativeSemanticProofAuthority {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeSemanticProofAuthorityV1';
  rootPropositionKey: string;
  supportPropositionFamily: 'action' | 'change' | 'outcome' | 'state';
  sourceProjectionSha256: string;
  proofCensusSha256: string;
  propositionCount: number;
  relationCount: number;
  exactEvidenceReferenceCount: number;
  exactInspectRequired: true;
  exactSourcesRemainAuthority: true;
  authoritySha256: string;
}

export interface SourceNativeSemanticNavigation {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeSemanticNavigationV1';
  authorityProjection: ProofAuthorityProjection;
  authority: SourceNativeSemanticProofAuthority;
  evidenceOffers: readonly SourceNativeSemanticEvidenceOffer[];
}

export interface SourceNativeVerifiedSemanticEvidence extends ProofEvidenceReference {
  role: 'answer' | 'counterevidence';
  fieldSha256: string;
}

export interface SourceNativeSemanticProofVerification {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeSemanticProofVerificationV1';
  rootPropositionKey: string;
  supportPropositionFamily: 'action' | 'change' | 'outcome' | 'state';
  sourceProjectionSha256: string;
  proofCensusSha256: string;
  proofContractSha256: string;
  proofClosed: boolean;
  proofDisposition: ProofSufficiencyEvaluation['proofDisposition'];
  propositionCount: number;
  relationCount: number;
  exactEvidenceReferenceCount: number;
  exactSourcesRemainAuthority: true;
  verificationSha256: string;
}

const SUPPORT_FAMILIES = new Set(['action', 'change', 'outcome', 'state']);
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function propositionKey(field: SourceNativeField): string | null {
  const proposition = field.canonicalProposition;
  return proposition?.kind === 'OpenOntologySourceNativeCanonicalPropositionV2'
    && typeof proposition.propositionKey === 'string' ? proposition.propositionKey : null;
}

function exactOffer(field: SourceNativeField, sourceProjectionItemId: string,
  role: SourceNativeSemanticEvidenceOffer['role']): SourceNativeSemanticEvidenceOffer {
  return freeze({
    role,
    sourceProjectionItemId,
    fieldSha256: field.fieldSha256,
    fieldPath: field.fieldPath,
    propositionFamilyKey: field.propositionFamilyKey ?? field.fieldPath,
    sourceRef: field.evidence.relativePath,
    sourceSha256: field.evidence.sourceSha256,
    byteStart: field.evidence.byteStart,
    byteEnd: field.evidence.byteEnd,
    textSha256: field.evidence.textSha256,
  });
}

export function compileSourceNativeSemanticNavigation({
  sourceNativeObjectMap,
  namespace,
  rootFieldSha256,
}: {
  sourceNativeObjectMap?: SourceNativeObjectMap;
  namespace?: string;
  rootFieldSha256?: string;
} = {}): SourceNativeSemanticNavigation | null {
  if (!sourceNativeObjectMap || typeof namespace !== 'string' || !namespace
    || typeof rootFieldSha256 !== 'string' || !rootFieldSha256) {
    fail('SOURCE_NATIVE_SEMANTIC_NAVIGATION_INPUT');
  }
  const map = sourceNativeObjectMap ?? fail('SOURCE_NATIVE_SEMANTIC_NAVIGATION_INPUT');
  const rootFields = map.nativeObjects
    .filter((object) => object.objectIdentity.namespace === namespace)
    .flatMap((object) => object.fields)
    .filter((field) => field.fieldSha256 === rootFieldSha256);
  if (rootFields.length !== 1) fail('SOURCE_NATIVE_SEMANTIC_NAVIGATION_ROOT');
  const rootField = rootFields[0] ?? fail('SOURCE_NATIVE_SEMANTIC_NAVIGATION_ROOT');
  const rootPropositionKey = propositionKey(rootField);
  if (rootPropositionKey === null) return null;
  const rootRoles = rootField.canonicalProposition?.canonicalRoles;
  const supportFamilies = Array.isArray(rootRoles)
    ? rootRoles.filter((role): role is 'action' | 'change' | 'outcome' | 'state' =>
      typeof role === 'string' && SUPPORT_FAMILIES.has(role)) : [];
  if (supportFamilies.length !== 1) return null;
  const supportPropositionFamily = supportFamilies[0]
    ?? fail('SOURCE_NATIVE_SEMANTIC_NAVIGATION_ROOT');
  const authorityProjection = compileSourceNativeProofAuthorityProjection({
    sourceNativeObjectMap: map,
    namespace,
    rootPropositionKeys: [rootPropositionKey],
  });
  const fieldsByProposition = new Map<string, SourceNativeField[]>();
  for (const object of map.nativeObjects) {
    if (object.objectIdentity.namespace !== namespace) continue;
    for (const field of object.fields) {
      const key = propositionKey(field);
      if (key === null) continue;
      const fields = fieldsByProposition.get(key) ?? [];
      fields.push(field);
      fieldsByProposition.set(key, fields);
    }
  }
  const evidenceOffers = authorityProjection.items.map((item) => {
    const fields = fieldsByProposition.get(item.sourceProjectionItemId) ?? [];
    if (fields.length !== 1 || item.exactEvidenceReferences.length !== 1) {
      fail('SOURCE_NATIVE_SEMANTIC_NAVIGATION_EVIDENCE');
    }
    const field = fields[0] ?? fail('SOURCE_NATIVE_SEMANTIC_NAVIGATION_EVIDENCE');
    const role = item.sourceProjectionItemId === rootPropositionKey
      ? 'answer' as const : 'counterevidence' as const;
    const offer = exactOffer(field, item.sourceProjectionItemId, role);
    const { role: _role, sourceProjectionItemId: _itemId, fieldSha256: _fieldSha256,
      fieldPath: _fieldPath, propositionFamilyKey: _family, ...reference } = offer;
    if (stableObjectText(reference) !== stableObjectText(item.exactEvidenceReferences[0])) {
      fail('SOURCE_NATIVE_SEMANTIC_NAVIGATION_EVIDENCE');
    }
    return offer;
  }).sort((left, right) => (left.role === right.role ? 0 : left.role === 'answer' ? -1 : 1)
    || compare(left.sourceProjectionItemId, right.sourceProjectionItemId));
  const authorityCore = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologySourceNativeSemanticProofAuthorityV1' as const,
    rootPropositionKey,
    supportPropositionFamily,
    sourceProjectionSha256: authorityProjection.sourceProjectionSha256,
    proofCensusSha256: authorityProjection.proofCensusSha256,
    propositionCount: authorityProjection.items.length,
    relationCount: authorityProjection.relations.length,
    exactEvidenceReferenceCount: evidenceOffers.length,
    exactInspectRequired: true as const,
    exactSourcesRemainAuthority: true as const,
  };
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeSemanticNavigationV1',
    authorityProjection,
    authority: freeze({
      ...authorityCore,
      authoritySha256: stableObjectSha256(authorityCore),
    }),
    evidenceOffers: freeze(evidenceOffers),
  });
}

export function evaluateSourceNativeSemanticNavigation({
  navigation,
  verifiedEvidence,
}: {
  navigation?: SourceNativeSemanticNavigation;
  verifiedEvidence?: readonly SourceNativeVerifiedSemanticEvidence[];
} = {}): {
  contract: ProofSufficiencyContract;
  evaluation: ProofSufficiencyEvaluation;
  propositions: readonly ProofProposition[];
  relations: readonly ProofRelation[];
  verification: SourceNativeSemanticProofVerification;
} {
  if (!navigation || !Array.isArray(verifiedEvidence)) {
    fail('SOURCE_NATIVE_SEMANTIC_VERIFICATION_INPUT');
  }
  const exactNavigation = navigation ?? fail('SOURCE_NATIVE_SEMANTIC_VERIFICATION_INPUT');
  const exactVerifiedEvidence = verifiedEvidence
    ?? fail('SOURCE_NATIVE_SEMANTIC_VERIFICATION_INPUT');
  const expectedEvidence = exactNavigation.evidenceOffers.map((offer) => ({
    role: offer.role,
    fieldSha256: offer.fieldSha256,
    sourceRef: offer.sourceRef,
    sourceSha256: offer.sourceSha256,
    byteStart: offer.byteStart,
    byteEnd: offer.byteEnd,
    textSha256: offer.textSha256,
  })).sort((left, right) => compare(stableObjectText(left), stableObjectText(right)));
  const observedEvidence = [...exactVerifiedEvidence]
    .sort((left, right) => compare(stableObjectText(left), stableObjectText(right)));
  if (stableObjectText(expectedEvidence) !== stableObjectText(observedEvidence)) {
    fail('SOURCE_NATIVE_SEMANTIC_VERIFICATION_EVIDENCE');
  }
  const contract = compileProofSufficiencyContract({
    questionKind: `source-native-${exactNavigation.authority.supportPropositionFamily}`,
    obligations: [{
      obligationId: 'answer',
      propositionFamily: exactNavigation.authority.supportPropositionFamily,
      role: 'support',
      required: true,
      relationshipAnyOf: [],
      description: 'The selected canonical proposition family is present.',
    }, {
      obligationId: 'exact',
      propositionFamily: 'exact-support',
      role: 'support',
      required: true,
      relationshipAnyOf: [],
      description: 'Every proof proposition has an exact Corpus reference.',
      sameFamilyAsObligationId: 'answer',
    }, {
      obligationId: 'counterevidence',
      propositionFamily: 'counterevidence',
      role: 'invalidator',
      required: true,
      minimumCount: 0,
      relationshipAnyOf: ['contradicts', 'qualifies'],
      relationshipDirection: 'outbound',
      relationshipTargetPropositionFamily: exactNavigation.authority.supportPropositionFamily,
      description: 'The query-scoped counterevidence relation census is complete.',
    }],
    sourceProjectionAuthority: proofAuthorityForProjection(exactNavigation.authorityProjection),
    sufficiencyRule: 'close support only with the complete query-scoped invalidator census',
    stopWhen: 'proof closes or a required obligation remains unresolved',
  });
  const propositions = exactNavigation.authorityProjection.items.map((item) => ({
    revisionId: `source-native:${item.sourceProjectionItemId}`,
    ...item,
  }));
  const relations = exactNavigation.authorityProjection.relations.map((relation) => ({
    type: relation.type,
    sourceRevisionId: `source-native:${relation.sourceProjectionItemId}`,
    targetRevisionId: `source-native:${relation.targetProjectionItemId}`,
  }));
  const evaluation = evaluateProofSufficiencyContract({
    contract,
    propositions,
    relations,
    authorityProjection: exactNavigation.authorityProjection,
  });
  const verificationCore = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologySourceNativeSemanticProofVerificationV1' as const,
    rootPropositionKey: exactNavigation.authority.rootPropositionKey,
    supportPropositionFamily: exactNavigation.authority.supportPropositionFamily,
    sourceProjectionSha256: exactNavigation.authority.sourceProjectionSha256,
    proofCensusSha256: exactNavigation.authority.proofCensusSha256,
    proofContractSha256: contract.contractSha256,
    proofClosed: evaluation.proofClosed,
    proofDisposition: evaluation.proofDisposition,
    propositionCount: exactNavigation.authority.propositionCount,
    relationCount: exactNavigation.authority.relationCount,
    exactEvidenceReferenceCount: exactNavigation.authority.exactEvidenceReferenceCount,
    exactSourcesRemainAuthority: true as const,
  };
  return freeze({
    contract,
    evaluation,
    propositions,
    relations,
    verification: freeze({
      ...verificationCore,
      verificationSha256: stableObjectSha256(verificationCore),
    }),
  });
}
