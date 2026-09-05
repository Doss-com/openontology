/** Public SDK entrypoint over proof-closing OpenOntology products. */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  openSourceNativeProduct,
  SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE,
} from './source-native-product.mjs';
import type { ProductOptions } from './source-native-artifact.mjs';
import type { OpenOntologyResultState as ResultState } from './product-result-state.mjs';

export interface OpenOntologyScopeInput {
  sourceSystem: string;
  objectType: string;
  externalId?: string;
  field: string;
}
export interface OpenOntologyQueryInput {
  question: string;
  intent?: 'current' | 'next';
  anchorValue?: string | null;
  scope?: OpenOntologyScopeInput;
}

interface OpenOntologyQuery {
  question: string;
  intent?: 'current' | 'next';
  anchorValue?: string | null;
  typedQuery?: {
    sourceSystem: string;
    objectType: string;
    fieldPath: string;
    externalId?: string;
  } | null;
}
export interface OpenOntologyReferenceInput { ref: string }
export interface OpenOntologyOptions {
  artifactRoot: string;
  objectBackendUri?: string | null;
  objectBackendEnv?: Record<string, string | undefined>;
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
export interface OpenOntologyVerificationMetadata {
  artifactSha256: string;
  nativeObjectMapSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  queryPlanSha256: string;
  searchPathSha256: string | null;
  resolutionSha256: string | null;
  navigationProposals: Record<string, unknown> | null;
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
  intent: 'current' | 'next';
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
  intent: 'current' | 'next';
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
  verify: (input: string | OpenOntologyQueryInput) => Promise<OpenOntologyVerificationResult>;
  search: (input: string | OpenOntologyQueryInput) => Promise<OpenOntologySearchResult>;
  read: (input: string | OpenOntologyReferenceInput) => Promise<OpenOntologyReadResult>;
  status: () => OpenOntologyStatus;
}

const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function queryFields(record: Record<string, unknown>): Omit<OpenOntologyQuery, 'typedQuery'> {
  const { question: inputQuestion, intent: inputIntent, anchorValue } = record;
  if (typeof inputQuestion !== 'string' || !inputQuestion.trim()
    || inputIntent !== undefined && inputIntent !== 'current' && inputIntent !== 'next'
    || anchorValue !== undefined && anchorValue !== null && typeof anchorValue !== 'string') {
    fail('OPENONTOLOGY_QUERY');
  }
  const question = typeof inputQuestion === 'string' ? inputQuestion : fail('OPENONTOLOGY_QUERY');
  const exactAnchorValue = anchorValue === undefined || anchorValue === null
    ? anchorValue
    : typeof anchorValue === 'string' ? anchorValue : fail('OPENONTOLOGY_QUERY');
  return {
    question,
    ...(inputIntent === 'current' || inputIntent === 'next' ? { intent: inputIntent } : {}),
    ...(exactAnchorValue === undefined ? {} : { anchorValue: exactAnchorValue }),
  };
}

function query(input: unknown): OpenOntologyQuery {
  if (typeof input === 'string') {
    if (!input.trim()) fail('OPENONTOLOGY_QUERY');
    return { question: input };
  }
  const record = isRecord(input) ? input : fail('OPENONTOLOGY_QUERY');
  if (Object.keys(record).some((name) =>
    !['question', 'intent', 'anchorValue', 'scope'].includes(name))) {
    fail('OPENONTOLOGY_QUERY');
  }
  const fields = queryFields(record);
  if (record.scope === undefined) return fields;
  const scope = isRecord(record.scope) ? record.scope : fail('OPENONTOLOGY_QUERY');
  if (Object.keys(scope).some((name) =>
      !['sourceSystem', 'objectType', 'externalId', 'field'].includes(name))
    || typeof scope.sourceSystem !== 'string' || !scope.sourceSystem
    || typeof scope.objectType !== 'string' || !scope.objectType
    || typeof scope.field !== 'string' || !scope.field
    || scope.externalId !== undefined
      && (typeof scope.externalId !== 'string' || !scope.externalId)) {
    fail('OPENONTOLOGY_QUERY');
  }
  const sourceSystem = typeof scope.sourceSystem === 'string'
    ? scope.sourceSystem : fail('OPENONTOLOGY_QUERY');
  const objectType = typeof scope.objectType === 'string'
    ? scope.objectType : fail('OPENONTOLOGY_QUERY');
  const fieldPath = typeof scope.field === 'string'
    ? scope.field : fail('OPENONTOLOGY_QUERY');
  const externalId = scope.externalId;
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
  const ref = typeof record.ref === 'string' ? record.ref : fail('OPENONTOLOGY_REFERENCE');
  return { ref };
}

export function openOntology(options: OpenOntologyOptions): OpenOntologyProduct;
export function openOntology(options: ProductOptions = {}): OpenOntologyProduct {
  const allowedOptions = new Set(['artifactRoot', 'objectBackendUri', 'objectBackendEnv']);
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((name) => !allowedOptions.has(name))) {
    fail('OPENONTOLOGY_OPTIONS');
  }
  if (typeof options?.artifactRoot !== 'string' || !options.artifactRoot) {
    fail('OPENONTOLOGY_OPTIONS');
  }
  const artifactRoot = typeof options.artifactRoot === 'string' && options.artifactRoot
    ? options.artifactRoot : fail('OPENONTOLOGY_OPTIONS');
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
