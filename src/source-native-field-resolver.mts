/** Resolver orchestration over source-native field selection and Exact Evidence. */
import { stableObjectSha256 } from './canonical-content.mjs';
import {
  compileSourceNativeCurrentFieldChronologyVerification,
} from './source-native-current-field-verification.mjs';
import type {
  SourceNativeCurrentFieldChronologyVerification,
} from './source-native-current-field-verification.mjs';
import { validateSourceNativeExactSourceAvailabilitySnapshot } from './source-native-evidence-session.mjs';
import type { ExactSourceAvailabilitySnapshot } from './source-native-evidence-session.mjs';
import {
  resolveSourceNativeField,
  resolveSourceNativeFieldSuccessor,
} from './source-native-field-resolution.mjs';
import type {
  SourceNativeFieldResolutionResult,
  SourceNativeFieldSuccessorResolutionResult,
} from './source-native-field-resolution.mjs';
import type { SourceNativeObjectMap, UnknownRecord } from './source-native-object-map.mjs';
import type { SourceHandle } from './source-native-evidence-session.mjs';
import type {
  FieldQueryPlanner,
  SeedSearchAdapter,
  ValidatedFieldQueryPlan,
} from './source-native-resolver-support.mjs';
import type { SourceNativeObjectIdentityCensus } from './source-native-identity-census.mjs';
import type { SourceNativeFieldQuery } from './source-native-query-planner.mjs';
import {
  validateSourceNativeObjectIdentityCensus as validateObjectIdentityCensus,
} from './source-native-identity-census.mjs';
import {
  learnedRouteMatchesIdentity,
  navigationProposalSummary,
  prepareFieldResolverContext,
  queryBindingSha256,
  runSeedSearch,
  validateFieldQueryPlan,
} from './source-native-resolver-support.mjs';

export {
  compileSourceNativeObjectIdentityCensus,
} from './source-native-identity-census.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const fail = (code: string): never => { const error = new TypeError(code) as TypeError & { code: string }; error.code = code; throw error; };
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export interface SourceNativeObjectIdentityAbsenceReceipt {
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

function compileObjectIdentityAbsenceReceipt({
  map,
  census,
  query,
  namespace,
  sourceCatalogSha256,
  sourceHandleSetSha256,
}: {
  map: SourceNativeObjectMap;
  census: SourceNativeObjectIdentityCensus | null;
  query: SourceNativeFieldQuery;
  namespace: string;
  sourceCatalogSha256: string | null;
  sourceHandleSetSha256: string;
}): SourceNativeObjectIdentityAbsenceReceipt | null {
  if (query.externalId === undefined || census === null) return null;
  const matches = (row: { sourceSystem: string; objectType: string; externalId: string }) =>
    row.sourceSystem === query.sourceSystem
    && row.objectType === query.objectType
    && row.externalId === query.externalId;
  const censusContainsIdentity = census.objectIdentities.some(matches);
  const mapContainsIdentity = map.nativeObjects.some((row) =>
    row.objectIdentity.namespace === namespace && matches(row.objectIdentity));
  if (censusContainsIdentity || mapContainsIdentity) return null;
  const catalogSha256 = sourceCatalogSha256
    ?? fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS_BINDING');
  const core: Omit<SourceNativeObjectIdentityAbsenceReceipt, 'receiptSha256'> = {
    schema: 1,
    kind: 'OpenOntologySourceNativeObjectIdentityAbsenceReceiptV1',
    namespace,
    objectIdentity: freeze({
      sourceSystem: query.sourceSystem,
      objectType: query.objectType,
      externalId: query.externalId,
    }),
    censusSha256: census.censusSha256,
    sourceCatalogSha256: catalogSha256,
    sourceHandleSetSha256,
    sourceCount: census.sourceCount,
    exactOccurrenceCount: 0,
    authority: 'complete-strict-object-identity-census-over-bound-source-catalog',
    worldAbsenceAuthorized: false,
    modelCalls: 0,
    networkCalls: 0,
    targetLeakage: false,
  };
  return freeze({ ...core, receiptSha256: stableObjectSha256(core) });
}

/**
 * Open one source-native Resolver Module bound to the exact source handles of a
 * committed Ont session. The query planner remains a source-format Adapter;
 * native identity traversal and duplicate-Evidence compaction stay here.
 */
export function openSourceNativeCurrentFieldResolver({
  sourceNativeObjectMap: mapInput,
  sourceHandles: sourceHandleInput,
  namespace,
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  sourceCatalogSha256 = null,
  objectIdentityCensus: objectIdentityCensusInput = null,
  seedSearchAdapter: seedSearchAdapterInput,
  maximumSeedSourceMessages = 4,
  queryPlanner: queryPlannerInput,
}: {
  sourceNativeObjectMap?: SourceNativeObjectMap;
  sourceHandles?: SourceHandle[];
  namespace?: string;
  sourceCommitSha256?: string;
  sourceReplaySha256?: string;
  sourceSearchRouteMapSha256?: string;
  sourceCatalogSha256?: string | null;
  objectIdentityCensus?: SourceNativeObjectIdentityCensus | null;
  seedSearchAdapter?: SeedSearchAdapter;
  maximumSeedSourceMessages?: number;
  queryPlanner?: FieldQueryPlanner;
} = {}) {
  const boundNamespace = namespace ?? fail('SOURCE_NATIVE_CURRENT_FIELD_RESOLVER_INPUT');
  const boundCommitSha256 = sourceCommitSha256 ?? fail('SOURCE_NATIVE_CURRENT_FIELD_RESOLVER_INPUT');
  const boundReplaySha256 = sourceReplaySha256 ?? fail('SOURCE_NATIVE_CURRENT_FIELD_RESOLVER_INPUT');
  const boundRouteMapSha256 = sourceSearchRouteMapSha256
    ?? fail('SOURCE_NATIVE_CURRENT_FIELD_RESOLVER_INPUT');
  const {
    map,
    queryPlanner,
    sourceHandles,
    handleById,
    handleByPath,
    namespacePaths,
    mappedSourceCoverageComplete,
    sourceHandleSetSha256,
    seedSearchAdapter,
    seedPolicyBinding,
  } = prepareFieldResolverContext({
    mapInput,
    sourceHandleInput,
    namespace: boundNamespace,
    sourceCommitSha256: boundCommitSha256,
    sourceReplaySha256: boundReplaySha256,
    sourceSearchRouteMapSha256: boundRouteMapSha256,
    seedSearchAdapterInput,
    maximumSeedSourceMessages,
    queryPlannerInput,
    invalidInputCode: 'SOURCE_NATIVE_CURRENT_FIELD_RESOLVER_INPUT',
  });
  const objectIdentityCensus = objectIdentityCensusInput === null ? null
    : validateObjectIdentityCensus(objectIdentityCensusInput);
  if (objectIdentityCensus !== null
    && (!SHA256.test(sourceCatalogSha256 ?? '')
      || objectIdentityCensus.namespace !== boundNamespace
      || objectIdentityCensus.sourceCatalogSha256 !== sourceCatalogSha256
      || objectIdentityCensus.sourceHandleSetSha256 !== sourceHandleSetSha256
      || objectIdentityCensus.sourceCount !== sourceHandles.length
      || map.mappedSourceCount !== map.sourceCount
      || map.unsupportedSourceCount !== 0
      || map.parseFailureCount !== 0)) {
    fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS_BINDING');
  }
  const search = async ({ question, maximumSourceMessages = 64 }: {
    question?: unknown;
    maximumSourceMessages?: number;
  } = {}) => {
    if (typeof question !== 'string' || !question.trim()
      || !Number.isSafeInteger(maximumSourceMessages) || maximumSourceMessages < 1
      || maximumSourceMessages > 1024) fail('SOURCE_NATIVE_OBJECT_RESOLVER_SEARCH');
    const askedQuestion = typeof question === 'string' ? question
      : fail('SOURCE_NATIVE_OBJECT_RESOLVER_SEARCH');
    const queryPlan = validateFieldQueryPlan(await queryPlanner.plan({ question: askedQuestion }), {
      planner: queryPlanner, namespace: boundNamespace, question: askedQuestion,
    });
    let resolution: SourceNativeFieldResolutionResult | null = null;
    let evidenceUnits: UnknownRecord[] = [];
    let selectedSourceMessageIds: number[] = [];
    let allReferenceSourceMessageIds: number[] = [];
    let seedSourceMessageIds: number[] = [];
    let policyPreferredSeedSourceMessageIds: number[] = [];
    let seedSearchReceiptSha256 = null;
    let seedSearchNetworkCalls = 0;
    let rawSeedSearchExecuted = false;
    let state = queryPlan.state;
    let currentFieldChronology: SourceNativeCurrentFieldChronologyVerification | null = null;
    let absenceAuthorized = false;
    let absenceReceipt: SourceNativeObjectIdentityAbsenceReceipt | null = null;
    let selectionLabel = 'unresolved source-native current field';
    if (queryPlan.state === 'resolved-native-field-query' && queryPlan.query !== null) {
      const resolvedQuery = queryPlan.query;
      selectionLabel = [resolvedQuery.sourceSystem, resolvedQuery.objectType,
        resolvedQuery.externalId, resolvedQuery.fieldPath]
        .filter((value) => value !== undefined).join(' ');
      absenceReceipt = compileObjectIdentityAbsenceReceipt({
        map,
        census: objectIdentityCensus,
        query: resolvedQuery,
        namespace: boundNamespace,
        sourceCatalogSha256,
        sourceHandleSetSha256,
      });
      if (absenceReceipt !== null) {
        state = 'verified-native-object-absent-from-bound-source-catalog';
        absenceAuthorized = true;
      } else {
        const bindingSha256 = queryBindingSha256('current', resolvedQuery);
        const seedSearch = await runSeedSearch({
          adapter: seedSearchAdapter,
          question: askedQuestion,
          limit: Math.min(maximumSeedSourceMessages, maximumSourceMessages),
          maximumSeedSourceMessages,
          sourceCommitSha256: boundCommitSha256,
          sourceReplaySha256: boundReplaySha256,
          sourceSearchRouteMapSha256: boundRouteMapSha256,
          sourceHandleSetSha256,
          handleById,
          queryBindingSha256: bindingSha256,
        });
        seedSourceMessageIds = seedSearch.rows.map((row) => row.sourceMessageId);
        policyPreferredSeedSourceMessageIds = seedSearch.policyPreferredRows
          .map((row) => row.sourceMessageId);
        seedSearchReceiptSha256 = seedSearch.receiptSha256;
        seedSearchNetworkCalls = seedSearch.networkCalls;
        rawSeedSearchExecuted = seedSearch.rawSearchExecuted;
        resolution = resolveSourceNativeField({
          sourceNativeObjectMap: map,
          seedRelativePaths: seedSearch.traversalRows.map((row) => row.relativePath),
          query: resolvedQuery,
        });
        state = resolution.state;
        if (resolution.state === 'resolved-current-field' && resolution.current !== null
          && resolution.current !== undefined) {
          currentFieldChronology = compileSourceNativeCurrentFieldChronologyVerification({
            sourceNativeObjectMap: map,
            resolution,
            sourceCommitSha256: boundCommitSha256,
            sourceReplaySha256: boundReplaySha256,
            sourceCatalogSha256,
            sourceHandles,
          });
          if (currentFieldChronology.proofDisposition === 'insufficient') {
            state = 'unavailable-incomplete-recorded-field-chronology';
          } else {
            const currentHandle = handleByPath.get(resolution.current.relativePath)
              ?? fail('SOURCE_NATIVE_OBJECT_RESOLVER_SOURCE_COVERAGE');
            const suppressedSourceMessageIds = resolution.suppressedRelativePaths.map((relativePath: string) => {
              const handle = handleByPath.get(relativePath);
              return (handle ?? fail('SOURCE_NATIVE_OBJECT_RESOLVER_SOURCE_COVERAGE')).sourceMessageId;
            }).sort((left: number, right: number) => left - right);
            const unitCore = {
              schema: 1,
              kind: 'OpenOntologySourceNativeCurrentFieldEvidenceUnitV1',
              selectionLabel,
              representativeSourceMessageId: currentHandle.sourceMessageId,
              referenceSourceMessageIds: freeze([currentHandle.sourceMessageId]),
              evidenceReferenceCount: 1,
              exactEvidenceReferences: freeze([freeze({
                sourceMessageId: currentHandle.sourceMessageId,
                relativePath: resolution.current.relativePath,
                sourceSha256: resolution.current.evidence.sourceSha256,
                byteStart: resolution.current.evidence.byteStart,
                byteEnd: resolution.current.evidence.byteEnd,
                textSha256: resolution.current.evidence.textSha256,
                fieldSha256: resolution.current.fieldSha256,
                fieldPath: resolution.query.fieldPath,
                propositionFamilyKey: resolution.query.fieldPath,
                businessEntityKeys: freeze([]),
              })]),
              exactEvidenceReferenceCount: 1,
              suppressedSourceMessageIds: freeze(suppressedSourceMessageIds),
              revisionClosureCount: resolution.revisionClosureCount,
              revisionClosureSha256: resolution.revisionClosureSha256,
              currentFieldChronologyVerificationSha256: currentFieldChronology.verificationSha256,
              currentFieldSha256: resolution.current.fieldSha256,
              navigationOnly: true,
              exactInspectRequired: true,
              exactSourcesRemainAuthority: true,
            };
            evidenceUnits = [freeze({ ...unitCore, evidenceUnitSha256: stableObjectSha256(unitCore) })];
            selectedSourceMessageIds = [currentHandle.sourceMessageId];
            allReferenceSourceMessageIds = [currentHandle.sourceMessageId];
          }
        }
      }
    }
    const current = resolution?.current;
    const selectedIdentitySha256 = current === undefined || current === null ? null
      : map.nativeObjects.find((row) => row.relativePath === current.relativePath)
        ?.objectIdentitySha256 ?? null;
    const core = {
      schema: 1,
      kind: 'OpenOntologySourceNativeObjectResolverResultV1',
      state,
      selectionMode: 'current-field-revision',
      selectionLabel,
      nativeObjectMapSha256: map.nativeObjectMapSha256,
      sourceCommitSha256: boundCommitSha256,
      sourceReplaySha256: boundReplaySha256,
      sourceSearchRouteMapSha256: boundRouteMapSha256,
      sourceHandleSetSha256,
      queryPlannerAdapter: queryPlanner.adapter,
      queryPlannerSha256: queryPlanner.plannerSha256,
      queryPlan,
      queryBindingSha256: queryBindingSha256('current', queryPlan.query),
      resolutionSha256: resolution?.resolutionSha256 ?? null,
      fieldResolutionPolicy: resolution?.policy ?? null,
      businessEntityKey: null,
      businessEntityCensusSha256: null,
      objectIdentityCensusSha256: objectIdentityCensus?.censusSha256 ?? null,
      currentFieldChronology,
      absenceReceipt,
      searchPath: null,
      evidenceUnits: freeze(evidenceUnits),
      selectedSourceMessageIds: freeze(selectedSourceMessageIds),
      allReferenceSourceMessageIds: freeze(allReferenceSourceMessageIds),
      seedSourceMessageIds: freeze(seedSourceMessageIds),
      seedSearchReceiptSha256,
      ...seedPolicyBinding,
      policyPreferredSeedSourceMessageIds: freeze(policyPreferredSeedSourceMessageIds),
      navigationProposals: navigationProposalSummary({
        seedSearchReceiptSha256,
        seedSourceMessageIds,
        policyPreferredSeedSourceMessageIds,
        searchPolicyArtifactSha256: seedPolicyBinding.searchPolicyArtifactSha256,
        rawSeedSearchExecuted,
        seedSearchNetworkCalls,
        learnedRouteUsed: learnedRouteMatchesIdentity({
          map,
          handleById,
          policyPreferredSeedSourceMessageIds,
          objectIdentitySha256: selectedIdentitySha256,
        }),
      }),
      searchPathAnchorSourceMessageIds: freeze([]),
      identityRejectedSeedSourceMessageIds: freeze([]),
      searchPathExpandedSourceMessageIds: freeze([]),
      exactEvidenceReferenceCount: evidenceUnits.reduce((sum, unit) =>
        sum + Number(unit.exactEvidenceReferenceCount), 0),
      uniqueEvidenceUnitCount: evidenceUnits.length,
      redundantEvidenceReferenceCount: 0,
      maximumSourceMessages,
      mappedNamespaceSourceCoverageComplete: mappedSourceCoverageComplete,
      absenceAuthorized,
      absencePolicy: absenceAuthorized
        ? 'complete-strict-object-identity-census-over-bound-source-catalog-only'
        : 'native-map-does-not-certify-unmapped-source-types-or-world-absence',
      candidateQuestionReads: 1,
      candidateGoldReads: 0,
      modelCalls: 0,
      networkCalls: seedSearchNetworkCalls,
      targetLeakage: false,
      navigationOnly: true,
      exactInspectRequired: true,
      exactSourcesRemainAuthority: true,
    };
    return freeze({ ...core, resultSha256: stableObjectSha256(core) });
  };

  return freeze({
    kind: 'OpenOntologySourceNativeObjectResolverModuleV1',
    implementation: 'OpenOntologySourceNativeCurrentFieldResolverV1',
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    namespace: boundNamespace,
    sourceCommitSha256: boundCommitSha256,
    sourceReplaySha256: boundReplaySha256,
    sourceSearchRouteMapSha256: boundRouteMapSha256,
    sourceHandleSetSha256,
    sourceCatalogSha256,
    businessEntityCensusSha256: null,
    objectIdentityCensusSha256: objectIdentityCensus?.censusSha256 ?? null,
    queryPlannerAdapter: queryPlanner.adapter,
    queryPlannerSha256: queryPlanner.plannerSha256,
    ...seedPolicyBinding,
    mappedNamespaceSourceCount: namespacePaths.length,
    maximumSeedSourceMessages,
    modelCalls: 0,
    networkCalls: 0,
    search,
  });
}
/**
 * Open an immediate historical field-successor Adapter. The map keeps the
 * direct supersedes edge fixed while the availability snapshot controls which
 * exact source objects may be inspected.
 */
export function openSourceNativeHistoricalFieldResolver({
  sourceNativeObjectMap: mapInput,
  sourceHandles: sourceHandleInput,
  namespace,
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  exactSourceAvailabilitySnapshot: availabilityInput,
  seedSearchAdapter: seedSearchAdapterInput,
  maximumSeedSourceMessages = 4,
  queryPlanner: queryPlannerInput,
}: {
  sourceNativeObjectMap?: SourceNativeObjectMap;
  sourceHandles?: SourceHandle[];
  namespace?: string;
  sourceCommitSha256?: string;
  sourceReplaySha256?: string;
  sourceSearchRouteMapSha256?: string;
  exactSourceAvailabilitySnapshot?: ExactSourceAvailabilitySnapshot;
  seedSearchAdapter?: SeedSearchAdapter;
  maximumSeedSourceMessages?: number;
  queryPlanner?: FieldQueryPlanner;
} = {}) {
  const boundNamespace = namespace ?? fail('SOURCE_NATIVE_HISTORICAL_FIELD_RESOLVER_INPUT');
  const boundCommitSha256 = sourceCommitSha256 ?? fail('SOURCE_NATIVE_HISTORICAL_FIELD_RESOLVER_INPUT');
  const boundReplaySha256 = sourceReplaySha256 ?? fail('SOURCE_NATIVE_HISTORICAL_FIELD_RESOLVER_INPUT');
  const boundRouteMapSha256 = sourceSearchRouteMapSha256
    ?? fail('SOURCE_NATIVE_HISTORICAL_FIELD_RESOLVER_INPUT');
  const {
    map,
    queryPlanner,
    sourceHandles,
    handleById,
    handleByPath,
    namespacePaths,
    mappedSourceCoverageComplete,
    sourceHandleSetSha256,
    seedSearchAdapter,
    seedPolicyBinding,
  } = prepareFieldResolverContext({
    mapInput,
    sourceHandleInput,
    namespace: boundNamespace,
    sourceCommitSha256: boundCommitSha256,
    sourceReplaySha256: boundReplaySha256,
    sourceSearchRouteMapSha256: boundRouteMapSha256,
    seedSearchAdapterInput,
    maximumSeedSourceMessages,
    queryPlannerInput,
    invalidInputCode: 'SOURCE_NATIVE_HISTORICAL_FIELD_RESOLVER_INPUT',
  });
  const availability = validateSourceNativeExactSourceAvailabilitySnapshot(availabilityInput ?? fail('SOURCE_NATIVE_HISTORICAL_FIELD_RESOLVER_INPUT'), {
    sourceCommitSha256: boundCommitSha256,
    sourceReplaySha256: boundReplaySha256,
    sourceSearchRouteMapSha256: boundRouteMapSha256,
    sourceHandleSetSha256,
    sourceCount: sourceHandles.length,
  });
  const unavailableIds = new Set(availability.unavailableSourceMessageIds);
  const search = async ({ question, maximumSourceMessages = 64 }: {
    question?: unknown;
    maximumSourceMessages?: number;
  } = {}) => {
    if (typeof question !== 'string' || !question.trim()
      || !Number.isSafeInteger(maximumSourceMessages) || maximumSourceMessages < 1
      || maximumSourceMessages > 1024) fail('SOURCE_NATIVE_OBJECT_RESOLVER_SEARCH');
    const askedQuestion = typeof question === 'string' ? question
      : fail('SOURCE_NATIVE_OBJECT_RESOLVER_SEARCH');
    const queryPlan = validateFieldQueryPlan(await queryPlanner.plan({ question: askedQuestion }), {
      planner: queryPlanner, namespace: boundNamespace, question: askedQuestion,
    });
    let resolution: SourceNativeFieldSuccessorResolutionResult | null = null;
    let evidenceUnits: UnknownRecord[] = [];
    let selectedSourceMessageIds: number[] = [];
    let allReferenceSourceMessageIds: number[] = [];
    let seedSourceMessageIds: number[] = [];
    let policyPreferredSeedSourceMessageIds: number[] = [];
    let anchorSourceMessageIds: number[] = [];
    let seedSearchReceiptSha256 = null;
    let seedSearchNetworkCalls = 0;
    let rawSeedSearchExecuted = false;
    let searchPath = null;
    let state = queryPlan.state;
    let selectionLabel = 'unresolved source-native historical field successor';
    if (queryPlan.state === 'resolved-native-field-query' && queryPlan.query !== null) {
      const resolvedQuery = queryPlan.query;
      const bindingSha256 = queryBindingSha256('next', resolvedQuery);
      const seedSearch = await runSeedSearch({
        adapter: seedSearchAdapter,
        question: askedQuestion,
        limit: Math.min(maximumSeedSourceMessages, maximumSourceMessages),
        maximumSeedSourceMessages,
        sourceCommitSha256: boundCommitSha256,
        sourceReplaySha256: boundReplaySha256,
        sourceSearchRouteMapSha256: boundRouteMapSha256,
        sourceHandleSetSha256,
        handleById,
        queryBindingSha256: bindingSha256,
      });
      seedSourceMessageIds = seedSearch.rows.map((row) => row.sourceMessageId);
      policyPreferredSeedSourceMessageIds = seedSearch.policyPreferredRows
        .map((row) => row.sourceMessageId);
      seedSearchReceiptSha256 = seedSearch.receiptSha256;
      seedSearchNetworkCalls = seedSearch.networkCalls;
      rawSeedSearchExecuted = seedSearch.rawSearchExecuted;
      selectionLabel = [resolvedQuery.sourceSystem, resolvedQuery.objectType,
        resolvedQuery.externalId, resolvedQuery.fieldPath, 'next recorded revision']
        .filter((value) => value !== undefined).join(' ');
      if (seedSearch.traversalRows.length === 0 && resolvedQuery.anchorFieldSha256 === undefined) {
        state = 'unavailable-native-object-not-seeded';
      } else {
        resolution = resolveSourceNativeFieldSuccessor({
          sourceNativeObjectMap: map,
          seedRelativePaths: seedSearch.traversalRows.map((row) => row.relativePath),
          query: resolvedQuery,
        });
        state = resolution.state;
      }
      if (resolution?.state === 'resolved-next-field-revision') {
        const anchor = resolution.anchor ?? fail('SOURCE_NATIVE_SUCCESSOR_PROOF_CLOSURE');
        const successor = resolution.successor ?? fail('SOURCE_NATIVE_SUCCESSOR_PROOF_CLOSURE');
        const anchorHandle = handleByPath.get(anchor.relativePath)
          ?? fail('SOURCE_NATIVE_SUCCESSOR_PROOF_CLOSURE');
        anchorSourceMessageIds = [anchorHandle.sourceMessageId];
        const proofRows = resolution.proofRelativePaths.map((relativePath) => {
          const handle = handleByPath.get(relativePath);
          const object = map.nativeObjects.find((row) => row.relativePath === relativePath
            && row.objectIdentitySha256 === successor.objectIdentitySha256);
          const field = object?.fields.find((row) => row.fieldPath === resolvedQuery.fieldPath);
          return {
            handle: handle ?? fail('SOURCE_NATIVE_SUCCESSOR_PROOF_CLOSURE'),
            field: field ?? fail('SOURCE_NATIVE_SUCCESSOR_PROOF_CLOSURE'),
          };
        });
        allReferenceSourceMessageIds = proofRows.map((row) => row.handle.sourceMessageId)
          .sort((left, right) => left - right);
        const proofClosureSourceMessageIds = [...new Set([
          ...anchorSourceMessageIds,
          ...allReferenceSourceMessageIds,
        ])].sort((left, right) => left - right);
        const availableProofRows = proofRows.filter((row) => !unavailableIds.has(row.handle.sourceMessageId));
        const representative = availableProofRows.find((row) =>
          row.handle.relativePath === successor.relativePath) ?? availableProofRows[0] ?? null;
        const proofAvailable = representative !== null && !unavailableIds.has(anchorHandle.sourceMessageId);
        state = proofAvailable ? 'resolved-next-field-revision' : 'unavailable-exact-source';
        if (proofAvailable) {
          selectedSourceMessageIds = [representative.handle.sourceMessageId];
          const unitCore = {
            schema: 1,
            kind: 'OpenOntologySourceNativeHistoricalFieldEvidenceUnitV1',
            selectionLabel,
            representativeSourceMessageId: representative.handle.sourceMessageId,
            referenceSourceMessageIds: freeze(allReferenceSourceMessageIds),
            evidenceReferenceCount: allReferenceSourceMessageIds.length,
            exactEvidenceReferences: freeze([freeze({
              sourceMessageId: representative.handle.sourceMessageId,
              relativePath: representative.handle.relativePath,
              sourceSha256: representative.field.evidence.sourceSha256,
              byteStart: representative.field.evidence.byteStart,
              byteEnd: representative.field.evidence.byteEnd,
              textSha256: representative.field.evidence.textSha256,
              fieldSha256: representative.field.fieldSha256,
              fieldPath: resolvedQuery.fieldPath,
              propositionFamilyKey: resolvedQuery.fieldPath,
              businessEntityKeys: freeze([]),
            })]),
            exactEvidenceReferenceCount: 1,
            proofClosureSourceMessageIds: freeze(proofClosureSourceMessageIds),
            unavailableProofSourceMessageIds: freeze(proofClosureSourceMessageIds
              .filter((id) => unavailableIds.has(id))),
            revisionSha256: successor.revisionSha256,
            navigationOnly: true,
            exactInspectRequired: true,
            exactSourcesRemainAuthority: true,
          };
          evidenceUnits = [freeze({ ...unitCore, evidenceUnitSha256: stableObjectSha256(unitCore) })];
        }
        const searchPathCore = {
          schema: 1,
          kind: 'OpenOntologySourceNativeHistoricalFieldSearchPathV1',
          relationType: 'supersedes',
          selectionMode: 'next-recorded-field-revision',
          revisionSha256: successor.revisionSha256,
          seedSourceMessageIds: freeze(seedSourceMessageIds),
          anchorSourceMessageId: anchorHandle.sourceMessageId,
          proofClosureSourceMessageIds: freeze(proofClosureSourceMessageIds),
          unavailableProofSourceMessageIds: freeze(proofClosureSourceMessageIds
            .filter((id) => unavailableIds.has(id))),
          selectedSourceMessageIds: freeze(selectedSourceMessageIds),
          exactSourceAvailabilitySnapshotSha256: availability.snapshotSha256,
          navigationOnly: true,
          exactInspectRequired: true,
          exactSourcesRemainAuthority: true,
        };
        searchPath = freeze({ ...searchPathCore, searchPathSha256: stableObjectSha256(searchPathCore) });
      }
    }
    const core = {
      schema: 1,
      kind: 'OpenOntologySourceNativeObjectResolverResultV1',
      state,
      selectionMode: 'next-recorded-field-revision',
      selectionLabel,
      nativeObjectMapSha256: map.nativeObjectMapSha256,
      sourceCommitSha256: boundCommitSha256,
      sourceReplaySha256: boundReplaySha256,
      sourceSearchRouteMapSha256: boundRouteMapSha256,
      sourceHandleSetSha256,
      exactSourceAvailabilitySnapshotSha256: availability.snapshotSha256,
      queryPlannerAdapter: queryPlanner.adapter,
      queryPlannerSha256: queryPlanner.plannerSha256,
      queryPlan,
      queryBindingSha256: queryBindingSha256('next', queryPlan.query),
      resolutionSha256: resolution?.resolutionSha256 ?? null,
      fieldResolutionPolicy: resolution?.policy ?? null,
      businessEntityKey: null,
      businessEntityCensusSha256: null,
      objectIdentityCensusSha256: null,
      absenceReceipt: null,
      searchPath,
      evidenceUnits: freeze(evidenceUnits),
      selectedSourceMessageIds: freeze(selectedSourceMessageIds),
      allReferenceSourceMessageIds: freeze(allReferenceSourceMessageIds),
      seedSourceMessageIds: freeze(seedSourceMessageIds),
      seedSearchReceiptSha256,
      ...seedPolicyBinding,
      policyPreferredSeedSourceMessageIds: freeze(policyPreferredSeedSourceMessageIds),
      navigationProposals: navigationProposalSummary({
        seedSearchReceiptSha256,
        seedSourceMessageIds,
        policyPreferredSeedSourceMessageIds,
        searchPolicyArtifactSha256: seedPolicyBinding.searchPolicyArtifactSha256,
        rawSeedSearchExecuted,
        seedSearchNetworkCalls,
        learnedRouteUsed: learnedRouteMatchesIdentity({
          map,
          handleById,
          policyPreferredSeedSourceMessageIds,
          objectIdentitySha256: resolution?.successor?.objectIdentitySha256 ?? null,
        }),
      }),
      searchPathAnchorSourceMessageIds: freeze(anchorSourceMessageIds),
      identityRejectedSeedSourceMessageIds: freeze([]),
      searchPathExpandedSourceMessageIds: freeze(selectedSourceMessageIds
        .filter((id) => !seedSourceMessageIds.includes(id))),
      exactEvidenceReferenceCount: evidenceUnits.reduce((sum, unit) =>
        sum + Number(unit.exactEvidenceReferenceCount), 0),
      uniqueEvidenceUnitCount: evidenceUnits.length,
      redundantEvidenceReferenceCount: Math.max(0, allReferenceSourceMessageIds.length - 1),
      maximumSourceMessages,
      mappedNamespaceSourceCoverageComplete: mappedSourceCoverageComplete,
      absenceAuthorized: false,
      absencePolicy: 'historical-successor-resolution-does-not-authorize-absence',
      candidateQuestionReads: 1,
      candidateGoldReads: 0,
      modelCalls: 0,
      networkCalls: seedSearchNetworkCalls,
      targetLeakage: false,
      navigationOnly: true,
      exactInspectRequired: true,
      exactSourcesRemainAuthority: true,
    };
    return freeze({ ...core, resultSha256: stableObjectSha256(core) });
  };

  return freeze({
    kind: 'OpenOntologySourceNativeObjectResolverModuleV1',
    implementation: 'OpenOntologySourceNativeHistoricalFieldResolverV1',
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    namespace: boundNamespace,
    sourceCommitSha256: boundCommitSha256,
    sourceReplaySha256: boundReplaySha256,
    sourceSearchRouteMapSha256: boundRouteMapSha256,
    sourceHandleSetSha256,
    exactSourceAvailabilitySnapshotSha256: availability.snapshotSha256,
    sourceCatalogSha256: null,
    businessEntityCensusSha256: null,
    objectIdentityCensusSha256: null,
    queryPlannerAdapter: queryPlanner.adapter,
    queryPlannerSha256: queryPlanner.plannerSha256,
    ...seedPolicyBinding,
    mappedNamespaceSourceCount: namespacePaths.length,
    maximumSeedSourceMessages,
    modelCalls: 0,
    networkCalls: 0,
    search,
  });
}
