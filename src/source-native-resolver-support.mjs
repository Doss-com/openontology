/** Shared validation and raw or learned proposal transport for field Resolvers. */
import { stableObjectSha256 } from './canonical-content.mjs';
import { validateSourceNativeObjectMap } from './source-native-object-map.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const compare = (left, right) => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code) => { const error = new TypeError(code); error.code = code; throw error; };
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function validateFieldQueryPlanner(planner, namespace) {
  if (planner?.kind !== 'OpenOntologySourceNativeFieldQueryPlannerV1'
    || planner.namespace !== namespace || typeof planner.adapter !== 'string' || !planner.adapter
    || !SHA256.test(planner.plannerSha256 ?? '') || typeof planner.plan !== 'function'
    || planner.modelCalls !== 0 || planner.networkCalls !== 0) {
    fail('SOURCE_NATIVE_FIELD_QUERY_PLANNER');
  }
  return planner;
}

export function validateFieldQueryPlan(plan, { planner, namespace, question }) {
  const { planSha256, ...core } = plan ?? {};
  const resolved = plan?.state === 'resolved-native-field-query';
  if (plan?.kind !== 'OpenOntologySourceNativeFieldQueryPlanV1'
    || !SHA256.test(planSha256 ?? '') || stableObjectSha256(core) !== planSha256
    || plan.plannerSha256 !== planner.plannerSha256 || plan.namespace !== namespace
    || plan.questionSha256 !== stableObjectSha256({ question })
    || !['resolved-native-field-query', 'unavailable-native-object-type-not-declared',
      'unavailable-native-object-type-ambiguous', 'unavailable-native-field-not-declared',
      'unavailable-native-field-ambiguous', 'unavailable-native-object-identifier-not-declared',
      'unavailable-native-multiple-object-identifiers',
      'unavailable-native-field-anchor-not-matched',
      'unavailable-native-field-anchor-ambiguous'].includes(plan.state)
    || resolved && (typeof plan.query?.sourceSystem !== 'string' || !plan.query.sourceSystem
      || typeof plan.query.objectType !== 'string' || !plan.query.objectType
      || typeof plan.query.fieldPath !== 'string' || !plan.query.fieldPath
      || plan.query.namespace !== namespace
      || plan.query.externalId !== undefined
        && (typeof plan.query.externalId !== 'string' || !plan.query.externalId)
      || plan.query.anchorFieldSha256 !== undefined
        && !SHA256.test(plan.query.anchorFieldSha256))
    || !resolved && plan.query !== null
    || plan.modelCalls !== 0 || plan.networkCalls !== 0 || plan.targetLeakage !== false
    || plan.navigationOnly !== true || plan.exactInspectRequired !== true
    || plan.exactSourcesRemainAuthority !== true) {
    fail('SOURCE_NATIVE_FIELD_QUERY_PLAN');
  }
  return freeze(plan);
}

function seedSearchPolicyBinding(adapter) {
  const values = [
    adapter?.searchPolicyArtifactSha256,
    adapter?.searchPolicyActivationSha256,
    adapter?.sourceSearchEpisodeLedgerHeadSha256,
  ];
  const present = values.filter((value) => value !== undefined && value !== null);
  if (present.length !== 0 && (present.length !== values.length
    || present.some((value) => !SHA256.test(value))
    || typeof adapter.proposalArm !== 'string' || !adapter.proposalArm)) {
    fail('SOURCE_NATIVE_SEED_SEARCH_POLICY_BINDING');
  }
  return freeze({
    searchPolicyArtifactSha256: present.length === 0 ? null : values[0],
    searchPolicyActivationSha256: present.length === 0 ? null : values[1],
    sourceSearchEpisodeLedgerHeadSha256: present.length === 0 ? null : values[2],
    seedProposalArm: present.length === 0 ? 'raw-source-retrieval' : adapter.proposalArm,
  });
}

function validateSeedSearchAdapter(adapter, {
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  sourceHandleSetSha256,
}) {
  if (adapter?.kind !== 'OpenOntologySourceNativeSeedSearchAdapterV1'
    || adapter.sourceCommitSha256 !== sourceCommitSha256
    || adapter.sourceReplaySha256 !== sourceReplaySha256
    || adapter.sourceSearchRouteMapSha256 !== sourceSearchRouteMapSha256
    || adapter.sourceHandleSetSha256 !== sourceHandleSetSha256
    || typeof adapter.search !== 'function' || adapter.modelCalls !== 0 || adapter.networkCalls !== 0) {
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
}) {
  const learnedProposalCount = policyPreferredSeedSourceMessageIds.length;
  const rawProposalCount = seedSourceMessageIds.length - learnedProposalCount;
  const searchExecuted = seedSearchReceiptSha256 !== null;
  const searchPolicyActive = searchPolicyArtifactSha256 !== null;
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyNavigationProposalSummaryV1',
    state: !searchExecuted ? 'not-run'
      : !searchPolicyActive ? 'raw-only'
        : learnedProposalCount === 0 ? 'raw-fallback'
          : learnedRouteUsed ? 'learned-route-used' : 'learned-route-rejected',
    searchPolicyActive,
    learnedProposalCount,
    rawProposalCount,
    learnedRouteUsed,
    rawSearchExecuted: rawSeedSearchExecuted,
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
}) {
  if (objectIdentitySha256 === null) return false;
  const learnedPaths = new Set(policyPreferredSeedSourceMessageIds.map((id) =>
    handleById.get(id)?.relativePath));
  return map.nativeObjects.some((row) =>
    learnedPaths.has(row.relativePath)
    && row.objectIdentitySha256 === objectIdentitySha256);
}

export function queryBindingSha256(intent, query) {
  if (query?.externalId === undefined) return null;
  return stableObjectSha256({
    intent,
    sourceSystem: query.sourceSystem,
    objectType: query.objectType,
    namespace: query.namespace,
    externalId: query.externalId,
    fieldPath: query.fieldPath,
    ...(query.anchorFieldSha256 === undefined ? {} : {
      anchorFieldSha256: query.anchorFieldSha256,
    }),
  });
}

export async function runSeedSearch({ adapter, question, limit, maximumSeedSourceMessages,
  sourceCommitSha256, sourceReplaySha256, sourceSearchRouteMapSha256,
  sourceHandleSetSha256, handleById, queryBindingSha256: bindingSha256 }) {
  const seedPacket = await adapter.search({
    query: question,
    limit,
    queryBindingSha256: bindingSha256,
  });
  const { resultSha256, ...seedResultCore } = seedPacket?.response ?? {};
  const { receiptSha256, ...seedReceiptCore } = seedPacket?.receipt ?? {};
  if (seedPacket?.response?.kind !== 'OpenOntologySourceNativeSeedSearchResultV1'
    || !SHA256.test(resultSha256 ?? '') || stableObjectSha256(seedResultCore) !== resultSha256
    || seedPacket.response.sourceCommitSha256 !== sourceCommitSha256
    || seedPacket.response.sourceReplaySha256 !== sourceReplaySha256
    || seedPacket.response.sourceSearchRouteMapSha256 !== sourceSearchRouteMapSha256
    || seedPacket.response.sourceHandleSetSha256 !== sourceHandleSetSha256
    || seedPacket.response.query !== question
    || adapter.searchPolicyArtifactSha256 !== undefined
      && seedPacket.response.queryBindingSha256 !== bindingSha256
    || adapter.searchPolicyArtifactSha256 !== undefined
      && typeof seedPacket.response.rawSearchExecuted !== 'boolean'
    || !Array.isArray(seedPacket.response.rows)
    || seedPacket.response.rows.length > maximumSeedSourceMessages
    || seedPacket.response.rows.some((row, index) => row.rank !== index + 1
      || !Number.isSafeInteger(row.sourceMessageId) || !handleById.has(row.sourceMessageId)
      || row.relativePath !== handleById.get(row.sourceMessageId).relativePath)
    || adapter.searchPolicyArtifactSha256 !== undefined
      && seedPacket.response.rows.some((row) =>
        !['learned-exact-route-memory', 'raw-source-retrieval'].includes(row.proposalSource))
    || !SHA256.test(receiptSha256 ?? '') || stableObjectSha256(seedReceiptCore) !== receiptSha256
    || seedPacket.receipt.commitSha256 !== sourceCommitSha256
    || seedPacket.receipt.replaySha256 !== sourceReplaySha256) {
    fail('SOURCE_NATIVE_SEED_SEARCH_RESULT');
  }
  const policyPreferredRows = adapter.searchPolicyArtifactSha256 === undefined ? []
    : seedPacket.response.rows.filter((row) =>
      row.proposalSource === 'learned-exact-route-memory');
  return freeze({
    rows: seedPacket.response.rows,
    traversalRows: policyPreferredRows.length > 0 ? policyPreferredRows : seedPacket.response.rows,
    policyPreferredRows,
    rawSearchExecuted: adapter.searchPolicyArtifactSha256 === undefined
      ? true : seedPacket.response.rawSearchExecuted,
    receiptSha256,
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
}) {
  let map;
  try { map = validateSourceNativeObjectMap(mapInput); } catch { fail('SOURCE_NATIVE_RESOLVER_MAP'); }
  if (typeof namespace !== 'string' || !namespace
    || !SHA256.test(sourceCommitSha256 ?? '') || !SHA256.test(sourceReplaySha256 ?? '')
    || !SHA256.test(sourceSearchRouteMapSha256 ?? '')
    || !Array.isArray(sourceHandleInput) || sourceHandleInput.length < 1
    || !Number.isSafeInteger(maximumSeedSourceMessages) || maximumSeedSourceMessages < 1
    || maximumSeedSourceMessages > 128) {
    fail(invalidInputCode);
  }
  const queryPlanner = validateFieldQueryPlanner(queryPlannerInput, namespace);
  const sourceHandles = sourceHandleInput.map((row) => {
    if (!Number.isSafeInteger(row?.sourceMessageId) || row.sourceMessageId < 0
      || typeof row.relativePath !== 'string' || !row.relativePath) {
      fail('SOURCE_NATIVE_OBJECT_RESOLVER_SOURCE_HANDLE');
    }
    return freeze({ sourceMessageId: row.sourceMessageId, relativePath: row.relativePath });
  }).sort((left, right) => left.sourceMessageId - right.sourceMessageId
    || compare(left.relativePath, right.relativePath));
  if (new Set(sourceHandles.map((row) => row.sourceMessageId)).size !== sourceHandles.length
    || new Set(sourceHandles.map((row) => row.relativePath)).size !== sourceHandles.length) {
    fail('SOURCE_NATIVE_OBJECT_RESOLVER_SOURCE_HANDLE');
  }
  const handleById = new Map(sourceHandles.map((row) => [row.sourceMessageId, row]));
  const handleByPath = new Map(sourceHandles.map((row) => [row.relativePath, row]));
  const namespacePaths = [...new Set(map.nativeObjects
    .filter((row) => row.objectIdentity.namespace === namespace)
    .map((row) => row.relativePath))].sort(compare);
  if (namespacePaths.length < 1
    || namespacePaths.some((relativePath) => !handleByPath.has(relativePath))) {
    fail('SOURCE_NATIVE_OBJECT_RESOLVER_SOURCE_COVERAGE');
  }
  const sourceHandleSetSha256 = stableObjectSha256(sourceHandles);
  const seedSearchAdapter = validateSeedSearchAdapter(seedSearchAdapterInput, {
    sourceCommitSha256,
    sourceReplaySha256,
    sourceSearchRouteMapSha256,
    sourceHandleSetSha256,
  });
  return {
    map,
    queryPlanner,
    sourceHandles,
    handleById,
    handleByPath,
    namespacePaths,
    mappedSourceCoverageComplete: map.mappedSourceCount === map.sourceCount
      && map.unsupportedSourceCount === 0,
    sourceHandleSetSha256,
    seedSearchAdapter,
    seedPolicyBinding: seedSearchPolicyBinding(seedSearchAdapter),
  };
}
