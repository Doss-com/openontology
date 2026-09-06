/** Immutable object-native Ont commits, branch refs, replay, and merge planning. */
import { constants as zstdConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import {
  ASSERTION_V,
  STORE_V,
  compareEntries,
  entryProblem,
} from './assertion-envelope.mjs';
import {
  objectBytesSha256,
  stableObjectSha256,
  stableObjectText,
} from './canonical-content.mjs';
import type {
  AssertionEntry,
} from './assertion-envelope.mjs';
import type {
  ObjectBackend,
  ObjectBackendCapabilities,
  ObjectBackendInput,
  ObjectReadResult,
  ObjectWriteReceipt,
} from './object-storage-backend.mjs';

export { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';

export interface AssertionSegmentDescriptor {
  schemaVersion: 1;
  kind: 'OpenOntologyAssertionSegmentDescriptorV1';
  key: string;
  logicalPath: string;
  storedSha256: string;
  storedByteLength: number;
  uncompressedSha256: string;
  uncompressedByteLength: number;
  lineCount: number;
  assertionLinesSha256: string;
}

export interface BlobDescriptor {
  schemaVersion: 1;
  kind: 'OpenOntologyBlobDescriptorV1';
  key: string;
  logicalPath: string;
  storedSha256: string;
  byteLength: number;
  mediaType: string;
}

export interface ObjectCommit {
  schemaVersion: 1;
  kind: 'OpenOntologyObjectCommitV1';
  formatVersion: 'object/v1';
  ontId: string;
  parents: string[];
  assertionEnvelopeVersion: string;
  storeManifestVersion: string;
  ontManifest: BlobDescriptor;
  segments: AssertionSegmentDescriptor[];
  blobs: BlobDescriptor[];
}

export interface BranchRef {
  schemaVersion: 1;
  kind: 'OpenOntologyBranchRefV1';
  ontId: string;
  branch: string;
  commitSha256: string;
  replayStatus: 'CLEAN' | 'CONFLICT';
  replaySha256: string;
}

export interface LoadedAssertionSegment {
  descriptor: AssertionSegmentDescriptor;
  bytes: Buffer;
  records: AssertionRecord[];
}

export interface AssertionRecord {
  entry: AssertionEntry;
  line: string;
  lineSha256: string;
}

interface CommitRecord {
  commitSha256: string;
  key: string;
  byteLength: number;
  commit: ObjectCommit;
}

export interface ReplayConflict {
  type: string;
  identity: string;
  variants: string[];
}

export interface ReplayGraph {
  schemaVersion: 1;
  kind: 'OpenOntologyObjectReplayV1';
  ontId: string;
  tipCommitSha256: string;
  ontManifestSha256: string;
  commitOrder: string[];
  segmentKeys: string[];
  blobKeys: string[];
  assertionRows: Array<{ assertionId: string; lineSha256s: string[] }>;
  conflicts: ReplayConflict[];
  status: 'CLEAN' | 'CONFLICT';
  replaySha256: string;
  manifest: { descriptor: BlobDescriptor; bytes: Buffer };
  segments: LoadedAssertionSegment[];
  blobs: Array<{ descriptor: BlobDescriptor; bytes: Buffer }>;
  ledgerFiles: Array<{ logicalPath: string; bytes: Buffer; sha256: string; segmentKeys: string[] }>;
  entries: AssertionEntry[];
}

export interface ReplayMetadataGraph {
  schemaVersion: 1;
  kind: 'OpenOntologyObjectReplayMetadataV1';
  replayIdentity: Record<string, unknown>;
  ontId: string;
  tipCommitSha256: string;
  ontManifestSha256: string;
  commitOrder: string[];
  segmentKeys: string[];
  blobKeys: string[];
  assertionRows: Array<{ assertionId: string; lineSha256s: string[] }>;
  conflicts: ReplayConflict[];
  status: 'CLEAN' | 'CONFLICT';
  replaySha256: string;
  manifestDescriptor: BlobDescriptor;
  segmentDescriptors: AssertionSegmentDescriptor[];
  blobDescriptors: BlobDescriptor[];
  segments: LoadedAssertionSegment[];
  ledgerFiles: Array<{ logicalPath: string; bytes: Buffer; sha256: string; segmentKeys: string[] }>;
  entries: AssertionEntry[];
  blobBytesLoaded: number;
  payloadBlobBytesValidated: boolean;
}

export interface ReplayIndexCheckpoint {
  schemaVersion: 1;
  kind: 'OpenOntologyObjectReplayIndexCheckpointV1';
  replayIdentity: Record<string, unknown>;
  manifestDescriptor: BlobDescriptor;
  blobDescriptors: BlobDescriptor[];
  checkpointSha256: string;
}

export interface ReplayIndexCheckpointReceipt {
  schemaVersion: 1;
  kind: 'OpenOntologyObjectReplayIndexCheckpointReceiptV1';
  key: string;
  checkpointSha256: string;
  replaySha256: string;
  tipCommitSha256: string;
  bytesSha256: string;
  byteLength: number;
  replayed: boolean;
}

export interface ReplayIndexCheckpointRead {
  checkpoint: ReplayIndexCheckpoint;
  replayMetadata: ReplayMetadataGraph;
  key: string;
  version: string;
  checksumSha256: string;
  byteLength: number;
}

export interface ReplayMetadataCheckpointWriteResult {
  ref: BranchRef;
  version: string;
  previousVersion?: string | null;
  key: string;
  replayMetadata: ReplayMetadataGraph;
  replayMetadataSource: 'graph';
  replayIndexCheckpointSha256: string;
  replayIndexCheckpointByteLength: number;
}

export interface RefWriteResult {
  ref: BranchRef;
  version: string;
  previousVersion?: string | null;
  key: string;
  [key: string]: unknown;
}

interface MergePlanBase {
  schemaVersion: 1;
  kind: 'OpenOntologyMergePlanV1';
  ontId: string;
  parents: string[];
  conflicts: ReplayConflict[];
}
interface FastForwardMergePlan extends MergePlanBase {
  status: 'FAST_FORWARD';
  targetCommitSha256: string;
}
interface ConflictMergePlan extends MergePlanBase {
  status: 'CONFLICT';
}
interface CleanMergePlan extends MergePlanBase {
  status: 'CLEAN';
  prospectiveCommitSha256: string;
  prospectiveReplaySha256: string;
}
type MergePlan = FastForwardMergePlan | ConflictMergePlan | CleanMergePlan;

interface CommitInput {
  ontId: string;
  parents?: string[];
  ontManifest: unknown;
  segments?: unknown[];
  blobs?: unknown[];
}

export interface ObjectOntStore {
  backendCapabilities: ObjectBackendCapabilities;
  putAssertionSegment(input: { logicalPath: string; jsonlBytes: ObjectBackendInput }): AssertionSegmentDescriptor;
  readAssertionSegment(descriptor: unknown): LoadedAssertionSegment;
  putBlob(input: { logicalPath: string; bytes: ObjectBackendInput; mediaType?: string }): BlobDescriptor;
  readBlob(descriptor: unknown, options?: { manifest?: boolean }): { descriptor: BlobDescriptor; bytes: Buffer };
  readBlobRange(descriptor: unknown, options?: { start?: number; end?: number | null }): {
    descriptor: BlobDescriptor;
    bytes: Buffer;
    range: { start: number; end: number };
    objectChecksumSha256: string;
    deliveredSha256: string;
    objectChecksumBound: true;
    completeObjectBytesVerified: boolean;
  };
  writeCommit(input: CommitInput): { ontId: string; commitSha256: string; key: string; byteLength: number; replayed: boolean };
  writeCommitMetadata(input: CommitInput): { ontId: string; commitSha256: string; key: string; byteLength: number; replayed: boolean };
  readCommit(commitSha256: string): { commitSha256: string; key: string; byteLength: number; commit: ObjectCommit };
  loadGraph(tipCommitSha256: string, virtualCommits?: Map<string, CommitRecord>): {
    commits: Map<string, CommitRecord>;
    order: string[];
    ontId: string;
  };
  replay(tipCommitSha256: string): ReplayGraph;
  replayMetadata(tipCommitSha256: string): ReplayMetadataGraph;
  planMerge(input: { leftCommitSha256: string; rightCommitSha256: string }): MergePlan;
  merge(input: { leftCommitSha256: string; rightCommitSha256: string }): Record<string, unknown>;
  readRef(input: { ontId: string; branch: string }): RefReadResult | null;
  readRefMetadata(input: { ontId: string; branch: string }): RefReadResult | null;
  readRefMetadataSnapshot(input: { ontId: string; branch: string }): ReplayMetadataSnapshot | null;
  readRefMetadataCheckpointSnapshot(input: { ontId: string; branch: string }): ReplayMetadataCheckpointSnapshot | null;
  writeReplayIndexCheckpoint(replayMetadata: ReplayMetadataGraph): ReplayIndexCheckpointReceipt;
  readReplayIndexCheckpoint(input: {
    ontId: string;
    tipCommitSha256: string;
    replaySha256: string;
  }): ReplayIndexCheckpointRead | null;
  compareAndSwapRef(input: RefUpdateInput): RefWriteResult;
  compareAndSwapRefMetadata(input: RefUpdateInput): RefWriteResult;
  compareAndSwapRefMetadataCheckpointed(input: RefUpdateInput): ReplayMetadataCheckpointWriteResult;
}

export interface RefReadResult {
  ref: BranchRef;
  version: string;
  key: string;
  checksumSha256: string;
}

export interface ReplayMetadataSnapshot extends RefReadResult {
  replayMetadata: ReplayMetadataGraph;
}

export interface ReplayMetadataCheckpointSnapshot extends ReplayMetadataSnapshot {
  replayMetadataSource: 'graph' | 'checkpoint';
  replayIndexCheckpointSha256: string | null;
  replayIndexCheckpointByteLength: number | null;
}

interface RefUpdateInput {
  ontId: string;
  branch: string;
  expectedVersion?: string | null;
  commitSha256: string;
  allowConflicts?: boolean;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const compare = (left: unknown, right: unknown): number => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code: string): never => {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  throw error;
};
const freeze = <T,>(value: T): T => {
  if (ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const clone = <T,>(value: T): T => structuredClone(value);

function exactKeys(value: unknown, keys: readonly string[], code: string): void {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stableObjectText(Object.keys(record ?? {}).sort(compare)) !== stableObjectText([...keys].sort(compare))) fail(code);
}

function validateSha256(value: unknown, code: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return fail(code);
  return value;
}

function validateIdentity(value: unknown, code: string): string {
  if (typeof value !== 'string' || !ID.test(value)) return fail(code);
  return value;
}

function validateLogicalPath(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0')
    || value.startsWith('/') || value.includes('\\')) return fail(code);
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) fail(code);
  return value;
}

function exactBytes(value: ObjectBackendInput): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  return fail('OBJECT_ONT_BYTES');
}

function parseAssertionJsonl(bytesInput: ObjectBackendInput): { bytes: Buffer; records: AssertionRecord[] } {
  const bytes = exactBytes(bytesInput);
  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) fail('OBJECT_ONT_SEGMENT_JSONL');
  const lines = bytes.toString('utf8').split('\n');
  lines.pop();
  if (!lines.length || lines.some((line) => !line)) fail('OBJECT_ONT_SEGMENT_JSONL');
  const records = lines.map((line): AssertionRecord => {
    let entry: AssertionEntry | undefined;
    try { entry = JSON.parse(line) as AssertionEntry; } catch { fail('OBJECT_ONT_SEGMENT_JSONL'); }
    if (entry === undefined) return fail('OBJECT_ONT_SEGMENT_ASSERTION');
    if (entryProblem(entry) !== null) return fail('OBJECT_ONT_SEGMENT_ASSERTION');
    return {
      entry,
      line,
      lineSha256: objectBytesSha256(Buffer.from(line)),
    };
  });
  const variants = new Map<string, string>();
  for (const record of records) {
    const prior = variants.get(record.entry.id);
    if (prior && prior !== record.lineSha256) fail('OBJECT_ONT_SEGMENT_IDENTITY_VARIANT');
    variants.set(record.entry.id, record.lineSha256);
  }
  return { bytes, records };
}

const zstdOptions = Object.freeze({
  params: Object.freeze({
    [zstdConstants.ZSTD_c_compressionLevel]: 9,
    [zstdConstants.ZSTD_c_checksumFlag]: 1,
    [zstdConstants.ZSTD_c_contentSizeFlag]: 1,
    [zstdConstants.ZSTD_c_nbWorkers]: 0,
  }),
});

function segmentDigestRows(records: AssertionRecord[]): Array<{ assertionId: string; lineSha256: string }> {
  return records.map((record) => ({ assertionId: record.entry.id, lineSha256: record.lineSha256 }));
}

function validateSegmentDescriptor(value: unknown): AssertionSegmentDescriptor {
  const descriptor = value as AssertionSegmentDescriptor;
  exactKeys(value, [
    'schemaVersion', 'kind', 'key', 'logicalPath', 'storedSha256', 'storedByteLength',
    'uncompressedSha256', 'uncompressedByteLength', 'lineCount', 'assertionLinesSha256',
  ], 'OBJECT_ONT_SEGMENT_DESCRIPTOR');
  if (descriptor.schemaVersion !== 1 || descriptor.kind !== 'OpenOntologyAssertionSegmentDescriptorV1'
    || validateLogicalPath(descriptor.logicalPath, 'OBJECT_ONT_SEGMENT_DESCRIPTOR').startsWith('ledger/') !== true
    || !descriptor.logicalPath.endsWith('.jsonl')
    || descriptor.key !== `segments/sha256/${validateSha256(descriptor.storedSha256, 'OBJECT_ONT_SEGMENT_DESCRIPTOR').slice(7)}.jsonl.zst`
    || !Number.isSafeInteger(descriptor.storedByteLength) || descriptor.storedByteLength < 1
    || !SHA256.test(descriptor.uncompressedSha256 ?? '')
    || !Number.isSafeInteger(descriptor.uncompressedByteLength) || descriptor.uncompressedByteLength < 1
    || !Number.isSafeInteger(descriptor.lineCount) || descriptor.lineCount < 1
    || !SHA256.test(descriptor.assertionLinesSha256 ?? '')) fail('OBJECT_ONT_SEGMENT_DESCRIPTOR');
  return descriptor;
}

function validateBlobDescriptor(value: unknown, { manifest = false }: { manifest?: boolean } = {}): BlobDescriptor {
  const descriptor = value as BlobDescriptor;
  exactKeys(value, [
    'schemaVersion', 'kind', 'key', 'logicalPath', 'storedSha256', 'byteLength', 'mediaType',
  ], 'OBJECT_ONT_BLOB_DESCRIPTOR');
  if (descriptor.schemaVersion !== 1 || descriptor.kind !== 'OpenOntologyBlobDescriptorV1'
    || descriptor.key !== `blobs/sha256/${validateSha256(descriptor.storedSha256, 'OBJECT_ONT_BLOB_DESCRIPTOR').slice(7)}`
    || !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1
    || typeof descriptor.mediaType !== 'string' || !descriptor.mediaType
    || validateLogicalPath(descriptor.logicalPath, 'OBJECT_ONT_BLOB_DESCRIPTOR') !== descriptor.logicalPath
    || (manifest ? descriptor.logicalPath !== 'oont.json' : !descriptor.logicalPath.startsWith('blobs/'))) {
    fail('OBJECT_ONT_BLOB_DESCRIPTOR');
  }
  return descriptor;
}

function descriptorOrder(left: AssertionSegmentDescriptor | BlobDescriptor, right: AssertionSegmentDescriptor | BlobDescriptor): number {
  return compare(left.logicalPath, right.logicalPath) || compare(left.key, right.key);
}

function canonicalDescriptors<T extends AssertionSegmentDescriptor | BlobDescriptor>(
  values: unknown,
  validator: (value: unknown) => T,
  code: string,
): T[] {
  if (!Array.isArray(values)) return fail(code);
  const normalized = (values as unknown[]).map((value) => clone(validator(value))).sort(descriptorOrder);
  const identities = normalized.map((value) => `${value.logicalPath}\0${value.key}`);
  if (new Set(identities).size !== identities.length) fail(code);
  return normalized;
}

function validateCommitCore(value: unknown): ObjectCommit {
  const commit = value as ObjectCommit;
  exactKeys(value, [
    'schemaVersion', 'kind', 'formatVersion', 'ontId', 'parents', 'assertionEnvelopeVersion',
    'storeManifestVersion', 'ontManifest', 'segments', 'blobs',
  ], 'OBJECT_ONT_COMMIT');
  if (commit.schemaVersion !== 1 || commit.kind !== 'OpenOntologyObjectCommitV1'
    || commit.formatVersion !== 'object/v1' || commit.assertionEnvelopeVersion !== ASSERTION_V
    || commit.storeManifestVersion !== STORE_V) fail('OBJECT_ONT_COMMIT');
  validateIdentity(commit.ontId, 'OBJECT_ONT_COMMIT');
  if (!Array.isArray(commit.parents) || commit.parents.length > 2
    || commit.parents.some((parent) => !SHA256.test(parent))
    || new Set(commit.parents).size !== commit.parents.length
    || stableObjectText(commit.parents) !== stableObjectText([...commit.parents].sort(compare))) fail('OBJECT_ONT_COMMIT');
  validateBlobDescriptor(commit.ontManifest, { manifest: true });
  const segments = canonicalDescriptors(commit.segments, validateSegmentDescriptor, 'OBJECT_ONT_COMMIT');
  const blobs = canonicalDescriptors(commit.blobs, (row) => validateBlobDescriptor(row), 'OBJECT_ONT_COMMIT');
  if (stableObjectText(segments) !== stableObjectText(commit.segments)
    || stableObjectText(blobs) !== stableObjectText(commit.blobs)) fail('OBJECT_ONT_COMMIT');
  return commit;
}

function commitKey(commitSha256: string): string {
  return `commits/sha256/${validateSha256(commitSha256, 'OBJECT_ONT_COMMIT_ID').slice(7)}.json`;
}

function refKey(ontId: string, branch: string): string {
  return `refs/${validateIdentity(ontId, 'OBJECT_ONT_REF')}/${validateIdentity(branch, 'OBJECT_ONT_REF')}.json`;
}

function replayIndexKey(replaySha256: string): string {
  return `replay-indexes/sha256/${validateSha256(
    replaySha256,
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT',
  ).slice(7)}.json`;
}

function validateReplayIndexCheckpoint(value: unknown, {
  ontId,
  tipCommitSha256,
  replaySha256,
}: {
  ontId?: string;
  tipCommitSha256?: string;
  replaySha256?: string;
} = {}): ReplayIndexCheckpoint {
  exactKeys(value, [
    'schemaVersion', 'kind', 'replayIdentity', 'manifestDescriptor',
    'blobDescriptors', 'checkpointSha256',
  ], 'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT');
  const checkpoint = value as ReplayIndexCheckpoint;
  const { checkpointSha256, ...core } = checkpoint;
  const replay = checkpoint.replayIdentity;
  exactKeys(replay, [
    'schemaVersion', 'kind', 'ontId', 'tipCommitSha256', 'ontManifestSha256',
    'commitOrder', 'segmentKeys', 'blobKeys', 'assertionRows', 'conflicts',
  ], 'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT');
  const replayRecord = replay as Record<string, unknown>;
  const commitOrder = replayRecord.commitOrder;
  const segmentKeys = replayRecord.segmentKeys;
  const blobKeys = replayRecord.blobKeys;
  const assertionRows = replayRecord.assertionRows;
  const conflicts = replayRecord.conflicts;
  const ontManifestSha256 = replayRecord.ontManifestSha256;
  if (checkpoint.schemaVersion !== 1
    || checkpoint.kind !== 'OpenOntologyObjectReplayIndexCheckpointV1'
    || !SHA256.test(checkpointSha256 ?? '')
    || stableObjectSha256(core) !== checkpointSha256
    || replayRecord.schemaVersion !== 1
    || replayRecord.kind !== 'OpenOntologyObjectReplayV1'
    || validateIdentity(replayRecord.ontId, 'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT') !== ontId
    || replayRecord.tipCommitSha256 !== tipCommitSha256
    || stableObjectSha256(replay) !== replaySha256
    || typeof ontManifestSha256 !== 'string' || !SHA256.test(ontManifestSha256)
    || !Array.isArray(commitOrder) || commitOrder.length < 1
    || commitOrder.at(-1) !== tipCommitSha256
    || new Set(commitOrder).size !== commitOrder.length
    || commitOrder.some((commit) => typeof commit !== 'string' || !SHA256.test(commit))
    || !Array.isArray(segmentKeys) || segmentKeys.length !== 0
    || !Array.isArray(blobKeys)
    || blobKeys.some((key) => typeof key !== 'string')
    || stableObjectText([...blobKeys].sort(compare)) !== stableObjectText(blobKeys)
    || !Array.isArray(assertionRows) || assertionRows.length !== 0
    || !Array.isArray(conflicts) || conflicts.length !== 0) {
    fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT');
  }
  const blobKeysValue = blobKeys as unknown[];
  const manifestDescriptor = clone(validateBlobDescriptor(
    checkpoint.manifestDescriptor,
    { manifest: true },
  ));
  const blobDescriptors = canonicalDescriptors(
    checkpoint.blobDescriptors,
    (row) => validateBlobDescriptor(row),
    'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT',
  );
  if (manifestDescriptor.storedSha256 !== ontManifestSha256
    || stableObjectText(blobDescriptors) !== stableObjectText(checkpoint.blobDescriptors)
    || stableObjectText(blobDescriptors.map((row) => row.key).sort(compare))
      !== stableObjectText(blobKeysValue)) {
    fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT');
  }
  return freeze(clone(checkpoint));
}

function replayMetadataFromIndexCheckpoint(checkpoint: ReplayIndexCheckpoint): ReplayMetadataGraph {
  const replayIdentity = clone(checkpoint.replayIdentity);
  const identity = replayIdentity as {
    ontId: string;
    tipCommitSha256: string;
    ontManifestSha256: string;
    commitOrder: string[];
    segmentKeys: string[];
    blobKeys: string[];
    assertionRows: Array<{ assertionId: string; lineSha256s: string[] }>;
    conflicts: ReplayConflict[];
  };
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyObjectReplayMetadataV1',
    replayIdentity: freeze(replayIdentity),
    ontId: identity.ontId,
    tipCommitSha256: identity.tipCommitSha256,
    ontManifestSha256: identity.ontManifestSha256,
    commitOrder: freeze([...identity.commitOrder]),
    segmentKeys: freeze([...identity.segmentKeys]),
    blobKeys: freeze([...identity.blobKeys]),
    assertionRows: freeze(clone(identity.assertionRows)),
    conflicts: freeze(clone(identity.conflicts)),
    status: 'CLEAN',
    replaySha256: stableObjectSha256(replayIdentity),
    manifestDescriptor: freeze(clone(checkpoint.manifestDescriptor)),
    segmentDescriptors: freeze([]),
    blobDescriptors: freeze(clone(checkpoint.blobDescriptors)),
    segments: freeze([]),
    ledgerFiles: freeze([]),
    entries: freeze([]),
    blobBytesLoaded: 0,
    payloadBlobBytesValidated: false,
  });
}

function validateRef(value: unknown, { ontId, branch }: { ontId?: string; branch?: string } = {}): BranchRef {
  const ref = value as BranchRef;
  exactKeys(value, [
    'schemaVersion', 'kind', 'ontId', 'branch', 'commitSha256', 'replayStatus', 'replaySha256',
  ], 'OBJECT_ONT_REF');
  if (ref.schemaVersion !== 1 || ref.kind !== 'OpenOntologyBranchRefV1'
    || validateIdentity(ref.ontId, 'OBJECT_ONT_REF') !== ref.ontId
    || validateIdentity(ref.branch, 'OBJECT_ONT_REF') !== ref.branch
    || !SHA256.test(ref.commitSha256 ?? '') || !['CLEAN', 'CONFLICT'].includes(ref.replayStatus)
    || !SHA256.test(ref.replaySha256 ?? '')
    || ontId && ref.ontId !== ontId || branch && ref.branch !== branch) fail('OBJECT_ONT_REF');
  return ref;
}

function readBackendBytes(backend: ObjectBackend, key: string, expectedSha256: string, code: string): ObjectReadResult {
  const result = backend.get(key);
  if (result.checksumSha256 !== expectedSha256 || objectBytesSha256(result.bytes) !== expectedSha256) fail(code);
  return result;
}

function conflictOrder(left: ReplayConflict, right: ReplayConflict): number {
  return compare(left.type, right.type) || compare(left.identity, right.identity);
}

export function openObjectOntStore({ backend: backendInput }: { backend?: ObjectBackend } = {}): ObjectOntStore {
  if (!backendInput || typeof backendInput.get !== 'function' || typeof backendInput.putIfAbsent !== 'function'
    || typeof backendInput.compareAndSwap !== 'function' || typeof backendInput.head !== 'function') return fail('OBJECT_ONT_BACKEND');
  const backend = backendInput;

  const putAssertionSegment = ({ logicalPath, jsonlBytes }: {
    logicalPath: string;
    jsonlBytes: ObjectBackendInput;
  }): AssertionSegmentDescriptor => {
    const parsed = parseAssertionJsonl(jsonlBytes);
    validateLogicalPath(logicalPath, 'OBJECT_ONT_SEGMENT_DESCRIPTOR');
    if (!logicalPath.startsWith('ledger/') || !logicalPath.endsWith('.jsonl')) fail('OBJECT_ONT_SEGMENT_DESCRIPTOR');
    const stored = zstdCompressSync(parsed.bytes, zstdOptions);
    const storedSha256 = objectBytesSha256(stored);
    const key = `segments/sha256/${storedSha256.slice(7)}.jsonl.zst`;
    const write = backend.putIfAbsent(key, stored);
    if (write.checksumSha256 !== storedSha256) fail('OBJECT_ONT_SEGMENT_WRITE');
    return freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyAssertionSegmentDescriptorV1',
      key,
      logicalPath,
      storedSha256,
      storedByteLength: stored.length,
      uncompressedSha256: objectBytesSha256(parsed.bytes),
      uncompressedByteLength: parsed.bytes.length,
      lineCount: parsed.records.length,
      assertionLinesSha256: stableObjectSha256(segmentDigestRows(parsed.records)),
    });
  };

  const readAssertionSegment = (descriptorInput: unknown): LoadedAssertionSegment => {
    const descriptor = validateSegmentDescriptor(descriptorInput);
    const stored = readBackendBytes(backend, descriptor.key, descriptor.storedSha256, 'OBJECT_ONT_SEGMENT_READ');
    if (stored.bytes.length !== descriptor.storedByteLength) fail('OBJECT_ONT_SEGMENT_READ');
    let uncompressed;
    try { uncompressed = zstdDecompressSync(stored.bytes); } catch { return fail('OBJECT_ONT_SEGMENT_READ'); }
    const parsed = parseAssertionJsonl(uncompressed);
    if (parsed.bytes.length !== descriptor.uncompressedByteLength
      || objectBytesSha256(parsed.bytes) !== descriptor.uncompressedSha256
      || parsed.records.length !== descriptor.lineCount
      || stableObjectSha256(segmentDigestRows(parsed.records)) !== descriptor.assertionLinesSha256) {
      fail('OBJECT_ONT_SEGMENT_READ');
    }
    return freeze({ descriptor: clone(descriptor), bytes: parsed.bytes, records: parsed.records });
  };

  const putBlob = ({ logicalPath, bytes: bytesInput, mediaType = 'application/octet-stream' }: {
    logicalPath: string;
    bytes: ObjectBackendInput;
    mediaType?: string;
  }): BlobDescriptor => {
    validateLogicalPath(logicalPath, 'OBJECT_ONT_BLOB_DESCRIPTOR');
    if (logicalPath !== 'oont.json' && !logicalPath.startsWith('blobs/')) fail('OBJECT_ONT_BLOB_DESCRIPTOR');
    if (typeof mediaType !== 'string' || !mediaType) fail('OBJECT_ONT_BLOB_DESCRIPTOR');
    const bytes = exactBytes(bytesInput);
    if (!bytes.length) fail('OBJECT_ONT_BLOB_DESCRIPTOR');
    const storedSha256 = objectBytesSha256(bytes);
    const key = `blobs/sha256/${storedSha256.slice(7)}`;
    const write = backend.putIfAbsent(key, bytes);
    if (write.checksumSha256 !== storedSha256) fail('OBJECT_ONT_BLOB_WRITE');
    return freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyBlobDescriptorV1',
      key,
      logicalPath,
      storedSha256,
      byteLength: bytes.length,
      mediaType,
    });
  };

  const readBlob = (descriptorInput: unknown, options: { manifest?: boolean } = {}): { descriptor: BlobDescriptor; bytes: Buffer } => {
    const descriptor = validateBlobDescriptor(descriptorInput, options);
    const result = readBackendBytes(backend, descriptor.key, descriptor.storedSha256, 'OBJECT_ONT_BLOB_READ');
    if (result.bytes.length !== descriptor.byteLength) fail('OBJECT_ONT_BLOB_READ');
    return freeze({ descriptor: clone(descriptor), bytes: result.bytes });
  };

  const readBlobRange = (descriptorInput: unknown, { start = 0, end = null }: {
    start?: number;
    end?: number | null;
  } = {}): {
    descriptor: BlobDescriptor;
    bytes: Buffer;
    range: { start: number; end: number };
    objectChecksumSha256: string;
    deliveredSha256: string;
    objectChecksumBound: true;
    completeObjectBytesVerified: boolean;
  } => {
    const descriptor = validateBlobDescriptor(descriptorInput);
    const finalEnd = end === null ? descriptor.byteLength : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(finalEnd)
      || start < 0 || finalEnd <= start || finalEnd > descriptor.byteLength) {
      fail('OBJECT_ONT_BLOB_RANGE');
    }
    const result = backend.get(descriptor.key, { start, end: finalEnd });
    if (result.checksumSha256 !== descriptor.storedSha256
      || result.byteLength !== descriptor.byteLength
      || result.bytes.length !== finalEnd - start
      || result.range?.start !== start || result.range?.end !== finalEnd) {
      fail('OBJECT_ONT_BLOB_RANGE');
    }
    const completeObjectBytesVerified = start === 0 && finalEnd === descriptor.byteLength;
    if (completeObjectBytesVerified && objectBytesSha256(result.bytes) !== descriptor.storedSha256) {
      fail('OBJECT_ONT_BLOB_RANGE');
    }
    return freeze({
      descriptor: clone(descriptor),
      bytes: result.bytes,
      range: freeze({ start, end: finalEnd }),
      objectChecksumSha256: descriptor.storedSha256,
      deliveredSha256: objectBytesSha256(result.bytes),
      objectChecksumBound: true,
      completeObjectBytesVerified,
    });
  };

  const readCommit = (commitSha256: string): { commitSha256: string; key: string; byteLength: number; commit: ObjectCommit } => {
    const key = commitKey(commitSha256);
    const result = readBackendBytes(backend, key, commitSha256, 'OBJECT_ONT_COMMIT_READ');
    let commit;
    try { commit = JSON.parse(result.bytes.toString('utf8')); } catch { fail('OBJECT_ONT_COMMIT_READ'); }
    validateCommitCore(commit);
    if (!result.bytes.equals(Buffer.from(stableObjectText(commit)))) fail('OBJECT_ONT_COMMIT_READ');
    return freeze({ commitSha256, key, byteLength: result.bytes.length, commit });
  };

  const writeReplayIndexCheckpoint = (replayMetadata: ReplayMetadataGraph): ReplayIndexCheckpointReceipt => {
    if (replayMetadata?.kind !== 'OpenOntologyObjectReplayMetadataV1'
      || replayMetadata.status !== 'CLEAN'
      || !Array.isArray(replayMetadata.segmentKeys)
      || replayMetadata.segmentKeys.length !== 0) {
      fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_ELIGIBILITY');
    }
    const core = {
      schemaVersion: 1 as const,
      kind: 'OpenOntologyObjectReplayIndexCheckpointV1' as const,
      replayIdentity: clone(replayMetadata.replayIdentity),
      manifestDescriptor: clone(replayMetadata.manifestDescriptor),
      blobDescriptors: clone(replayMetadata.blobDescriptors),
    };
    const checkpoint = validateReplayIndexCheckpoint({
      ...core,
      checkpointSha256: stableObjectSha256(core),
    }, {
      ontId: replayMetadata.ontId,
      tipCommitSha256: replayMetadata.tipCommitSha256,
      replaySha256: replayMetadata.replaySha256,
    });
    const bytes = Buffer.from(stableObjectText(checkpoint));
    const key = replayIndexKey(replayMetadata.replaySha256);
    const write = backend.putIfAbsent(key, bytes);
    const bytesSha256 = objectBytesSha256(bytes);
    if (write.key !== key || write.checksumSha256 !== bytesSha256 || write.byteLength !== bytes.length) {
      fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_WRITE');
    }
    return freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyObjectReplayIndexCheckpointReceiptV1',
      key,
      checkpointSha256: checkpoint.checkpointSha256,
      replaySha256: replayMetadata.replaySha256,
      tipCommitSha256: replayMetadata.tipCommitSha256,
      bytesSha256,
      byteLength: bytes.length,
      replayed: write.replayed === true,
    });
  };

  const readReplayIndexCheckpoint = ({
    ontId,
    tipCommitSha256,
    replaySha256,
  }: {
    ontId: string;
    tipCommitSha256: string;
    replaySha256: string;
  }): ReplayIndexCheckpointRead | null => {
    const key = replayIndexKey(replaySha256);
    if (backend.head(key) === null) return null;
    const result = backend.get(key);
    if (result.key !== key || result.byteLength !== result.bytes.length
      || result.checksumSha256 !== objectBytesSha256(result.bytes)) {
      fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_READ');
    }
    let value: unknown;
    try { value = JSON.parse(result.bytes.toString('utf8')); } catch {
      fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_READ');
    }
    if (!result.bytes.equals(Buffer.from(stableObjectText(value as object)))) {
      fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_READ');
    }
    const checkpoint = validateReplayIndexCheckpoint(value, {
      ontId,
      tipCommitSha256,
      replaySha256,
    });
    const tip = readCommit(tipCommitSha256);
    if (tip.commit.ontId !== ontId
      || stableObjectText(tip.commit.ontManifest)
        !== stableObjectText(checkpoint.manifestDescriptor)) {
      fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT');
    }
    return freeze({
      checkpoint,
      replayMetadata: replayMetadataFromIndexCheckpoint(checkpoint),
      key,
      version: result.version,
      checksumSha256: result.checksumSha256,
      byteLength: result.bytes.length,
    });
  };

  const readRefRecord = ({ ontId, branch }: { ontId: string; branch: string }): RefReadResult | null => {
    const key = refKey(ontId, branch);
    if (backend.head(key) === null) return null;
    const result = backend.get(key);
    let ref: unknown;
    try { ref = JSON.parse(result.bytes.toString('utf8')); } catch { fail('OBJECT_ONT_REF_READ'); }
    validateRef(ref, { ontId, branch });
    if (!result.bytes.equals(Buffer.from(stableObjectText(ref as object)))) fail('OBJECT_ONT_REF_READ');
    return freeze({
      ref: clone(ref as BranchRef),
      version: result.version,
      key,
      checksumSha256: result.checksumSha256,
    });
  };

  const readRefWith = ({ ontId, branch }: { ontId: string; branch: string }, replayReader: (
    tipCommitSha256: string,
    virtualCommits?: Map<string, CommitRecord>,
  ) => ReplayGraph | ReplayMetadataGraph): RefReadResult | null => {
    const result = readRefRecord({ ontId, branch });
    if (result === null) return null;
    const replay = replayReader(result.ref.commitSha256);
    if (replay.status !== result.ref.replayStatus || replay.replaySha256 !== result.ref.replaySha256) fail('OBJECT_ONT_REF_READ');
    return result;
  };
  const readRef = (input: { ontId: string; branch: string }): RefReadResult | null => readRefWith(input, replayGraph);
  const readRefMetadata = (input: { ontId: string; branch: string }): RefReadResult | null => readRefWith(input, replayMetadataGraph);
  const readRefMetadataSnapshot = (input: { ontId: string; branch: string }): ReplayMetadataSnapshot | null => {
    let replayMetadata: ReplayMetadataGraph | null = null;
    const result = readRefWith(input, (tipCommitSha256) => {
      replayMetadata = replayMetadataGraph(tipCommitSha256);
      return replayMetadata;
    });
    return result === null || replayMetadata === null
      ? null
      : freeze({ ...result, replayMetadata });
  };
  const readRefMetadataCheckpointSnapshot = (
    input: { ontId: string; branch: string },
  ): ReplayMetadataCheckpointSnapshot | null => {
    const result = readRefRecord(input);
    if (result === null) return null;
    const indexed = readReplayIndexCheckpoint({
      ontId: result.ref.ontId,
      tipCommitSha256: result.ref.commitSha256,
      replaySha256: result.ref.replaySha256,
    });
    const replayMetadata = indexed?.replayMetadata
      ?? replayMetadataGraph(result.ref.commitSha256);
    if (replayMetadata.status !== result.ref.replayStatus
      || replayMetadata.replaySha256 !== result.ref.replaySha256) {
      fail('OBJECT_ONT_REF_READ');
    }
    return freeze({
      ...result,
      replayMetadata,
      replayMetadataSource: indexed === null ? 'graph' : 'checkpoint',
      replayIndexCheckpointSha256: indexed?.checkpoint.checkpointSha256 ?? null,
      replayIndexCheckpointByteLength: indexed?.byteLength ?? null,
    });
  };

  const loadGraph = (tipCommitSha256: string, virtualCommits: Map<string, CommitRecord> = new Map()): {
    commits: Map<string, CommitRecord>;
    order: string[];
    ontId: string;
  } => {
    validateSha256(tipCommitSha256, 'OBJECT_ONT_COMMIT_ID');
    const commits = new Map<string, CommitRecord>();
    const visiting = new Set<string>();
    const order: string[] = [];
    const stack: Array<{ commitSha256: string; record: CommitRecord | null }> = [{
      commitSha256: tipCommitSha256,
      record: null,
    }];
    while (stack.length) {
      const frame = stack.pop() as { commitSha256: string; record: CommitRecord | null };
      if (frame.record !== null) {
        visiting.delete(frame.commitSha256);
        commits.set(frame.commitSha256, frame.record);
        order.push(frame.commitSha256);
        continue;
      }
      if (commits.has(frame.commitSha256)) continue;
      if (visiting.has(frame.commitSha256)) fail('OBJECT_ONT_COMMIT_CYCLE');
      visiting.add(frame.commitSha256);
      const record = virtualCommits.get(frame.commitSha256) ?? readCommit(frame.commitSha256);
      stack.push({ commitSha256: frame.commitSha256, record });
      for (let index = record.commit.parents.length - 1; index >= 0; index -= 1) {
        stack.push({ commitSha256: record.commit.parents[index], record: null });
      }
    }
    const ontIds = new Set([...commits.values()].map((record) => record.commit.ontId));
    if (ontIds.size !== 1) fail('OBJECT_ONT_GRAPH_SCOPE');
    return { commits, order, ontId: [...ontIds][0] };
  };

  const compileReplayGraph = ({
    tipCommitSha256,
    virtualCommits = new Map(),
    hydrateBlobs,
  }: {
    tipCommitSha256: string;
    virtualCommits?: Map<string, CommitRecord>;
    hydrateBlobs: boolean;
  }): ReplayGraph | ReplayMetadataGraph => {
    const graph = loadGraph(tipCommitSha256, virtualCommits);
    const segmentDescriptors = new Map<string, AssertionSegmentDescriptor>();
    const blobDescriptors = new Map<string, BlobDescriptor>();
    for (const commitSha256 of graph.order) {
      const commit = graph.commits.get(commitSha256)?.commit ?? fail('OBJECT_ONT_COMMIT_READ');
      for (const descriptor of commit.segments) {
        const identity = `${descriptor.logicalPath}\0${descriptor.key}`;
        segmentDescriptors.set(identity, descriptor);
      }
      for (const descriptor of commit.blobs) {
        const identity = `${descriptor.logicalPath}\0${descriptor.key}`;
        blobDescriptors.set(identity, descriptor);
      }
    }

    const conflicts: ReplayConflict[] = [];
    const blobPaths = new Map<string, Set<string>>();
    for (const descriptor of blobDescriptors.values()) {
      const variants = blobPaths.get(descriptor.logicalPath) ?? new Set<string>();
      variants.add(descriptor.storedSha256);
      blobPaths.set(descriptor.logicalPath, variants);
    }
    for (const [logicalPath, variants] of blobPaths) {
      if (variants.size > 1) conflicts.push({
        type: 'blob-path-variant',
        identity: logicalPath,
        variants: [...variants].sort(compare),
      });
    }

    const assertionVariants = new Map<string, Map<string, AssertionEntry>>();
    const entriesByLine = new Map<string, AssertionEntry>();
    const segments = [...segmentDescriptors.values()].sort(descriptorOrder).map((descriptor) => {
      const loaded = readAssertionSegment(descriptor);
      for (const record of loaded.records) {
        const variants = assertionVariants.get(record.entry.id)
          ?? new Map<string, AssertionEntry>();
        variants.set(record.lineSha256, record.entry);
        assertionVariants.set(record.entry.id, variants);
        entriesByLine.set(record.lineSha256, record.entry);
      }
      return loaded;
    });
    for (const [assertionId, variants] of assertionVariants) {
      if (variants.size > 1) conflicts.push({
        type: 'assertion-identity-variant',
        identity: assertionId,
        variants: [...variants.keys()].sort(compare),
      });
    }
    const superseders = new Map<string, Set<string>>();
    for (const entry of entriesByLine.values()) {
      if (!entry.supersedes) continue;
      const ids = superseders.get(entry.supersedes) ?? new Set<string>();
      ids.add(entry.id);
      superseders.set(entry.supersedes, ids);
    }
    for (const [baseAssertionId, ids] of superseders) {
      if (ids.size > 1) conflicts.push({
        type: 'concurrent-supersession',
        identity: baseAssertionId,
        variants: [...ids].sort(compare),
      });
    }
    conflicts.sort(conflictOrder);

    const tipManifest = graph.commits.get(tipCommitSha256)?.commit.ontManifest
      ?? fail('OBJECT_ONT_COMMIT_READ');
    const canonicalSegmentDescriptors = [...segmentDescriptors.values()].sort(descriptorOrder);
    const canonicalBlobDescriptors = [...blobDescriptors.values()].sort(descriptorOrder);
    const manifest = hydrateBlobs ? readBlob(tipManifest, { manifest: true }) : null;
    const blobs = hydrateBlobs
      ? canonicalBlobDescriptors.map((descriptor) => readBlob(descriptor)) : null;
    const ledgerGroups = new Map<string, LoadedAssertionSegment[]>();
    for (const segment of segments) {
      const rows = ledgerGroups.get(segment.descriptor.logicalPath) ?? [];
      rows.push(segment);
      ledgerGroups.set(segment.descriptor.logicalPath, rows);
    }
    const ledgerFiles = [...ledgerGroups.entries()].sort(([left], [right]) => compare(left, right)).map(([logicalPath, rows]) => {
      rows.sort((left: LoadedAssertionSegment, right: LoadedAssertionSegment) => compare(left.descriptor.key, right.descriptor.key));
      const bytes = Buffer.concat(rows.map((row: LoadedAssertionSegment) => row.bytes));
      return freeze({ logicalPath, bytes, sha256: objectBytesSha256(bytes), segmentKeys: rows.map((row: LoadedAssertionSegment) => row.descriptor.key) });
    });
    const entries = [...entriesByLine.values()].sort(compareEntries);
    const replayCore = {
      schemaVersion: 1,
      kind: 'OpenOntologyObjectReplayV1',
      ontId: graph.ontId,
      tipCommitSha256,
      ontManifestSha256: tipManifest.storedSha256,
      commitOrder: graph.order,
      segmentKeys: [...segmentDescriptors.values()].map((row) => row.key).sort(compare),
      blobKeys: [...blobDescriptors.values()].map((row) => row.key).sort(compare),
      assertionRows: [...assertionVariants.entries()].sort(([left], [right]) => compare(left, right)).map(([assertionId, variants]) => ({
        assertionId,
        lineSha256s: [...variants.keys()].sort(compare),
      })),
      conflicts,
    };
    const status = conflicts.length ? 'CONFLICT' : 'CLEAN';
    const replaySha256 = stableObjectSha256(replayCore);
    if (hydrateBlobs) {
      if (manifest === null || blobs === null) return fail('OBJECT_ONT_COMMIT_READ');
      return freeze({
        ...replayCore,
        status,
        replaySha256,
        manifest,
        segments,
        blobs,
        ledgerFiles,
        entries,
      }) as ReplayGraph;
    }
    return freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyObjectReplayMetadataV1',
      replayIdentity: freeze(clone(replayCore)),
      ontId: replayCore.ontId,
      tipCommitSha256: replayCore.tipCommitSha256,
      ontManifestSha256: replayCore.ontManifestSha256,
      commitOrder: freeze([...replayCore.commitOrder]),
      segmentKeys: freeze([...replayCore.segmentKeys]),
      blobKeys: freeze([...replayCore.blobKeys]),
      assertionRows: freeze(clone(replayCore.assertionRows)),
      conflicts: freeze(clone(replayCore.conflicts)),
      status,
      replaySha256,
      manifestDescriptor: freeze(clone(tipManifest)),
      segmentDescriptors: freeze(canonicalSegmentDescriptors.map((row) => freeze(clone(row)))),
      blobDescriptors: freeze(canonicalBlobDescriptors.map((row) => freeze(clone(row)))),
      segments,
      ledgerFiles,
      entries,
      blobBytesLoaded: 0,
      payloadBlobBytesValidated: false,
    });
  };
  const replayGraph = (tipCommitSha256: string,
    virtualCommits: Map<string, CommitRecord> = new Map()): ReplayGraph => {
    const replay = compileReplayGraph({
      tipCommitSha256,
      virtualCommits,
      hydrateBlobs: true,
    });
    return replay.kind === 'OpenOntologyObjectReplayV1'
      ? replay : fail('OBJECT_ONT_COMMIT_READ');
  };
  const replayMetadataGraph = (tipCommitSha256: string,
    virtualCommits: Map<string, CommitRecord> = new Map()): ReplayMetadataGraph => {
    const replay = compileReplayGraph({ tipCommitSha256, virtualCommits, hydrateBlobs: false });
    return replay.kind === 'OpenOntologyObjectReplayMetadataV1'
      ? replay : fail('OBJECT_ONT_COMMIT_READ');
  };

  const planMerge = ({ leftCommitSha256, rightCommitSha256 }: {
    leftCommitSha256: string;
    rightCommitSha256: string;
  }): MergePlan => {
    validateSha256(leftCommitSha256, 'OBJECT_ONT_MERGE');
    validateSha256(rightCommitSha256, 'OBJECT_ONT_MERGE');
    const parents = [...new Set([leftCommitSha256, rightCommitSha256])].sort(compare);
    if (parents.length !== 2) fail('OBJECT_ONT_MERGE');
    const left = readCommit(parents[0]);
    const right = readCommit(parents[1]);
    if (left.commit.ontId !== right.commit.ontId) fail('OBJECT_ONT_MERGE_SCOPE');
    const leftGraph = loadGraph(parents[0]);
    const rightGraph = loadGraph(parents[1]);
    const targetCommitSha256 = leftGraph.commits.has(parents[1])
      ? parents[0]
      : rightGraph.commits.has(parents[0]) ? parents[1] : null;
    if (targetCommitSha256 !== null) {
      return freeze({
        schemaVersion: 1,
        kind: 'OpenOntologyMergePlanV1',
        ontId: left.commit.ontId,
        parents,
        status: 'FAST_FORWARD',
        conflicts: [],
        targetCommitSha256,
      });
    }
    if (stableObjectText(left.commit.ontManifest) !== stableObjectText(right.commit.ontManifest)) {
      return freeze({
        schemaVersion: 1,
        kind: 'OpenOntologyMergePlanV1',
        ontId: left.commit.ontId,
        parents,
        status: 'CONFLICT',
        conflicts: [{
          type: 'ont-manifest-variant',
          identity: 'oont.json',
          variants: [left.commit.ontManifest.storedSha256, right.commit.ontManifest.storedSha256].sort(compare),
        }],
      });
    }
    const previewCore: ObjectCommit = {
      schemaVersion: 1,
      kind: 'OpenOntologyObjectCommitV1',
      formatVersion: 'object/v1',
      ontId: left.commit.ontId,
      parents,
      assertionEnvelopeVersion: ASSERTION_V,
      storeManifestVersion: STORE_V,
      ontManifest: clone(left.commit.ontManifest),
      segments: [],
      blobs: [],
    };
    const previewBytes = Buffer.from(stableObjectText(previewCore));
    const previewSha256 = objectBytesSha256(previewBytes);
    const mergedReplay = replayGraph(previewSha256, new Map([[
      previewSha256,
      freeze({
        commitSha256: previewSha256,
        key: commitKey(previewSha256),
        byteLength: previewBytes.length,
        commit: previewCore,
      }),
    ]]));
    return freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyMergePlanV1',
      ontId: left.commit.ontId,
      parents,
      status: mergedReplay.status,
      conflicts: clone(mergedReplay.conflicts),
      prospectiveCommitSha256: previewSha256,
      prospectiveReplaySha256: mergedReplay.replaySha256,
    });
  };

  const writeCommitWith = ({
    ontId,
    parents = [],
    ontManifest,
    segments = [],
    blobs = [],
  }: CommitInput, { hydratePayloadBlobs }: { hydratePayloadBlobs: boolean }): {
    schemaVersion: 1;
    kind: 'OpenOntologyCommitReceiptV1';
    ontId: string;
    commitSha256: string;
    key: string;
    byteLength: number;
    replayed: boolean;
  } => {
    validateIdentity(ontId, 'OBJECT_ONT_COMMIT');
    const canonicalParents = [...parents].sort(compare);
    if (canonicalParents.length !== parents.length || new Set(canonicalParents).size !== canonicalParents.length
      || canonicalParents.length > 2 || canonicalParents.some((parent) => !SHA256.test(parent))) fail('OBJECT_ONT_COMMIT');
    const manifest = clone(validateBlobDescriptor(ontManifest, { manifest: true }));
    const canonicalSegments = canonicalDescriptors(segments, validateSegmentDescriptor, 'OBJECT_ONT_COMMIT');
    const canonicalBlobs = canonicalDescriptors(blobs, (row) => validateBlobDescriptor(row), 'OBJECT_ONT_COMMIT');
    readBlob(manifest, { manifest: true });
    for (const descriptor of canonicalSegments) readAssertionSegment(descriptor);
    for (const descriptor of canonicalBlobs) {
      if (hydratePayloadBlobs) {
        readBlob(descriptor);
        continue;
      }
      const head = backend.head(descriptor.key);
      if (head === null || head.checksumSha256 !== descriptor.storedSha256
        || head.byteLength !== descriptor.byteLength) {
        fail('OBJECT_ONT_BLOB_READ');
      }
    }
    for (const parent of canonicalParents) {
      const parentCommit = readCommit(parent).commit;
      if (parentCommit.ontId !== ontId) fail('OBJECT_ONT_COMMIT_SCOPE');
    }
    if (canonicalParents.length === 2) {
      const plan = planMerge({ leftCommitSha256: canonicalParents[0], rightCommitSha256: canonicalParents[1] });
      if (plan.status !== 'CLEAN') fail('OBJECT_ONT_MERGE_CONFLICT');
      const parentManifest = readCommit(canonicalParents[0]).commit.ontManifest;
      if (stableObjectText(parentManifest) !== stableObjectText(manifest)) fail('OBJECT_ONT_MERGE_MANIFEST');
      if (canonicalSegments.length || canonicalBlobs.length) fail('OBJECT_ONT_MERGE_RESOLUTION_REQUIRED');
    }
    const core = validateCommitCore({
      schemaVersion: 1,
      kind: 'OpenOntologyObjectCommitV1',
      formatVersion: 'object/v1',
      ontId,
      parents: canonicalParents,
      assertionEnvelopeVersion: ASSERTION_V,
      storeManifestVersion: STORE_V,
      ontManifest: manifest,
      segments: canonicalSegments,
      blobs: canonicalBlobs,
    });
    const bytes = Buffer.from(stableObjectText(core));
    const commitSha256 = objectBytesSha256(bytes);
    const key = commitKey(commitSha256);
    const write = backend.putIfAbsent(key, bytes);
    if (write.checksumSha256 !== commitSha256) fail('OBJECT_ONT_COMMIT_WRITE');
    return freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyCommitReceiptV1',
      ontId,
      commitSha256,
      key,
      byteLength: bytes.length,
      replayed: write.replayed === true,
    });
  };
  const writeCommit = (input: CommitInput) =>
    writeCommitWith(input, { hydratePayloadBlobs: true });
  const writeCommitMetadata = (input: CommitInput) =>
    writeCommitWith(input, { hydratePayloadBlobs: false });

  const merge = ({ leftCommitSha256, rightCommitSha256 }: {
    leftCommitSha256: string;
    rightCommitSha256: string;
  }): Record<string, unknown> => {
    const plan = planMerge({ leftCommitSha256, rightCommitSha256 });
    if (plan.status === 'FAST_FORWARD') {
      return freeze({ plan, receipt: null, commitSha256: plan.targetCommitSha256 });
    }
    if (plan.status !== 'CLEAN') return fail('OBJECT_ONT_MERGE_CONFLICT');
    const left = readCommit(plan.parents[0]);
    const receipt = writeCommit({
      ontId: plan.ontId,
      parents: plan.parents,
      ontManifest: left.commit.ontManifest,
    });
    if (receipt.commitSha256 !== plan.prospectiveCommitSha256) fail('OBJECT_ONT_MERGE_IDENTITY');
    return freeze({ plan, receipt, commitSha256: receipt.commitSha256 });
  };

  const compareAndSwapRefWith = ({
    ontId,
    branch,
    expectedVersion = null,
    commitSha256,
    allowConflicts = false,
  }: {
    ontId: string;
    branch: string;
    expectedVersion?: string | null;
    commitSha256: string;
    allowConflicts?: boolean;
  }, replayReader: (
    tipCommitSha256: string,
    virtualCommits?: Map<string, CommitRecord>,
  ) => ReplayGraph | ReplayMetadataGraph): RefWriteResult => {
    const commit = readCommit(commitSha256);
    if (commit.commit.ontId !== ontId) fail('OBJECT_ONT_REF_SCOPE');
    const replay = replayReader(commitSha256);
    if (replay.status === 'CONFLICT' && allowConflicts !== true) fail('OBJECT_ONT_REF_CONFLICT');
    const current = readRefRecord({ ontId, branch });
    if (current !== null && expectedVersion === current.version
      && !replay.commitOrder.includes(current.ref.commitSha256)) {
      fail('OBJECT_ONT_REF_ROLLBACK');
    }
    const ref = validateRef({
      schemaVersion: 1,
      kind: 'OpenOntologyBranchRefV1',
      ontId,
      branch,
      commitSha256,
      replayStatus: replay.status,
      replaySha256: replay.replaySha256,
    }, { ontId, branch });
    const result = backend.compareAndSwap(refKey(ontId, branch), {
      expectedVersion,
      bytes: Buffer.from(stableObjectText(ref)),
    });
    return freeze({ ref: clone(ref), version: result.version, previousVersion: result.previousVersion, key: refKey(ontId, branch) });
  };
  const compareAndSwapRef = (input: RefUpdateInput): RefWriteResult =>
    compareAndSwapRefWith(input, replayGraph);
  const compareAndSwapRefMetadata = (input: RefUpdateInput): RefWriteResult =>
    compareAndSwapRefWith(input, replayMetadataGraph);
  const compareAndSwapRefMetadataCheckpointed = (
    input: RefUpdateInput,
  ): ReplayMetadataCheckpointWriteResult => {
    let replayMetadata: ReplayMetadataGraph | null = null;
    let checkpoint: ReplayIndexCheckpointReceipt | null = null;
    const ref = compareAndSwapRefWith(input, (tipCommitSha256) => {
      replayMetadata = replayMetadataGraph(tipCommitSha256);
      checkpoint = writeReplayIndexCheckpoint(replayMetadata as ReplayMetadataGraph);
      return replayMetadata as ReplayMetadataGraph;
    });
    if (replayMetadata === null || checkpoint === null) return fail('OBJECT_ONT_REPLAY_INDEX_CHECKPOINT');
    const replayMetadataValue = replayMetadata as ReplayMetadataGraph;
    const checkpointValue = checkpoint as ReplayIndexCheckpointReceipt;
    return freeze({
      ...ref,
      replayMetadata: replayMetadataValue,
      replayMetadataSource: 'graph',
      replayIndexCheckpointSha256: checkpointValue.checkpointSha256,
      replayIndexCheckpointByteLength: checkpointValue.byteLength,
    });
  };

  return freeze({
    backendCapabilities: clone(backend.capabilities),
    putAssertionSegment,
    readAssertionSegment,
    putBlob,
    readBlob,
    readBlobRange,
    writeCommit,
    writeCommitMetadata,
    readCommit,
    loadGraph,
    replay: (tipCommitSha256: string): ReplayGraph => replayGraph(tipCommitSha256),
    replayMetadata: (tipCommitSha256: string): ReplayMetadataGraph => replayMetadataGraph(tipCommitSha256),
    planMerge,
    merge,
    readRef,
    readRefMetadata,
    readRefMetadataSnapshot,
    readRefMetadataCheckpointSnapshot,
    writeReplayIndexCheckpoint,
    readReplayIndexCheckpoint,
    compareAndSwapRef,
    compareAndSwapRefMetadata,
    compareAndSwapRefMetadataCheckpointed,
  });
}
