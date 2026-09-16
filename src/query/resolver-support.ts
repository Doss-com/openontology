/** Shared validation and raw or learned proposal transport for field Resolvers. */
import { stableObjectSha256 } from '../canonical-content.js';
import { validateSourceNativeObjectMap } from '../source/object-map.js';
import type { SourceNativeObjectMap, UnknownRecord } from '../source/object-map.js';
import type { SourceHandle } from './verification/evidence-session.js';
import type { SourceNativeFieldQuery } from './planner.js';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAXIMUM_SEED_NETWORK_CALLS = 1000;
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const isSeedNetworkCalls = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAXIMUM_SEED_NETWORK_CALLS;
const validateSeedNetworkCalls = (value: unknown, maximum: number): number => {
  if (isSeedNetworkCalls(value) && value <= maximum) return value;
  return fail('SOURCE_NATIVE_SEED_SEARCH_RESULT');
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export interface FieldQueryPlanner extends UnknownRecord {
  kind: 'OpenOntologySourceNativeFieldQueryPlannerV1';
  namespace: string;
  adapter: string;
  plannerSha256: string;
  modelCalls: number;
  networkCalls: number;
  plan(input: { question: string }): Promise<ValidatedFieldQueryPlan> | ValidatedFieldQueryPlan;
}
export interface SeedSearchAdapter extends UnknownRecord {
  kind: 'OpenOntologySourceNativeSeedSearchAdapterV1';
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceSearchRouteMapSha256: string;
  sourceHandleSetSha256: string;
  modelCalls: number;
  /** Maximum logical network operations per seed search; each receipt reports actual use. */
  networkCalls: number;
  search(input: UnknownRecord): Promise<SeedPacket>;
  searchPolicyArtifactSha256?: string | null;
  searchPolicyActivationSha256?: string | null;
  sourceSearchEpisodeLedgerHeadSha256?: string | null;
  proposalArm?: string;
}
export interface SeedRow extends UnknownRecord {
  rank: number;
  sourceMessageId: number;
  relativePath: string;
  proposalSource?: 'learned-exact-route-memory' | 'raw-source-retrieval';
}
interface SeedResponse extends UnknownRecord {
  kind: 'OpenOntologySourceNativeSeedSearchResultV1';
  resultSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceSearchRouteMapSha256: string;
  sourceHandleSetSha256: string;
  query: string;
  rows: SeedRow[];
  queryBindingSha256?: string | null;
  rawSearchExecuted?: boolean;
}
interface SeedReceipt extends UnknownRecord {
  receiptSha256: string;
  commitSha256: string;
  replaySha256: string;
  networkCalls?: unknown;
}
interface SeedPacket {
  response: SeedResponse;
  receipt: SeedReceipt;
}
interface SeedPolicyBinding {
  searchPolicyArtifactSha256: string | null;
  searchPolicyActivationSha256: string | null;
  sourceSearchEpisodeLedgerHeadSha256: string | null;
  seedProposalArm: string;
}
export interface ValidatedFieldQueryPlan extends UnknownRecord {
  state: string;
  query: SourceNativeFieldQuery | null;
  plannerSha256: string;
  questionSha256: string;
  planSha256: string;
}
export interface SeedSearchResult extends UnknownRecord {
  rows: SeedRow[];
  traversalRows: SeedRow[];
  policyPreferredRows: SeedRow[];
  rawSearchExecuted: boolean;
  receiptSha256: string;
  networkCalls: number;
}
interface FieldResolverContextOptions {
  mapInput?: SourceNativeObjectMap;
  sourceHandleInput?: SourceHandle[];
  namespace?: unknown;
  sourceCommitSha256?: unknown;
  sourceReplaySha256?: unknown;
  sourceSearchRouteMapSha256?: unknown;
  seedSearchAdapterInput?: SeedSearchAdapter;
  maximumSeedSourceMessages?: number;
  queryPlannerInput?: FieldQueryPlanner;
  invalidInputCode: string;
}
export interface PreparedFieldResolverContext {
  map: SourceNativeObjectMap;
  queryPlanner: FieldQueryPlanner;
  sourceHandles: SourceHandle[];
  handleById: Map<number, SourceHandle>;
  handleByPath: Map<string, SourceHandle>;
  namespacePaths: string[];
  mappedSourceCoverageComplete: boolean;
  sourceHandleSetSha256: string;
  seedSearchAdapter: SeedSearchAdapter;
  seedPolicyBinding: SeedPolicyBinding;
}

function validateFieldQueryPlanner(
  planner: FieldQueryPlanner,
  namespace: string,
): FieldQueryPlanner {
  if (
    planner?.kind !== 'OpenOntologySourceNativeFieldQueryPlannerV1' ||
    planner.namespace !== namespace ||
    typeof planner.adapter !== 'string' ||
    !planner.adapter ||
    !SHA256.test(planner.plannerSha256 ?? '') ||
    typeof planner.plan !== 'function' ||
    planner.modelCalls !== 0 ||
    planner.networkCalls !== 0
  ) {
    fail('SOURCE_NATIVE_FIELD_QUERY_PLANNER');
  }
  return planner;
}

export function validateFieldQueryPlan(
  plan: ValidatedFieldQueryPlan,
  {
    planner,
    namespace,
    question,
  }: {
    planner: FieldQueryPlanner;
    namespace: string;
    question: string;
  },
): ValidatedFieldQueryPlan {
  const { planSha256, ...core } = plan ?? {};
  const resolved = plan?.state === 'resolved-native-field-query';
  if (
    plan?.kind !== 'OpenOntologySourceNativeFieldQueryPlanV1' ||
    !SHA256.test(planSha256 ?? '') ||
    stableObjectSha256(core) !== planSha256 ||
    plan.plannerSha256 !== planner.plannerSha256 ||
    plan.namespace !== namespace ||
    plan.questionSha256 !== stableObjectSha256({ question }) ||
    ![
      'resolved-native-field-query',
      'unavailable-native-object-type-not-declared',
      'unavailable-native-object-type-ambiguous',
      'unavailable-native-field-not-declared',
      'unavailable-native-field-ambiguous',
      'unavailable-native-object-identifier-not-declared',
      'unavailable-native-multiple-object-identifiers',
      'unavailable-native-field-anchor-not-matched',
      'unavailable-native-field-anchor-ambiguous',
    ].includes(plan.state) ||
    (resolved &&
      (typeof plan.query?.sourceSystem !== 'string' ||
        !plan.query.sourceSystem ||
        typeof plan.query.objectType !== 'string' ||
        !plan.query.objectType ||
        typeof plan.query.fieldPath !== 'string' ||
        !plan.query.fieldPath ||
        plan.query.namespace !== namespace ||
        (plan.query.externalId !== undefined &&
          (typeof plan.query.externalId !== 'string' || !plan.query.externalId)) ||
        (plan.query.anchorFieldSha256 !== undefined &&
          !SHA256.test(plan.query.anchorFieldSha256)))) ||
    (!resolved && plan.query !== null) ||
    plan.modelCalls !== 0 ||
    plan.networkCalls !== 0 ||
    plan.targetLeakage !== false ||
    plan.navigationOnly !== true ||
    plan.exactInspectRequired !== true ||
    plan.exactSourcesRemainAuthority !== true
  ) {
    fail('SOURCE_NATIVE_FIELD_QUERY_PLAN');
  }
  return freeze(plan);
}

function seedSearchPolicyBinding(adapter: SeedSearchAdapter): SeedPolicyBinding {
  const values = [
    adapter?.searchPolicyArtifactSha256,
    adapter?.searchPolicyActivationSha256,
    adapter?.sourceSearchEpisodeLedgerHeadSha256,
  ];
  const present = values.filter((value) => value !== undefined && value !== null);
  if (
    present.length !== 0 &&
    (present.length !== values.length ||
      present.some((value) => !SHA256.test(value)) ||
      typeof adapter.proposalArm !== 'string' ||
      !adapter.proposalArm)
  ) {
    fail('SOURCE_NATIVE_SEED_SEARCH_POLICY_BINDING');
  }
  const searchPolicyArtifactSha256 = values[0] ?? null;
  const searchPolicyActivationSha256 = values[1] ?? null;
  const sourceSearchEpisodeLedgerHeadSha256 = values[2] ?? null;
  const seedProposalArm = typeof adapter.proposalArm === 'string' ? adapter.proposalArm : null;
  if (present.length !== 0 && seedProposalArm === null) {
    fail('SOURCE_NATIVE_SEED_SEARCH_POLICY_BINDING');
  }
  return freeze({
    searchPolicyArtifactSha256,
    searchPolicyActivationSha256,
    sourceSearchEpisodeLedgerHeadSha256,
    seedProposalArm:
      present.length === 0
        ? 'raw-source-retrieval'
        : (seedProposalArm ?? fail('SOURCE_NATIVE_SEED_SEARCH_POLICY_BINDING')),
  });
}

function validateSeedSearchAdapter(
  adapter: SeedSearchAdapter,
  {
    sourceCommitSha256,
    sourceReplaySha256,
    sourceSearchRouteMapSha256,
    sourceHandleSetSha256,
  }: {
    sourceCommitSha256: string;
    sourceReplaySha256: string;
    sourceSearchRouteMapSha256: string;
    sourceHandleSetSha256: string;
  },
): SeedSearchAdapter {
  if (
    adapter?.kind !== 'OpenOntologySourceNativeSeedSearchAdapterV1' ||
    adapter.sourceCommitSha256 !== sourceCommitSha256 ||
    adapter.sourceReplaySha256 !== sourceReplaySha256 ||
    adapter.sourceSearchRouteMapSha256 !== sourceSearchRouteMapSha256 ||
    adapter.sourceHandleSetSha256 !== sourceHandleSetSha256 ||
    typeof adapter.search !== 'function' ||
    adapter.modelCalls !== 0 ||
    !isSeedNetworkCalls(adapter.networkCalls)
  ) {
    fail('SOURCE_NATIVE_SEED_SEARCH_ADAPTER');
  }
  seedSearchPolicyBinding(adapter);
  return adapter;
}

export function navigationProposalSummary({
  seedSearchReceiptSha256,
  seedSourceMessageIds,
  policyPreferredSeedSourceMessageIds,
  searchPolicyArtifactSha256,
  learnedRouteUsed,
  rawSeedSearchExecuted,
  seedSearchNetworkCalls,
}: {
  seedSearchReceiptSha256: string | null;
  seedSourceMessageIds: number[];
  policyPreferredSeedSourceMessageIds: number[];
  searchPolicyArtifactSha256: string | null;
  learnedRouteUsed: boolean;
  rawSeedSearchExecuted: boolean;
  seedSearchNetworkCalls: number;
}): UnknownRecord {
  const learnedProposalCount = policyPreferredSeedSourceMessageIds.length;
  const rawProposalCount = seedSourceMessageIds.length - learnedProposalCount;
  const searchExecuted = seedSearchReceiptSha256 !== null;
  const searchPolicyActive = searchPolicyArtifactSha256 !== null;
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyNavigationProposalSummaryV1',
    state: !searchExecuted
      ? 'not-run'
      : !searchPolicyActive
        ? 'raw-only'
        : learnedProposalCount === 0
          ? 'raw-fallback'
          : learnedRouteUsed
            ? 'learned-route-used'
            : 'learned-route-rejected',
    searchPolicyActive,
    learnedProposalCount,
    rawProposalCount,
    learnedRouteUsed,
    rawSearchExecuted: rawSeedSearchExecuted,
    seedSearchNetworkCalls,
    rawProposalArmPreserved: true,
    navigationOnly: true,
    exactInspectRequired: true,
  });
}

export function learnedRouteMatchesIdentity({
  map,
  handleById,
  policyPreferredSeedSourceMessageIds,
  objectIdentitySha256,
}: {
  map: SourceNativeObjectMap;
  handleById: Map<number, SourceHandle>;
  policyPreferredSeedSourceMessageIds: number[];
  objectIdentitySha256: string | null;
}): boolean {
  if (objectIdentitySha256 === null) return false;
  const learnedPaths = new Set(
    policyPreferredSeedSourceMessageIds.map((id) => handleById.get(id)?.relativePath),
  );
  return map.nativeObjects.some(
    (row) =>
      learnedPaths.has(row.relativePath) && row.objectIdentitySha256 === objectIdentitySha256,
  );
}

export function queryBindingSha256(
  intent: string,
  query: SourceNativeFieldQuery | null | undefined,
): string | null {
  if (query?.externalId === undefined) return null;
  return stableObjectSha256({
    intent,
    sourceSystem: query.sourceSystem,
    objectType: query.objectType,
    namespace: query.namespace,
    externalId: query.externalId,
    fieldPath: query.fieldPath,
    ...(query.anchorFieldSha256 === undefined
      ? {}
      : {
          anchorFieldSha256: query.anchorFieldSha256,
        }),
  });
}

export async function runSeedSearch({
  adapter,
  question,
  limit,
  maximumSeedSourceMessages,
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  sourceHandleSetSha256,
  handleById,
  queryBindingSha256: bindingSha256,
}: {
  adapter: SeedSearchAdapter;
  question: string;
  limit: number;
  maximumSeedSourceMessages: number;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceSearchRouteMapSha256: string;
  sourceHandleSetSha256: string;
  handleById: Map<number, SourceHandle>;
  queryBindingSha256: string | null;
}): Promise<SeedSearchResult> {
  const seedPacket = await adapter.search({
    query: question,
    limit,
    queryBindingSha256: bindingSha256,
  });
  const { resultSha256, ...seedResultCore } = seedPacket.response;
  const { receiptSha256, ...seedReceiptCore } = seedPacket.receipt;
  if (
    seedPacket.response.kind !== 'OpenOntologySourceNativeSeedSearchResultV1' ||
    !SHA256.test(resultSha256 ?? '') ||
    stableObjectSha256(seedResultCore) !== resultSha256 ||
    seedPacket.response.sourceCommitSha256 !== sourceCommitSha256 ||
    seedPacket.response.sourceReplaySha256 !== sourceReplaySha256 ||
    seedPacket.response.sourceSearchRouteMapSha256 !== sourceSearchRouteMapSha256 ||
    seedPacket.response.sourceHandleSetSha256 !== sourceHandleSetSha256 ||
    seedPacket.response.query !== question ||
    (adapter.searchPolicyArtifactSha256 !== undefined &&
      seedPacket.response.queryBindingSha256 !== bindingSha256) ||
    (adapter.searchPolicyArtifactSha256 !== undefined &&
      typeof seedPacket.response.rawSearchExecuted !== 'boolean') ||
    !Array.isArray(seedPacket.response.rows) ||
    seedPacket.response.rows.length > maximumSeedSourceMessages ||
    seedPacket.response.rows.some(
      (row: SeedRow, index: number) =>
        row.rank !== index + 1 ||
        !Number.isSafeInteger(row.sourceMessageId) ||
        !handleById.has(row.sourceMessageId) ||
        row.relativePath !== handleById.get(row.sourceMessageId)?.relativePath,
    ) ||
    (adapter.searchPolicyArtifactSha256 !== undefined &&
      seedPacket.response.rows.some(
        (row: SeedRow) =>
          !['learned-exact-route-memory', 'raw-source-retrieval'].includes(
            row.proposalSource ?? '',
          ),
      )) ||
    !SHA256.test(receiptSha256 ?? '') ||
    stableObjectSha256(seedReceiptCore) !== receiptSha256 ||
    seedPacket.receipt.commitSha256 !== sourceCommitSha256 ||
    seedPacket.receipt.replaySha256 !== sourceReplaySha256
  ) {
    fail('SOURCE_NATIVE_SEED_SEARCH_RESULT');
  }
  let declaredNetworkCalls: unknown = seedPacket.receipt.networkCalls;
  if (declaredNetworkCalls === undefined) {
    if (adapter.networkCalls !== 0) fail('SOURCE_NATIVE_SEED_SEARCH_RESULT');
    declaredNetworkCalls = 0;
  }
  const validatedNetworkCalls = validateSeedNetworkCalls(
    declaredNetworkCalls,
    adapter.networkCalls,
  );
  const policyPreferredRows =
    adapter.searchPolicyArtifactSha256 === undefined
      ? []
      : seedPacket.response.rows.filter(
          (row: SeedRow) => row.proposalSource === 'learned-exact-route-memory',
        );
  return freeze({
    rows: seedPacket.response.rows,
    traversalRows: policyPreferredRows.length > 0 ? policyPreferredRows : seedPacket.response.rows,
    policyPreferredRows,
    rawSearchExecuted:
      adapter.searchPolicyArtifactSha256 === undefined
        ? true
        : seedPacket.response.rawSearchExecuted === true,
    receiptSha256,
    networkCalls: validatedNetworkCalls,
  });
}

export function prepareFieldResolverContext({
  mapInput,
  sourceHandleInput,
  namespace,
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  seedSearchAdapterInput,
  maximumSeedSourceMessages,
  queryPlannerInput,
  invalidInputCode,
}: FieldResolverContextOptions): PreparedFieldResolverContext {
  const map = (() => {
    try {
      return validateSourceNativeObjectMap(mapInput ?? fail('SOURCE_NATIVE_RESOLVER_MAP'));
    } catch {
      return fail('SOURCE_NATIVE_RESOLVER_MAP');
    }
  })();
  const commitSha256 = typeof sourceCommitSha256 === 'string' ? sourceCommitSha256 : '';
  const replaySha256 = typeof sourceReplaySha256 === 'string' ? sourceReplaySha256 : '';
  const namespaceValue = typeof namespace === 'string' ? namespace : '';
  const routeMapSha256 =
    typeof sourceSearchRouteMapSha256 === 'string' ? sourceSearchRouteMapSha256 : '';
  const maximumSeeds = maximumSeedSourceMessages ?? 0;
  if (
    !namespaceValue ||
    !SHA256.test(commitSha256) ||
    !SHA256.test(replaySha256) ||
    !SHA256.test(routeMapSha256) ||
    !Array.isArray(sourceHandleInput) ||
    sourceHandleInput.length < 1 ||
    !Number.isSafeInteger(maximumSeeds) ||
    maximumSeeds < 1 ||
    maximumSeeds > 128
  ) {
    fail(invalidInputCode);
  }
  const queryPlanner = validateFieldQueryPlanner(
    queryPlannerInput ?? fail(invalidInputCode),
    namespaceValue,
  );
  const sourceHandles = (sourceHandleInput ?? [])
    .map((row: SourceHandle) => {
      if (
        !Number.isSafeInteger(row?.sourceMessageId) ||
        row.sourceMessageId < 0 ||
        typeof row.relativePath !== 'string' ||
        !row.relativePath
      ) {
        fail('SOURCE_NATIVE_OBJECT_RESOLVER_SOURCE_HANDLE');
      }
      return freeze({ sourceMessageId: row.sourceMessageId, relativePath: row.relativePath });
    })
    .sort(
      (left, right) =>
        left.sourceMessageId - right.sourceMessageId ||
        compare(left.relativePath, right.relativePath),
    );
  if (
    new Set(sourceHandles.map((row) => row.sourceMessageId)).size !== sourceHandles.length ||
    new Set(sourceHandles.map((row) => row.relativePath)).size !== sourceHandles.length
  ) {
    fail('SOURCE_NATIVE_OBJECT_RESOLVER_SOURCE_HANDLE');
  }
  const handleById = new Map(sourceHandles.map((row) => [row.sourceMessageId, row]));
  const handleByPath = new Map(sourceHandles.map((row) => [row.relativePath, row]));
  const namespacePaths = [
    ...new Set(
      map.nativeObjects
        .filter((row) => row.objectIdentity.namespace === namespaceValue)
        .map((row) => row.relativePath),
    ),
  ].sort(compare);
  if (
    namespacePaths.length < 1 ||
    namespacePaths.some((relativePath) => !handleByPath.has(relativePath))
  ) {
    fail('SOURCE_NATIVE_OBJECT_RESOLVER_SOURCE_COVERAGE');
  }
  const sourceHandleSetSha256 = stableObjectSha256(sourceHandles);
  const seedSearchAdapter = validateSeedSearchAdapter(
    seedSearchAdapterInput ?? fail(invalidInputCode),
    {
      sourceCommitSha256: commitSha256,
      sourceReplaySha256: replaySha256,
      sourceSearchRouteMapSha256: routeMapSha256,
      sourceHandleSetSha256,
    },
  );
  return {
    map,
    queryPlanner,
    sourceHandles,
    handleById,
    handleByPath,
    namespacePaths,
    mappedSourceCoverageComplete:
      map.mappedSourceCount === map.sourceCount && map.unsupportedSourceCount === 0,
    sourceHandleSetSha256,
    seedSearchAdapter,
    seedPolicyBinding: seedSearchPolicyBinding(seedSearchAdapter),
  };
}
