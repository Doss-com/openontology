/** Public SDK for querying and inspecting an Ont. */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openSourceNativeProduct, SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE } from './product/runtime.js';
import type { ProductOptions } from './source/artifact.js';
import type { OpenOntologyResultState as ResultState } from './product/result-state.js';
import type { GcsRequestObserver } from './storage/gcs-request-observation.js';

export interface OpenOntologyScopeInput {
  sourceSystem: string;
  objectType: string;
  externalId?: string;
  field: string;
}
export interface OpenOntologyQueryInput {
  question: string;
  intent?: 'current' | 'next';
  /** Select by valid time in the snapshot, not by what was known at that time. */
  at?: string;
  /** Exact previous field value for `next`, not an object ID. */
  anchorValue?: string | null;
  /** Source, type and field names must match the Adapter schema. */
  scope?: OpenOntologyScopeInput;
}

interface OpenOntologyQuery {
  question: string;
  intent?: 'current' | 'next';
  at?: string;
  anchorValue?: string | null;
  typedQuery?: {
    sourceSystem: string;
    objectType: string;
    fieldPath: string;
    externalId?: string;
  } | null;
}
export interface OpenOntologyReferenceInput {
  ref: string;
}
export type OpenOntologyBackendEnvironment = Readonly<
  Record<string, string | (() => string) | GcsRequestObserver | null | undefined>
>;
export interface OpenOntologyOptions {
  artifactRoot: string;
  objectBackendUri?: string | null;
  objectBackendEnv?: OpenOntologyBackendEnvironment;
}
export type OpenOntologyResultState = ResultState;
export interface OpenOntologyResolvedQuery {
  sourceSystem: string;
  objectType: string;
  fieldPath: string;
  namespace?: string;
  externalId?: string;
  anchorFieldSha256?: string;
}
export interface OpenOntologyMatch {
  ref: string;
  role: string;
  requiredForProof: true;
  relativePath: string;
  occurredAt: string;
  fieldPath: string;
  propositionFamilyKey: string;
  sourceSha256: string;
  fieldSha256: string;
}
export interface OpenOntologyAvailableField {
  sourceSystem: string;
  objectType: string;
  fieldPath: string;
  aliases: string[];
}
export interface OpenOntologyCurrentFieldChronologyVerification {
  schema: 1;
  kind: 'OpenOntologySourceNativeCurrentFieldChronologyVerificationV1';
  state:
    | 'verified-complete-recorded-field-chronology'
    | 'unverified-incomplete-recorded-field-chronology';
  proofDisposition: 'sufficient' | 'insufficient';
  scope: 'latest-recorded-field-over-bound-source-cut';
  objectIdentity: {
    home: 'ObjectDef/InstanceRef';
    sourceSystem: string;
    objectType: string;
    externalId: string;
    namespace?: string;
  };
  objectIdentitySha256: string;
  fieldPath: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceCatalogSha256: string | null;
  sourceHandleSetSha256: string;
  nativeObjectMapSha256: string;
  fieldResolutionSha256: string;
  sourceCount: number;
  mappedSourceCount: number;
  identityObservationCount: number;
  fieldObservationCount: number;
  fieldRevisionCount: number;
  chronologySha256: string;
  revisionClosureSha256: string;
  currentFieldSha256: string;
  currentSourceSha256: string;
  currentRelativePath: string;
  currentOccurredAt: string;
  unmetRequirements: string[];
  questionIndependentMap: true;
  navigationOnly: true;
  exactInspectRequired: true;
  exactSourcesRemainAuthority: true;
  verificationSha256: string;
}
export interface OpenOntologyHistoricalFieldChronologyVerification {
  schema: 1;
  kind: 'OpenOntologySourceNativeHistoricalFieldChronologyVerificationV1';
  proofDisposition: 'sufficient' | 'insufficient';
  scope: 'retrospective-valid-time-over-bound-source-cut';
  temporalProfile: 'source-native-basic-retrospective-v1';
  at: string;
  sourceObservedThrough: string;
  knownAtLimitsSelection: false;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceCatalogSha256: string | null;
  sourceHandleSetSha256: string;
  nativeObjectMapSha256: string;
  fieldResolutionSha256: string;
  selectedFieldSha256: string;
  selectedValidAt: string;
  selectedKnownAt: string;
  observationClosureCount: number;
  observationClosureSha256: string;
  revisionClosureCount: number;
  revisionClosureSha256: string;
  derivedValidAtFieldCount: number;
  unmetRequirements: string[];
  exactInspectRequired: true;
  exactSourcesRemainAuthority: true;
  verificationSha256: string;
}
export interface OpenOntologyObjectIdentityAbsenceReceipt {
  schema: 1;
  kind: 'OpenOntologySourceNativeObjectIdentityAbsenceReceiptV1';
  namespace: string;
  objectIdentity: {
    sourceSystem: string;
    objectType: string;
    externalId: string;
  };
  censusSha256: string;
  sourceCatalogSha256: string;
  sourceHandleSetSha256: string;
  sourceCount: number;
  exactOccurrenceCount: 0;
  authority: 'complete-strict-object-identity-census-over-bound-source-catalog';
  worldAbsenceAuthorized: false;
  modelCalls: 0;
  networkCalls: 0;
  targetLeakage: false;
  receiptSha256: string;
}
export interface OpenOntologySemanticProofAuthority {
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
export interface OpenOntologySemanticProofVerification {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeSemanticProofVerificationV1';
  rootPropositionKey: string;
  supportPropositionFamily: 'action' | 'change' | 'outcome' | 'state';
  sourceProjectionSha256: string;
  proofCensusSha256: string;
  proofContractSha256: string;
  proofClosed: boolean;
  proofDisposition: 'contradicted' | 'qualified' | 'supported' | 'unresolved';
  propositionCount: number;
  relationCount: number;
  exactEvidenceReferenceCount: number;
  exactSourcesRemainAuthority: true;
  verificationSha256: string;
}
export interface OpenOntologySemanticProofRefusal {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeSemanticProofRefusalV1';
  code: 'semantic-proof-context-budget-exceeded';
  sourceProjectionSha256: string;
  proofCensusSha256: string;
  observedEvidenceReferenceCount: number;
  observedExactEvidenceBytes: number;
  maximumEvidenceReferenceCount: 64;
  maximumExactEvidenceBytes: 65536;
  partialContextReturned: false;
  exactSourcesRemainAuthority: true;
  refusalSha256: string;
}
export interface OpenOntologyVerificationMetadata {
  artifactSha256: string;
  nativeObjectMapSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  queryPlanSha256: string;
  searchPathSha256: string | null;
  resolutionSha256: string | null;
  navigationProposals: Record<string, unknown> | null;
  currentFieldChronology: OpenOntologyCurrentFieldChronologyVerification | null;
  historicalFieldChronology?: OpenOntologyHistoricalFieldChronologyVerification | null;
  absenceReceipt: OpenOntologyObjectIdentityAbsenceReceipt | null;
  semanticProofAuthority?: OpenOntologySemanticProofAuthority;
  semanticProof?: OpenOntologySemanticProofVerification;
  semanticProofRefusal?: OpenOntologySemanticProofRefusal;
}
export interface OpenOntologyResultPolicy {
  navigationOnly: boolean;
  exactReadRequired: boolean;
  exactSourcesRemainAuthority: boolean;
  canonicalTruthMutation: boolean;
}
export interface OpenOntologySearchResult {
  resultSha256: string;
  schemaVersion: number;
  kind: 'OpenOntologySourceNativeProductSearchResultV2';
  state: OpenOntologyResultState;
  intent: 'current' | 'next' | 'at';
  at?: string;
  query: OpenOntologyResolvedQuery | null;
  mentionedExternalIds: string[] | undefined;
  unresolvedExternalIds: string[] | undefined;
  selectionMode: string | null;
  matches: OpenOntologyMatch[];
  availableFields: OpenOntologyAvailableField[];
  verification: OpenOntologyVerificationMetadata;
  policy: OpenOntologyResultPolicy;
}
export interface OpenOntologyReadEvidence {
  relativePath: string;
  occurredAt: string;
  sourceSha256: string;
  byteStart: number;
  byteEnd: number;
  textSha256: string;
}
export interface OpenOntologyReadBinding {
  bindingSha256: string;
  schemaVersion: number;
  kind: 'OpenOntologyVerifiedSourceNativeFieldBindingV1';
  role: string;
  selectionMode: string;
  sourceSystem: string;
  objectType: string;
  namespace: string | undefined;
  externalId: string;
  fieldPath: string;
  fieldSha256: string;
  sourceSha256: string;
  resultSha256: string;
  searchPathSha256: string | null;
  exactSourcesRemainAuthority: boolean;
}
export interface OpenOntologyReadResult {
  receiptSha256: string;
  schemaVersion: number;
  kind: 'OpenOntologySourceNativeProductReadResultV1';
  ref: string;
  exactText: string;
  evidence: OpenOntologyReadEvidence;
  binding: OpenOntologyReadBinding;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  immutable: boolean;
  exactSourcesRemainAuthority: boolean;
  canonicalTruthMutation: boolean;
}
export interface OpenOntologyVerificationResult {
  verificationSha256: string;
  schemaVersion: number;
  kind: 'OpenOntologySourceNativeVerificationV1';
  state: OpenOntologyResultState;
  answerable: boolean;
  proofDisposition?: 'contradicted' | 'qualified' | 'supported' | 'unresolved';
  intent: 'current' | 'next' | 'at';
  at?: string;
  query: OpenOntologyResolvedQuery | null;
  context: Array<{
    role: string;
    exactText: string;
    evidence: OpenOntologyReadEvidence;
    binding: OpenOntologyReadBinding;
  }>;
  mentionedExternalIds: string[] | undefined;
  unresolvedExternalIds: string[] | undefined;
  availableFields: OpenOntologyAvailableField[];
  verification: OpenOntologyVerificationMetadata;
  policy: OpenOntologyResultPolicy;
}
export interface OpenOntologyStatus {
  schemaVersion: number;
  kind: 'OpenOntologySourceNativeProductStatusV1';
  ontId: string;
  branch: string;
  namespace: string;
  sourceCount: number;
  nativeObjectCount: number;
  fieldRevisionCount: number;
  artifactSha256: string;
  nativeObjectMapSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceSearchRouteMapSha256: string;
  objectBackend: string;
  objectBackendCapabilities: {
    schemaVersion: 1;
    kind: 'OpenOntologyObjectBackendCapabilitiesV1';
    backend: string;
    contractSha256: string;
    operations: Readonly<Record<string, string>>;
    distributedObjectStore: boolean;
    multiProcessCas: boolean;
    singleProcessCas: boolean;
    providerConditionalWritePolicy: boolean;
    [key: string]: unknown;
  };
  canonicalTruthMutation: boolean;
  canonicalSourceReadOnly: boolean;
  readOnly: boolean;
}
export interface OpenOntologyProduct {
  kind: 'OpenOntologyClientV2';
  /** Return checked source context, or a refusal when verification cannot complete. */
  verify: (input: string | OpenOntologyQueryInput) => Promise<OpenOntologyVerificationResult>;
  /** Find candidate References. Search results alone do not establish an answer. */
  search: (input: string | OpenOntologyQueryInput) => Promise<OpenOntologySearchResult>;
  /** Inspect a Reference issued by this client. */
  read: (input: string | OpenOntologyReferenceInput) => Promise<OpenOntologyReadResult>;
  /** Inspect the opened Ont without refreshing its source data. */
  status: () => OpenOntologyStatus;
}

function fail(code: string): never {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
}
const EXACT_UTC_MILLISECOND_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function exactUtcMillisecondIso(value: unknown): value is string {
  if (typeof value !== 'string' || !EXACT_UTC_MILLISECOND_ISO.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function queryFields(record: Record<string, unknown>): Omit<OpenOntologyQuery, 'typedQuery'> {
  const { question, intent, at, anchorValue } = record;
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    (intent !== undefined && intent !== 'current' && intent !== 'next') ||
    (at !== undefined && !exactUtcMillisecondIso(at)) ||
    (anchorValue !== undefined && anchorValue !== null && typeof anchorValue !== 'string')
  ) {
    fail('OPENONTOLOGY_QUERY');
  }
  if (
    at !== undefined &&
    (intent === 'next' || (typeof anchorValue === 'string' && anchorValue.trim()))
  ) {
    fail('OPENONTOLOGY_QUERY');
  }
  return {
    question,
    ...(intent === 'current' || intent === 'next' ? { intent } : {}),
    ...(at === undefined ? {} : { at }),
    ...(anchorValue === undefined ? {} : { anchorValue }),
  };
}

function query(input: unknown): OpenOntologyQuery {
  if (typeof input === 'string') {
    if (!input.trim()) fail('OPENONTOLOGY_QUERY');
    return { question: input };
  }
  const record = isRecord(input) ? input : fail('OPENONTOLOGY_QUERY');
  if (
    Object.keys(record).some(
      (name) => !['question', 'intent', 'at', 'anchorValue', 'scope'].includes(name),
    )
  ) {
    fail('OPENONTOLOGY_QUERY');
  }
  const fields = queryFields(record);
  if (record.scope === undefined) return fields;
  const scope = isRecord(record.scope) ? record.scope : fail('OPENONTOLOGY_QUERY');
  const { sourceSystem, objectType, externalId, field: fieldPath } = scope;
  if (
    Object.keys(scope).some(
      (name) => !['sourceSystem', 'objectType', 'externalId', 'field'].includes(name),
    ) ||
    typeof sourceSystem !== 'string' ||
    !sourceSystem ||
    typeof objectType !== 'string' ||
    !objectType ||
    typeof fieldPath !== 'string' ||
    !fieldPath ||
    (externalId !== undefined && (typeof externalId !== 'string' || !externalId))
  ) {
    fail('OPENONTOLOGY_QUERY');
  }
  return {
    ...fields,
    typedQuery: {
      sourceSystem,
      objectType,
      fieldPath,
      ...(typeof externalId === 'string' ? { externalId } : {}),
    },
  };
}

function reference(input: unknown): OpenOntologyReferenceInput {
  if (typeof input === 'string') {
    if (!input) fail('OPENONTOLOGY_REFERENCE');
    return { ref: input };
  }
  const record = isRecord(input) ? input : fail('OPENONTOLOGY_REFERENCE');
  if (Object.keys(record).length !== 1 || typeof record.ref !== 'string' || !record.ref) {
    fail('OPENONTOLOGY_REFERENCE');
  }
  return { ref: record.ref };
}

export function openOntology(options: OpenOntologyOptions): OpenOntologyProduct;
export function openOntology(options: ProductOptions = {}): OpenOntologyProduct {
  const allowedOptions = new Set(['artifactRoot', 'objectBackendUri', 'objectBackendEnv']);
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((name) => !allowedOptions.has(name))
  ) {
    fail('OPENONTOLOGY_OPTIONS');
  }
  if (typeof options?.artifactRoot !== 'string' || !options.artifactRoot) {
    fail('OPENONTOLOGY_OPTIONS');
  }
  const artifactRoot = options.artifactRoot;
  const root = resolve(artifactRoot);
  if (!existsSync(join(root, SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE))) {
    fail('OPENONTOLOGY_ARTIFACT');
  }
  const product = openSourceNativeProduct(options);
  return Object.freeze({
    kind: 'OpenOntologyClientV2' as const,
    verify: (input: unknown) => product.verify(query(input)),
    search: (input: unknown) => product.search(query(input)),
    read: (input: unknown) => product.read(reference(input)),
    status: () => product.status(),
  });
}
