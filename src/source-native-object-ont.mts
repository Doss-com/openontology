/** Canonical ObjectOnt storage for a source-native map and its exact sources. */
import {
  objectBytesSha256,
  stableObjectSha256,
  stableObjectText,
} from './canonical-content.mjs';
import { openObjectOntStore } from './object-ont-store.mjs';
import {
  compileSourceNativeObjectMap,
  validateSourceNativeObjectMap,
} from './source-native-object-map.mjs';
import type {
  JsonObject,
  SourceNativeObjectInput,
  SourceNativeObjectMap,
  SourceNativeSource,
  SourceNativeSourceInput,
} from './source-native-object-map.mjs';
import type { ObjectBackend } from './object-storage-backend.mjs';
import type {
  BlobDescriptor,
  ObjectOntStore,
  ReplayMetadataGraph,
} from './object-ont-store.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_SOURCE_PACK_BYTES = 8 * 1024 * 1024;
const compare = (left: unknown, right: unknown): number => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const freeze = <T,>(value: T): T => {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export interface SourceCatalogRow {
  relativePath: string;
  sourceType: string;
  occurredAt: string;
  sourceSha256: string;
  blobLogicalPath: string;
  blobStoredSha256?: string;
  byteStart?: number;
  byteEnd?: number;
}
export interface SourceCatalog {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeCatalogV1';
  sourceCount: number;
  sourceStorageLayout?: 'packed-ranges-v1';
  sourcePackCount?: number;
  sources: SourceCatalogRow[];
  sourceCatalogSha256: string;
  exactSourcesRemainAuthority: true;
}
export interface SourceOntManifest {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeObjectOntManifestV1';
  formatVersion: 'object/v1';
  ontId: string;
  nativeObjectMapSha256: string;
  sourceCatalogSha256: string;
  mapBlobLogicalPath: string;
  mapBlobStoredSha256: string;
  catalogBlobLogicalPath: string;
  catalogBlobStoredSha256: string;
  exactSourcesRemainAuthority: true;
  navigationOnly: true;
  canonicalTruthMutation: false;
}
export interface OpenSource extends SourceCatalogRow {
  blobDescriptor: BlobDescriptor;
  blobByteStart: number;
  blobByteEnd: number;
  content?: string;
}
export interface SourceNativeObjectOntIndex {
  kind: 'OpenOntologySourceNativeObjectOntIndexV1';
  ontId: string;
  commitSha256: string;
  replaySha256: string;
  manifest: SourceOntManifest;
  map: SourceNativeObjectMap;
  catalog: SourceCatalog;
  sources: OpenSource[];
  exactSourcesRemainAuthority: true;
  navigationOnly: true;
  canonicalTruthMutation: false;
}
export type SourceNativeObjectOntModule = Omit<SourceNativeObjectOntIndex, 'kind' | 'sources'> & {
  kind: 'OpenOntologySourceNativeObjectOntModuleV1';
  sources: Array<OpenSource & { content: string }>;
}
export interface SourceNativeObjectOntReceipt {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeObjectOntReceiptV1';
  status: 'SOURCE_NATIVE_OBJECT_ONT_DURABLE';
  ontId: string;
  branch: string;
  commitSha256: string;
  replaySha256: string;
  refVersion: string;
  nativeObjectMapSha256: string;
  sourceCatalogSha256: string;
  sourceCount: number;
  sourcePackCount: number;
  sourceStorageLayout?: string;
  nativeObjectCount: number;
  replayed: boolean;
  exactSourcesRemainAuthority: true;
  canonicalTruthMutation: false;
  receiptSha256: string;
}
interface MaterializeResult {
  map: SourceNativeObjectMap;
  catalog: SourceCatalog;
  receipt: SourceNativeObjectOntReceipt;
}
interface SourcePack {
  byteLength: number;
  sources: Array<{ source: SourceNativeSource; byteStart: number; byteEnd: number }>;
  bytes: Buffer[];
}
interface MaterializeInput {
  backend?: ObjectBackend;
  ontId?: string;
  branch?: string;
  expectedVersion?: string | null;
  sources?: SourceNativeSourceInput[];
  nativeObjectInputs?: SourceNativeObjectInput[];
  adapterDiagnostics?: JsonObject[];
}
interface RecordLike { [key: string]: unknown }
const isRecord = (value: unknown): value is RecordLike =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isSourceNativeObjectMap = (value: unknown): value is SourceNativeObjectMap => {
  if (!isRecord(value)) return false;
  return value.kind === 'OpenOntologySourceNativeObjectMapV1'
    && Array.isArray(value.nativeObjects)
    && value.nativeObjects.every((row) => isRecord(row))
    && Array.isArray(value.fieldRevisions)
    && value.fieldRevisions.every((row) => isRecord(row))
    && Array.isArray(value.duplicateEvidenceClusters)
    && value.duplicateEvidenceClusters.every((row) => isRecord(row))
    && Array.isArray(value.businessEntityEvidenceNeighborhoods)
    && value.businessEntityEvidenceNeighborhoods.every((row) => isRecord(row))
    && Array.isArray(value.adapterDiagnostics)
    && typeof value.nativeObjectMapSha256 === 'string';
};

function exactTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function normalizeSources(sourceInput: SourceNativeSourceInput[] | undefined): SourceNativeSource[] {
  if (!Array.isArray(sourceInput) || sourceInput.length < 1) {
    fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
  }
  const paths = new Set<string>();
  const input = sourceInput ?? fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
  const sources = input.map((source) => {
    const relativePath = typeof source?.relativePath === 'string' ? source.relativePath : '';
    const sourceType = typeof source?.sourceType === 'string' ? source.sourceType : '';
    const occurredAt = typeof source?.occurredAt === 'string' ? source.occurredAt : '';
    const content = typeof source?.content === 'string' ? source.content : '';
    const sourceSha256 = typeof source?.sourceSha256 === 'string' ? source.sourceSha256 : '';
    if (!relativePath
      || relativePath.startsWith('/') || relativePath.includes('\\')
      || relativePath.split('/').some((part) => !part || part === '.' || part === '..')
      || !sourceType
      || relativePath.split('/')[0] !== sourceType
      || !exactTime(occurredAt)
      || !content
      || !SHA256.test(sourceSha256)
      || objectBytesSha256(Buffer.from(content)) !== sourceSha256
      || paths.has(relativePath)) {
      fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    }
    paths.add(relativePath);
    return freeze({
      relativePath,
      sourceType,
      occurredAt,
      content,
      sourceSha256,
    });
  });
  return freeze(sources.sort((left, right) => compare(left.relativePath, right.relativePath)));
}

function sourceBlobPath(sourceSha256: string): string {
  return `blobs/source-native/sources/sha256/${sourceSha256.slice(7)}`;
}

function sourcePackBlobPath(packSha256: string): string {
  return `blobs/source-native/source-packs/sha256/${packSha256.slice(7)}`;
}

function catalogBlobPath(catalogSha256: string): string {
  return `blobs/source-native/catalogs/sha256/${catalogSha256.slice(7)}.json`;
}

function mapBlobPath(nativeObjectMapSha256: string): string {
  return `blobs/source-native/maps/sha256/${nativeObjectMapSha256.slice(7)}.json`;
}

function parseStableJson(bytes: Buffer, code: string): RecordLike {
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail(code); }
  const record = isRecord(value) ? value : fail(code);
  if (!bytes.equals(Buffer.from(stableObjectText(record)))) fail(code);
  return record;
}

function descriptorByLogicalPath(replay: ReplayMetadataGraph, logicalPath: string,
  expectedSha256: string, code: string): BlobDescriptor {
  const descriptors: BlobDescriptor[] = replay.blobDescriptors;
  const rows = descriptors.filter((row) => row.logicalPath === logicalPath);
  if (rows.length !== 1 || rows[0].storedSha256 !== expectedSha256) fail(code);
  return rows[0];
}

function validateManifest(manifest: unknown, ontId: string): SourceOntManifest {
  const record = isRecord(manifest) ? manifest : fail('SOURCE_NATIVE_OBJECT_ONT_MANIFEST');
  const nativeObjectMapSha256 = typeof record.nativeObjectMapSha256 === 'string'
    ? record.nativeObjectMapSha256 : '';
  const sourceCatalogSha256 = typeof record.sourceCatalogSha256 === 'string'
    ? record.sourceCatalogSha256 : '';
  const mapBlobStoredSha256 = typeof record.mapBlobStoredSha256 === 'string'
    ? record.mapBlobStoredSha256 : '';
  const mapBlobLogicalPath = typeof record.mapBlobLogicalPath === 'string'
    ? record.mapBlobLogicalPath : '';
  const catalogBlobLogicalPath = typeof record.catalogBlobLogicalPath === 'string'
    ? record.catalogBlobLogicalPath : '';
  const catalogBlobStoredSha256 = typeof record.catalogBlobStoredSha256 === 'string'
    ? record.catalogBlobStoredSha256 : '';
  if (record.schemaVersion !== 1
    || record.kind !== 'OpenOntologySourceNativeObjectOntManifestV1'
    || record.formatVersion !== 'object/v1'
    || record.ontId !== ontId
    || !SHA256.test(nativeObjectMapSha256)
    || !SHA256.test(sourceCatalogSha256)
    || !mapBlobLogicalPath
    || !SHA256.test(mapBlobStoredSha256)
    || !catalogBlobLogicalPath
    || !SHA256.test(catalogBlobStoredSha256)
    || record.exactSourcesRemainAuthority !== true
    || record.navigationOnly !== true
    || record.canonicalTruthMutation !== false) {
    fail('SOURCE_NATIVE_OBJECT_ONT_MANIFEST');
  }
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeObjectOntManifestV1',
    formatVersion: 'object/v1',
    ontId,
    nativeObjectMapSha256,
    sourceCatalogSha256,
    mapBlobLogicalPath,
    mapBlobStoredSha256,
    catalogBlobLogicalPath,
    catalogBlobStoredSha256,
    exactSourcesRemainAuthority: true,
    navigationOnly: true,
    canonicalTruthMutation: false,
  };
}

function openIndexAtCommit({ store, ontId, commitSha256 }: {
  store: ObjectOntStore; ontId: string; commitSha256: string;
}): SourceNativeObjectOntIndex {
  if (typeof ontId !== 'string' || !ontId || !SHA256.test(commitSha256 ?? '')) {
    fail('SOURCE_NATIVE_OBJECT_ONT_OPEN');
  }
  const commit = store.readCommit(commitSha256);
  const replay = store.replayMetadata(commitSha256);
  if (commit.commit.ontId !== ontId || replay.status !== 'CLEAN' || replay.conflicts.length !== 0) {
    fail('SOURCE_NATIVE_OBJECT_ONT_OPEN');
  }
  const manifestBlob = store.readBlob(replay.manifestDescriptor, { manifest: true });
  const manifest = validateManifest(parseStableJson(manifestBlob.bytes,
    'SOURCE_NATIVE_OBJECT_ONT_MANIFEST'), ontId);
  const mapDescriptor = descriptorByLogicalPath(replay, manifest.mapBlobLogicalPath,
    manifest.mapBlobStoredSha256, 'SOURCE_NATIVE_OBJECT_ONT_MAP');
  const mapBlob = store.readBlob(mapDescriptor);
  const mapValue = parseStableJson(mapBlob.bytes, 'SOURCE_NATIVE_OBJECT_ONT_MAP');
  if (!isRecord(mapValue)) fail('SOURCE_NATIVE_OBJECT_ONT_MAP');
  const map = isSourceNativeObjectMap(mapValue)
    ? validateSourceNativeObjectMap(mapValue)
    : fail('SOURCE_NATIVE_OBJECT_ONT_MAP');
  if (map.nativeObjectMapSha256 !== manifest.nativeObjectMapSha256) {
    fail('SOURCE_NATIVE_OBJECT_ONT_MAP');
  }
  const catalogDescriptor = descriptorByLogicalPath(replay, manifest.catalogBlobLogicalPath,
    manifest.catalogBlobStoredSha256, 'SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  const catalogBlob = store.readBlob(catalogDescriptor);
  const catalogValue = parseStableJson(catalogBlob.bytes, 'SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  if (!isRecord(catalogValue)) fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  const sourceCatalogSha256 = typeof catalogValue.sourceCatalogSha256 === 'string'
    ? catalogValue.sourceCatalogSha256 : '';
  const catalogCore = Object.fromEntries(Object.entries(catalogValue)
    .filter(([key]) => key !== 'sourceCatalogSha256'));
  const sourceRows = Array.isArray(catalogValue.sources) ? catalogValue.sources : [];
  const sourceCount = typeof catalogValue.sourceCount === 'number' ? catalogValue.sourceCount : -1;
  if (catalogValue.schemaVersion !== 1 || catalogValue.kind !== 'OpenOntologySourceNativeCatalogV1'
    || !SHA256.test(sourceCatalogSha256)
    || stableObjectSha256(catalogCore) !== sourceCatalogSha256
    || sourceCatalogSha256 !== manifest.sourceCatalogSha256
    || sourceRows.length !== sourceCount
    || sourceCount !== map.sourceCount) {
    fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  }
  const sourceStorageLayout = catalogValue.sourceStorageLayout;
  const sourcePackCount = typeof catalogValue.sourcePackCount === 'number'
    ? catalogValue.sourcePackCount : -1;
  const packedSources = sourceStorageLayout === 'packed-ranges-v1';
  if (!(packedSources
    ? Number.isSafeInteger(sourcePackCount) && sourcePackCount >= 1
    : sourceStorageLayout === undefined && sourcePackCount === undefined)) {
    fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  }
  const sources = sourceRows.map((rowValue): OpenSource => {
    if (!isRecord(rowValue)) fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
    const relativePath = typeof rowValue.relativePath === 'string' ? rowValue.relativePath : '';
    const sourceType = typeof rowValue.sourceType === 'string' ? rowValue.sourceType : '';
    const occurredAt = typeof rowValue.occurredAt === 'string' ? rowValue.occurredAt : '';
    const rowSourceSha256 = typeof rowValue.sourceSha256 === 'string' ? rowValue.sourceSha256 : '';
    const blobLogicalPath = typeof rowValue.blobLogicalPath === 'string' ? rowValue.blobLogicalPath : '';
    const blobStoredSha256 = typeof rowValue.blobStoredSha256 === 'string'
      ? rowValue.blobStoredSha256 : '';
    const byteStartValue = typeof rowValue.byteStart === 'number' ? rowValue.byteStart : -1;
    const byteEndValue = typeof rowValue.byteEnd === 'number' ? rowValue.byteEnd : -1;
    if (!relativePath || !sourceType || !exactTime(occurredAt) || !SHA256.test(rowSourceSha256)
      || !blobLogicalPath) {
      fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
    }
    if (packedSources
      && (!SHA256.test(blobStoredSha256)
        || blobLogicalPath !== sourcePackBlobPath(blobStoredSha256)
        || !Number.isSafeInteger(byteStartValue) || byteStartValue < 0
        || !Number.isSafeInteger(byteEndValue) || byteEndValue <= byteStartValue)
      || !packedSources && blobLogicalPath !== sourceBlobPath(rowSourceSha256)) {
      fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
    }
    const expectedBlobSha256 = packedSources ? blobStoredSha256 : rowSourceSha256;
    const blobDescriptor = descriptorByLogicalPath(replay, blobLogicalPath,
      expectedBlobSha256, 'SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    const byteStart = packedSources ? byteStartValue : 0;
    const byteEnd = packedSources ? byteEndValue : blobDescriptor.byteLength;
    if (byteEnd > blobDescriptor.byteLength) fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    return freeze({
      relativePath,
      sourceType,
      occurredAt,
      sourceSha256: rowSourceSha256,
      blobLogicalPath,
      ...(packedSources ? { blobStoredSha256, byteStart: byteStartValue, byteEnd: byteEndValue } : {}),
      blobDescriptor,
      blobByteStart: byteStart,
      blobByteEnd: byteEnd,
    });
  });
  const catalogValueExact: SourceCatalog = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeCatalogV1',
    sourceCount,
    ...(packedSources ? { sourceStorageLayout: 'packed-ranges-v1' as const, sourcePackCount } : {}),
    sources: sources.map((source: OpenSource) => ({
      relativePath: source.relativePath,
      sourceType: source.sourceType,
      occurredAt: source.occurredAt,
      sourceSha256: source.sourceSha256,
      blobLogicalPath: source.blobLogicalPath,
      ...(source.blobStoredSha256 === undefined ? {} : {
        blobStoredSha256: source.blobStoredSha256,
        byteStart: source.byteStart,
        byteEnd: source.byteEnd,
      }),
    })),
    sourceCatalogSha256,
    exactSourcesRemainAuthority: true,
  };
  const catalog = freeze(catalogValueExact);
  const sourceIdentityByPath = new Map(sources.map((source) =>
    [source.relativePath, source.sourceSha256]));
  if (sourceIdentityByPath.size !== sources.length
    || map.nativeObjects.some((object) =>
      sourceIdentityByPath.get(object.relativePath) !== object.sourceSha256)) {
    fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  }
  return freeze({
    kind: 'OpenOntologySourceNativeObjectOntIndexV1',
    ontId,
    commitSha256,
    replaySha256: replay.replaySha256,
    manifest,
    map,
    catalog,
    sources: freeze(sources),
    exactSourcesRemainAuthority: true,
    navigationOnly: true,
    canonicalTruthMutation: false,
  });
}

function openAtCommit({ store, ontId, commitSha256 }: {
  store: ObjectOntStore; ontId: string; commitSha256: string;
}): SourceNativeObjectOntModule {
  const index = openIndexAtCommit({ store, ontId, commitSha256 });
  const packBytesByKey = new Map<string, Buffer>();
  const sources: Array<OpenSource & { content: string }> = index.sources.map((source) => {
    let bytes = packBytesByKey.get(source.blobDescriptor.key);
    if (!bytes) {
      bytes = store.readBlob(source.blobDescriptor).bytes;
      packBytesByKey.set(source.blobDescriptor.key, bytes);
    }
    const sourceBytes = bytes.subarray(source.blobByteStart, source.blobByteEnd);
    if (objectBytesSha256(sourceBytes) !== source.sourceSha256) {
      fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    }
    return freeze({
      ...source,
      content: sourceBytes.toString('utf8'),
    });
  });
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  for (const object of index.map.nativeObjects) {
    const source = sourceByPath.get(object.relativePath);
    const exactSource = source ?? fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    if (exactSource.sourceSha256 !== object.sourceSha256) fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    const bytes = Buffer.from(exactSource.content);
    for (const field of object.fields) {
      const evidence = field.evidence;
      if (evidence.relativePath !== exactSource.relativePath
        || evidence.sourceSha256 !== exactSource.sourceSha256
        || evidence.byteStart < 0 || evidence.byteEnd > bytes.length
        || evidence.byteEnd <= evidence.byteStart) fail('SOURCE_NATIVE_OBJECT_ONT_FIELD_EVIDENCE');
      const exactBytes = bytes.subarray(evidence.byteStart, evidence.byteEnd);
      if (objectBytesSha256(exactBytes) !== evidence.textSha256
        || exactBytes.toString('utf8') !== field.value) fail('SOURCE_NATIVE_OBJECT_ONT_FIELD_EVIDENCE');
    }
  }
  return freeze({
    ...index,
    kind: 'OpenOntologySourceNativeObjectOntModuleV1',
    sources: freeze(sources),
  });
}

export function materializeSourceNativeObjectOnt({
  backend,
  ontId,
  branch = 'main',
  expectedVersion = null,
  sources: sourceInput,
  nativeObjectInputs,
  adapterDiagnostics = [],
}: MaterializeInput = {}): MaterializeResult {
  if (!backend || typeof backend.putIfAbsent !== 'function'
    || typeof backend.compareAndSwap !== 'function'
    || typeof ontId !== 'string' || !ontId
    || typeof branch !== 'string' || !branch
    || !(expectedVersion === null || typeof expectedVersion === 'string')) {
    fail('SOURCE_NATIVE_OBJECT_ONT_INPUT');
  }
  const ontIdValue = typeof ontId === 'string' && ontId ? ontId : fail('SOURCE_NATIVE_OBJECT_ONT_INPUT');
  const branchValue = typeof branch === 'string' && branch ? branch : fail('SOURCE_NATIVE_OBJECT_ONT_INPUT');
  const backendValue = backend ?? fail('SOURCE_NATIVE_OBJECT_ONT_INPUT');
  const sources = normalizeSources(sourceInput);
  const map = compileSourceNativeObjectMap({ sources, nativeObjectInputs, adapterDiagnostics });
  const store = openObjectOntStore({ backend: backendValue });
  const sourcePacks: SourcePack[] = [];
  let currentPack: SourcePack = { byteLength: 0, sources: [], bytes: [] };
  const finishPack = () => {
    if (currentPack.sources.length < 1) return;
    sourcePacks.push(currentPack);
    currentPack = { byteLength: 0, sources: [], bytes: [] };
  };
  for (const source of sources) {
    const bytes = Buffer.from(source.content);
    if (currentPack.sources.length > 0
      && currentPack.byteLength + bytes.length > MAX_SOURCE_PACK_BYTES) finishPack();
    const byteStart = currentPack.byteLength;
    currentPack.bytes.push(bytes);
    currentPack.sources.push({ source, byteStart, byteEnd: byteStart + bytes.length });
    currentPack.byteLength += bytes.length;
  }
  finishPack();
  const sourcePackDescriptors: BlobDescriptor[] = [];
  const sourceCatalogRows: SourceCatalogRow[] = [];
  for (const pack of sourcePacks) {
    const bytes = Buffer.concat(pack.bytes, pack.byteLength);
    const packSha256 = objectBytesSha256(bytes);
    const descriptor = store.putBlob({
      logicalPath: sourcePackBlobPath(packSha256),
      bytes,
      mediaType: 'application/vnd.openontology.source-pack-v1',
    });
    if (descriptor.storedSha256 !== packSha256) fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    sourcePackDescriptors.push(descriptor);
    for (const row of pack.sources) sourceCatalogRows.push(freeze({
      relativePath: row.source.relativePath,
      sourceType: row.source.sourceType,
      occurredAt: row.source.occurredAt,
      sourceSha256: row.source.sourceSha256,
      blobLogicalPath: descriptor.logicalPath,
      blobStoredSha256: descriptor.storedSha256,
      byteStart: row.byteStart,
      byteEnd: row.byteEnd,
    }));
  }
  const catalogCore: {
    schemaVersion: 1;
    kind: 'OpenOntologySourceNativeCatalogV1';
    sourceCount: number;
    sourceStorageLayout: 'packed-ranges-v1';
    sourcePackCount: number;
    sources: SourceCatalogRow[];
    exactSourcesRemainAuthority: true;
  } = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeCatalogV1',
    sourceCount: sources.length,
    sourceStorageLayout: 'packed-ranges-v1',
    sourcePackCount: sourcePackDescriptors.length,
    sources: freeze(sourceCatalogRows),
    exactSourcesRemainAuthority: true,
  };
  const sourceCatalogSha256 = stableObjectSha256(catalogCore);
  const catalog: SourceCatalog = freeze({ ...catalogCore, sourceCatalogSha256 });
  const catalogBlob = store.putBlob({
    logicalPath: catalogBlobPath(sourceCatalogSha256),
    bytes: Buffer.from(stableObjectText(catalog)),
    mediaType: 'application/json',
  });
  const mapBlob = store.putBlob({
    logicalPath: mapBlobPath(map.nativeObjectMapSha256),
    bytes: Buffer.from(stableObjectText(map)),
    mediaType: 'application/json',
  });
  const manifestValue = freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeObjectOntManifestV1',
    formatVersion: 'object/v1',
    ontId: ontIdValue,
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    sourceCatalogSha256,
    mapBlobLogicalPath: mapBlob.logicalPath,
    mapBlobStoredSha256: mapBlob.storedSha256,
    catalogBlobLogicalPath: catalogBlob.logicalPath,
    catalogBlobStoredSha256: catalogBlob.storedSha256,
    exactSourcesRemainAuthority: true,
    navigationOnly: true,
    canonicalTruthMutation: false,
  });
  const manifest = store.putBlob({
    logicalPath: 'oont.json',
    bytes: Buffer.from(stableObjectText(manifestValue)),
    mediaType: 'application/json',
  });
  const current = store.readRefMetadata({ ontId: ontIdValue, branch: branchValue });
  if (current !== null) {
    const opened = openIndexAtCommit({ store, ontId: ontIdValue, commitSha256: current.ref.commitSha256 });
    if (opened.map.nativeObjectMapSha256 === map.nativeObjectMapSha256
      && opened.catalog.sourceCatalogSha256 === sourceCatalogSha256) {
      const core: Omit<SourceNativeObjectOntReceipt, 'receiptSha256'> = {
        schemaVersion: 1,
        kind: 'OpenOntologySourceNativeObjectOntReceiptV1',
        status: 'SOURCE_NATIVE_OBJECT_ONT_DURABLE',
        ontId: ontIdValue,
        branch: branchValue,
        commitSha256: current.ref.commitSha256,
        replaySha256: current.ref.replaySha256,
        refVersion: current.version,
        nativeObjectMapSha256: map.nativeObjectMapSha256,
        sourceCatalogSha256,
        sourceCount: sources.length,
        sourcePackCount: sourcePackDescriptors.length,
        sourceStorageLayout: catalog.sourceStorageLayout,
        nativeObjectCount: map.nativeObjectCount,
        replayed: true,
        exactSourcesRemainAuthority: true,
        canonicalTruthMutation: false,
      };
      const receipt: SourceNativeObjectOntReceipt = freeze({
        ...core,
        receiptSha256: stableObjectSha256(core),
      });
      return freeze({ map, catalog, receipt });
    }
    if (expectedVersion !== current.version) fail('SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT');
  } else if (expectedVersion !== null) {
    fail('SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT');
  }
  const commit = store.writeCommitMetadata({
    ontId: ontIdValue,
    parents: current === null ? [] : [current.ref.commitSha256],
    ontManifest: manifest,
    blobs: [
      ...sourcePackDescriptors,
      catalogBlob,
      mapBlob,
    ],
  });
  let ref: Record<string, unknown>;
  try {
    ref = store.compareAndSwapRefMetadata({
      ontId: ontIdValue,
      branch: branchValue,
      expectedVersion,
      commitSha256: commit.commitSha256,
    });
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'OBJECT_BACKEND_PRECONDITION') {
      fail('SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT');
    }
    throw error;
  }
  const opened = openIndexAtCommit({ store, ontId: ontIdValue, commitSha256: commit.commitSha256 });
  const refVersion = typeof ref.version === 'string' ? ref.version : fail('SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT');
  const core: Omit<SourceNativeObjectOntReceipt, 'receiptSha256'> = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeObjectOntReceiptV1',
    status: 'SOURCE_NATIVE_OBJECT_ONT_DURABLE',
    ontId: ontIdValue,
    branch: branchValue,
    commitSha256: commit.commitSha256,
    replaySha256: opened.replaySha256,
    refVersion,
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    sourceCatalogSha256,
    sourceCount: sources.length,
    sourcePackCount: sourcePackDescriptors.length,
    sourceStorageLayout: catalog.sourceStorageLayout,
    nativeObjectCount: map.nativeObjectCount,
    replayed: false,
    exactSourcesRemainAuthority: true,
    canonicalTruthMutation: false,
  };
  const receipt: SourceNativeObjectOntReceipt = freeze({
    ...core,
    receiptSha256: stableObjectSha256(core),
  });
  return freeze({
    map,
    catalog,
    receipt,
  });
}

export function openSourceNativeObjectOnt({ backend, ontId, commitSha256 }: {
  backend?: ObjectBackend; ontId?: string; commitSha256?: string;
} = {}) {
  if (!backend) fail('SOURCE_NATIVE_OBJECT_ONT_OPEN');
  return openAtCommit({ store: openObjectOntStore({ backend }), ontId: ontId ?? '', commitSha256: commitSha256 ?? '' });
}

export function openSourceNativeObjectOntIndex({ backend, ontId, commitSha256 }: {
  backend?: ObjectBackend; ontId?: string; commitSha256?: string;
} = {}) {
  if (!backend) fail('SOURCE_NATIVE_OBJECT_ONT_OPEN');
  return openIndexAtCommit({ store: openObjectOntStore({ backend }), ontId: ontId ?? '', commitSha256: commitSha256 ?? '' });
}
