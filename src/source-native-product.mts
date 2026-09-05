/** Public read-only source-native product runtime. */
import { objectBytesSha256, stableObjectSha256 } from './canonical-content.mjs';
import {
  openSourceNativeCurrentFieldResolver,
  openSourceNativeHistoricalFieldResolver,
} from './source-native-field-resolver.mjs';
import { openSourceNativeExactEvidenceSession } from './source-native-evidence-session.mjs';
import { openProductState, productSources } from './source-native-artifact.mjs';
import { compileProductQueryPlan, queryPlanner } from './source-native-query-plan.mjs';
import type { Descriptor, ObjectOnt, ProductOptions } from './source-native-artifact.mjs';
import type { QuerySchema, SourceNativeFieldQuery } from './source-native-query-planner.mjs';
import type { UnknownRecord } from './source-native-object-map.mjs';
import type { SourceNativeObject } from './source-native-object-map.mjs';
import type { ValidatedFieldQueryPlan } from './source-native-resolver-support.mjs';
import type { SeedSearchAdapter } from './source-native-resolver-support.mjs';
import type { SourceNativeFieldResolutionResult, SourceNativeFieldSuccessorResolutionResult } from './source-native-field-resolution.mjs';

const PRODUCT_OPTIONS = new Set(['artifactRoot', 'objectBackendUri', 'objectBackendEnv']);
const MAXIMUM_OFFERED_REFERENCES = 1024;
export interface ProductSearchInput {
  question: string;
  intent?: 'current' | 'next';
  anchorValue?: string | null;
  typedQuery?: SourceNativeFieldQuery | null;
  investigationId?: string | null;
}
export interface SourceNativeProductMatch {
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
interface EvidenceReference extends UnknownRecord {
  sourceMessageId: number;
  relativePath: string;
  sourceSha256: string;
  byteStart: number;
  byteEnd: number;
  textSha256: string;
  fieldSha256: string;
  fieldPath: string;
  propositionFamilyKey: string;
}
interface Resolution extends UnknownRecord {
  state: string;
  selectionMode: string;
  resultSha256: string;
  evidenceUnits: UnknownRecord[];
  searchPath?: UnknownRecord & { searchPathSha256: string; revisionSha256?: string } | null;
  navigationProposals?: UnknownRecord;
}
interface LifecycleAdapter extends UnknownRecord {
  seedSearchAdapter?: SeedSearchAdapter;
  readOnly?: boolean;
  methods?: UnknownRecord;
  beginSearch?: (prepared: UnknownRecord, investigationId: string | null) => unknown;
  recordSearch?: (value: UnknownRecord) => unknown;
  verificationMetadata?: (resolution: Resolution | null) => UnknownRecord;
  resultMetadata?: (activity: unknown) => UnknownRecord;
  bindResult?: (activity: unknown, result: UnknownRecord) => void;
  activityId?: (activity: unknown) => string | null;
  referenceMetadata?: (activity: unknown) => UnknownRecord;
  readEvidence?: (value: UnknownRecord) => Promise<UnknownRecord>;
  verificationResult?: (value: UnknownRecord) => UnknownRecord;
  status?: () => UnknownRecord;
}
interface OfferedEvidence extends UnknownRecord {
  resolution: Resolution;
  role: string;
  reference: EvidenceReference;
  source: UnknownRecord & { content: string; contentSha256: string; occurredAt: string; relativePath: string; sourceMessageId: number };
  activityId: string | null;
}
interface ReadResult extends UnknownRecord {
  exactText: string;
  evidence: UnknownRecord;
  binding: UnknownRecord & { role: string };
}
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function exactEvidenceReferences(unit: UnknownRecord): EvidenceReference[] {
  const values = unit.exactEvidenceReferences;
  if (!Array.isArray(values) || values.length !== unit.exactEvidenceReferenceCount) {
    fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
  }
  const references: unknown[] = Array.isArray(values) ? values : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
  return references.map((value: unknown) => {
    const reference = isRecord(value) ? value : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const { sourceMessageId, relativePath, sourceSha256, byteStart, byteEnd, textSha256,
      fieldSha256, fieldPath, propositionFamilyKey } = reference;
    if (!Number.isSafeInteger(sourceMessageId) || typeof sourceMessageId !== 'number'
      || typeof relativePath !== 'string' || typeof sourceSha256 !== 'string'
      || !Number.isSafeInteger(byteStart) || typeof byteStart !== 'number'
      || !Number.isSafeInteger(byteEnd) || typeof byteEnd !== 'number'
      || typeof textSha256 !== 'string' || typeof fieldSha256 !== 'string'
      || typeof fieldPath !== 'string' || typeof propositionFamilyKey !== 'string') {
      fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    }
    const exactSourceMessageId = typeof sourceMessageId === 'number'
      ? sourceMessageId : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactRelativePath = typeof relativePath === 'string'
      ? relativePath : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactSourceSha256 = typeof sourceSha256 === 'string'
      ? sourceSha256 : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactByteStart = typeof byteStart === 'number'
      ? byteStart : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactByteEnd = typeof byteEnd === 'number'
      ? byteEnd : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactTextSha256 = typeof textSha256 === 'string'
      ? textSha256 : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactFieldSha256 = typeof fieldSha256 === 'string'
      ? fieldSha256 : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactFieldPath = typeof fieldPath === 'string'
      ? fieldPath : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactPropositionFamilyKey = typeof propositionFamilyKey === 'string'
      ? propositionFamilyKey : fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    return {
      ...reference,
      sourceMessageId: exactSourceMessageId,
      relativePath: exactRelativePath,
      sourceSha256: exactSourceSha256,
      byteStart: exactByteStart,
      byteEnd: exactByteEnd,
      textSha256: exactTextSha256,
      fieldSha256: exactFieldSha256,
      fieldPath: exactFieldPath,
      propositionFamilyKey: exactPropositionFamilyKey,
    };
  });
}
const freeze = <T,>(value: T): T => {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export {
  buildSourceNativeProduct,
  SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE,
} from './source-native-artifact.mjs';

function productResult({ descriptor, objectOnt, intent, plan, resolution = null, matches = [],
  verificationFields = {}, resultFields = {} }: {
  descriptor: Descriptor;
  objectOnt: ObjectOnt;
  intent: 'current' | 'next';
  plan: ValidatedFieldQueryPlan & { mentionedExternalIds?: string[]; unresolvedExternalIds?: string[]; query?: SourceNativeFieldQuery | null };
  resolution?: Resolution | null;
  matches?: SourceNativeProductMatch[];
  verificationFields?: UnknownRecord;
  resultFields?: UnknownRecord;
}) {
  const availableFields = matches.length > 0 ? [] : descriptor.querySchemas.flatMap((schema) =>
    schema.fields.map((field) => freeze({
      sourceSystem: schema.sourceSystem,
      objectType: schema.objectType,
      fieldPath: field.fieldPath,
      aliases: field.aliases,
    })));
  const core = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeProductSearchResultV2' as const,
    state: resolution?.state ?? plan.state,
    intent,
    query: plan.query,
    mentionedExternalIds: plan.mentionedExternalIds,
    unresolvedExternalIds: plan.unresolvedExternalIds,
    selectionMode: resolution?.selectionMode ?? null,
    matches: freeze(matches),
    availableFields: freeze(availableFields),
    verification: freeze({
      artifactSha256: descriptor.artifactSha256,
      nativeObjectMapSha256: objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: objectOnt.commitSha256,
      sourceReplaySha256: objectOnt.replaySha256,
      queryPlanSha256: plan.planSha256,
      searchPathSha256: resolution?.searchPath?.searchPathSha256 ?? null,
      resolutionSha256: resolution?.resultSha256 ?? null,
      navigationProposals: resolution?.navigationProposals ?? null,
      ...verificationFields,
    }),
    policy: freeze({
      navigationOnly: true,
      exactReadRequired: true,
      exactSourcesRemainAuthority: true,
      canonicalTruthMutation: false,
    }),
    ...resultFields,
  };
  return freeze({ ...core, resultSha256: stableObjectSha256(core) });
}

export function openSourceNativeProductRuntime(options: ProductOptions = {}, createLifecycleAdapter: ((value: UnknownRecord) => LifecycleAdapter | null) | null = null) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((name) => !PRODUCT_OPTIONS.has(name))) {
    fail('SOURCE_NATIVE_PRODUCT_OPTIONS');
  }
  const {
    artifactRoot,
    objectBackendUri = null,
    objectBackendEnv = process.env,
  } = options;
  if (createLifecycleAdapter !== null && typeof createLifecycleAdapter !== 'function') {
    fail('SOURCE_NATIVE_PRODUCT_LIFECYCLE_ADAPTER');
  }
  const { descriptor, selectedBackend, backend, store, objectOnt } = openProductState({
    artifactRoot, objectBackendUri, objectBackendEnv,
  });
  const sources = productSources(objectOnt);
  const sourceById = new Map(sources.map((source) => [source.sourceMessageId, source]));
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  const retrievalAdapterSha256 = stableObjectSha256({ adapter: 'source-native-product-bm25-v1' });
  const session = openSourceNativeExactEvidenceSession({
    namespace: descriptor.namespace,
    nativeObjectMapSha256: objectOnt.map.nativeObjectMapSha256,
    objectOnt,
    sources,
    tokenize: (value) => String(value).normalize('NFKC').toLocaleLowerCase('en-US')
      .split(/[^\p{L}\p{N}]+/gu).filter(Boolean),
    retrievalAdapter: 'source-native-product-bm25-v1',
    retrievalAdapterSha256,
    maximumSearchResults: 4,
  });
  const offered = new Map<string, OfferedEvidence>();

  const rememberOffer = (evidenceRef: string, offer: OfferedEvidence) => {
    if (!offered.has(evidenceRef) && offered.size >= MAXIMUM_OFFERED_REFERENCES) {
      const oldest = offered.keys().next().value;
      if (oldest !== undefined) offered.delete(oldest);
    }
    offered.set(evidenceRef, offer);
  };

  const prepareSearch = ({ question, intent = 'current', anchorValue = null,
    typedQuery = null }: ProductSearchInput) => {
    if (typeof question !== 'string' || !question.trim()
      || !['current', 'next'].includes(intent)
      || anchorValue !== null && typeof anchorValue !== 'string') {
      fail('SOURCE_NATIVE_PRODUCT_SEARCH');
    }
    const exactAnchorValue = typeof anchorValue === 'string' && anchorValue.trim()
      ? anchorValue.trim() : null;
    const plan = compileProductQueryPlan({
      question,
      namespace: descriptor.namespace,
      querySchemas: descriptor.querySchemas,
      map: objectOnt.map,
      intent,
      anchorValue: exactAnchorValue,
      typedQuery,
    });
    return { question, intent, anchorValue: exactAnchorValue, typedQuery, plan };
  };

  const forgetOffers = (activityId: string | null) => {
    for (const [evidenceRef, offer] of offered) {
      if (offer.activityId === activityId) offered.delete(evidenceRef);
    }
  };
  const lifecycle = createLifecycleAdapter?.({
    descriptor,
    selectedBackend,
    backend,
    store,
    objectOnt,
    sources,
    session,
    prepareSearch,
    forgetOffers,
  }) ?? null;
  const seedSearchAdapter = lifecycle?.seedSearchAdapter
    ?? session.sourceNativeSeedSearchAdapter;

  const search = async (input: ProductSearchInput = { question: '' }) => {
    const { investigationId = null, ...searchInput } = input;
    const prepared = prepareSearch(searchInput);
    const { question, intent, plan } = prepared;
    if (lifecycle === null && investigationId !== null) fail('SOURCE_NATIVE_PRODUCT_SEARCH');
    const startReceipt = lifecycle?.beginSearch?.(prepared, investigationId) ?? null;
    if (plan.state !== 'resolved-native-field-query'
      || intent === 'next' && (plan.query === null || plan.query.externalId === undefined)) {
      const activity = lifecycle?.recordSearch?.({
        question, intent, plan, startReceipt,
      }) ?? null;
      const result = productResult({
        descriptor,
        objectOnt,
        intent,
        plan,
        verificationFields: lifecycle?.verificationMetadata?.(null) ?? {},
        resultFields: lifecycle?.resultMetadata?.(activity) ?? {},
      });
      lifecycle?.bindResult?.(activity, result);
      return result;
    }
    const resolvedPlanQuery = plan.query ?? fail('SOURCE_NATIVE_PRODUCT_SEARCH');
    const common = {
      sourceNativeObjectMap: objectOnt.map,
      sourceHandles: session.sourceHandles,
      namespace: descriptor.namespace,
      sourceCommitSha256: session.sourceCommitSha256,
      sourceReplaySha256: session.sourceReplaySha256,
      sourceSearchRouteMapSha256: session.sourceSearchRouteMapSha256,
      seedSearchAdapter: resolvedPlanQuery.externalId === undefined
        ? session.sourceNativeSeedSearchAdapter : seedSearchAdapter,
      maximumSeedSourceMessages: 4,
      queryPlanner: queryPlanner({ namespace: descriptor.namespace, plan }),
    };
    const resolver = intent === 'current'
      ? openSourceNativeCurrentFieldResolver({
        ...common,
        sourceCatalogSha256: session.sourceCatalogSha256,
      })
      : openSourceNativeHistoricalFieldResolver({
        ...common,
        exactSourceAvailabilitySnapshot: session.exactSourceAvailabilitySnapshot,
    });
    const resolution: Resolution = await resolver.search({ question, maximumSourceMessages: 4 });
    const activity = lifecycle?.recordSearch?.({
      question, intent, plan, startReceipt, resolution,
    }) ?? null;
    const references = resolution.evidenceUnits.flatMap((unit) =>
      exactEvidenceReferences(unit).map((reference) => ({ role: 'answer', reference })));
    if (intent === 'next' && resolution.state === 'resolved-next-field-revision') {
      const revision = objectOnt.map.fieldRevisions.find((row) =>
        row.revisionSha256 === resolution.searchPath?.revisionSha256);
      const source = revision === undefined ? null
        : sourceByPath.get(revision.targetField.evidence.relativePath) ?? null;
      if (!revision || !source) fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
      const exactRevision = revision ?? fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
      const exactSource = source ?? fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
      references.push({
        role: 'anchor',
        reference: {
          sourceMessageId: exactSource.sourceMessageId,
          relativePath: exactSource.relativePath,
          sourceSha256: exactRevision.targetField.evidence.sourceSha256,
          byteStart: exactRevision.targetField.evidence.byteStart,
          byteEnd: exactRevision.targetField.evidence.byteEnd,
          textSha256: exactRevision.targetField.evidence.textSha256,
          fieldSha256: exactRevision.targetField.fieldSha256,
          fieldPath: exactRevision.fieldPath,
          propositionFamilyKey: exactRevision.targetField.propositionFamilyKey ?? exactRevision.fieldPath,
        },
      });
    }
    const matches = references.map(({ role, reference }) => {
      const source = sourceById.get(reference.sourceMessageId);
      if (!source || source.relativePath !== reference.relativePath) {
        fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
      }
      const exactSource = source ?? fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
      const activityFields = lifecycle?.referenceMetadata?.(activity) ?? {};
      const evidenceRef = `evidence:${stableObjectSha256({
        sourceCommitSha256: objectOnt.commitSha256,
        resultSha256: resolution.resultSha256,
        sourceMessageId: reference.sourceMessageId,
        fieldSha256: reference.fieldSha256,
        role,
        ...activityFields,
      }).slice(7)}`;
      rememberOffer(evidenceRef, freeze({
        resolution,
        role,
        reference,
        source: exactSource,
        activityId: lifecycle?.activityId?.(activity) ?? null,
      }));
      return freeze({
        ref: evidenceRef,
        role,
        requiredForProof: true as const,
        relativePath: reference.relativePath,
        occurredAt: exactSource.occurredAt,
        fieldPath: reference.fieldPath,
        propositionFamilyKey: reference.propositionFamilyKey,
        sourceSha256: reference.sourceSha256,
        fieldSha256: reference.fieldSha256,
      });
    });
    const result = productResult({
      descriptor,
      objectOnt,
      intent,
      plan,
      resolution,
      matches,
      verificationFields: lifecycle?.verificationMetadata?.(resolution) ?? {},
      resultFields: lifecycle?.resultMetadata?.(activity) ?? {},
    });
    lifecycle?.bindResult?.(activity, result);
    return result;
  };

  const read = async ({ ref: evidenceRef }: { ref: string }) => {
    const offeredEvidence = offered.get(evidenceRef) ?? fail('SOURCE_NATIVE_PRODUCT_READ');
    const { resolution, role, reference, source } = offeredEvidence;
    const bytes = Buffer.from(source.content);
    if (objectBytesSha256(bytes) !== source.contentSha256
      || reference.byteEnd > bytes.length || reference.byteStart < 0
      || reference.byteEnd <= reference.byteStart) fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactBytes = bytes.subarray(reference.byteStart, reference.byteEnd);
    if (objectBytesSha256(exactBytes) !== reference.textSha256) {
      fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    }
    const object = objectOnt.map.nativeObjects.find((row) =>
      row.relativePath === reference.relativePath
      && row.fields.some((field) => field.fieldSha256 === reference.fieldSha256));
    if (!object) fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactObject = object ?? fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const resultFields = await lifecycle?.readEvidence?.({
      offeredEvidence,
      exactBytes,
      object,
    }) ?? {};
    const bindingCore = {
      schemaVersion: 1,
      kind: 'OpenOntologyVerifiedSourceNativeFieldBindingV1' as const,
      role,
      selectionMode: resolution.selectionMode,
      sourceSystem: exactObject.objectIdentity.sourceSystem,
      objectType: exactObject.objectIdentity.objectType,
      namespace: exactObject.objectIdentity.namespace,
      externalId: exactObject.objectIdentity.externalId,
      fieldPath: reference.fieldPath,
      fieldSha256: reference.fieldSha256,
      sourceSha256: reference.sourceSha256,
      resultSha256: resolution.resultSha256,
      searchPathSha256: resolution.searchPath?.searchPathSha256 ?? null,
      exactSourcesRemainAuthority: true,
    };
    const binding = freeze({ ...bindingCore, bindingSha256: stableObjectSha256(bindingCore) });
    const core = {
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeProductReadResultV1' as const,
      ref: evidenceRef,
      exactText: exactBytes.toString('utf8'),
      evidence: freeze({
        relativePath: reference.relativePath,
        occurredAt: source.occurredAt,
        sourceSha256: reference.sourceSha256,
        byteStart: reference.byteStart,
        byteEnd: reference.byteEnd,
        textSha256: reference.textSha256,
      }),
      binding,
      sourceCommitSha256: objectOnt.commitSha256,
      sourceReplaySha256: objectOnt.replaySha256,
      immutable: true,
      exactSourcesRemainAuthority: true,
      canonicalTruthMutation: false,
      ...resultFields,
    };
    return freeze({ ...core, receiptSha256: stableObjectSha256(core) });
  };

  const verify = async (input: ProductSearchInput = { question: '' }) => {
    const searchResult = await search(input);
    const reads: ReadResult[] = [];
    for (const match of searchResult.matches) {
      if (match.requiredForProof) {
        const ref = typeof match.ref === 'string' ? match.ref : fail('SOURCE_NATIVE_PRODUCT_READ');
        reads.push(await read({ ref }));
      }
    }
    const context = reads.map((row: ReadResult) => freeze({
      role: row.binding.role,
      exactText: row.exactText,
      evidence: row.evidence,
      binding: row.binding,
    }));
    const completeProof = searchResult.matches.length > 0
      && searchResult.matches.filter((match) => match.requiredForProof).length === context.length;
    const core = {
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeVerificationV1' as const,
      state: searchResult.state,
      answerable: completeProof,
      intent: searchResult.intent,
      query: searchResult.query,
      context: freeze(context),
      availableFields: searchResult.availableFields,
      verification: searchResult.verification,
      policy: searchResult.policy,
      ...(lifecycle?.verificationResult?.({ searchResult, reads, completeProof }) ?? {}),
    };
    return freeze({ ...core, verificationSha256: stableObjectSha256(core) });
  };

  return freeze({
    kind: 'OpenOntologySourceNativeProductV2' as const,
    verify,
    search,
    read,
    ...(lifecycle?.methods ?? {}),
    status: () => freeze({
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeProductStatusV1' as const,
      ontId: descriptor.ontId,
      branch: descriptor.branch,
      namespace: descriptor.namespace,
      sourceCount: objectOnt.catalog.sourceCount,
      nativeObjectCount: objectOnt.map.nativeObjectCount,
      fieldRevisionCount: objectOnt.map.fieldRevisionCount,
      artifactSha256: descriptor.artifactSha256,
      nativeObjectMapSha256: objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: objectOnt.commitSha256,
      sourceReplaySha256: objectOnt.replaySha256,
      sourceSearchRouteMapSha256: session.sourceSearchRouteMapSha256,
      objectBackend: descriptor.objectBackend,
      objectBackendCapabilities: selectedBackend.capabilities,
      canonicalTruthMutation: false,
      canonicalSourceReadOnly: true,
      readOnly: lifecycle?.readOnly ?? true,
      ...(lifecycle?.status?.() ?? {}),
    }),
  });
}

export function openSourceNativeProduct(options = {}) {
  return openSourceNativeProductRuntime(options);
}

export type SourceNativeProduct = ReturnType<typeof openSourceNativeProductRuntime>;
export type SourceNativeProductSearchResult = Awaited<ReturnType<SourceNativeProduct['search']>>;
export type SourceNativeProductReadResult = Awaited<ReturnType<SourceNativeProduct['read']>>;
export type SourceNativeProductVerificationResult = Awaited<ReturnType<SourceNativeProduct['verify']>>;
export type SourceNativeProductStatus = ReturnType<SourceNativeProduct['status']>;
