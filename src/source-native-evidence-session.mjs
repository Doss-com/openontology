/** Capability-scoped Exact Evidence search, inspection, and source availability. */
import { createBm25Index } from './bm25-index.mjs';
import { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';

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

export function validateSourceNativeExactSourceAvailabilitySnapshot(value, {
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  sourceHandleSetSha256,
  sourceCount,
}) {
  const { snapshotSha256, ...core } = value ?? {};
  if (value?.kind !== 'OpenOntologyExactSourceAvailabilitySnapshotV1'
    || !SHA256.test(snapshotSha256 ?? '') || stableObjectSha256(core) !== snapshotSha256
    || value.sourceCommitSha256 !== sourceCommitSha256
    || value.sourceReplaySha256 !== sourceReplaySha256
    || value.sourceSearchRouteMapSha256 !== sourceSearchRouteMapSha256
    || value.sourceHandleSetSha256 !== sourceHandleSetSha256
    || value.sourceCount !== sourceCount
    || !Array.isArray(value.unavailableSourceMessageIds)
    || new Set(value.unavailableSourceMessageIds).size !== value.unavailableSourceMessageIds.length
    || value.unavailableSourceMessageIds.some((id) => !Number.isSafeInteger(id) || id < 0)
    || value.availableSourceCount !== sourceCount - value.unavailableSourceMessageIds.length
    || value.availabilityOnly !== true || value.navigationOnly !== true
    || value.exactSourcesRemainAuthority !== true) {
    fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY');
  }
  return freeze(value);
}

export function compileSourceNativeExactSourceAvailabilitySnapshot({
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  sourceHandles: sourceHandleInput,
  unavailableSourceMessageIds: unavailableInput = [],
} = {}) {
  if (!SHA256.test(sourceCommitSha256 ?? '') || !SHA256.test(sourceReplaySha256 ?? '')
    || !SHA256.test(sourceSearchRouteMapSha256 ?? '')
    || !Array.isArray(sourceHandleInput) || sourceHandleInput.length < 1
    || !Array.isArray(unavailableInput)) {
    fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY_INPUT');
  }
  const sourceHandles = sourceHandleInput.map((row) => {
    if (!Number.isSafeInteger(row?.sourceMessageId) || row.sourceMessageId < 0
      || typeof row.relativePath !== 'string' || !row.relativePath) {
      fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY_INPUT');
    }
    return { sourceMessageId: row.sourceMessageId, relativePath: row.relativePath };
  }).sort((left, right) => left.sourceMessageId - right.sourceMessageId
    || compare(left.relativePath, right.relativePath));
  if (new Set(sourceHandles.map((row) => row.sourceMessageId)).size !== sourceHandles.length
    || new Set(sourceHandles.map((row) => row.relativePath)).size !== sourceHandles.length) {
    fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY_INPUT');
  }
  const knownIds = new Set(sourceHandles.map((row) => row.sourceMessageId));
  const unavailableSourceMessageIds = [...unavailableInput].sort((left, right) => left - right);
  if (new Set(unavailableSourceMessageIds).size !== unavailableSourceMessageIds.length
    || unavailableSourceMessageIds.some((id) => !knownIds.has(id))) {
    fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY_INPUT');
  }
  const core = {
    schema: 1,
    kind: 'OpenOntologyExactSourceAvailabilitySnapshotV1',
    sourceCommitSha256,
    sourceReplaySha256,
    sourceSearchRouteMapSha256,
    sourceHandleSetSha256: stableObjectSha256(sourceHandles),
    sourceCount: sourceHandles.length,
    availableSourceCount: sourceHandles.length - unavailableSourceMessageIds.length,
    unavailableSourceMessageIds: freeze(unavailableSourceMessageIds),
    availabilityOnly: true,
    navigationOnly: true,
    exactSourcesRemainAuthority: true,
  };
  return freeze({ ...core, snapshotSha256: stableObjectSha256(core) });
}

/** Open one immutable, capability-scoped Evidence session. */
export function openSourceNativeExactEvidenceSession({
  namespace,
  nativeObjectMapSha256,
  objectOnt = null,
  sources: sourceInput,
  tokenize,
  retrievalAdapter,
  retrievalAdapterSha256,
  maximumSearchResults = 4,
  unavailableSourceMessageIds = [],
  taskId = 'source-native-resolution',
  sessionId = 'source-native-exact-evidence',
} = {}) {
  if (typeof namespace !== 'string' || !namespace
    || !SHA256.test(nativeObjectMapSha256 ?? '')
    || !Array.isArray(sourceInput) || sourceInput.length < 1
    || typeof tokenize !== 'function'
    || typeof retrievalAdapter !== 'string' || !retrievalAdapter
    || !SHA256.test(retrievalAdapterSha256 ?? '')
    || !Number.isSafeInteger(maximumSearchResults) || maximumSearchResults < 1
    || maximumSearchResults > 128
    || !Array.isArray(unavailableSourceMessageIds)
    || typeof taskId !== 'string' || !taskId
    || typeof sessionId !== 'string' || !sessionId) {
    fail('SOURCE_NATIVE_EXACT_SESSION_INPUT');
  }
  const sources = sourceInput.map((row) => {
    if (!Number.isSafeInteger(row?.sourceMessageId) || row.sourceMessageId < 0
      || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1
      || typeof row.relativePath !== 'string' || !row.relativePath
      || typeof row.occurredAt !== 'string' || !Number.isFinite(Date.parse(row.occurredAt))
      || typeof row.content !== 'string' || !row.content.trim()
      || !SHA256.test(row.contentSha256 ?? '')
      || objectBytesSha256(Buffer.from(row.content)) !== row.contentSha256) {
      fail('SOURCE_NATIVE_EXACT_SESSION_SOURCE');
    }
    return freeze({
      sourceMessageId: row.sourceMessageId,
      ordinal: row.ordinal,
      relativePath: row.relativePath,
      occurredAt: row.occurredAt,
      content: row.content,
      contentSha256: row.contentSha256,
    });
  }).sort((left, right) => left.ordinal - right.ordinal
    || left.sourceMessageId - right.sourceMessageId || compare(left.relativePath, right.relativePath));
  if (new Set(sources.map((row) => row.sourceMessageId)).size !== sources.length
    || new Set(sources.map((row) => row.ordinal)).size !== sources.length
    || new Set(sources.map((row) => row.relativePath)).size !== sources.length) {
    fail('SOURCE_NATIVE_EXACT_SESSION_SOURCE');
  }
  const sourceById = new Map(sources.map((row) => [row.sourceMessageId, row]));
  const sourceByRef = new Map(sources.map((row) => [`source-native:${row.sourceMessageId}`, row]));
  const sourceCatalog = sources.map(({ content: _content, ...row }) => row);
  const sourceCatalogSha256 = stableObjectSha256(sourceCatalog);
  if (objectOnt !== null
    && (objectOnt?.kind !== 'OpenOntologySourceNativeObjectOntModuleV1'
      || objectOnt.map?.nativeObjectMapSha256 !== nativeObjectMapSha256
      || !SHA256.test(objectOnt.commitSha256 ?? '')
      || !SHA256.test(objectOnt.replaySha256 ?? '')
      || objectOnt.catalog?.sourceCount !== sources.length
      || objectOnt.sources?.length !== sources.length
      || sources.some((source) => !objectOnt.sources.some((bound) =>
        bound.relativePath === source.relativePath
        && bound.sourceSha256 === source.contentSha256
        && bound.content === source.content)))) {
    fail('SOURCE_NATIVE_EXACT_SESSION_OBJECT_ONT');
  }
  const sourceCommitSha256 = objectOnt === null ? stableObjectSha256({
    schema: 1,
    kind: 'OpenOntologySourceNativeExactSourceCommitV1',
    namespace,
    nativeObjectMapSha256,
    sourceCatalogSha256,
  }) : objectOnt.commitSha256;
  const sourceReplaySha256 = objectOnt === null ? stableObjectSha256({
    schema: 1,
    kind: 'OpenOntologySourceNativeExactSourceReplayV1',
    sourceCommitSha256,
    sourceCatalogSha256,
  }) : objectOnt.replaySha256;
  const sourceSearchRouteMapSha256 = stableObjectSha256({
    schema: 1,
    kind: 'OpenOntologySourceNativeNavigationMapBindingV1',
    nativeObjectMapSha256,
    sourceCatalogSha256,
    ...(objectOnt === null ? {} : { sourceCommitSha256, sourceReplaySha256 }),
  });
  const sourceHandles = freeze(sources.map((row) => freeze({
    sourceMessageId: row.sourceMessageId,
    relativePath: row.relativePath,
  })));
  const sourceHandleSetSha256 = stableObjectSha256(sourceHandles);
  const exactSourceAvailabilitySnapshot = compileSourceNativeExactSourceAvailabilitySnapshot({
    sourceCommitSha256,
    sourceReplaySha256,
    sourceSearchRouteMapSha256,
    sourceHandles,
    unavailableSourceMessageIds,
  });
  const unavailableSourceIds = new Set(exactSourceAvailabilitySnapshot.unavailableSourceMessageIds);
  const availableSources = sources.filter((row) => !unavailableSourceIds.has(row.sourceMessageId));
  const index = createBm25Index(availableSources, {
    idOf: (row) => `source-native:${row.sourceMessageId}`,
    textOf: (row) => row.content,
    tokenize,
  });
  const offeredRefs = new Set();
  const offeredSourceMessageIds = new Set();
  let searchCalls = 0;
  let navigationSourceOfferCalls = 0;
  let inspectCalls = 0;

  const receipt = (toolId, request, response) => {
    const core = {
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeExactEvidenceToolReceiptV1',
      toolId,
      taskId,
      sessionId,
      commitSha256: sourceCommitSha256,
      replaySha256: sourceReplaySha256,
      requestSha256: stableObjectSha256(request),
      responseSha256: stableObjectSha256(response),
    };
    return freeze({ ...core, receiptSha256: stableObjectSha256(core) });
  };
  const exactSource = (source) => freeze({
    physicalChatId: `source-native:${namespace}`,
    sourceMessageId: source.sourceMessageId,
    ordinal: source.ordinal,
    batchNumber: 1,
    turnOrdinal: source.ordinal,
    role: 'source',
    index: null,
    questionType: null,
    timeAnchor: source.occurredAt,
    relativePath: source.relativePath,
    content: source.content,
    contentSha256: source.contentSha256,
    sourceContentSha256: source.contentSha256,
    blobSha256: source.contentSha256,
    sourceSpanId: `source-native-exact:${source.contentSha256.slice(7, 31)}:0-${Buffer.byteLength(source.content)}`,
    byteStart: 0,
    byteEnd: Buffer.byteLength(source.content),
  });
  const inspectEnvelope = (toolId, request, rows) => {
    const exactSources = freeze(rows.map(exactSource));
    const ref = toolId === 'inspect'
      ? request.ref : `sources:${stableObjectSha256(request.sources)}`;
    const textValue = {
      schemaVersion: 1,
      kind: 'OpenOntologyExactSourceBundleV1',
      sources: exactSources,
    };
    const bytes = Buffer.from(stableObjectText(textValue));
    const response = freeze({
      schemaVersion: 1,
      kind: 'CommonInspectResultV1',
      ref,
      text_utf8_base64: bytes.toString('base64'),
      immutable: true,
      provenance: freeze({
        commitSha256: sourceCommitSha256,
        replaySha256: sourceReplaySha256,
        text_sha256: objectBytesSha256(bytes),
        sourceMessageIds: freeze(exactSources.map((row) => row.sourceMessageId)),
        sourceBlobSha256s: freeze(exactSources.map((row) => row.blobSha256)),
        generatedClaimVisibleAsEvidence: false,
      }),
    });
    inspectCalls += 1;
    return freeze({ response, receipt: receipt(toolId, request, response) });
  };

  const search = async (request) => {
    if (typeof request?.query !== 'string' || !request.query.trim()
      || !Array.isArray(request.gaps)
      || !request.filters || typeof request.filters !== 'object' || Array.isArray(request.filters)
      || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 128) {
      fail('SOURCE_NATIVE_EXACT_SESSION_SEARCH');
    }
    const ranked = index.rank(request.query, { limit: Math.min(request.limit, maximumSearchResults) });
    const candidates = freeze(ranked.map((row, rank) => {
      const source = sourceByRef.get(row.id);
      if (!source) fail('SOURCE_NATIVE_EXACT_SESSION_SEARCH');
      offeredRefs.add(row.id);
      offeredSourceMessageIds.add(source.sourceMessageId);
      return freeze({ ref: row.id, rank: rank + 1, score: row.score });
    }));
    searchCalls += 1;
    const response = freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyObjectOntSearchResultV1',
      query: request.query,
      candidates,
      navigationOnly: true,
      exactInspectRequired: true,
      exactSourcesRemainAuthority: true,
      targetLeakage: false,
    });
    return freeze({ response, receipt: receipt('search', request, response) });
  };
  const searchSourceHandles = async (request) => {
    if (typeof request?.query !== 'string' || !request.query.trim()
      || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 128) {
      fail('SOURCE_NATIVE_EXACT_SESSION_SEED_SEARCH');
    }
    const ranked = index.rank(request.query, { limit: Math.min(request.limit, maximumSearchResults) });
    const rows = freeze(ranked.map((row, rank) => {
      const source = sourceByRef.get(row.id);
      if (!source) fail('SOURCE_NATIVE_EXACT_SESSION_SEED_SEARCH');
      offeredRefs.add(row.id);
      offeredSourceMessageIds.add(source.sourceMessageId);
      return freeze({
        rank: rank + 1,
        score: row.score,
        sourceMessageId: source.sourceMessageId,
        relativePath: source.relativePath,
      });
    }));
    searchCalls += 1;
    const core = {
      schema: 1,
      kind: 'OpenOntologySourceNativeSeedSearchResultV1',
      query: request.query,
      sourceCommitSha256,
      sourceReplaySha256,
      sourceSearchRouteMapSha256,
      sourceHandleSetSha256,
      rows,
      navigationOnly: true,
      exactInspectRequired: true,
      exactSourcesRemainAuthority: true,
      targetLeakage: false,
    };
    const response = freeze({ ...core, resultSha256: stableObjectSha256(core) });
    return freeze({ response, receipt: receipt('search_source_handles', request, response) });
  };
  const inspect = async (request) => {
    if (typeof request?.ref !== 'string' || !offeredRefs.has(request.ref)) {
      fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT');
    }
    const source = sourceByRef.get(request.ref);
    if (!source || unavailableSourceIds.has(source.sourceMessageId)) {
      fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT');
    }
    return inspectEnvelope('inspect', request, [source]);
  };
  const offerNavigationSources = (request) => {
    if (typeof request?.selectionKind !== 'string' || !request.selectionKind
      || !SHA256.test(request.selectionSha256 ?? '')
      || request.sourceCommitSha256 !== sourceCommitSha256
      || request.sourceReplaySha256 !== sourceReplaySha256
      || request.sourceSearchRouteMapSha256 !== sourceSearchRouteMapSha256
      || !Array.isArray(request.sourceMessageIds) || request.sourceMessageIds.length < 1
      || request.sourceMessageIds.length > 128
      || new Set(request.sourceMessageIds).size !== request.sourceMessageIds.length
      || request.sourceMessageIds.some((sourceMessageId) => !sourceById.has(sourceMessageId)
        || unavailableSourceIds.has(sourceMessageId))) {
      fail('SOURCE_NATIVE_EXACT_SESSION_OFFER');
    }
    for (const sourceMessageId of request.sourceMessageIds) offeredSourceMessageIds.add(sourceMessageId);
    navigationSourceOfferCalls += 1;
    const response = freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyNavigationSourceOfferV1',
      selectionKind: request.selectionKind,
      selectionSha256: request.selectionSha256,
      sourceMessageIds: freeze([...request.sourceMessageIds]),
      commitSha256: sourceCommitSha256,
      replaySha256: sourceReplaySha256,
      sourceSearchRouteMapSha256,
      navigationOnly: true,
      exactInspectRequired: true,
      targetLeakage: false,
    });
    return freeze({ response, receipt: receipt('offer_navigation_sources', request, response) });
  };
  const inspectSources = async (request) => {
    if (!Array.isArray(request?.sources) || request.sources.length < 1 || request.sources.length > 32
      || new Set(request.sources.map((row) => row?.sourceMessageId)).size !== request.sources.length
      || request.sources.some((row) => !Number.isSafeInteger(row?.sourceMessageId)
        || !offeredSourceMessageIds.has(row.sourceMessageId)
        || typeof row.navigationQuery !== 'string' || !row.navigationQuery.trim()
        || Object.hasOwn(row, 'sourceSpanIds'))) {
      fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT_SOURCES');
    }
    const rows = request.sources.map((row) => sourceById.get(row.sourceMessageId));
    if (rows.some((row) => !row || unavailableSourceIds.has(row.sourceMessageId))) {
      fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT_SOURCES');
    }
    return inspectEnvelope('inspect_sources', request, rows);
  };
  const sourceNativeSeedSearchAdapter = freeze({
    kind: 'OpenOntologySourceNativeSeedSearchAdapterV1',
    adapter: retrievalAdapter,
    adapterSha256: retrievalAdapterSha256,
    sourceCommitSha256,
    sourceReplaySha256,
    sourceSearchRouteMapSha256,
    sourceHandleSetSha256,
    modelCalls: 0,
    networkCalls: 0,
    search: searchSourceHandles,
  });

  return freeze({
    kind: 'CompoundingDeclarationSessionV1',
    sessionImplementation: 'OpenOntologySourceNativeExactEvidenceSessionV1',
    taskId,
    sessionId,
    namespace,
    nativeObjectMapSha256,
    objectOntBound: objectOnt !== null,
    sourceCatalogSha256,
    sourceCommitSha256,
    sourceReplaySha256,
    sourceSearchRouteMapSha256,
    sourceHandles,
    sourceHandleSetSha256,
    exactSourceAvailabilitySnapshot,
    exactSourceAvailabilitySnapshotSha256: exactSourceAvailabilitySnapshot.snapshotSha256,
    sourceNativeSeedSearchAdapter,
    retrievalAdapter,
    retrievalAdapterSha256,
    maximumSearchResults,
    modelCalls: 0,
    networkCalls: 0,
    search,
    inspect,
    offerNavigationSources,
    inspectSources,
    getState: () => freeze({
      schemaVersion: 2,
      kind: 'OpenOntologySourceNativeExactEvidenceSessionStateV1',
      taskId,
      sessionId,
      commitSha256: sourceCommitSha256,
      replaySha256: sourceReplaySha256,
      searchRouteMapSha256: sourceSearchRouteMapSha256,
      sourceCount: sources.length,
      sourceCatalogSha256,
      searchCalls,
      navigationSourceOfferCalls,
      inspectCalls,
      ledgerWrites: 0,
      policyPromotion: false,
    }),
  });
}
