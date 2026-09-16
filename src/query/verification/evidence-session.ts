/** Capability-scoped Exact Evidence search, inspection, and source availability. */
import { createBm25Index } from '../bm25-index.js';
import { objectBytesSha256, stableObjectSha256, stableObjectText } from '../../canonical-content.js';
import type { SourceNativeObjectMap, UnknownRecord } from '../../source/object-map.js';

export interface SourceHandle extends UnknownRecord {
  sourceMessageId: number;
  relativePath: string;
}
export interface ExactSessionSource extends SourceHandle {
  ordinal: number;
  occurredAt: string;
  content: string;
  contentSha256: string;
}
export interface ExactSessionOptions {
  namespace: string;
  nativeObjectMapSha256: string;
  objectOnt?: BoundObjectOnt | null;
  sources: ExactSessionSource[];
  tokenize: (value: string) => string[];
  retrievalAdapter: string;
  retrievalAdapterSha256: string;
  maximumSearchResults?: number;
  unavailableSourceMessageIds?: number[];
  taskId?: string;
  sessionId?: string;
}
interface AvailabilityOptions {
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceSearchRouteMapSha256: string;
  sourceHandleSetSha256: string;
  sourceCount: number;
}
export interface ExactSourceAvailabilitySnapshot extends UnknownRecord {
  kind: 'OpenOntologyExactSourceAvailabilitySnapshotV1';
  snapshotSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceSearchRouteMapSha256: string;
  sourceHandleSetSha256: string;
  sourceCount: number;
  availableSourceCount: number;
  unavailableSourceMessageIds: number[];
}
export interface BoundObjectOnt extends UnknownRecord {
  kind: 'OpenOntologySourceNativeObjectOntModuleV1';
  map: { nativeObjectMapSha256: string };
  commitSha256: string;
  replaySha256: string;
  catalog: { sourceCount: number };
  sources: Array<{ relativePath: string; sourceSha256: string; content: string }>;
}
export interface SeedRequest extends UnknownRecord {
  query: string;
  limit: number;
}
export interface SearchRequest extends SeedRequest {
  gaps: UnknownRecord[];
  filters: UnknownRecord;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const isSourceMessageIds = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((id) => Number.isSafeInteger(id) && id >= 0);
const exactSourceMessageIds = (value: unknown): number[] =>
  isSourceMessageIds(value) ? value : fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY');
const compare = (left: unknown, right: unknown): number => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code: string): never => { const error = new TypeError(code) as TypeError & { code: string }; error.code = code; throw error; };
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export function validateSourceNativeExactSourceAvailabilitySnapshot(value: UnknownRecord, {
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  sourceHandleSetSha256,
  sourceCount,
}: AvailabilityOptions): ExactSourceAvailabilitySnapshot {
  const { snapshotSha256, ...core } = value ?? {};
  const snapshot = typeof snapshotSha256 === 'string' ? snapshotSha256 : '';
  const unavailableIds = exactSourceMessageIds(value.unavailableSourceMessageIds);
  if (value?.kind !== 'OpenOntologyExactSourceAvailabilitySnapshotV1'
    || !SHA256.test(snapshot) || stableObjectSha256(core) !== snapshot
    || value.sourceCommitSha256 !== sourceCommitSha256
    || value.sourceReplaySha256 !== sourceReplaySha256
    || value.sourceSearchRouteMapSha256 !== sourceSearchRouteMapSha256
    || value.sourceHandleSetSha256 !== sourceHandleSetSha256
    || value.sourceCount !== sourceCount
    || new Set(unavailableIds).size !== unavailableIds.length
    || value.availableSourceCount !== sourceCount - unavailableIds.length
    || value.availabilityOnly !== true || value.navigationOnly !== true
    || value.exactSourcesRemainAuthority !== true) {
    fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY');
  }
  return freeze({
    ...value,
    kind: 'OpenOntologyExactSourceAvailabilitySnapshotV1',
    snapshotSha256: snapshot,
    sourceCommitSha256,
    sourceReplaySha256,
    sourceSearchRouteMapSha256,
    sourceHandleSetSha256,
    sourceCount,
    availableSourceCount: sourceCount - unavailableIds.length,
    unavailableSourceMessageIds: [...unavailableIds],
    availabilityOnly: true,
    navigationOnly: true,
    exactSourcesRemainAuthority: true,
  });
}

export function compileSourceNativeExactSourceAvailabilitySnapshot({
  sourceCommitSha256,
  sourceReplaySha256,
  sourceSearchRouteMapSha256,
  sourceHandles: sourceHandleInput,
  unavailableSourceMessageIds: unavailableInput = [],
}: {
  sourceCommitSha256?: unknown;
  sourceReplaySha256?: unknown;
  sourceSearchRouteMapSha256?: unknown;
  sourceHandles?: SourceHandle[];
  unavailableSourceMessageIds?: number[];
} = {}): ExactSourceAvailabilitySnapshot {
  const commitSha256 = typeof sourceCommitSha256 === 'string' ? sourceCommitSha256 : '';
  const replaySha256 = typeof sourceReplaySha256 === 'string' ? sourceReplaySha256 : '';
  const routeMapSha256 = typeof sourceSearchRouteMapSha256 === 'string'
    ? sourceSearchRouteMapSha256 : '';
  const sourceRows = sourceHandleInput ?? [];
  if (!SHA256.test(commitSha256) || !SHA256.test(replaySha256)
    || !SHA256.test(routeMapSha256) || sourceRows.length < 1
    || !Array.isArray(unavailableInput)) {
    fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY_INPUT');
  }
  const sourceHandles = sourceRows.map((row: SourceHandle) => {
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
  const unavailableSourceMessageIds = [...unavailableInput].sort((left: number, right: number) => left - right);
  if (new Set(unavailableSourceMessageIds).size !== unavailableSourceMessageIds.length
    || unavailableSourceMessageIds.some((id) => !knownIds.has(id))) {
    fail('SOURCE_NATIVE_EXACT_SOURCE_AVAILABILITY_INPUT');
  }
  const core = {
    schema: 1,
    kind: 'OpenOntologyExactSourceAvailabilitySnapshotV1' as const,
    sourceCommitSha256: commitSha256,
    sourceReplaySha256: replaySha256,
    sourceSearchRouteMapSha256: routeMapSha256,
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
export function openSourceNativeExactEvidenceSession(options: ExactSessionOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    fail('SOURCE_NATIVE_EXACT_SESSION_INPUT');
  }
  const {
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
  } = options;
  const mapSha256 = typeof nativeObjectMapSha256 === 'string' ? nativeObjectMapSha256 : '';
  const retrievalSha256 = typeof retrievalAdapterSha256 === 'string' ? retrievalAdapterSha256 : '';
  const sourceRows = sourceInput ?? [];
  const tokenizeFn = typeof tokenize === 'function' ? tokenize : fail('SOURCE_NATIVE_EXACT_SESSION_INPUT');
  if (typeof namespace !== 'string' || !namespace
    || !SHA256.test(mapSha256) || sourceRows.length < 1
    || typeof tokenizeFn !== 'function'
    || typeof retrievalAdapter !== 'string' || !retrievalAdapter
    || !SHA256.test(retrievalSha256)
    || !Number.isSafeInteger(maximumSearchResults) || maximumSearchResults < 1
    || maximumSearchResults > 128
    || !Array.isArray(unavailableSourceMessageIds)
    || typeof taskId !== 'string' || !taskId
    || typeof sessionId !== 'string' || !sessionId) {
    fail('SOURCE_NATIVE_EXACT_SESSION_INPUT');
  }
  const sources = sourceRows.map((row: ExactSessionSource) => {
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
  }).sort((left: ExactSessionSource, right: ExactSessionSource) => left.ordinal - right.ordinal
    || left.sourceMessageId - right.sourceMessageId || compare(left.relativePath, right.relativePath));
  if (new Set(sources.map((row: ExactSessionSource) => row.sourceMessageId)).size !== sources.length
    || new Set(sources.map((row: ExactSessionSource) => row.ordinal)).size !== sources.length
    || new Set(sources.map((row: ExactSessionSource) => row.relativePath)).size !== sources.length) {
    fail('SOURCE_NATIVE_EXACT_SESSION_SOURCE');
  }
  const sourceById = new Map<number, ExactSessionSource>(sources.map((row: ExactSessionSource) => [row.sourceMessageId, row]));
  const sourceByRef = new Map<string, ExactSessionSource>(sources.map((row: ExactSessionSource) => [`source-native:${row.sourceMessageId}`, row]));
  const sourceCatalog = sources.map(({ content: _content, ...row }: ExactSessionSource) => row);
  const sourceCatalogSha256 = stableObjectSha256(sourceCatalog);
  if (objectOnt !== null
    && (objectOnt?.kind !== 'OpenOntologySourceNativeObjectOntModuleV1'
      || objectOnt.map.nativeObjectMapSha256 !== mapSha256
      || !SHA256.test(objectOnt.commitSha256 ?? '')
      || !SHA256.test(objectOnt.replaySha256 ?? '')
      || objectOnt.catalog?.sourceCount !== sources.length
      || objectOnt.sources?.length !== sources.length
      || sources.some((source: ExactSessionSource) => !objectOnt.sources.some((bound: UnknownRecord) =>
        bound.relativePath === source.relativePath
        && bound.sourceSha256 === source.contentSha256
        && bound.content === source.content)))) {
    fail('SOURCE_NATIVE_EXACT_SESSION_OBJECT_ONT');
  }
  const sourceCommitSha256 = objectOnt === null ? stableObjectSha256({
    schema: 1,
    kind: 'OpenOntologySourceNativeExactSourceCommitV1',
    namespace,
    nativeObjectMapSha256: mapSha256,
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
    nativeObjectMapSha256: mapSha256,
    sourceCatalogSha256,
    ...(objectOnt === null ? {} : { sourceCommitSha256, sourceReplaySha256 }),
  });
  const sourceHandles = freeze(sources.map((row: ExactSessionSource) => freeze({
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
  const unavailableSourceIds = new Set<number>(exactSourceAvailabilitySnapshot.unavailableSourceMessageIds);
  const availableSources = sources.filter((row) => !unavailableSourceIds.has(row.sourceMessageId));
  const index = createBm25Index(availableSources, {
    idOf: (row) => `source-native:${row.sourceMessageId}`,
    textOf: (row) => row.content,
    tokenize: (text: unknown) => tokenizeFn(String(text)),
  });
  const offeredRefs = new Set<string>();
  const offeredSourceMessageIds = new Set<number>();
  let searchCalls = 0;
  let navigationSourceOfferCalls = 0;
  let inspectCalls = 0;

  const receipt = (toolId: string, request: UnknownRecord, response: UnknownRecord) => {
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
  const exactSource = (source: ExactSessionSource): UnknownRecord => freeze({
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
  const inspectEnvelope = (toolId: string, request: UnknownRecord, rows: ExactSessionSource[]) => {
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

  const search = async (request: SearchRequest) => {
    if (typeof request?.query !== 'string' || !request.query.trim()
      || !Array.isArray(request.gaps)
      || !request.filters || typeof request.filters !== 'object' || Array.isArray(request.filters)
      || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 128) {
      fail('SOURCE_NATIVE_EXACT_SESSION_SEARCH');
    }
    const ranked = index.rank(request.query, { limit: Math.min(request.limit, maximumSearchResults) });
    const candidates = freeze(ranked.map((row: { id: string; score: number }, rank: number) => {
      const source = sourceByRef.get(row.id);
      const exact: ExactSessionSource = source ?? fail('SOURCE_NATIVE_EXACT_SESSION_SEARCH');
      offeredRefs.add(row.id);
      offeredSourceMessageIds.add(exact.sourceMessageId);
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
  const searchSourceHandles = async (request: SeedRequest) => {
    if (typeof request?.query !== 'string' || !request.query.trim()
      || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 128) {
      fail('SOURCE_NATIVE_EXACT_SESSION_SEED_SEARCH');
    }
    const ranked = index.rank(request.query, { limit: Math.min(request.limit, maximumSearchResults) });
    const rows = freeze(ranked.map((row: { id: string; score: number }, rank: number) => {
      const source = sourceByRef.get(row.id);
      const exact: ExactSessionSource = source ?? fail('SOURCE_NATIVE_EXACT_SESSION_SEED_SEARCH');
      offeredRefs.add(row.id);
      offeredSourceMessageIds.add(exact.sourceMessageId);
      return freeze({
        rank: rank + 1,
        score: row.score,
        sourceMessageId: exact.sourceMessageId,
        relativePath: exact.relativePath,
      });
    }));
    searchCalls += 1;
    const core = {
      schema: 1,
      kind: 'OpenOntologySourceNativeSeedSearchResultV1' as const,
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
  const inspect = async (request: UnknownRecord & { ref?: unknown }) => {
    if (typeof request?.ref !== 'string' || !offeredRefs.has(request.ref)) {
      fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT');
    }
    const ref = typeof request.ref === 'string'
      ? request.ref : fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT');
    const source = sourceByRef.get(ref);
    const exact: ExactSessionSource = source && !unavailableSourceIds.has(source.sourceMessageId)
      ? source : fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT');
    return inspectEnvelope('inspect', request, [exact]);
  };
  const offerNavigationSources = (request: UnknownRecord & { selectionKind?: unknown; selectionSha256?: unknown; sourceCommitSha256?: unknown; sourceReplaySha256?: unknown; sourceSearchRouteMapSha256?: unknown; sourceMessageIds?: number[] }) => {
    const sourceMessageIds: number[] = request.sourceMessageIds ?? [];
    const selectionSha256 = typeof request.selectionSha256 === 'string' ? request.selectionSha256 : '';
    if (typeof request?.selectionKind !== 'string' || !request.selectionKind
      || !SHA256.test(selectionSha256)
      || request.sourceCommitSha256 !== sourceCommitSha256
      || request.sourceReplaySha256 !== sourceReplaySha256
      || request.sourceSearchRouteMapSha256 !== sourceSearchRouteMapSha256
      || sourceMessageIds.length < 1 || sourceMessageIds.length > 128
      || new Set(sourceMessageIds).size !== sourceMessageIds.length
      || sourceMessageIds.some((sourceMessageId: number) => !sourceById.has(sourceMessageId)
        || unavailableSourceIds.has(sourceMessageId))) {
      fail('SOURCE_NATIVE_EXACT_SESSION_OFFER');
    }
    for (const sourceMessageId of sourceMessageIds) offeredSourceMessageIds.add(sourceMessageId);
    navigationSourceOfferCalls += 1;
    const response = freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyNavigationSourceOfferV1',
      selectionKind: request.selectionKind,
      selectionSha256,
      sourceMessageIds: freeze([...sourceMessageIds]),
      commitSha256: sourceCommitSha256,
      replaySha256: sourceReplaySha256,
      sourceSearchRouteMapSha256,
      navigationOnly: true,
      exactInspectRequired: true,
      targetLeakage: false,
    });
    return freeze({ response, receipt: receipt('offer_navigation_sources', request, response) });
  };
  const inspectSources = async (request: UnknownRecord & { sources?: Array<UnknownRecord & { sourceMessageId?: unknown; navigationQuery?: unknown }> }) => {
    const sourceRequests = request.sources ?? [];
    if (sourceRequests.length < 1 || sourceRequests.length > 32
      || new Set(sourceRequests.map((row) => row?.sourceMessageId)).size !== sourceRequests.length
      || sourceRequests.some((row) => !Number.isSafeInteger(row?.sourceMessageId)
        || !offeredSourceMessageIds.has(typeof row.sourceMessageId === 'number'
          ? row.sourceMessageId : -1)
        || typeof row.navigationQuery !== 'string' || !row.navigationQuery.trim()
        || Object.hasOwn(row, 'sourceSpanIds'))) {
      fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT_SOURCES');
    }
    const requestedSourceMessageIds = sourceRequests.map((row) =>
      typeof row.sourceMessageId === 'number'
        ? row.sourceMessageId : fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT_SOURCES'));
    const rows = requestedSourceMessageIds.map((sourceMessageId) => sourceById.get(sourceMessageId))
      .filter((row): row is ExactSessionSource => row !== undefined);
    if (rows.some((row) => !row || unavailableSourceIds.has(row.sourceMessageId))) {
      fail('SOURCE_NATIVE_EXACT_SESSION_INSPECT_SOURCES');
    }
    return inspectEnvelope('inspect_sources', request, rows);
  };
  const sourceNativeSeedSearchAdapter = freeze({
    kind: 'OpenOntologySourceNativeSeedSearchAdapterV1' as const,
    adapter: retrievalAdapter,
    adapterSha256: retrievalSha256,
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
    nativeObjectMapSha256: mapSha256,
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
    retrievalAdapterSha256: retrievalSha256,
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
