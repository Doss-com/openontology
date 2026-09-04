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

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_SOURCE_PACK_BYTES = 8 * 1024 * 1024;
const compare = (left, right) => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code) => {
  const error = new TypeError(code);
  error.code = code;
  throw error;
};
const freeze = (value) => {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function exactTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function normalizeSources(sourceInput) {
  if (!Array.isArray(sourceInput) || sourceInput.length < 1) {
    fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
  }
  const paths = new Set();
  const sources = sourceInput.map((source) => {
    if (typeof source?.relativePath !== 'string' || !source.relativePath
      || source.relativePath.startsWith('/') || source.relativePath.includes('\\')
      || source.relativePath.split('/').some((part) => !part || part === '.' || part === '..')
      || typeof source.sourceType !== 'string' || !source.sourceType
      || source.relativePath.split('/')[0] !== source.sourceType
      || !exactTime(source.occurredAt)
      || typeof source.content !== 'string' || !source.content
      || !SHA256.test(source.sourceSha256 ?? '')
      || objectBytesSha256(Buffer.from(source.content)) !== source.sourceSha256
      || paths.has(source.relativePath)) {
      fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    }
    paths.add(source.relativePath);
    return freeze({
      relativePath: source.relativePath,
      sourceType: source.sourceType,
      occurredAt: source.occurredAt,
      content: source.content,
      sourceSha256: source.sourceSha256,
    });
  });
  return freeze(sources.sort((left, right) => compare(left.relativePath, right.relativePath)));
}

function sourceBlobPath(sourceSha256) {
  return `blobs/source-native/sources/sha256/${sourceSha256.slice(7)}`;
}

function sourcePackBlobPath(packSha256) {
  return `blobs/source-native/source-packs/sha256/${packSha256.slice(7)}`;
}

function catalogBlobPath(catalogSha256) {
  return `blobs/source-native/catalogs/sha256/${catalogSha256.slice(7)}.json`;
}

function mapBlobPath(nativeObjectMapSha256) {
  return `blobs/source-native/maps/sha256/${nativeObjectMapSha256.slice(7)}.json`;
}

function parseStableJson(bytes, code) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail(code); }
  if (!bytes.equals(Buffer.from(stableObjectText(value)))) fail(code);
  return value;
}

function descriptorByLogicalPath(replay, logicalPath, expectedSha256, code) {
  const descriptors = replay.blobDescriptors ?? replay.blobs?.map((row) => row.descriptor) ?? [];
  const rows = descriptors.filter((row) => row.logicalPath === logicalPath);
  if (rows.length !== 1 || rows[0].storedSha256 !== expectedSha256) fail(code);
  return rows[0];
}

function validateManifest(manifest, ontId) {
  if (manifest?.schemaVersion !== 1
    || manifest.kind !== 'OpenOntologySourceNativeObjectOntManifestV1'
    || manifest.formatVersion !== 'object/v1'
    || manifest.ontId !== ontId
    || !SHA256.test(manifest.nativeObjectMapSha256 ?? '')
    || !SHA256.test(manifest.sourceCatalogSha256 ?? '')
    || typeof manifest.mapBlobLogicalPath !== 'string'
    || !SHA256.test(manifest.mapBlobStoredSha256 ?? '')
    || typeof manifest.catalogBlobLogicalPath !== 'string'
    || !SHA256.test(manifest.catalogBlobStoredSha256 ?? '')
    || manifest.exactSourcesRemainAuthority !== true
    || manifest.navigationOnly !== true
    || manifest.canonicalTruthMutation !== false) {
    fail('SOURCE_NATIVE_OBJECT_ONT_MANIFEST');
  }
  return manifest;
}

function openIndexAtCommit({ store, ontId, commitSha256 }) {
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
  const map = validateSourceNativeObjectMap(parseStableJson(mapBlob.bytes,
    'SOURCE_NATIVE_OBJECT_ONT_MAP'));
  if (map.nativeObjectMapSha256 !== manifest.nativeObjectMapSha256) {
    fail('SOURCE_NATIVE_OBJECT_ONT_MAP');
  }
  const catalogDescriptor = descriptorByLogicalPath(replay, manifest.catalogBlobLogicalPath,
    manifest.catalogBlobStoredSha256, 'SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  const catalogBlob = store.readBlob(catalogDescriptor);
  const catalog = parseStableJson(catalogBlob.bytes, 'SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  const { sourceCatalogSha256, ...catalogCore } = catalog ?? {};
  if (catalog?.schemaVersion !== 1 || catalog.kind !== 'OpenOntologySourceNativeCatalogV1'
    || !SHA256.test(sourceCatalogSha256 ?? '')
    || stableObjectSha256(catalogCore) !== sourceCatalogSha256
    || sourceCatalogSha256 !== manifest.sourceCatalogSha256
    || !Array.isArray(catalog.sources) || catalog.sourceCount !== catalog.sources.length
    || catalog.sourceCount !== map.sourceCount) {
    fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  }
  const packedSources = catalog.sourceStorageLayout === 'packed-ranges-v1';
  if (!(packedSources
    ? Number.isSafeInteger(catalog.sourcePackCount) && catalog.sourcePackCount >= 1
    : catalog.sourceStorageLayout === undefined && catalog.sourcePackCount === undefined)) {
    fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
  }
  const sources = catalog.sources.map((row) => {
    if (typeof row?.relativePath !== 'string' || !row.relativePath
      || typeof row.sourceType !== 'string' || !row.sourceType
      || !exactTime(row.occurredAt) || !SHA256.test(row.sourceSha256 ?? '')
      || typeof row.blobLogicalPath !== 'string') {
      fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
    }
    if (packedSources
      && (!SHA256.test(row.blobStoredSha256 ?? '')
        || row.blobLogicalPath !== sourcePackBlobPath(row.blobStoredSha256)
        || !Number.isSafeInteger(row.byteStart) || row.byteStart < 0
        || !Number.isSafeInteger(row.byteEnd) || row.byteEnd <= row.byteStart)
      || !packedSources && row.blobLogicalPath !== sourceBlobPath(row.sourceSha256)) {
      fail('SOURCE_NATIVE_OBJECT_ONT_CATALOG');
    }
    const expectedBlobSha256 = packedSources ? row.blobStoredSha256 : row.sourceSha256;
    const blobDescriptor = descriptorByLogicalPath(replay, row.blobLogicalPath,
      expectedBlobSha256, 'SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    const byteStart = packedSources ? row.byteStart : 0;
    const byteEnd = packedSources ? row.byteEnd : blobDescriptor.byteLength;
    if (byteEnd > blobDescriptor.byteLength) fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    return freeze({
      relativePath: row.relativePath,
      sourceType: row.sourceType,
      occurredAt: row.occurredAt,
      sourceSha256: row.sourceSha256,
      blobDescriptor,
      blobByteStart: byteStart,
      blobByteEnd: byteEnd,
    });
  });
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

function openAtCommit({ store, ontId, commitSha256 }) {
  const index = openIndexAtCommit({ store, ontId, commitSha256 });
  const packBytesByKey = new Map();
  const sources = index.sources.map((source) => {
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
    if (!source || source.sourceSha256 !== object.sourceSha256) fail('SOURCE_NATIVE_OBJECT_ONT_SOURCE');
    const bytes = Buffer.from(source.content);
    for (const field of object.fields) {
      const evidence = field.evidence;
      if (evidence.relativePath !== source.relativePath
        || evidence.sourceSha256 !== source.sourceSha256
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
} = {}) {
  if (!backend || typeof backend.putIfAbsent !== 'function'
    || typeof backend.compareAndSwap !== 'function'
    || typeof ontId !== 'string' || !ontId
    || typeof branch !== 'string' || !branch
    || !(expectedVersion === null || typeof expectedVersion === 'string')) {
    fail('SOURCE_NATIVE_OBJECT_ONT_INPUT');
  }
  const sources = normalizeSources(sourceInput);
  const map = compileSourceNativeObjectMap({ sources, nativeObjectInputs, adapterDiagnostics });
  const store = openObjectOntStore({ backend });
  const sourcePacks = [];
  let currentPack = { byteLength: 0, sources: [], bytes: [] };
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
  const sourcePackDescriptors = [];
  const sourceCatalogRows = [];
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
  const catalogCore = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeCatalogV1',
    sourceCount: sources.length,
    sourceStorageLayout: 'packed-ranges-v1',
    sourcePackCount: sourcePackDescriptors.length,
    sources: freeze(sourceCatalogRows),
    exactSourcesRemainAuthority: true,
  };
  const sourceCatalogSha256 = stableObjectSha256(catalogCore);
  const catalog = freeze({ ...catalogCore, sourceCatalogSha256 });
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
    ontId,
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
  const current = store.readRefMetadata({ ontId, branch });
  if (current !== null) {
    const opened = openIndexAtCommit({ store, ontId, commitSha256: current.ref.commitSha256 });
    if (opened.map.nativeObjectMapSha256 === map.nativeObjectMapSha256
      && opened.catalog.sourceCatalogSha256 === sourceCatalogSha256) {
      const core = {
        schemaVersion: 1,
        kind: 'OpenOntologySourceNativeObjectOntReceiptV1',
        status: 'SOURCE_NATIVE_OBJECT_ONT_DURABLE',
        ontId,
        branch,
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
      return freeze({ map, catalog, receipt: freeze({ ...core, receiptSha256: stableObjectSha256(core) }) });
    }
    if (expectedVersion !== current.version) fail('SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT');
  } else if (expectedVersion !== null) {
    fail('SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT');
  }
  const commit = store.writeCommitMetadata({
    ontId,
    parents: current === null ? [] : [current.ref.commitSha256],
    ontManifest: manifest,
    blobs: [
      ...sourcePackDescriptors,
      catalogBlob,
      mapBlob,
    ],
  });
  let ref;
  try {
    ref = store.compareAndSwapRefMetadata({
      ontId,
      branch,
      expectedVersion,
      commitSha256: commit.commitSha256,
    });
  } catch (error) {
    if (error?.code === 'OBJECT_BACKEND_PRECONDITION') {
      fail('SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT');
    }
    throw error;
  }
  const opened = openIndexAtCommit({ store, ontId, commitSha256: commit.commitSha256 });
  const core = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeObjectOntReceiptV1',
    status: 'SOURCE_NATIVE_OBJECT_ONT_DURABLE',
    ontId,
    branch,
    commitSha256: commit.commitSha256,
    replaySha256: opened.replaySha256,
    refVersion: ref.version,
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
  return freeze({
    map,
    catalog,
    receipt: freeze({ ...core, receiptSha256: stableObjectSha256(core) }),
  });
}

export function openSourceNativeObjectOnt({ backend, ontId, commitSha256 } = {}) {
  if (!backend) fail('SOURCE_NATIVE_OBJECT_ONT_OPEN');
  return openAtCommit({ store: openObjectOntStore({ backend }), ontId, commitSha256 });
}

export function openSourceNativeObjectOntIndex({ backend, ontId, commitSha256 } = {}) {
  if (!backend) fail('SOURCE_NATIVE_OBJECT_ONT_OPEN');
  return openIndexAtCommit({ store: openObjectOntStore({ backend }), ontId, commitSha256 });
}
