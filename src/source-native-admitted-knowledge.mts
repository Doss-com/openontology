/** Signed, cold-replayable semantic proof reuse over exact source-native Corpus bytes. */
import { createPublicKey, verify as verifySignature } from 'node:crypto';

import { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';
import { openProductState } from './source-native-artifact.mjs';
import {
  resolveSourceNativeField,
  resolveSourceNativeFieldSuccessor,
} from './source-native-field-resolution.mjs';
import type { SourceNativeFieldResolutionResult } from './source-native-field-resolution.mjs';
import { openSourceNativeProductRuntime } from './source-native-product.mjs';
import { compileProductQueryPlan } from './source-native-query-plan.mjs';
import {
  normalizeProofAuthorityItem,
  proofAuthorityForProjection,
  validateProofAuthorityProjection,
} from './proof-authority-projection.mjs';
import type {
  ProofAuthorityProjection,
  ProofEvidenceReference,
  SourceProjectionAuthority,
} from './proof-authority-projection.mjs';
import { validateProofSufficiencyContract } from './proof-sufficiency-contract.mjs';
import type { ProofSufficiencyContract } from './proof-sufficiency-contract.mjs';
import { evaluateProofSufficiencyContract } from './proof-sufficiency-evaluator.mjs';
import type {
  ProofProposition,
  ProofRelation,
  ProofSufficiencyEvaluation,
} from './proof-sufficiency-evaluator.mjs';
import type { ProductOptions } from './source-native-artifact.mjs';
import type {
  ProductSearchInput,
  SourceNativeProductPreparedSearch,
  SourceNativeProductReadResult,
  SourceNativeProductRuntimeContext,
  SourceNativeProductSearchResult,
  SourceNativeProductStatus,
  SourceNativeProductVerificationResult,
} from './source-native-product.mjs';
import type {
  SourceNativeObjectIdentity,
  UnknownRecord,
} from './source-native-object-map.mjs';
import type { SourceNativeFieldQuery } from './source-native-query-planner.mjs';

export interface SourceNativeAdmittedKnowledgeQueryBinding {
  question: string;
  anchorValue: string | null;
  typedQuery: SourceNativeFieldQuery | null;
  query: SourceNativeFieldQuery & { namespace: string; externalId: string };
  queryPlanSha256: string;
  questionSha256: string;
  intent: 'current' | 'next';
}

export interface SourceNativeAdmittedKnowledgeBundle {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeAdmittedKnowledgeBundleV1';
  proposedBy: string;
  proposedAt: string;
  ontId: string;
  namespace: string;
  artifactSha256: string;
  nativeObjectMapSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  queryBinding: SourceNativeAdmittedKnowledgeQueryBinding;
  proofSufficiencyContract: ProofSufficiencyContract;
  proofAuthorityProjection: ProofAuthorityProjection;
  propositions: readonly ProofProposition[];
  relations: readonly ProofRelation[];
  proofEvaluation: ProofSufficiencyEvaluation;
  exactSourcesRemainAuthority: true;
  bundleSha256: string;
}

export interface SourceNativeAdmissionStatement {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeAdmissionStatementV1';
  bundleSha256: string;
  proposedBy: string;
  issuerId: string;
  admittedAt: string;
  supersedesRecordSha256s: readonly string[];
  decision: 'admitted';
  signatureAlgorithm: 'Ed25519';
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeProposalStatement {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeProposalStatementV1';
  bundleSha256: string;
  proposerId: string;
  proposedAt: string;
  signatureAlgorithm: 'Ed25519';
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeAdmissionRecord {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeAdmissionRecordV1';
  bundle: SourceNativeAdmittedKnowledgeBundle;
  proposalStatement: SourceNativeProposalStatement;
  proposalSignatureBase64: string;
  statement: SourceNativeAdmissionStatement;
  signatureBase64: string;
  recordSha256: string;
}

export interface SourceNativeAdmissionTrustEntry {
  issuerId: string;
  publicKeyPem: string;
  roles: readonly SourceNativeAdmissionTrustRole[];
}

export type SourceNativeAdmissionTrustRole = 'proposer' | 'reviewer';

export interface CompileSourceNativeAdmittedKnowledgeBundleInput extends UnknownRecord {
  proposedBy?: unknown;
  proposedAt?: unknown;
  ontId?: unknown;
  namespace?: unknown;
  artifactSha256?: unknown;
  nativeObjectMapSha256?: unknown;
  sourceCommitSha256?: unknown;
  sourceReplaySha256?: unknown;
  queryBinding?: unknown;
  proofSufficiencyContract?: unknown;
  proofAuthorityProjection?: unknown;
  propositions?: unknown;
  relations?: unknown;
}

export interface SourceNativeAdmittedKnowledgeWriteResult {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeAdmittedKnowledgeWriteResultV1';
  ontId: string;
  branch: string;
  recordSha256: string;
  commitSha256: string;
  replaySha256: string;
  replayed: boolean;
}

export interface SourceNativeAdmittedKnowledgeEvidence {
  relativePath: string;
  occurredAt: string;
  sourceSha256: string;
  byteStart: number;
  byteEnd: number;
  textSha256: string;
}

export interface SourceNativeAdmittedProofBinding {
  schemaVersion: 1;
  kind: 'OpenOntologyAdmittedProofBindingV1';
  proofUnitSha256: string;
  contractSha256: string;
  proofCensusSha256: string;
  admissionRecordSha256: string;
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeAdmittedQueryAnchorBinding {
  schemaVersion: 1;
  kind: 'OpenOntologyAdmittedQueryAnchorBindingV1';
  objectIdentity: SourceNativeObjectIdentity;
  objectIdentitySha256: string;
  fieldSha256: string;
  sourceCommitSha256: string;
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeAdmittedProofContext {
  role: 'answer' | 'counterevidence';
  exactText: string;
  evidence: SourceNativeAdmittedKnowledgeEvidence;
  binding: SourceNativeAdmittedProofBinding;
}

export interface SourceNativeAdmittedAnchorContext {
  role: 'anchor';
  exactText: string;
  evidence: SourceNativeAdmittedKnowledgeEvidence;
  binding: SourceNativeAdmittedQueryAnchorBinding;
}

export type SourceNativeAdmittedKnowledgeContext =
  | SourceNativeAdmittedProofContext
  | SourceNativeAdmittedAnchorContext;

export interface SourceNativeAdmittedKnowledgePolicy {
  navigationOnly: false;
  exactReadRequired: true;
  exactSourcesRemainAuthority: true;
  canonicalTruthMutation: false;
}

export interface SourceNativeAdmittedKnowledgeVerificationBase {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeAdmittedKnowledgeVerificationV1';
  intent: 'current' | 'next';
  query: SourceNativeFieldQuery | null;
  mentionedExternalIds: readonly string[];
  unresolvedExternalIds: readonly string[];
  availableFields: readonly never[];
  policy: SourceNativeAdmittedKnowledgePolicy;
  verificationSha256: string;
}

export interface SourceNativeAdmittedKnowledgeVerificationDetailsBase {
  artifactSha256: string;
  nativeObjectMapSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  queryPlanSha256: string;
  rawSearchExecuted: false;
  rawSearchCalls: number;
  modelCalls: 0;
  exactSourceInspectionCount: number;
}

export interface SourceNativeAdmittedKnowledgeResolvedVerification
  extends SourceNativeAdmittedKnowledgeVerificationBase {
  state: 'resolved-admitted-knowledge-proof-closure';
  answerable: true;
  context: readonly SourceNativeAdmittedKnowledgeContext[];
  proofDisposition: Exclude<ProofSufficiencyEvaluation['proofDisposition'], 'unresolved'>;
  verification: SourceNativeAdmittedKnowledgeVerificationDetailsBase & {
    admissionRecordSha256: string;
    admissionRecordSha256s: readonly string[];
    admissionIssuerId: string;
    admissionIssuerIds: readonly string[];
    supersededAdmissionRecordSha256s: readonly string[];
    proofContractSha256: string;
    proofCensusSha256: string;
  };
}

export interface SourceNativeAdmittedKnowledgeRefusalVerification
  extends SourceNativeAdmittedKnowledgeVerificationBase {
  state: 'unavailable-admitted-knowledge-ambiguous';
  answerable: false;
  context: readonly never[];
  proofDisposition: 'unresolved';
  refusal: { code: string };
  verification: SourceNativeAdmittedKnowledgeVerificationDetailsBase & {
    admissionRecordSha256: string | null;
  };
}

export type SourceNativeAdmittedKnowledgeVerification =
  | SourceNativeAdmittedKnowledgeResolvedVerification
  | SourceNativeAdmittedKnowledgeRefusalVerification;

export interface SourceNativeAdmittedKnowledgeLedgerStatus {
  branch: string;
  commitSha256: string | null;
  replaySha256: string | null;
  admittedRecordCount: number;
  activeAdmissionRecordCount: number;
  supersededAdmissionRecordCount: number;
  invalidAdmissionRecordCount: number;
  runtimeFallbackCount: number;
  lastRuntimeFallback: Readonly<{
    code: string;
    admissionRecordSha256: string;
  }> | null;
  diagnosticCodes: readonly string[];
  state: 'ready' | 'degraded';
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeAdmittedKnowledgeProduct {
  kind: 'OpenOntologySourceNativeAdmittedKnowledgeProductV1';
  verify(input?: ProductSearchInput): Promise<SourceNativeAdmittedKnowledgeVerificationResult>;
  search(input?: ProductSearchInput): Promise<SourceNativeProductSearchResult>;
  read(input: { ref: string }): Promise<SourceNativeProductReadResult>;
  status(): SourceNativeAdmittedKnowledgeStatus;
}

export type SourceNativeAdmittedKnowledgeVerificationResult =
  | SourceNativeAdmittedKnowledgeVerification
  | SourceNativeProductVerificationResult;

export type SourceNativeAdmittedKnowledgeStatus = SourceNativeProductStatus & {
  admittedKnowledge: SourceNativeAdmittedKnowledgeLedgerStatus;
};

type PlainRecord = Record<string, unknown>;
type SourceNativeBindingContext = Pick<SourceNativeProductRuntimeContext,
  'descriptor' | 'objectOnt'>;
type SourceNativeBoundSource = SourceNativeBindingContext['objectOnt']['sources'][number];
interface TrustedAdmissionKey {
  key: ReturnType<typeof createPublicKey>;
  roles: ReadonlySet<SourceNativeAdmissionTrustRole>;
}
type RequiredProofRole = 'support' | 'invalidator';
interface SourceNativeAdmittedProofUnit {
  role: SourceNativeAdmittedProofContext['role'];
  evidence: ProofEvidenceReference;
  propositionSha256s: readonly string[];
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const KNOWLEDGE_PREFIX = 'blobs/knowledge-ledger/admitted/';
const DEFAULT_KNOWLEDGE_BRANCH_PREFIX = 'knowledge';
const MAX_ADMITTED_CONTEXT_UNITS = 64;
const MAX_ADMITTED_CONTEXT_EVIDENCE_BYTES = 64 * 1024;
const MAX_ADMITTED_CONTEXT_ENCODED_EVIDENCE_BYTES = 64 * 1024;
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const caughtCode = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' && error.code.length > 0) return error.code;
  return fallback;
};
const freeze = <T,>(value: T): T => {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const plain = (value: unknown): value is PlainRecord => value !== null
  && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value: PlainRecord, keys: readonly string[], code: string): void => {
  if (Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
};
const nonempty = (value: unknown, code: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fail(code);
const sha256 = (value: unknown, code: string): string =>
  typeof value === 'string' && SHA256.test(value) ? value : fail(code);
const exactTime = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(Date.parse(value)).toISOString() !== value) fail(code);
  return typeof value === 'string' ? value : fail(code);
};
const sha256List = (value: unknown, code: string): readonly string[] => {
  if (!Array.isArray(value) || value.length > 128) fail(code);
  const rows: unknown[] = Array.isArray(value) ? value : fail(code);
  const normalized = rows.map((entry) => sha256(entry, code)).sort(compare);
  if (new Set(normalized).size !== normalized.length) fail(code);
  return freeze(normalized);
};
const knowledgeBranchFor = (sourceCommitSha256: string, value: unknown): string => {
  if (value === undefined) {
    return `${DEFAULT_KNOWLEDGE_BRANCH_PREFIX}-${sourceCommitSha256.slice(7, 23)}`;
  }
  return nonempty(value, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BRANCH');
};

function normalizeQueryBinding(value: unknown): SourceNativeAdmittedKnowledgeQueryBinding {
  const row = plain(value) ? value : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
  exactKeys(row, [
    'question', 'anchorValue', 'typedQuery', 'query', 'queryPlanSha256',
    'questionSha256', 'intent',
  ],
    'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
  const question = nonempty(row.question, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
  const intent: 'current' | 'next' = row.intent === 'current' || row.intent === 'next'
    ? row.intent : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
  const anchorValue = row.anchorValue === null ? null
    : nonempty(row.anchorValue, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
  const normalizeFieldQuery = (input: unknown, resolved: boolean): SourceNativeFieldQuery => {
    const query = plain(input) ? input : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
    if (Object.keys(query).some((key) => ![
        'sourceSystem', 'objectType', 'fieldPath', 'namespace', 'externalId',
        'anchorFieldSha256',
      ].includes(key))) fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
    const namespace = query.namespace === undefined ? undefined
      : nonempty(query.namespace, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
    const externalId = query.externalId === undefined ? undefined
      : nonempty(query.externalId, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
    const anchorFieldSha256 = query.anchorFieldSha256 === undefined ? undefined
      : sha256(query.anchorFieldSha256, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
    if (resolved && (namespace === undefined || externalId === undefined)) {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
    }
    return freeze({
      sourceSystem: nonempty(query.sourceSystem,
        'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING'),
      objectType: nonempty(query.objectType, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING'),
      fieldPath: nonempty(query.fieldPath, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING'),
      ...(namespace === undefined ? {} : { namespace }),
      ...(externalId === undefined ? {} : { externalId }),
      ...(anchorFieldSha256 === undefined ? {} : { anchorFieldSha256 }),
    });
  };
  const typedQuery = row.typedQuery === null ? null : normalizeFieldQuery(row.typedQuery, false);
  const query = normalizeFieldQuery(row.query, true) as SourceNativeFieldQuery
    & { namespace: string; externalId: string };
  const questionSha256 = sha256(row.questionSha256,
    'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
  if (questionSha256 !== stableObjectSha256({ question })) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING');
  }
  return freeze({
    question,
    anchorValue,
    typedQuery,
    query,
    queryPlanSha256: sha256(row.queryPlanSha256,
      'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_QUERY_BINDING'),
    questionSha256,
    intent,
  });
}

function normalizePropositions(value: unknown): readonly ProofProposition[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROPOSITIONS');
  }
  const rows: unknown[] = Array.isArray(value) ? value
    : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROPOSITIONS');
  return freeze(rows.map((input): ProofProposition => {
    const row = plain(input) ? input : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROPOSITIONS');
    exactKeys(row, [
      'revisionId', 'sourceProjectionItemId', 'familyId', 'canonicalRoles',
      'modality', 'polarity', 'actorRef', 'validAt', 'knownAt',
      'exactEvidenceReferences',
    ], 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROPOSITIONS');
    const { revisionId, ...authorityItem } = row;
    return freeze({
      revisionId: nonempty(revisionId, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROPOSITIONS'),
      ...normalizeProofAuthorityItem(authorityItem),
    });
  }).sort((left, right) => compare(left.revisionId, right.revisionId)));
}

function normalizeRelations(value: unknown): readonly ProofRelation[] {
  if (!Array.isArray(value) || value.length > 256) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RELATIONS');
  }
  const rows: unknown[] = Array.isArray(value) ? value
    : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RELATIONS');
  return freeze(rows.map((input): ProofRelation => {
    const row = plain(input) ? input : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RELATIONS');
    exactKeys(row, ['type', 'sourceRevisionId', 'targetRevisionId'],
      'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RELATIONS');
    return freeze({
      type: nonempty(row.type, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RELATIONS'),
      sourceRevisionId: nonempty(row.sourceRevisionId,
        'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RELATIONS'),
      targetRevisionId: nonempty(row.targetRevisionId,
        'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RELATIONS'),
    });
  }).sort((left, right) => compare(stableObjectText(left), stableObjectText(right))));
}

export function compileSourceNativeAdmittedKnowledgeBundle({
  proposedBy,
  proposedAt,
  ontId,
  namespace,
  artifactSha256,
  nativeObjectMapSha256,
  sourceCommitSha256,
  sourceReplaySha256,
  queryBinding: queryBindingInput,
  proofSufficiencyContract: contractInput,
  proofAuthorityProjection: authorityInput,
  propositions: propositionsInput,
  relations: relationsInput,
}: CompileSourceNativeAdmittedKnowledgeBundleInput = {}): SourceNativeAdmittedKnowledgeBundle {
  const authorityProjection = validateProofAuthorityProjection(authorityInput);
  const contract = validateProofSufficiencyContract(contractInput);
  const authority: SourceProjectionAuthority = proofAuthorityForProjection(authorityProjection);
  if (contract.sourceProjectionAuthority === undefined
    || stableObjectText(contract.sourceProjectionAuthority) !== stableObjectText(authority)) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_AUTHORITY');
  }
  const propositions = normalizePropositions(propositionsInput);
  const relations = normalizeRelations(relationsInput);
  const proofEvaluation: ProofSufficiencyEvaluation = (() => {
    try {
      return evaluateProofSufficiencyContract({
        contract,
        propositions,
        relations,
        authorityProjection,
      });
    } catch {
      return fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROOF');
    }
  })();
  if (!proofEvaluation.proofClosed) fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROOF');
  const core = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologySourceNativeAdmittedKnowledgeBundleV1' as const,
    proposedBy: nonempty(proposedBy, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE'),
    proposedAt: exactTime(proposedAt, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE'),
    ontId: nonempty(ontId, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE'),
    namespace: nonempty(namespace, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE'),
    artifactSha256: sha256(artifactSha256, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE'),
    nativeObjectMapSha256: sha256(nativeObjectMapSha256,
      'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE'),
    sourceCommitSha256: sha256(sourceCommitSha256,
      'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE'),
    sourceReplaySha256: sha256(sourceReplaySha256,
      'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE'),
    queryBinding: normalizeQueryBinding(queryBindingInput),
    proofSufficiencyContract: contract,
    proofAuthorityProjection: authorityProjection,
    propositions,
    relations,
    proofEvaluation,
    exactSourcesRemainAuthority: true as const,
  };
  return freeze({ ...core, bundleSha256: stableObjectSha256(core) });
}

export function validateSourceNativeAdmittedKnowledgeBundle(
  value: unknown,
): SourceNativeAdmittedKnowledgeBundle {
  const row = plain(value) ? value : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE');
  const expected = compileSourceNativeAdmittedKnowledgeBundle({
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt,
    ontId: row.ontId,
    namespace: row.namespace,
    artifactSha256: row.artifactSha256,
    nativeObjectMapSha256: row.nativeObjectMapSha256,
    sourceCommitSha256: row.sourceCommitSha256,
    sourceReplaySha256: row.sourceReplaySha256,
    queryBinding: row.queryBinding,
    proofSufficiencyContract: row.proofSufficiencyContract,
    proofAuthorityProjection: row.proofAuthorityProjection,
    propositions: row.propositions,
    relations: row.relations,
  });
  if (stableObjectText(row) !== stableObjectText(expected)) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BUNDLE');
  }
  return expected;
}

export function sourceNativeAdmissionStatement({
  bundle: bundleInput,
  issuerId,
  admittedAt,
  supersedesRecordSha256s = [],
}: {
  bundle?: unknown;
  issuerId?: unknown;
  admittedAt?: unknown;
  supersedesRecordSha256s?: unknown;
} = {}): SourceNativeAdmissionStatement {
  const bundle = validateSourceNativeAdmittedKnowledgeBundle(bundleInput);
  const exactIssuerId = nonempty(issuerId, 'SOURCE_NATIVE_ADMISSION_STATEMENT');
  const exactAdmittedAt = exactTime(admittedAt, 'SOURCE_NATIVE_ADMISSION_STATEMENT');
  if (exactIssuerId === bundle.proposedBy
    || Date.parse(exactAdmittedAt) < Date.parse(bundle.proposedAt)) {
    fail('SOURCE_NATIVE_ADMISSION_INDEPENDENCE');
  }
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeAdmissionStatementV1',
    bundleSha256: bundle.bundleSha256,
    proposedBy: bundle.proposedBy,
    issuerId: exactIssuerId,
    admittedAt: exactAdmittedAt,
    supersedesRecordSha256s: sha256List(supersedesRecordSha256s,
      'SOURCE_NATIVE_ADMISSION_SUPERSESSION'),
    decision: 'admitted',
    signatureAlgorithm: 'Ed25519',
    exactSourcesRemainAuthority: true,
  });
}

export function sourceNativeProposalStatement({
  bundle: bundleInput,
}: {
  bundle?: unknown;
} = {}): SourceNativeProposalStatement {
  const bundle = validateSourceNativeAdmittedKnowledgeBundle(bundleInput);
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeProposalStatementV1',
    bundleSha256: bundle.bundleSha256,
    proposerId: bundle.proposedBy,
    proposedAt: bundle.proposedAt,
    signatureAlgorithm: 'Ed25519',
    exactSourcesRemainAuthority: true,
  });
}

function validateProposalStatement(value: unknown,
  bundle: SourceNativeAdmittedKnowledgeBundle): SourceNativeProposalStatement {
  const row = plain(value) ? value : fail('SOURCE_NATIVE_PROPOSAL_STATEMENT');
  const expected = sourceNativeProposalStatement({ bundle });
  if (stableObjectText(row) !== stableObjectText(expected)) {
    fail('SOURCE_NATIVE_PROPOSAL_STATEMENT');
  }
  return expected;
}

function validateAdmissionStatement(value: unknown,
  bundle: SourceNativeAdmittedKnowledgeBundle): SourceNativeAdmissionStatement {
  const row = plain(value) ? value : fail('SOURCE_NATIVE_ADMISSION_STATEMENT');
  const expected = sourceNativeAdmissionStatement({
    bundle,
    issuerId: row.issuerId,
    admittedAt: row.admittedAt,
    supersedesRecordSha256s: row.supersedesRecordSha256s,
  });
  if (stableObjectText(row) !== stableObjectText(expected)) {
    fail('SOURCE_NATIVE_ADMISSION_STATEMENT');
  }
  return expected;
}

function canonicalSignature(value: unknown): string {
  const signature = typeof value === 'string' && value.length > 0 && BASE64.test(value)
    ? value : fail('SOURCE_NATIVE_ADMISSION_SIGNATURE');
  const bytes = Buffer.from(signature, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== signature) {
    fail('SOURCE_NATIVE_ADMISSION_SIGNATURE');
  }
  return signature;
}

export function compileSourceNativeAdmissionRecord({
  bundle: bundleInput,
  proposalStatement: proposalStatementInput,
  proposalSignatureBase64,
  statement: statementInput,
  signatureBase64,
}: {
  bundle?: unknown;
  proposalStatement?: unknown;
  proposalSignatureBase64?: unknown;
  statement?: unknown;
  signatureBase64?: unknown;
} = {}): SourceNativeAdmissionRecord {
  const bundle = validateSourceNativeAdmittedKnowledgeBundle(bundleInput);
  const proposalStatement = validateProposalStatement(proposalStatementInput, bundle);
  const proposalSignature = canonicalSignature(proposalSignatureBase64);
  const statement = validateAdmissionStatement(statementInput, bundle);
  const signature = canonicalSignature(signatureBase64);
  const core = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologySourceNativeAdmissionRecordV1' as const,
    bundle,
    proposalStatement,
    proposalSignatureBase64: proposalSignature,
    statement,
    signatureBase64: signature,
  };
  return freeze({ ...core, recordSha256: stableObjectSha256(core) });
}

function validateSourceNativeAdmissionRecord(value: unknown): SourceNativeAdmissionRecord {
  const row = plain(value) ? value : fail('SOURCE_NATIVE_ADMISSION_RECORD');
  const expected = compileSourceNativeAdmissionRecord({
    bundle: row.bundle,
    proposalStatement: row.proposalStatement,
    proposalSignatureBase64: row.proposalSignatureBase64,
    statement: row.statement,
    signatureBase64: row.signatureBase64,
  });
  if (stableObjectText(row) !== stableObjectText(expected)) {
    fail('SOURCE_NATIVE_ADMISSION_RECORD');
  }
  return expected;
}

function trustRegistry(value: unknown): Map<string, TrustedAdmissionKey> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    fail('SOURCE_NATIVE_ADMISSION_TRUST');
  }
  const entries: unknown[] = Array.isArray(value) ? value : fail('SOURCE_NATIVE_ADMISSION_TRUST');
  const registry = new Map<string, TrustedAdmissionKey>();
  for (const entryInput of entries) {
    const entry = plain(entryInput) ? entryInput : fail('SOURCE_NATIVE_ADMISSION_TRUST');
    exactKeys(entry, ['issuerId', 'publicKeyPem', 'roles'], 'SOURCE_NATIVE_ADMISSION_TRUST');
    const issuerId = nonempty(entry.issuerId, 'SOURCE_NATIVE_ADMISSION_TRUST');
    const publicKeyPem = nonempty(entry.publicKeyPem, 'SOURCE_NATIVE_ADMISSION_TRUST');
    const roleRows: unknown[] = Array.isArray(entry.roles)
      ? entry.roles : fail('SOURCE_NATIVE_ADMISSION_TRUST');
    const roles = roleRows.map((role): SourceNativeAdmissionTrustRole =>
      role === 'proposer' || role === 'reviewer'
        ? role : fail('SOURCE_NATIVE_ADMISSION_TRUST')).sort(compare);
    const key: ReturnType<typeof createPublicKey> = (() => {
      try { return createPublicKey(publicKeyPem); } catch {
        return fail('SOURCE_NATIVE_ADMISSION_TRUST');
      }
    })();
    if (key.asymmetricKeyType !== 'ed25519' || registry.has(issuerId)
      || roles.length < 1 || new Set(roles).size !== roles.length) {
      fail('SOURCE_NATIVE_ADMISSION_TRUST');
    }
    registry.set(issuerId, { key, roles: new Set(roles) });
  }
  return registry;
}

function authenticateRecord(value: unknown,
  registry: Map<string, TrustedAdmissionKey>): SourceNativeAdmissionRecord {
  const record = validateSourceNativeAdmissionRecord(value);
  const proposer = registry.get(record.proposalStatement.proposerId);
  const reviewer = registry.get(record.statement.issuerId);
  const proposerKey = proposer?.key;
  const reviewerKey = reviewer?.key;
  const sameKey = proposerKey !== undefined && reviewerKey !== undefined
    && Buffer.from(proposerKey.export({ type: 'spki', format: 'der' }))
      .equals(Buffer.from(reviewerKey.export({ type: 'spki', format: 'der' })));
  if (proposerKey === undefined || reviewerKey === undefined
    || proposer?.roles.has('proposer') !== true
    || reviewer?.roles.has('reviewer') !== true || sameKey
    || !verifySignature(
      null,
      Buffer.from(stableObjectText(record.proposalStatement)),
      proposerKey,
      Buffer.from(record.proposalSignatureBase64, 'base64'),
    )
    || !verifySignature(
    null,
    Buffer.from(stableObjectText(record.statement)),
    reviewerKey,
    Buffer.from(record.signatureBase64, 'base64'),
  )) fail('SOURCE_NATIVE_ADMISSION_AUTHENTICATION');
  return record;
}

function exactBoundEvidenceText(reference: ProofEvidenceReference,
  sourceByPath: ReadonlyMap<string, SourceNativeBoundSource>): string {
  const source = sourceByPath.get(reference.sourceRef)
    ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
  const bytes = Buffer.from(source.content);
  const exactBytes = bytes.subarray(reference.byteStart, reference.byteEnd);
  const exactText = exactBytes.toString('utf8');
  if (source.sourceSha256 !== reference.sourceSha256
    || objectBytesSha256(bytes) !== reference.sourceSha256
    || reference.byteStart < 0 || reference.byteEnd > bytes.length
    || reference.byteEnd <= reference.byteStart
    || objectBytesSha256(exactBytes) !== reference.textSha256
    || !Buffer.from(exactText).equals(exactBytes)) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
  }
  return exactText;
}

function encodedEvidencePayloadBytes(exactText: string): number {
  return Buffer.byteLength(JSON.stringify(exactText)) - 2;
}

function assertSourceBinding(bundle: SourceNativeAdmittedKnowledgeBundle,
  context: SourceNativeBindingContext): void {
  if (bundle.ontId !== context.descriptor.ontId
    || bundle.namespace !== context.descriptor.namespace
    || bundle.artifactSha256 !== context.descriptor.artifactSha256
    || bundle.nativeObjectMapSha256 !== context.objectOnt.map.nativeObjectMapSha256
    || bundle.sourceCommitSha256 !== context.objectOnt.commitSha256
    || bundle.sourceReplaySha256 !== context.objectOnt.replaySha256) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SOURCE_BINDING');
  }
  const binding = bundle.queryBinding;
  const plan = compileProductQueryPlan({
    question: binding.question,
    namespace: context.descriptor.namespace,
    querySchemas: context.descriptor.querySchemas,
    map: context.objectOnt.map,
    intent: binding.intent,
    anchorValue: binding.anchorValue,
    typedQuery: binding.typedQuery,
  });
  if (plan.state !== 'resolved-native-field-query' || plan.query === null
    || plan.planSha256 !== binding.queryPlanSha256
    || plan.questionSha256 !== binding.questionSha256
    || stableObjectText(plan.query) !== stableObjectText(binding.query)) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
  }
  const { answer, anchor, scopedObjectCount } = resolveBoundRevisions(bundle, context);
  assertProofContextBudget(bundle, anchor);
  const sourceByPath = new Map(context.objectOnt.sources.map((source) =>
    [source.relativePath, source]));
  for (const reference of bundle.propositions.flatMap((proposition) =>
    [...proposition.exactEvidenceReferences])) {
    exactBoundEvidenceText(reference, sourceByPath);
  }
  const anchorReference: ProofEvidenceReference | null = anchor === null ? null : {
    sourceRef: anchor.relativePath,
    ...anchor.evidence,
  };
  const encodedEvidenceBytes = admittedProofUnits(bundle).reduce((total, unit) =>
    total + encodedEvidencePayloadBytes(exactBoundEvidenceText(unit.evidence, sourceByPath)), 0)
    + (anchorReference === null ? 0 : encodedEvidencePayloadBytes(
      exactBoundEvidenceText(anchorReference, sourceByPath),
    ));
  if (encodedEvidenceBytes > MAX_ADMITTED_CONTEXT_ENCODED_EVIDENCE_BYTES) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_CONTEXT_BUDGET');
  }
  const proofRoles = requiredProofRoles(bundle);
  const supportRevisionIds = new Set([...proofRoles]
    .filter(([, role]) => role === 'support')
    .map(([revisionId]) => revisionId));
  const supportPropositions = bundle.propositions
    .filter((proposition) => supportRevisionIds.has(proposition.revisionId));
  const matchesAnswer = (reference: ProofEvidenceReference): boolean =>
    answer.relativePath === reference.sourceRef
    && answer.evidence.sourceSha256 === reference.sourceSha256
    && answer.evidence.byteStart === reference.byteStart
    && answer.evidence.byteEnd === reference.byteEnd
    && answer.evidence.textSha256 === reference.textSha256;
  if (scopedObjectCount < 1 || supportPropositions.length < 1
    || supportPropositions.some((proposition) =>
      proposition.exactEvidenceReferences.length < 1
      || !proposition.exactEvidenceReferences.every(matchesAnswer))) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
  }
  if (binding.intent === 'next' && anchor === null) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
  }
}

type SourceNativeBoundFieldRevision = NonNullable<SourceNativeFieldResolutionResult['current']>;
interface SourceNativeBoundRevisions {
  answer: SourceNativeBoundFieldRevision;
  anchor: SourceNativeBoundFieldRevision | null;
  scopedObjectCount: number;
}

function resolveBoundRevisions(bundle: SourceNativeAdmittedKnowledgeBundle,
  context: SourceNativeBindingContext): SourceNativeBoundRevisions {
  const binding = bundle.queryBinding;
  const scopedObjects = context.objectOnt.map.nativeObjects.filter((object) =>
    object.objectIdentity.sourceSystem === binding.query.sourceSystem
    && object.objectIdentity.objectType === binding.query.objectType
    && object.objectIdentity.namespace === binding.query.namespace
    && object.objectIdentity.externalId === binding.query.externalId);
  const seedRelativePaths = [...new Set(scopedObjects
    .map((object) => object.relativePath))].sort(compare);
  if (binding.intent === 'current') {
    const resolution = resolveSourceNativeField({
      sourceNativeObjectMap: context.objectOnt.map,
      seedRelativePaths,
      query: binding.query,
    });
    const answer = resolution.current
      ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
    if (resolution.state !== 'resolved-current-field') {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
    }
    return { answer, anchor: null, scopedObjectCount: scopedObjects.length };
  }
  const resolution = resolveSourceNativeFieldSuccessor({
    sourceNativeObjectMap: context.objectOnt.map,
    seedRelativePaths,
    query: binding.query,
  });
  const answer = resolution.successor
    ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
  const anchor = resolution.anchor
    ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
  if (resolution.state !== 'resolved-next-field-revision') {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
  }
  return { answer, anchor, scopedObjectCount: scopedObjects.length };
}

function requiredProofRoles(bundle: SourceNativeAdmittedKnowledgeBundle):
ReadonlyMap<string, RequiredProofRole> {
  const rolesByRevision = new Map<string, Set<RequiredProofRole>>();
  for (const obligation of bundle.proofEvaluation.obligations) {
    if (!obligation.required) continue;
    for (const revisionId of obligation.propositionRevisionIds) {
      const roles = rolesByRevision.get(revisionId) ?? new Set<RequiredProofRole>();
      roles.add(obligation.role);
      rolesByRevision.set(revisionId, roles);
    }
  }
  const roles = new Map<string, RequiredProofRole>();
  for (const proposition of bundle.propositions) {
    const matched = rolesByRevision.get(proposition.revisionId);
    const role = matched !== undefined && matched.size === 1
      ? [...matched][0] ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE')
      : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
    roles.set(proposition.revisionId, role);
  }
  return roles;
}

function admittedProofUnits(
  bundle: SourceNativeAdmittedKnowledgeBundle,
): readonly SourceNativeAdmittedProofUnit[] {
  const proofRoles = requiredProofRoles(bundle);
  const units = new Map<string, {
    role: SourceNativeAdmittedProofContext['role'];
    evidence: ProofEvidenceReference;
    propositionSha256s: Set<string>;
  }>();
  for (const proposition of bundle.propositions) {
    const proofRole = proofRoles.get(proposition.revisionId)
      ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE');
    const role = proofRole === 'invalidator' ? 'counterevidence' : 'answer';
    const propositionSha256 = stableObjectSha256(proposition);
    for (const evidence of proposition.exactEvidenceReferences) {
      const unitKey = stableObjectText({ role, evidence });
      const unit = units.get(unitKey) ?? {
        role,
        evidence,
        propositionSha256s: new Set<string>(),
      };
      unit.propositionSha256s.add(propositionSha256);
      units.set(unitKey, unit);
    }
  }
  return freeze([...units.values()].map((unit) => freeze({
    role: unit.role,
    evidence: unit.evidence,
    propositionSha256s: freeze([...unit.propositionSha256s].sort(compare)),
  })).sort((left, right) => compare(
    stableObjectText({ role: left.role, evidence: left.evidence }),
    stableObjectText({ role: right.role, evidence: right.evidence }),
  )));
}

function assertProofContextBudget(bundle: SourceNativeAdmittedKnowledgeBundle,
  anchor: SourceNativeBoundFieldRevision | null): void {
  const proofUnits = admittedProofUnits(bundle);
  const contextUnitCount = proofUnits.length + (anchor === null ? 0 : 1);
  const exactEvidenceBytes = proofUnits.reduce((total, unit) =>
    total + unit.evidence.byteEnd - unit.evidence.byteStart, 0)
    + (anchor === null ? 0 : anchor.evidence.byteEnd - anchor.evidence.byteStart);
  if (contextUnitCount > MAX_ADMITTED_CONTEXT_UNITS
    || exactEvidenceBytes > MAX_ADMITTED_CONTEXT_EVIDENCE_BYTES) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_CONTEXT_BUDGET');
  }
}

export function writeSourceNativeAdmittedKnowledge({
  options = {},
  record: recordInput,
  trustRegistry: trustInput,
  knowledgeBranch: knowledgeBranchInput,
}: {
  options?: ProductOptions;
  record: unknown;
  trustRegistry: readonly SourceNativeAdmissionTrustEntry[];
  knowledgeBranch?: string;
}): SourceNativeAdmittedKnowledgeWriteResult {
  const registry = trustRegistry(trustInput);
  const record = authenticateRecord(recordInput, registry);
  const state = openProductState(options);
  const context = {
    descriptor: state.descriptor,
    objectOnt: state.objectOnt,
  };
  const knowledgeBranch = knowledgeBranchFor(state.objectOnt.commitSha256,
    knowledgeBranchInput);
  assertSourceBinding(record.bundle, context);
  if (typeof knowledgeBranch !== 'string' || !knowledgeBranch
    || knowledgeBranch === state.descriptor.branch) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BRANCH');
  }
  const current = state.store.readRefMetadata({
    ontId: state.descriptor.ontId,
    branch: knowledgeBranch,
  });
  const currentReplay = current === null ? null
    : state.store.replayMetadata(current.ref.commitSha256);
  if (current !== null && (current.ref.replayStatus !== 'CLEAN'
    || currentReplay === null
    || currentReplay.ontId !== state.descriptor.ontId
    || !currentReplay.commitOrder.includes(state.objectOnt.commitSha256))) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BRANCH');
  }
  for (const supersededRecordSha256 of record.statement.supersedesRecordSha256s) {
    const supersededPath = `${KNOWLEDGE_PREFIX}${supersededRecordSha256.slice(7)}.json`;
    const descriptor = currentReplay?.blobDescriptors.find((candidate) =>
      candidate.logicalPath === supersededPath)
      ?? fail('SOURCE_NATIVE_ADMISSION_SUPERSESSION');
    const loaded = state.store.readBlob(descriptor);
    let value: unknown;
    try { value = JSON.parse(loaded.bytes.toString('utf8')); } catch {
      fail('SOURCE_NATIVE_ADMISSION_SUPERSESSION');
    }
    const superseded = validateSourceNativeAdmissionRecord(value);
    if (superseded.recordSha256 !== supersededRecordSha256
      || Date.parse(superseded.statement.admittedAt) >= Date.parse(record.statement.admittedAt)
      || stableObjectText(superseded.bundle.queryBinding)
        !== stableObjectText(record.bundle.queryBinding)) {
      fail('SOURCE_NATIVE_ADMISSION_SUPERSESSION');
    }
  }
  const logicalPath = `${KNOWLEDGE_PREFIX}${record.recordSha256.slice(7)}.json`;
  const recordBytes = Buffer.from(stableObjectText(record));
  const existing = currentReplay?.blobDescriptors.find((descriptor) =>
    descriptor.logicalPath === logicalPath);
  if (existing !== undefined) {
    if (existing.storedSha256 !== objectBytesSha256(recordBytes)) {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BRANCH');
    }
    return freeze({
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeAdmittedKnowledgeWriteResultV1',
      ontId: state.descriptor.ontId,
      branch: knowledgeBranch,
      recordSha256: record.recordSha256,
      commitSha256: current?.ref.commitSha256
        ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BRANCH'),
      replaySha256: current?.ref.replaySha256
        ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BRANCH'),
      replayed: true,
    });
  }
  const blob = state.store.putBlob({
    logicalPath,
    bytes: recordBytes,
    mediaType: 'application/vnd.openontology.admission+json',
  });
  const parentCommitSha256 = current?.ref.commitSha256 ?? state.objectOnt.commitSha256;
  const parent = state.store.readCommit(parentCommitSha256).commit;
  const receipt = state.store.writeCommitMetadata({
    ontId: state.descriptor.ontId,
    parents: [parentCommitSha256],
    ontManifest: parent.ontManifest,
    blobs: [blob],
  });
  const updated = state.store.compareAndSwapRefMetadata({
    ontId: state.descriptor.ontId,
    branch: knowledgeBranch,
    expectedVersion: current?.version ?? null,
    commitSha256: receipt.commitSha256,
  }) as { ref?: { replaySha256?: unknown } };
  const replaySha256 = sha256(updated.ref?.replaySha256,
    'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_WRITE');
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeAdmittedKnowledgeWriteResultV1',
    ontId: state.descriptor.ontId,
    branch: knowledgeBranch,
    recordSha256: record.recordSha256,
    commitSha256: receipt.commitSha256,
    replaySha256,
    replayed: false,
  });
}

function refusal(prepared: SourceNativeProductPreparedSearch, context: SourceNativeProductRuntimeContext,
  state: string, record: SourceNativeAdmissionRecord | null, reason: string,
  sessionBefore: UnknownRecord,
  sessionAfter: UnknownRecord): SourceNativeAdmittedKnowledgeVerification {
  const core = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologySourceNativeAdmittedKnowledgeVerificationV1' as const,
    state: state as 'unavailable-admitted-knowledge-ambiguous',
    answerable: false as const,
    intent: prepared.intent,
    query: prepared.plan.query,
    context: freeze([]),
    mentionedExternalIds: prepared.plan.mentionedExternalIds,
    unresolvedExternalIds: prepared.plan.unresolvedExternalIds,
    availableFields: freeze([]),
    proofDisposition: 'unresolved' as const,
    refusal: freeze({ code: reason }),
    verification: freeze({
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryPlanSha256: prepared.plan.planSha256,
      admissionRecordSha256: record?.recordSha256 ?? null,
      rawSearchExecuted: false as const,
      rawSearchCalls: Number(sessionAfter.searchCalls) - Number(sessionBefore.searchCalls),
      modelCalls: 0 as const,
      exactSourceInspectionCount: Number(sessionAfter.inspectCalls)
        - Number(sessionBefore.inspectCalls),
    }),
    policy: freeze({
      navigationOnly: false as const,
      exactReadRequired: true as const,
      exactSourcesRemainAuthority: true as const,
      canonicalTruthMutation: false as const,
    }),
  };
  return freeze({ ...core, verificationSha256: stableObjectSha256(core) });
}

function exactContextRows(record: SourceNativeAdmissionRecord,
  sources: Map<string, PlainRecord>,
  anchor: SourceNativeBoundFieldRevision | null): SourceNativeAdmittedKnowledgeContext[] {
  const rows: SourceNativeAdmittedKnowledgeContext[] = [];
  for (const unit of admittedProofUnits(record.bundle)) {
    const source = sources.get(unit.evidence.sourceRef)
      ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    if (source.contentSha256 !== unit.evidence.sourceSha256
      || typeof source.content !== 'string') {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    }
    const content = typeof source.content === 'string'
      ? source.content : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    const occurredAt = nonempty(source.timeAnchor,
      'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    const bytes = Buffer.from(content);
    if (objectBytesSha256(bytes) !== unit.evidence.sourceSha256
      || unit.evidence.byteStart < 0 || unit.evidence.byteEnd > bytes.length
      || unit.evidence.byteEnd <= unit.evidence.byteStart) {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    }
    const exactBytes = bytes.subarray(unit.evidence.byteStart, unit.evidence.byteEnd);
    const exactText = exactBytes.toString('utf8');
    if (objectBytesSha256(exactBytes) !== unit.evidence.textSha256
      || !Buffer.from(exactText).equals(exactBytes)) {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    }
    const row: SourceNativeAdmittedProofContext = freeze({
      role: unit.role,
      exactText,
      evidence: freeze({
        relativePath: unit.evidence.sourceRef,
        occurredAt,
        sourceSha256: unit.evidence.sourceSha256,
        byteStart: unit.evidence.byteStart,
        byteEnd: unit.evidence.byteEnd,
        textSha256: unit.evidence.textSha256,
      }),
      binding: freeze({
        schemaVersion: 1,
        kind: 'OpenOntologyAdmittedProofBindingV1',
        proofUnitSha256: stableObjectSha256({
          schemaVersion: 1,
          kind: 'OpenOntologyAdmittedProofUnitV1',
          role: unit.role,
          evidence: unit.evidence,
          propositionSha256s: unit.propositionSha256s,
        }),
        contractSha256: record.bundle.proofSufficiencyContract.contractSha256,
        proofCensusSha256: record.bundle.proofAuthorityProjection.proofCensusSha256,
        admissionRecordSha256: record.recordSha256,
        exactSourcesRemainAuthority: true,
      }),
    });
    rows.push(row);
  }
  rows.sort((left, right) => compare(stableObjectText(left), stableObjectText(right)));
  if (anchor !== null) {
    const evidence = {
      sourceRef: anchor.relativePath,
      ...anchor.evidence,
    };
    const source = sources.get(evidence.sourceRef)
      ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    const content = typeof source.content === 'string'
      ? source.content : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    const occurredAt = nonempty(source.timeAnchor,
      'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    const bytes = Buffer.from(content);
    const exactBytes = bytes.subarray(evidence.byteStart, evidence.byteEnd);
    const exactText = exactBytes.toString('utf8');
    if (source.contentSha256 !== evidence.sourceSha256
      || objectBytesSha256(bytes) !== evidence.sourceSha256
      || evidence.byteStart < 0 || evidence.byteEnd > bytes.length
      || evidence.byteEnd <= evidence.byteStart
      || objectBytesSha256(exactBytes) !== evidence.textSha256
      || !Buffer.from(exactText).equals(exactBytes)) {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    }
    const row: SourceNativeAdmittedAnchorContext = freeze({
      role: 'anchor',
      exactText,
      evidence: freeze({
        relativePath: evidence.sourceRef,
        occurredAt,
        sourceSha256: evidence.sourceSha256,
        byteStart: evidence.byteStart,
        byteEnd: evidence.byteEnd,
        textSha256: evidence.textSha256,
      }),
      binding: freeze({
        schemaVersion: 1,
        kind: 'OpenOntologyAdmittedQueryAnchorBindingV1',
        objectIdentity: anchor.objectIdentity,
        objectIdentitySha256: anchor.objectIdentitySha256,
        fieldSha256: anchor.fieldSha256,
        sourceCommitSha256: record.bundle.sourceCommitSha256,
        exactSourcesRemainAuthority: true,
      }),
    });
    rows.push(row);
  }
  return rows;
}

async function inspectExactSources(record: SourceNativeAdmissionRecord,
  prepared: SourceNativeProductPreparedSearch,
  context: SourceNativeProductRuntimeContext,
  additionalReferences: readonly ProofEvidenceReference[] = [],
): Promise<Map<string, PlainRecord>> {
  const sourceByPath = new Map(context.sources.map((source) => [source.relativePath, source]));
  const references: ProofEvidenceReference[] = [
    ...record.bundle.propositions
      .flatMap((proposition) => [...proposition.exactEvidenceReferences]),
    ...additionalReferences,
  ];
  const paths = [...new Set(references.map((reference) => reference.sourceRef))].sort(compare);
  if (paths.length < 1) fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
  const sourceIds = paths.map((path) => sourceByPath.get(path)?.sourceMessageId
    ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE'));
  for (let start = 0; start < sourceIds.length; start += 128) {
    context.session.offerNavigationSources({
      selectionKind: 'admitted-knowledge-proof',
      selectionSha256: record.recordSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      sourceSearchRouteMapSha256: context.session.sourceSearchRouteMapSha256,
      sourceMessageIds: sourceIds.slice(start, start + 128),
    });
  }
  const reopened = new Map<string, PlainRecord>();
  for (let start = 0; start < sourceIds.length; start += 32) {
    const inspected = await context.session.inspectSources({
      sources: sourceIds.slice(start, start + 32).map((sourceMessageId) => ({
        sourceMessageId,
        navigationQuery: prepared.question,
      })),
    });
    const response = inspected.response as UnknownRecord;
    if (typeof response.text_utf8_base64 !== 'string') {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    }
    const encoded = typeof response.text_utf8_base64 === 'string'
      ? response.text_utf8_base64
      : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    let bundle: unknown;
    try {
      bundle = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    }
    const row = plain(bundle) ? bundle : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    const sourceRows: unknown[] = Array.isArray(row.sources) ? row.sources
      : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    if (row.kind !== 'OpenOntologyExactSourceBundleV1') {
      fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
    }
    for (const sourceInput of sourceRows) {
      const source = plain(sourceInput) ? sourceInput
        : fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
      const relativePath = nonempty(source.relativePath,
        'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
      if (reopened.has(relativePath)) fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
      reopened.set(relativePath, source);
    }
  }
  if (reopened.size !== paths.length
    || paths.some((path) => !reopened.has(path))) {
    fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE');
  }
  return reopened;
}

function openReader(context: SourceNativeProductRuntimeContext,
  trustInput: readonly SourceNativeAdmissionTrustEntry[], knowledgeBranch: string) {
  const registry = trustRegistry(trustInput);
  let ref: ReturnType<typeof context.store.readRefMetadata> = null;
  const structuralRecords: SourceNativeAdmissionRecord[] = [];
  const records: SourceNativeAdmissionRecord[] = [];
  let invalidAdmissionRecordCount = 0;
  const diagnosticCodes = new Set<string>();
  try {
    ref = context.store.readRefMetadata({
      ontId: context.descriptor.ontId,
      branch: knowledgeBranch,
    });
    if (ref !== null) {
      const replay = context.store.replayMetadata(ref.ref.commitSha256);
      if (replay.status !== 'CLEAN'
        || !replay.commitOrder.includes(context.objectOnt.commitSha256)) {
        fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BRANCH');
      }
      for (const descriptor of replay.blobDescriptors.filter((row) =>
        row.logicalPath.startsWith(KNOWLEDGE_PREFIX))) {
        try {
          const loaded = context.store.readBlob(descriptor);
          const value: unknown = JSON.parse(loaded.bytes.toString('utf8'));
          const record = validateSourceNativeAdmissionRecord(value);
          structuralRecords.push(record);
          try {
            assertSourceBinding(record.bundle, context);
            records.push(authenticateRecord(record, registry));
          } catch (error) {
            invalidAdmissionRecordCount += 1;
            diagnosticCodes.add(caughtCode(error,
              'SOURCE_NATIVE_ADMISSION_AUTHENTICATION'));
          }
        } catch (error) {
          invalidAdmissionRecordCount += 1;
          diagnosticCodes.add(caughtCode(error,
            'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RECORD_INVALID'));
        }
      }
    }
  } catch (error) {
    ref = null;
    structuralRecords.length = 0;
    records.length = 0;
    invalidAdmissionRecordCount += 1;
    diagnosticCodes.add(caughtCode(error, 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_BRANCH'));
  }
  structuralRecords.sort((left, right) => compare(left.recordSha256, right.recordSha256));
  records.sort((left, right) => compare(left.recordSha256, right.recordSha256));
  const recordsBySha256 = new Map(structuralRecords
    .map((record) => [record.recordSha256, record]));
  const invalidSupersessionRecordSha256s = new Set<string>();
  const supersessionTargets = new Map<string, string[]>();
  for (const record of records) {
    const targets: string[] = [];
    for (const supersededRecordSha256 of record.statement.supersedesRecordSha256s) {
      const superseded = recordsBySha256.get(supersededRecordSha256);
      if (superseded === undefined
        || Date.parse(superseded.statement.admittedAt) >= Date.parse(record.statement.admittedAt)
        || stableObjectText(superseded.bundle.queryBinding)
          !== stableObjectText(record.bundle.queryBinding)) {
        invalidSupersessionRecordSha256s.add(record.recordSha256);
        invalidAdmissionRecordCount += 1;
        diagnosticCodes.add('SOURCE_NATIVE_ADMISSION_SUPERSESSION');
        break;
      }
      targets.push(supersededRecordSha256);
    }
    if (!invalidSupersessionRecordSha256s.has(record.recordSha256)) {
      supersessionTargets.set(record.recordSha256, targets);
    }
  }
  const supersededRecordSha256s = new Set<string>();
  for (const record of records) {
    for (const supersededRecordSha256 of supersessionTargets.get(record.recordSha256) ?? []) {
      supersededRecordSha256s.add(supersededRecordSha256);
    }
  }
  const activeRecords = records.filter((record) =>
    !invalidSupersessionRecordSha256s.has(record.recordSha256)
    && !supersededRecordSha256s.has(record.recordSha256));
  let runtimeFallbackCount = 0;
  let lastRuntimeFallback: Readonly<{ code: string; admissionRecordSha256: string }> | null = null;
  const fallback = (code: string, record: SourceNativeAdmissionRecord): null => {
    runtimeFallbackCount += 1;
    lastRuntimeFallback = freeze({ code, admissionRecordSha256: record.recordSha256 });
    return null;
  };

  const verifyPrepared = async (prepared: SourceNativeProductPreparedSearch) => {
    const matching = activeRecords.filter((record) =>
      prepared.plan.state === 'resolved-native-field-query'
      && prepared.plan.query !== null
      && record.bundle.queryBinding.queryPlanSha256 === prepared.plan.planSha256
      && record.bundle.queryBinding.questionSha256 === prepared.plan.questionSha256
      && record.bundle.queryBinding.intent === prepared.intent
      && record.bundle.queryBinding.question === prepared.question
      && record.bundle.queryBinding.anchorValue === prepared.anchorValue
      && stableObjectText(record.bundle.queryBinding.typedQuery)
        === stableObjectText(prepared.typedQuery)
      && stableObjectText(record.bundle.queryBinding.query)
        === stableObjectText(prepared.plan.query));
    if (matching.length === 0) return null;
    const before = context.session.getState() as UnknownRecord;
    const recordsByBundle = new Map<string, SourceNativeAdmissionRecord[]>();
    for (const record of matching) {
      const agreement = recordsByBundle.get(record.bundle.bundleSha256) ?? [];
      agreement.push(record);
      recordsByBundle.set(record.bundle.bundleSha256, agreement);
    }
    if (recordsByBundle.size !== 1) {
      return refusal(prepared, context, 'unavailable-admitted-knowledge-ambiguous', null,
        'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_AMBIGUOUS', before,
        context.session.getState() as UnknownRecord);
    }
    const agreement = [...recordsByBundle.values()][0]
      ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_AMBIGUOUS');
    const record = agreement[0] ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_AMBIGUOUS');
    const admissionRecordSha256s = agreement
      .map((candidate) => candidate.recordSha256)
      .sort(compare);
    const admissionIssuerIds = [...new Set(agreement
      .map((candidate) => candidate.statement.issuerId))]
      .sort(compare);
    const relatedSupersededRecordSha256s = [...supersededRecordSha256s]
      .filter((recordSha256) => {
        const superseded = recordsBySha256.get(recordSha256);
        return superseded !== undefined
          && stableObjectText(superseded.bundle.queryBinding)
            === stableObjectText(record.bundle.queryBinding);
      })
      .sort(compare);
    let evaluation: ProofSufficiencyEvaluation;
    try {
      evaluation = evaluateProofSufficiencyContract({
        contract: record.bundle.proofSufficiencyContract,
        propositions: record.bundle.propositions,
        relations: record.bundle.relations,
        authorityProjection: record.bundle.proofAuthorityProjection,
      });
    } catch {
      return fallback('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_AUTHORITY', record);
    }
    if (!evaluation.proofClosed
      || stableObjectText(evaluation) !== stableObjectText(record.bundle.proofEvaluation)) {
      return fallback('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROOF', record);
    }
    let contextRows: SourceNativeAdmittedKnowledgeContext[];
    try {
      const { anchor } = resolveBoundRevisions(record.bundle, context);
      const anchorReferences: ProofEvidenceReference[] = anchor === null ? [] : [{
        sourceRef: anchor.relativePath,
        ...anchor.evidence,
      }];
      const sources = await inspectExactSources(record, prepared, context, anchorReferences);
      contextRows = exactContextRows(record, sources, anchor);
    } catch {
      return fallback('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE', record);
    }
    const after = context.session.getState() as UnknownRecord;
    const core = {
      schemaVersion: 1 as const,
      kind: 'OpenOntologySourceNativeAdmittedKnowledgeVerificationV1' as const,
      state: 'resolved-admitted-knowledge-proof-closure' as const,
      answerable: true as const,
      intent: prepared.intent,
      query: prepared.plan.query,
      context: freeze(contextRows),
      mentionedExternalIds: prepared.plan.mentionedExternalIds,
      unresolvedExternalIds: prepared.plan.unresolvedExternalIds,
      availableFields: freeze([]),
      proofDisposition: evaluation.proofDisposition as Exclude<
        ProofSufficiencyEvaluation['proofDisposition'], 'unresolved'>,
      verification: freeze({
        artifactSha256: context.descriptor.artifactSha256,
        nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
        sourceCommitSha256: context.objectOnt.commitSha256,
        sourceReplaySha256: context.objectOnt.replaySha256,
        queryPlanSha256: prepared.plan.planSha256,
        admissionRecordSha256: record.recordSha256,
        admissionRecordSha256s: freeze(admissionRecordSha256s),
        admissionIssuerId: record.statement.issuerId,
        admissionIssuerIds: freeze(admissionIssuerIds),
        supersededAdmissionRecordSha256s: freeze(relatedSupersededRecordSha256s),
        proofContractSha256: record.bundle.proofSufficiencyContract.contractSha256,
        proofCensusSha256: record.bundle.proofAuthorityProjection.proofCensusSha256,
        rawSearchExecuted: false as const,
        rawSearchCalls: Number(after.searchCalls) - Number(before.searchCalls),
        modelCalls: 0 as const,
        exactSourceInspectionCount: Number(after.inspectCalls) - Number(before.inspectCalls),
      }),
      policy: freeze({
        navigationOnly: false as const,
        exactReadRequired: true as const,
        exactSourcesRemainAuthority: true as const,
        canonicalTruthMutation: false as const,
      }),
    };
    return freeze({ ...core, verificationSha256: stableObjectSha256(core) });
  };
  return freeze({
    verifyPrepared,
    status: () => freeze({
      branch: knowledgeBranch,
      commitSha256: ref?.ref.commitSha256 ?? null,
      replaySha256: ref?.ref.replaySha256 ?? null,
      admittedRecordCount: records.length,
      activeAdmissionRecordCount: activeRecords.length,
      supersededAdmissionRecordCount: supersededRecordSha256s.size,
      invalidAdmissionRecordCount,
      runtimeFallbackCount,
      lastRuntimeFallback,
      diagnosticCodes: freeze([...diagnosticCodes].sort(compare)),
      state: invalidAdmissionRecordCount === 0 && runtimeFallbackCount === 0
        ? 'ready' as const : 'degraded' as const,
      exactSourcesRemainAuthority: true as const,
    }),
  });
}

export function openSourceNativeProductWithAdmittedKnowledge(
  options: ProductOptions = {},
  configuration: {
    trustRegistry: readonly SourceNativeAdmissionTrustEntry[];
    knowledgeBranch?: string;
  },
): SourceNativeAdmittedKnowledgeProduct {
  const {
    trustRegistry: trustInput,
    knowledgeBranch: knowledgeBranchInput,
  } = configuration ?? fail('SOURCE_NATIVE_ADMISSION_TRUST');
  let context: SourceNativeProductRuntimeContext | null = null;
  const product = openSourceNativeProductRuntime(options, (runtimeContext) => {
    context = runtimeContext;
    return null;
  });
  const capturedContext = context as SourceNativeProductRuntimeContext | null;
  const exactContext: SourceNativeProductRuntimeContext = capturedContext
    ?? fail('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_RUNTIME');
  const knowledgeBranch = knowledgeBranchFor(exactContext.objectOnt.commitSha256,
    knowledgeBranchInput);
  const reader = openReader(exactContext, trustInput, knowledgeBranch);
  return Object.freeze({
    kind: 'OpenOntologySourceNativeAdmittedKnowledgeProductV1' as const,
    verify: async (input: ProductSearchInput = { question: '' }) => {
      const { investigationId = null, ...searchInput } = input;
      if (investigationId !== null) return product.verify(input);
      const prepared = exactContext.prepareSearch(searchInput);
      return await reader.verifyPrepared(prepared) ?? product.verify(input);
    },
    search: async (input: ProductSearchInput = { question: '' }): Promise<SourceNativeProductSearchResult> =>
      product.search(input),
    read: async (input: { ref: string }): Promise<SourceNativeProductReadResult> =>
      product.read(input),
    status: () => freeze({
      ...product.status(),
      admittedKnowledge: reader.status(),
    }),
  });
}
