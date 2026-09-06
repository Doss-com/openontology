/** Bounded, metadata-only graph pages over one source-native Ont snapshot. */
import { createPublicKey, randomUUID } from 'node:crypto';
import { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';
import { openExactProductArtifactState, openProductState } from './source-native-artifact.mjs';
import type { ProductOptions } from './source-native-artifact.mjs';
import { admissionTrustRegistry } from './admission-authentication.mjs';
import { createConstructionLedgerReader } from './source-native-construction-admission.mjs';
import type {
  SourceNativeConstructionAdmissionRecord, SourceNativeConstructionLedger,
} from './source-native-construction-admission.mjs';
import type { SourceNativeAdmissionTrustEntry } from './admission-authentication.mjs';
import type {
  SourceNativeObject, SourceNativeObjectIdentity,
} from './source-native-object-map.mjs';
import type {
  SourceNativeSemanticClaim, SourceNativeSemanticWitness,
} from './source-native-semantic-construction.mjs';

const MAX_NODE_PAGE = 64;
const MAX_EDGE_PAGE = 128;
const MAX_RECORD_PAGE = 64;
const MAX_CURSOR_COUNT = 128;
const MAX_METADATA_ITEMS = 128;
const MAX_PAGE_BYTES = 256 * 1024;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const STATES = new Set(['invalid', 'ineligible', 'superseded', 'conflicting', 'active']);

export interface SourceNativeOntExplorerConfiguration {
  trustRegistry: readonly SourceNativeAdmissionTrustEntry[];
  knowledgeBranch?: string;
}

export interface SourceNativeOntExplorerHistoricalConfiguration
  extends SourceNativeOntExplorerConfiguration {
  snapshot: SourceNativeOntExplorerBinding;
  recordSha256: string;
}

export interface SourceNativeOntExplorerBinding {
  kind: 'OpenOntologySourceNativeOntExplorerBindingV1';
  ontId: string;
  namespace: string;
  artifactSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceCatalogSha256: string;
  nativeObjectMapSha256: string;
  knowledgeBranch: string;
  knowledgeCommitSha256: string | null;
  knowledgeReplaySha256: string | null;
  reviewerConfigurationSha256: string;
}

export interface SourceNativeOntExplorerFreshness {
  state: 'unknown';
  reason: 'upstream-observation-not-captured-by-kernel-primitive';
}

export interface SourceNativeOntExplorerAuthority {
  scope: 'whole-ont';
  accessMode: 'trusted-whole-ont-kernel';
}

export interface SourceNativeOntExplorerNativeCoverage {
  sourceCount: number;
  mappedSourceCount: number;
  unsupportedSourceCount: number;
  parseFailureCount: number;
  nativeObjectCount: number;
  fieldRevisionCount: number;
}

export interface SourceNativeOntExplorerLedgerSummary extends Omit<SourceNativeConstructionLedger,
  'activeRecords'> {
  conflictingObjectDefIdsTotal: number;
  diagnosticCodesTotal: number;
  conflictingObjectDefIdsTruncated: boolean;
  diagnosticCodesTruncated: boolean;
  activeRecordCount: number;
}

export interface SourceNativeOntExplorerConstructionCoverage {
  sourceCount: number;
  examinedSourceCount: number;
  unsupportedSourceCount: number;
  failedSourceCount: number;
  unexaminedSourceCount: number;
}

export type SourceNativeOntExplorerNodeKind = 'object-def' | 'native-object' | 'passage';

export interface SourceNativeOntExplorerNode {
  id: string;
  kind: SourceNativeOntExplorerNodeKind;
  label: string;
  state: 'active';
  objectDef?: {
    id: string;
    name: string;
    aliases: readonly { value: string; sourceSystem: string }[];
  };
  nativeObject?: {
    nativeObjectSha256: string;
    identity: SourceNativeObjectIdentity;
  };
  passage?: {
    nativeObjectSha256: string;
    evidence: SourceNativeSemanticWitness['evidence'];
  };
  readRef?: string;
}

export type SourceNativeOntExplorerEdgeKind =
  'claim' | 'name-witness' | 'alias-witness' | 'native-observation';

export interface SourceNativeOntExplorerEdge {
  id: string;
  kind: SourceNativeOntExplorerEdgeKind;
  from: string;
  to: string;
  role: SourceNativeOntExplorerEdgeKind;
  claimId?: string;
  about?: string;
  predicate?: SourceNativeSemanticClaim['predicate'];
  constructionSha256?: string;
  admissionRecordSha256?: string;
  evidence?: SourceNativeSemanticWitness['evidence'];
}

export interface SourceNativeOntExplorerRecord {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeOntExplorerRecordV1';
  blobSha256: string;
  recordSha256: string | null;
  constructionSha256: string | null;
  state: 'invalid' | 'ineligible' | 'superseded' | 'conflicting' | 'active';
  reasonCodes: readonly string[];
  supersedesRecordSha256s: readonly string[];
  supersededByRecordSha256s: readonly string[];
  conflictingObjectDefIds: readonly string[];
  constructionCoverage: SourceNativeOntExplorerConstructionCoverage | null;
}

interface ExplorerPageBase {
  schemaVersion: 1;
  availability: 'ready' | 'unavailable';
  unavailableReason?: 'history-unavailable';
  binding: SourceNativeOntExplorerBinding;
  freshness: SourceNativeOntExplorerFreshness;
  authority: SourceNativeOntExplorerAuthority;
  coverage: SourceNativeOntExplorerNativeCoverage;
  ledger: SourceNativeOntExplorerLedgerSummary;
  projectionSha256: string;
  historicalSnapshot?: true;
  currentNavigationEligible?: false;
}

export interface SourceNativeOntExplorerNodesInput {
  term?: string;
  scope?: { sourceSystem: string; objectType?: string };
  focusId?: string;
  ids?: readonly string[];
  limit?: number;
  cursor?: string;
}

export interface SourceNativeOntExplorerNodesResult extends ExplorerPageBase {
  kind: 'OpenOntologySourceNativeOntExplorerNodesV1';
  filter: {
    term: string | null;
    scope: { sourceSystem: string; objectType?: string } | null;
    focusId: string | null;
    ids: readonly string[] | null;
  };
  nodes: readonly SourceNativeOntExplorerNode[];
  totalCount: number | null;
  returnedCount: number;
  nextCursor: string | null;
}

export interface SourceNativeOntExplorerEdgesInput {
  focusId?: string;
  limit?: number;
  cursor?: string;
}

export interface SourceNativeOntExplorerEdgesResult extends ExplorerPageBase {
  kind: 'OpenOntologySourceNativeOntExplorerEdgesV1';
  filter: { focusId: string | null };
  edges: readonly SourceNativeOntExplorerEdge[];
  totalCount: number | null;
  returnedCount: number;
  nextCursor: string | null;
}

export interface SourceNativeOntExplorerRecordsInput {
  constructionSha256?: string;
  state?: SourceNativeOntExplorerRecord['state'];
  limit?: number;
  cursor?: string;
}

export interface SourceNativeOntExplorerRecordsResult extends ExplorerPageBase {
  kind: 'OpenOntologySourceNativeOntExplorerRecordsV1';
  filter: { constructionSha256: string | null; state: SourceNativeOntExplorerRecord['state'] | null };
  records: readonly SourceNativeOntExplorerRecord[];
  totalCount: number | null;
  returnedCount: number;
  nextCursor: string | null;
}

export interface SourceNativeOntExplorerStatusResult extends ExplorerPageBase {
  kind: 'OpenOntologySourceNativeOntExplorerStatusV1';
  state: 'ready' | 'degraded' | 'unavailable';
  recordCount: number | null;
  activeRecordCount: number | null;
}

export interface SourceNativeOntExplorerReadResult {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeOntExplorerReadV1';
  ref: string;
  historicalSnapshot: true;
  currentNavigationEligible: false;
  exactText: string;
  evidence: SourceNativeSemanticWitness['evidence'];
  selectedBinding: SourceNativeOntExplorerBinding;
  binding: {
    kind: 'OpenOntologySourceNativeOntExplorerPassageBindingV1';
    conceptId: string;
    roles: readonly string[];
    nativeObject: SourceNativeObjectIdentity;
    nativeObjectSha256: string;
    constructionSha256: string;
    admissionRecordSha256: string;
    sourceCommitSha256: string;
    sourceReplaySha256: string;
    knowledgeBranch: string;
    knowledgeCommitSha256: string;
    knowledgeReplaySha256: string;
    navigationOnly: true;
    exactSourcesRemainAuthority: true;
  };
  receiptSha256: string;
}

export interface SourceNativeOntExplorer {
  nodes(input?: SourceNativeOntExplorerNodesInput): SourceNativeOntExplorerNodesResult;
  edges(input?: SourceNativeOntExplorerEdgesInput): SourceNativeOntExplorerEdgesResult;
  records(input?: SourceNativeOntExplorerRecordsInput): SourceNativeOntExplorerRecordsResult;
  status(): SourceNativeOntExplorerStatusResult;
}

export interface SourceNativeOntExplorerHistorical extends SourceNativeOntExplorer {
  read(input: { ref: string }): SourceNativeOntExplorerReadResult;
}

type Snapshot = ReturnType<ReturnType<typeof createConstructionLedgerReader>['readSnapshot']>;
type SelectedSnapshot = ReturnType<ReturnType<typeof createConstructionLedgerReader>['readSnapshotAt']>;

interface Observation {
  snapshot: Snapshot | SelectedSnapshot;
  binding: SourceNativeOntExplorerBinding;
  projectionSha256: string;
  availability: 'ready' | 'unavailable';
  historicalSnapshot: boolean;
  selectedRecord: SourceNativeConstructionAdmissionRecord | null;
  selectedDisposition: Snapshot['records'][number] | null;
  knowledgeVersion: string | null;
  knowledgeChecksumSha256: string | null;
  sourceVersion: string | null;
  sourceChecksumSha256: string | null;
}

interface CursorState {
  method: 'nodes' | 'edges' | 'records';
  filterSha256: string;
  projectionSha256: string;
  offset: number;
}

interface InternalNode {
  node: SourceNativeOntExplorerNode;
  scope?: { sourceSystem: string; objectType: string };
  searchable?: {
    name: string;
    attachmentScopes: readonly { sourceSystem: string; objectType: string }[];
    aliases: readonly {
      value: string;
      sourceSystem: string;
    }[];
  };
}

interface GraphModel {
  nodes: readonly InternalNode[];
  edges: readonly SourceNativeOntExplorerEdge[];
  nodeById: ReadonlyMap<string, InternalNode>;
  passages: ReadonlyMap<string, { record: SourceNativeConstructionAdmissionRecord; witness: SourceNativeSemanticWitness }>;
}

interface SelectedConfiguration {
  snapshot: SourceNativeOntExplorerBinding;
  recordSha256: string;
}

interface OfferedRead {
  ref: string;
  nodeId: string;
  projectionSha256: string;
  recordSha256: string;
  witness: SourceNativeSemanticWitness;
}

const compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
const normalized = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('en-US');

function fail(suffix: string): never {
  const error = new TypeError(`SOURCE_NATIVE_EXPLORER_${suffix}`) as TypeError & { code: string };
  error.code = error.message;
  throw error;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || !Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.includes(key))) fail('INPUT');
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)
    || Buffer.from(value).toString('utf8') !== value) fail('INPUT');
  return value.trim();
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value)) fail('INPUT');
  return value;
}

const BINDING_KEYS = [
  'kind', 'ontId', 'namespace', 'artifactSha256', 'sourceCommitSha256',
  'sourceReplaySha256', 'sourceCatalogSha256', 'nativeObjectMapSha256',
  'knowledgeBranch', 'knowledgeCommitSha256', 'knowledgeReplaySha256',
  'reviewerConfigurationSha256',
] as const;

function explorerBinding(value: unknown): SourceNativeOntExplorerBinding {
  const input = record(value, BINDING_KEYS);
  if (Reflect.ownKeys(input).length !== BINDING_KEYS.length
    || input.kind !== 'OpenOntologySourceNativeOntExplorerBindingV1') fail('INPUT');
  const knowledgeCommitSha256 = input.knowledgeCommitSha256;
  const knowledgeReplaySha256 = input.knowledgeReplaySha256;
  if (knowledgeCommitSha256 !== null) hash(knowledgeCommitSha256);
  if (knowledgeReplaySha256 !== null) hash(knowledgeReplaySha256);
  return freeze({
    kind: 'OpenOntologySourceNativeOntExplorerBindingV1',
    ontId: text(input.ontId), namespace: text(input.namespace),
    artifactSha256: hash(input.artifactSha256),
    sourceCommitSha256: hash(input.sourceCommitSha256),
    sourceReplaySha256: hash(input.sourceReplaySha256),
    sourceCatalogSha256: hash(input.sourceCatalogSha256),
    nativeObjectMapSha256: hash(input.nativeObjectMapSha256),
    knowledgeBranch: text(input.knowledgeBranch),
    knowledgeCommitSha256: knowledgeCommitSha256 as string | null,
    knowledgeReplaySha256: knowledgeReplaySha256 as string | null,
    reviewerConfigurationSha256: hash(input.reviewerConfigurationSha256),
  });
}

function sameBinding(left: SourceNativeOntExplorerBinding,
  right: SourceNativeOntExplorerBinding): boolean {
  return stableObjectText(left) === stableObjectText(right);
}

function pageLimit(value: unknown, fallback: number, maximum: number): number {
  const limit = value === undefined ? fallback : value;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    fail('INPUT');
  }
  return limit;
}

function scope(value: unknown): { sourceSystem: string; objectType?: string } {
  const input = record(value, ['sourceSystem', 'objectType']);
  const sourceSystem = text(input.sourceSystem);
  const objectType = input.objectType === undefined ? undefined : text(input.objectType);
  return objectType === undefined ? { sourceSystem } : { sourceSystem, objectType };
}

function normalizeNodesInput(value: SourceNativeOntExplorerNodesInput | undefined) {
  const input = record(value ?? {}, ['term', 'scope', 'focusId', 'ids', 'limit', 'cursor']);
  const term = input.term === undefined ? null : text(input.term);
  const selectedScope = input.scope === undefined ? null : scope(input.scope);
  const focusId = input.focusId === undefined ? null : text(input.focusId, 512);
  const ids = input.ids === undefined ? null : (() => {
    if (!Array.isArray(input.ids) || input.ids.length > 64) fail('INPUT');
    const values = input.ids.map((id) => text(id, 512));
    if (new Set(values).size !== values.length) fail('INPUT');
    return [...values].sort(compare);
  })();
  if (focusId !== null && (term !== null || selectedScope !== null || ids !== null)) fail('INPUT');
  if (ids !== null && (term !== null || selectedScope !== null)) fail('INPUT');
  return { term, scope: selectedScope, focusId, ids,
    limit: pageLimit(input.limit, MAX_NODE_PAGE, MAX_NODE_PAGE),
    cursor: input.cursor === undefined ? null : text(input.cursor, 512) };
}

function normalizeEdgesInput(value: SourceNativeOntExplorerEdgesInput | undefined) {
  const input = record(value ?? {}, ['focusId', 'limit', 'cursor']);
  return {
    focusId: input.focusId === undefined ? null : text(input.focusId, 512),
    limit: pageLimit(input.limit, MAX_EDGE_PAGE, MAX_EDGE_PAGE),
    cursor: input.cursor === undefined ? null : text(input.cursor, 512),
  };
}

function normalizeRecordsInput(value: SourceNativeOntExplorerRecordsInput | undefined) {
  const input = record(value ?? {}, ['constructionSha256', 'state', 'limit', 'cursor']);
  const constructionSha256 = input.constructionSha256 === undefined
    ? null : hash(input.constructionSha256);
  const state = input.state === undefined ? null : input.state;
  if (state !== null && (typeof state !== 'string' || !STATES.has(state))) fail('INPUT');
  return {
    constructionSha256, state: state as SourceNativeOntExplorerRecord['state'] | null,
    limit: pageLimit(input.limit, MAX_RECORD_PAGE, MAX_RECORD_PAGE),
    cursor: input.cursor === undefined ? null : text(input.cursor, 512),
  };
}

function summary(ledger: SourceNativeConstructionLedger): SourceNativeOntExplorerLedgerSummary {
  const { activeRecords, ...rest } = ledger;
  const conflictingObjectDefIds = rest.conflictingObjectDefIds.slice(0, MAX_METADATA_ITEMS);
  const diagnosticCodes = rest.diagnosticCodes.slice(0, MAX_METADATA_ITEMS);
  return freeze({ ...rest,
    conflictingObjectDefIds,
    diagnosticCodes,
    conflictingObjectDefIdsTotal: rest.conflictingObjectDefIds.length,
    diagnosticCodesTotal: rest.diagnosticCodes.length,
    conflictingObjectDefIdsTruncated: conflictingObjectDefIds.length < rest.conflictingObjectDefIds.length,
    diagnosticCodesTruncated: diagnosticCodes.length < rest.diagnosticCodes.length,
    activeRecordCount: activeRecords.length });
}

function nativeCoverage(state: ReturnType<typeof openProductState>): SourceNativeOntExplorerNativeCoverage {
  const map = state.objectOnt.map;
  return freeze({ sourceCount: map.sourceCount, mappedSourceCount: map.mappedSourceCount,
    unsupportedSourceCount: map.unsupportedSourceCount, parseFailureCount: map.parseFailureCount,
    nativeObjectCount: map.nativeObjectCount, fieldRevisionCount: map.fieldRevisionCount });
}

function constructionCoverage(recordValue: SourceNativeConstructionAdmissionRecord): SourceNativeOntExplorerConstructionCoverage {
  const coverage = recordValue.construction.coverage;
  return freeze({ sourceCount: coverage.sourceCount, examinedSourceCount: coverage.examinedSourceCount,
    unsupportedSourceCount: coverage.unsupportedSourceCount, failedSourceCount: coverage.failedSourceCount,
    unexaminedSourceCount: coverage.unexaminedSourceCount });
}

function reviewerConfigurationSha256(trustRegistry: readonly SourceNativeAdmissionTrustEntry[]): string {
  const identity = trustRegistry.map((entry) => ({ issuerId: entry.issuerId,
    publicKeySpkiBase64: createPublicKey(entry.publicKeyPem)
      .export({ type: 'spki', format: 'der' }).toString('base64'),
    roles: [...entry.roles].sort(compare) })).sort((left, right) => compare(left.issuerId, right.issuerId));
  return stableObjectSha256(identity);
}

function sourceBinding(state: ReturnType<typeof openProductState>, ledger: SourceNativeConstructionLedger,
  reviewerSha256: string): SourceNativeOntExplorerBinding {
  return freeze({ kind: 'OpenOntologySourceNativeOntExplorerBindingV1',
    ontId: state.descriptor.ontId, namespace: state.descriptor.namespace,
    artifactSha256: state.descriptor.artifactSha256, sourceCommitSha256: state.objectOnt.commitSha256,
    sourceReplaySha256: state.objectOnt.replaySha256,
    sourceCatalogSha256: state.objectOnt.catalog.sourceCatalogSha256,
    nativeObjectMapSha256: state.objectOnt.map.nativeObjectMapSha256,
    knowledgeBranch: ledger.branch, knowledgeCommitSha256: ledger.commitSha256,
    knowledgeReplaySha256: ledger.replaySha256, reviewerConfigurationSha256: reviewerSha256,
  });
}

function historyUnavailable(ledger: SourceNativeConstructionLedger): boolean {
  return ledger.state === 'degraded' && ledger.commitSha256 === null && ledger.replaySha256 === null;
}

function observe(state: ReturnType<typeof openProductState>, reader: ReturnType<typeof createConstructionLedgerReader>,
  reviewerSha256: string, selected: SelectedConfiguration | null = null): Observation {
  const snapshot = selected === null ? reader.readSnapshot() : (() => {
    const requested = selected.snapshot;
    if (requested.knowledgeCommitSha256 === null || requested.knowledgeReplaySha256 === null) {
      fail('BINDING');
    }
    return reader.readSnapshotAt({ recordSha256: selected.recordSha256,
      commitSha256: requested.knowledgeCommitSha256,
      replaySha256: requested.knowledgeReplaySha256 });
  })();
  const binding = sourceBinding(state, snapshot.ledger, reviewerSha256);
  if (selected !== null && !sameBinding(binding, selected.snapshot)) fail('BINDING');
  const selectedSnapshot = selected === null ? null : snapshot as SelectedSnapshot;
  const projectionSha256 = stableObjectSha256({ binding,
    ledger: { state: snapshot.ledger.state, diagnosticCodes: snapshot.ledger.diagnosticCodes,
      activeRecordSha256s: snapshot.ledger.activeRecords.map((item) => item.recordSha256).sort(compare) },
    records: snapshot.records });
  const historicalSnapshot = selected !== null;
  return { snapshot, binding, projectionSha256,
    availability: historyUnavailable(snapshot.ledger) ? 'unavailable' : 'ready',
    historicalSnapshot,
    selectedRecord: selectedSnapshot?.selectedRecord ?? null,
    selectedDisposition: selectedSnapshot?.selectedDisposition ?? null,
    knowledgeVersion: selectedSnapshot?.knowledgeSnapshot.version ?? null,
    knowledgeChecksumSha256: selectedSnapshot?.knowledgeSnapshot.checksumSha256 ?? null,
    sourceVersion: selectedSnapshot?.sourceSnapshot.version ?? null,
    sourceChecksumSha256: selectedSnapshot?.sourceSnapshot.checksumSha256 ?? null,
  };
}

function base(observation: Observation, state: ReturnType<typeof openProductState>): ExplorerPageBase {
  return {
    schemaVersion: 1,
    availability: observation.availability,
    ...(observation.availability === 'unavailable' ? { unavailableReason: 'history-unavailable' as const } : {}),
    binding: observation.binding,
    freshness: { state: 'unknown', reason: 'upstream-observation-not-captured-by-kernel-primitive' },
    authority: { scope: 'whole-ont', accessMode: 'trusted-whole-ont-kernel' },
    coverage: nativeCoverage(state), ledger: summary(observation.snapshot.ledger),
    projectionSha256: observation.projectionSha256,
    ...(observation.historicalSnapshot ? {
      historicalSnapshot: true as const, currentNavigationEligible: false as const,
    } : {}),
  };
}

function cursorFor(cursors: Map<string, CursorState>, method: CursorState['method'], filterSha256: string,
  projectionSha256: string, cursor: string | null): number {
  if (cursor === null) return 0;
  const state = cursors.get(cursor);
  if (!state || state.method !== method) fail('CURSOR');
  if (state.filterSha256 !== filterSha256 || state.projectionSha256 !== projectionSha256) fail('CURSOR_STALE');
  return state.offset;
}

function rememberCursor(cursors: Map<string, CursorState>, state: CursorState): string {
  if (cursors.size >= MAX_CURSOR_COUNT) {
    const first = cursors.keys().next().value;
    if (first !== undefined) cursors.delete(first);
  }
  const cursor = randomUUID();
  cursors.set(cursor, state);
  return cursor;
}

function page<T>(input: {
  method: CursorState['method']; filter: unknown; projectionSha256: string; cursor: string | null;
  limit: number; items: readonly T[]; base: ExplorerPageBase; key: 'nodes' | 'edges' | 'records';
  cursors: Map<string, CursorState>; prefix: Record<string, unknown>;
  project?: (item: T) => T;
}): { items: readonly T[]; nextCursor: string | null } {
  const filterSha256 = stableObjectSha256(input.filter);
  const offset = cursorFor(input.cursors, input.method, filterSha256, input.projectionSha256, input.cursor);
  if (offset > input.items.length) fail('CURSOR_STALE');
  let selected = [...input.items.slice(offset, offset + input.limit)];
  const project = input.project ?? ((item: T): T => item);
  let nextCursor: string | null = offset + selected.length < input.items.length ? randomUUID() : null;
  const fits = () => {
    const output = { ...input.base, [input.key]: selected.map(project),
      ...input.prefix, totalCount: input.items.length, returnedCount: selected.length, nextCursor };
    return Buffer.byteLength(stableObjectText(output));
  };
  while (fits() > MAX_PAGE_BYTES) {
    if (selected.length <= 1) fail('ITEM_BYTES');
    selected = selected.slice(0, -1);
    if (nextCursor === null && offset + selected.length < input.items.length) nextCursor = randomUUID();
  }
  if (offset + selected.length < input.items.length) {
    const finalOffset = offset + selected.length;
    nextCursor = rememberCursor(input.cursors, { method: input.method, filterSha256,
      projectionSha256: input.projectionSha256, offset: finalOffset });
  } else {
    nextCursor = null;
  }
  return { items: freeze(selected.map(project)), nextCursor };
}

function objectDefNodeId(sourceCommitSha256: string, constructionSha256: string, objectDefId: string): string {
  return `object-def:${stableObjectSha256({ sourceCommitSha256, constructionSha256, objectDefId })}`;
}
function nativeNodeId(sourceCommitSha256: string, nativeObjectSha256: string): string {
  return `native-object:${stableObjectSha256({ sourceCommitSha256, nativeObjectSha256 })}`;
}
function passageNodeId(sourceCommitSha256: string, witness: SourceNativeSemanticWitness): string {
  return `passage:${stableObjectSha256({ sourceCommitSha256, witness })}`;
}
function edgeId(edge: Omit<SourceNativeOntExplorerEdge, 'id'>): string {
  const { admissionRecordSha256: _admissionRecordSha256, ...identity } = edge;
  return `edge:${stableObjectSha256(identity)}`;
}

function graph(state: ReturnType<typeof openProductState>, ledger: SourceNativeConstructionLedger,
  selectedRecord: SourceNativeConstructionAdmissionRecord | null = null): GraphModel {
  const nativeObjects = new Map<string, SourceNativeObject>(
    state.objectOnt.map.nativeObjects.map((object) => [object.nativeObjectSha256, object]));
  const nodes = new Map<string, InternalNode>();
  const edges = new Map<string, SourceNativeOntExplorerEdge>();
  const passages = new Map<string, { record: SourceNativeConstructionAdmissionRecord; witness: SourceNativeSemanticWitness }>();
  const addNode = (item: InternalNode): void => { if (!nodes.has(item.node.id)) nodes.set(item.node.id, item); };
  const addEdge = (item: Omit<SourceNativeOntExplorerEdge, 'id'>): void => {
    const id = edgeId(item);
    if (!edges.has(id)) edges.set(id, { id, ...item });
  };
  for (const object of nativeObjects.values()) {
    const id = nativeNodeId(state.objectOnt.commitSha256, object.nativeObjectSha256);
    addNode({ node: { id, kind: 'native-object', label: `${object.objectIdentity.sourceSystem}:`
      + `${object.objectIdentity.objectType}:${object.objectIdentity.externalId}`, state: 'active',
      nativeObject: { nativeObjectSha256: object.nativeObjectSha256, identity: object.objectIdentity } },
    scope: { sourceSystem: object.objectIdentity.sourceSystem, objectType: object.objectIdentity.objectType } });
  }
  const representatives = new Map<string, SourceNativeConstructionAdmissionRecord>();
  const graphRecords = selectedRecord === null ? ledger.activeRecords : [selectedRecord];
  for (const recordValue of [...graphRecords].sort((left, right) => compare(left.recordSha256, right.recordSha256))) {
    if (!representatives.has(recordValue.construction.constructionSha256)) {
      representatives.set(recordValue.construction.constructionSha256, recordValue);
    }
  }
  const witnessNode = (witness: SourceNativeSemanticWitness,
    recordValue: SourceNativeConstructionAdmissionRecord): string => {
    const object = nativeObjects.get(witness.nativeObjectSha256) ?? fail('BINDING');
    const id = passageNodeId(state.objectOnt.commitSha256, witness);
    addNode({ node: { id, kind: 'passage', label: `passage:${witness.evidence.textSha256}`, state: 'active',
      passage: { nativeObjectSha256: object.nativeObjectSha256, evidence: witness.evidence } },
    scope: { sourceSystem: object.objectIdentity.sourceSystem, objectType: object.objectIdentity.objectType } });
    passages.set(id, { record: recordValue, witness });
    const nativeId = nativeNodeId(state.objectOnt.commitSha256, object.nativeObjectSha256);
    addEdge({ kind: 'native-observation', role: 'native-observation', from: id, to: nativeId });
    return id;
  };
  for (const recordValue of representatives.values()) {
    const construction = recordValue.construction;
    const objectDefs = new Map(construction.objectDefs.map((object) => [object.id, object]));
    for (const objectDef of construction.objectDefs) {
      const id = objectDefNodeId(state.objectOnt.commitSha256, construction.constructionSha256, objectDef.id);
      addNode({ node: { id, kind: 'object-def', label: objectDef.name, state: 'active',
        objectDef: { id: objectDef.id, name: objectDef.name,
          aliases: objectDef.aliases.map((alias) => ({ value: alias.value, sourceSystem: alias.sourceSystem })) } },
      searchable: { name: objectDef.name,
        attachmentScopes: [objectDef.source,
          ...objectDef.aliases.map((alias) => alias.source),
          ...construction.claims.filter((claim) => claim.about === objectDef.id).map((claim) => claim.source)]
          .map((source) => nativeObjects.get(source.nativeObjectSha256)?.objectIdentity)
          .filter((identity): identity is SourceNativeObjectIdentity => identity !== undefined)
          .map((identity) => ({ sourceSystem: identity.sourceSystem, objectType: identity.objectType })),
        aliases: objectDef.aliases.map((alias) => ({ value: alias.value, sourceSystem: alias.sourceSystem })) } });
      const namePassage = witnessNode(objectDef.source, recordValue);
      addEdge({ kind: 'name-witness', role: 'name-witness', from: id, to: namePassage,
        constructionSha256: construction.constructionSha256, admissionRecordSha256: recordValue.recordSha256 });
      for (const alias of objectDef.aliases) {
        const aliasPassage = witnessNode(alias.source, recordValue);
        addEdge({ kind: 'alias-witness', role: 'alias-witness', from: id, to: aliasPassage,
          constructionSha256: construction.constructionSha256, admissionRecordSha256: recordValue.recordSha256 });
      }
    }
    for (const claim of construction.claims) {
      const objectDef = objectDefs.get(claim.about) ?? fail('BINDING');
      const objectDefId = objectDefNodeId(state.objectOnt.commitSha256, construction.constructionSha256, objectDef.id);
      const passage = witnessNode(claim.source, recordValue);
      addEdge({ kind: 'claim', role: 'claim', from: passage, to: objectDefId, claimId: claim.id,
        about: claim.about, predicate: claim.predicate, constructionSha256: construction.constructionSha256,
        admissionRecordSha256: recordValue.recordSha256, evidence: claim.source.evidence });
    }
  }
  return { nodes: [...nodes.values()].sort((left, right) => compare(left.node.id, right.node.id)),
    edges: [...edges.values()].sort((left, right) => compare(left.id, right.id)), nodeById: nodes, passages };
}

function matchesScope(item: InternalNode, selectedScope: { sourceSystem: string; objectType?: string } | null): boolean {
  if (selectedScope === null) return item.scope !== undefined || item.searchable !== undefined;
  if (item.scope && item.scope.sourceSystem === selectedScope.sourceSystem
    && (selectedScope.objectType === undefined || item.scope.objectType === selectedScope.objectType)) return true;
  return item.searchable?.attachmentScopes.some((attachment) => attachment.sourceSystem === selectedScope.sourceSystem
    && (selectedScope.objectType === undefined || attachment.objectType === selectedScope.objectType)) ?? false;
}

function matchesTerm(item: InternalNode, term: string,
  selectedScope: { sourceSystem: string; objectType?: string } | null): boolean {
  const searchable = item.searchable;
  if (!searchable) return false;
  if (!matchesScope(item, selectedScope)) return false;
  if (normalized(searchable.name) === normalized(term)) return true;
  return searchable.aliases.some((alias) => normalized(alias.value) === normalized(term)
    && (selectedScope === null || alias.sourceSystem === selectedScope.sourceSystem));
}

function witnessContext(recordValue: SourceNativeConstructionAdmissionRecord,
  witness: SourceNativeSemanticWitness): { conceptId: string; roles: readonly string[] } {
  const rolesByConcept = new Map<string, Set<string>>();
  const same = (candidate: SourceNativeSemanticWitness): boolean =>
    stableObjectText(candidate) === stableObjectText(witness);
  for (const object of recordValue.construction.objectDefs) {
    if (same(object.source)) {
      const roles = rolesByConcept.get(object.id) ?? new Set<string>();
      roles.add('name');
      rolesByConcept.set(object.id, roles);
    }
    for (const alias of object.aliases) {
      if (!same(alias.source)) continue;
      const roles = rolesByConcept.get(object.id) ?? new Set<string>();
      roles.add('alias');
      rolesByConcept.set(object.id, roles);
    }
  }
  for (const claim of recordValue.construction.claims) {
    if (!same(claim.source)) continue;
    const roles = rolesByConcept.get(claim.about) ?? new Set<string>();
    roles.add(claim.predicate);
    rolesByConcept.set(claim.about, roles);
  }
  const concepts = [...rolesByConcept.keys()].sort(compare);
  const conceptId = concepts[0] ?? fail('BINDING');
  return { conceptId, roles: [...(rolesByConcept.get(conceptId) ?? [])].sort(compare) };
}

export function openSourceNativeOntExplorer(
  options: ProductOptions,
  configuration: SourceNativeOntExplorerHistoricalConfiguration,
): SourceNativeOntExplorerHistorical;
export function openSourceNativeOntExplorer(
  options: ProductOptions,
  configuration: SourceNativeOntExplorerConfiguration,
): SourceNativeOntExplorer;
export function openSourceNativeOntExplorer(
  options: ProductOptions = {},
  configuration: SourceNativeOntExplorerConfiguration,
): SourceNativeOntExplorer | SourceNativeOntExplorerHistorical {
  const config = record(configuration, ['trustRegistry', 'knowledgeBranch', 'snapshot', 'recordSha256']);
  if (!Array.isArray(config.trustRegistry)) fail('INPUT');
  const trustRegistry = config.trustRegistry as readonly SourceNativeAdmissionTrustEntry[];
  admissionTrustRegistry(trustRegistry);
  const reviewerSha256 = reviewerConfigurationSha256(trustRegistry);
  const hasSnapshot = config.snapshot !== undefined;
  const hasRecord = config.recordSha256 !== undefined;
  if (hasSnapshot !== hasRecord) fail('INPUT');
  const selected = hasSnapshot && hasRecord ? {
    snapshot: explorerBinding(config.snapshot), recordSha256: hash(config.recordSha256),
  } : null;
  if (selected !== null && config.knowledgeBranch !== undefined
    && text(config.knowledgeBranch) !== selected.snapshot.knowledgeBranch) fail('BINDING');
  const state = selected === null ? openProductState(options) : openExactProductArtifactState(options);
  const knowledgeBranch = selected?.snapshot.knowledgeBranch
    ?? (config.knowledgeBranch === undefined ? undefined : text(config.knowledgeBranch));
  const reader = createConstructionLedgerReader(state, trustRegistry, knowledgeBranch);
  const cursors = new Map<string, CursorState>();
  const offered = new Map<string, OfferedRead>();
  const offeredByNode = new Map<string, string>();

  if (selected !== null) {
    if (reviewerSha256 !== selected.snapshot.reviewerConfigurationSha256
      || state.descriptor.ontId !== selected.snapshot.ontId
      || state.descriptor.namespace !== selected.snapshot.namespace
      || state.descriptor.artifactSha256 !== selected.snapshot.artifactSha256
      || state.objectOnt.commitSha256 !== selected.snapshot.sourceCommitSha256
      || state.objectOnt.replaySha256 !== selected.snapshot.sourceReplaySha256
      || state.objectOnt.catalog.sourceCatalogSha256 !== selected.snapshot.sourceCatalogSha256
      || state.objectOnt.map.nativeObjectMapSha256 !== selected.snapshot.nativeObjectMapSha256
      || selected.snapshot.knowledgeCommitSha256 === null
      || selected.snapshot.knowledgeReplaySha256 === null) fail('BINDING');
  }

  const offerRead = (nodeId: string, passage: { record: SourceNativeConstructionAdmissionRecord;
    witness: SourceNativeSemanticWitness }, projectionSha256: string): string => {
    const priorRef = offeredByNode.get(nodeId);
    const prior = priorRef === undefined ? undefined : offered.get(priorRef);
    if (prior && prior.projectionSha256 === projectionSha256
      && prior.recordSha256 === passage.record.recordSha256) return prior.ref;
    if (offered.size >= 1024) {
      const first = offered.keys().next().value;
      if (first !== undefined) {
        const evicted = offered.get(first);
        if (evicted) offeredByNode.delete(evicted.nodeId);
        offered.delete(first);
      }
    }
    const ref = `explorer:${randomUUID()}`;
    offered.set(ref, { ref, nodeId, projectionSha256, recordSha256: passage.record.recordSha256,
      witness: passage.witness });
    offeredByNode.set(nodeId, ref);
    return ref;
  };

  const observeForOperation = (): Observation => {
    try {
      return observe(state, reader, reviewerSha256, selected);
    } catch (error) {
      if (selected !== null) {
        cursors.clear();
        offered.clear();
        offeredByNode.clear();
      }
      throw error;
    }
  };

  const nodes = (input?: SourceNativeOntExplorerNodesInput): SourceNativeOntExplorerNodesResult => {
    const normalizedInput = normalizeNodesInput(input);
    const observation = observeForOperation();
    const common = base(observation, state);
    const filter = { term: normalizedInput.term, scope: normalizedInput.scope,
      focusId: normalizedInput.focusId, ids: normalizedInput.ids };
    const cursorFilter = { term: normalizedInput.term === null ? null : normalized(normalizedInput.term),
      scope: normalizedInput.scope, focusId: normalizedInput.focusId, ids: normalizedInput.ids };
    if (observation.availability === 'unavailable') {
      cursors.clear();
      return freeze({ ...common, kind: 'OpenOntologySourceNativeOntExplorerNodesV1' as const, filter,
        nodes: [], totalCount: null, returnedCount: 0, nextCursor: null });
    }
    if (selected !== null && observation.selectedRecord === null) fail('RECORD');
    const model = graph(state, observation.snapshot.ledger, observation.selectedRecord);
    let selectedNodes = [...model.nodes];
    if (normalizedInput.term !== null) {
      selectedNodes = selectedNodes.filter((item) => matchesTerm(item, normalizedInput.term!, normalizedInput.scope));
    } else if (normalizedInput.scope !== null) {
      selectedNodes = selectedNodes.filter((item) => matchesScope(item, normalizedInput.scope));
    } else if (normalizedInput.ids !== null) {
      const wanted = new Set(normalizedInput.ids);
      if (normalizedInput.ids.some((id) => !model.nodeById.has(id))) fail('NODE_ID');
      selectedNodes = selectedNodes.filter((item) => wanted.has(item.node.id));
    } else if (normalizedInput.focusId !== null) {
      if (!model.nodeById.has(normalizedInput.focusId)) fail('FOCUS');
      const adjacent = new Set([normalizedInput.focusId]);
      for (const edge of model.edges) {
        if (edge.from === normalizedInput.focusId) adjacent.add(edge.to);
        if (edge.to === normalizedInput.focusId) adjacent.add(edge.from);
      }
      selectedNodes = selectedNodes.filter((item) => adjacent.has(item.node.id));
    }
    const result = page({ method: 'nodes', filter: cursorFilter, projectionSha256: observation.projectionSha256,
      cursor: normalizedInput.cursor, limit: normalizedInput.limit,
      items: selectedNodes.map((item) => item.node), base: common, key: 'nodes', cursors,
      project: selected === null ? undefined : (item) => {
        if (item.kind !== 'passage') return item;
        const passage = model.passages.get(item.id) ?? fail('BINDING');
        return { ...item, readRef: offerRead(item.id, passage, observation.projectionSha256) };
      },
      prefix: { kind: 'OpenOntologySourceNativeOntExplorerNodesV1', filter } });
    return freeze({ ...common, kind: 'OpenOntologySourceNativeOntExplorerNodesV1' as const, filter,
      nodes: result.items, totalCount: selectedNodes.length, returnedCount: result.items.length,
      nextCursor: result.nextCursor, projectionSha256: observation.projectionSha256 });
  };

  const edges = (input?: SourceNativeOntExplorerEdgesInput): SourceNativeOntExplorerEdgesResult => {
    const normalizedInput = normalizeEdgesInput(input);
    const observation = observeForOperation();
    const common = base(observation, state);
    const filter = { focusId: normalizedInput.focusId };
    if (observation.availability === 'unavailable') {
      cursors.clear();
      return freeze({ ...common, kind: 'OpenOntologySourceNativeOntExplorerEdgesV1' as const, filter,
        edges: [], totalCount: null, returnedCount: 0, nextCursor: null });
    }
    if (selected !== null && observation.selectedRecord === null) fail('RECORD');
    const model = graph(state, observation.snapshot.ledger, observation.selectedRecord);
    let selectedEdges = [...model.edges];
    if (normalizedInput.focusId !== null) {
      if (!model.nodeById.has(normalizedInput.focusId)) fail('FOCUS');
      selectedEdges = selectedEdges.filter((edge) => edge.from === normalizedInput.focusId || edge.to === normalizedInput.focusId);
    }
    const result = page({ method: 'edges', filter, projectionSha256: observation.projectionSha256,
      cursor: normalizedInput.cursor, limit: normalizedInput.limit, items: selectedEdges,
      base: common, key: 'edges', cursors,
      prefix: { kind: 'OpenOntologySourceNativeOntExplorerEdgesV1', filter } });
    return freeze({ ...common, kind: 'OpenOntologySourceNativeOntExplorerEdgesV1' as const, filter,
      edges: result.items, totalCount: selectedEdges.length, returnedCount: result.items.length,
      nextCursor: result.nextCursor, projectionSha256: observation.projectionSha256 });
  };

  const records = (input?: SourceNativeOntExplorerRecordsInput): SourceNativeOntExplorerRecordsResult => {
    const normalizedInput = normalizeRecordsInput(input);
    const observation = observeForOperation();
    const common = base(observation, state);
    const filter = { constructionSha256: normalizedInput.constructionSha256, state: normalizedInput.state };
    if (observation.availability === 'unavailable') {
      cursors.clear();
      return freeze({ ...common, kind: 'OpenOntologySourceNativeOntExplorerRecordsV1' as const, filter,
        records: [], totalCount: null, returnedCount: 0, nextCursor: null });
    }
    const knownByRecord = new Map(observation.snapshot.ledger.activeRecords.map((item) => [item.recordSha256, item]));
    if (observation.selectedRecord !== null) {
      knownByRecord.set(observation.selectedRecord.recordSha256, observation.selectedRecord);
    }
    const selectedRecords = observation.snapshot.records.filter((item) =>
      (selected === null || item.recordSha256 === selected.recordSha256
        || item.blobSha256 === observation.selectedDisposition?.blobSha256)
      && (normalizedInput.constructionSha256 === null || item.constructionSha256 === normalizedInput.constructionSha256)
      && (normalizedInput.state === null || item.state === normalizedInput.state));
    const projected = selectedRecords.map((item): SourceNativeOntExplorerRecord => ({
      schemaVersion: 1, kind: 'OpenOntologySourceNativeOntExplorerRecordV1', blobSha256: item.blobSha256,
      recordSha256: item.recordSha256, constructionSha256: item.constructionSha256, state: item.state,
      reasonCodes: item.reasonCodes, supersedesRecordSha256s: item.supersedesRecordSha256s,
      supersededByRecordSha256s: item.supersededByRecordSha256s,
      conflictingObjectDefIds: item.conflictingObjectDefIds,
      constructionCoverage: item.recordSha256 === null ? null
        : knownByRecord.get(item.recordSha256) ? constructionCoverage(knownByRecord.get(item.recordSha256)!) : null,
    }));
    const result = page({ method: 'records', filter, projectionSha256: observation.projectionSha256,
      cursor: normalizedInput.cursor, limit: normalizedInput.limit, items: projected,
      base: common, key: 'records', cursors,
      prefix: { kind: 'OpenOntologySourceNativeOntExplorerRecordsV1', filter } });
    return freeze({ ...common, kind: 'OpenOntologySourceNativeOntExplorerRecordsV1' as const, filter,
      records: result.items, totalCount: projected.length, returnedCount: result.items.length,
      nextCursor: result.nextCursor, projectionSha256: observation.projectionSha256 });
  };

  const status = (): SourceNativeOntExplorerStatusResult => {
    const observation = observeForOperation();
    const common = base(observation, state);
    if (observation.availability === 'unavailable') cursors.clear();
    return freeze({ ...common, kind: 'OpenOntologySourceNativeOntExplorerStatusV1' as const,
      state: observation.availability === 'unavailable' ? 'unavailable' : observation.snapshot.ledger.state,
      recordCount: observation.availability === 'unavailable' ? null : observation.snapshot.records.length,
      activeRecordCount: observation.availability === 'unavailable'
        ? null : observation.snapshot.ledger.activeRecords.length });
  };

  const read = (input: { ref: string }): SourceNativeOntExplorerReadResult => {
    if (selected === null) fail('REFERENCE');
    const value = record(input, ['ref']);
    const ref = text(value.ref, 512);
    if (!ref.startsWith('explorer:')) fail('REFERENCE');
    const offeredRead = offered.get(ref);
    if (!offeredRead) fail('REFERENCE');
    const before = observeForOperation();
    if (before.availability === 'unavailable' || before.selectedRecord === null
      || before.selectedRecord.recordSha256 !== offeredRead.recordSha256
      || before.projectionSha256 !== offeredRead.projectionSha256) fail('REFERENCE_STALE');
    const reference = offeredRead.witness.evidence;
    const object = state.objectOnt.map.nativeObjects.find((item) =>
      item.nativeObjectSha256 === offeredRead.witness.nativeObjectSha256) ?? fail('BINDING');
    const source = state.objectOnt.sources.find((item) => item.relativePath === reference.sourceRef)
      ?? fail('BINDING');
    const bytes = Buffer.from(source.content);
    const exact = bytes.subarray(reference.byteStart, reference.byteEnd);
    const exactText = exact.toString('utf8');
    if (object.objectIdentity.namespace !== state.descriptor.namespace
      || object.relativePath !== reference.sourceRef || object.sourceSha256 !== reference.sourceSha256
      || source.sourceSha256 !== reference.sourceSha256 || objectBytesSha256(bytes) !== reference.sourceSha256
      || reference.byteStart < 0 || reference.byteEnd > bytes.length
      || reference.byteEnd <= reference.byteStart || reference.byteEnd - reference.byteStart > 64 * 1024
      || objectBytesSha256(exact) !== reference.textSha256 || !Buffer.from(exactText).equals(exact)
      || !object.fields.some((field) => field.evidence.relativePath === reference.sourceRef
        && field.evidence.sourceSha256 === reference.sourceSha256
        && field.evidence.byteStart <= reference.byteStart
        && field.evidence.byteEnd >= reference.byteEnd)) fail('EVIDENCE');
    const context = witnessContext(before.selectedRecord, offeredRead.witness);
    const knowledgeCommitSha256 = before.binding.knowledgeCommitSha256 ?? fail('BINDING');
    const knowledgeReplaySha256 = before.binding.knowledgeReplaySha256 ?? fail('BINDING');
    const core = {
      schemaVersion: 1 as const,
      kind: 'OpenOntologySourceNativeOntExplorerReadV1' as const,
      ref,
      historicalSnapshot: true as const,
      currentNavigationEligible: false as const,
      exactText,
      evidence: reference,
      selectedBinding: before.binding,
      binding: {
        kind: 'OpenOntologySourceNativeOntExplorerPassageBindingV1' as const,
        conceptId: context.conceptId, roles: context.roles,
        nativeObject: object.objectIdentity, nativeObjectSha256: object.nativeObjectSha256,
        constructionSha256: before.selectedRecord.construction.constructionSha256,
        admissionRecordSha256: before.selectedRecord.recordSha256,
        sourceCommitSha256: before.binding.sourceCommitSha256,
        sourceReplaySha256: before.binding.sourceReplaySha256,
        knowledgeBranch: before.binding.knowledgeBranch,
        knowledgeCommitSha256,
        knowledgeReplaySha256,
        navigationOnly: true as const, exactSourcesRemainAuthority: true as const,
      },
    };
    const after = observeForOperation();
    if (after.availability === 'unavailable' || after.projectionSha256 !== before.projectionSha256
      || after.knowledgeVersion !== before.knowledgeVersion
      || after.knowledgeChecksumSha256 !== before.knowledgeChecksumSha256
      || after.sourceVersion !== before.sourceVersion
      || after.sourceChecksumSha256 !== before.sourceChecksumSha256) fail('REFERENCE_STALE');
    return freeze({ ...core, receiptSha256: stableObjectSha256(core) });
  };

  return selected === null ? freeze({ nodes, edges, records, status })
    : freeze({ nodes, edges, records, status, read });
}
