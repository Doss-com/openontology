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

export { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const compare = (left, right) => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const freeze = (value) => {
  if (ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const clone = (value) => structuredClone(value);

function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stableObjectText(Object.keys(value).sort(compare)) !== stableObjectText([...keys].sort(compare))) fail(code);
}

function validateSha256(value, code) {
  if (!SHA256.test(value ?? '')) fail(code);
  return value;
}

function validateIdentity(value, code) {
  if (!ID.test(value ?? '')) fail(code);
  return value;
}

function validateLogicalPath(value, code) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0')
    || value.startsWith('/') || value.includes('\\')) fail(code);
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) fail(code);
  return value;
}

function exactBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  fail('OBJECT_ONT_BYTES');
}

function parseAssertionJsonl(bytesInput) {
  const bytes = exactBytes(bytesInput);
  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) fail('OBJECT_ONT_SEGMENT_JSONL');
  const lines = bytes.toString('utf8').split('\n');
  lines.pop();
  if (!lines.length || lines.some((line) => !line)) fail('OBJECT_ONT_SEGMENT_JSONL');
  const records = lines.map((line) => {
    let entry;
    try { entry = JSON.parse(line); } catch { fail('OBJECT_ONT_SEGMENT_JSONL'); }
    if (entryProblem(entry) !== null) fail('OBJECT_ONT_SEGMENT_ASSERTION');
    return {
      entry,
      line,
      lineSha256: objectBytesSha256(Buffer.from(line)),
    };
  });
  const variants = new Map();
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

function segmentDigestRows(records) {
  return records.map((record) => ({ assertionId: record.entry.id, lineSha256: record.lineSha256 }));
}

function validateSegmentDescriptor(value) {
  exactKeys(value, [
    'schemaVersion', 'kind', 'key', 'logicalPath', 'storedSha256', 'storedByteLength',
    'uncompressedSha256', 'uncompressedByteLength', 'lineCount', 'assertionLinesSha256',
  ], 'OBJECT_ONT_SEGMENT_DESCRIPTOR');
  if (value.schemaVersion !== 1 || value.kind !== 'OpenOntologyAssertionSegmentDescriptorV1'
    || validateLogicalPath(value.logicalPath, 'OBJECT_ONT_SEGMENT_DESCRIPTOR').startsWith('ledger/') !== true
    || !value.logicalPath.endsWith('.jsonl')
    || value.key !== `segments/sha256/${validateSha256(value.storedSha256, 'OBJECT_ONT_SEGMENT_DESCRIPTOR').slice(7)}.jsonl.zst`
    || !Number.isSafeInteger(value.storedByteLength) || value.storedByteLength < 1
    || !SHA256.test(value.uncompressedSha256 ?? '')
    || !Number.isSafeInteger(value.uncompressedByteLength) || value.uncompressedByteLength < 1
    || !Number.isSafeInteger(value.lineCount) || value.lineCount < 1
    || !SHA256.test(value.assertionLinesSha256 ?? '')) fail('OBJECT_ONT_SEGMENT_DESCRIPTOR');
  return value;
}

function validateBlobDescriptor(value, { manifest = false } = {}) {
  exactKeys(value, [
    'schemaVersion', 'kind', 'key', 'logicalPath', 'storedSha256', 'byteLength', 'mediaType',
  ], 'OBJECT_ONT_BLOB_DESCRIPTOR');
  if (value.schemaVersion !== 1 || value.kind !== 'OpenOntologyBlobDescriptorV1'
    || value.key !== `blobs/sha256/${validateSha256(value.storedSha256, 'OBJECT_ONT_BLOB_DESCRIPTOR').slice(7)}`
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
    || typeof value.mediaType !== 'string' || !value.mediaType
    || validateLogicalPath(value.logicalPath, 'OBJECT_ONT_BLOB_DESCRIPTOR') !== value.logicalPath
    || (manifest ? value.logicalPath !== 'oont.json' : !value.logicalPath.startsWith('blobs/'))) {
    fail('OBJECT_ONT_BLOB_DESCRIPTOR');
  }
  return value;
}

function descriptorOrder(left, right) {
  return compare(left.logicalPath, right.logicalPath) || compare(left.key, right.key);
}

function canonicalDescriptors(values, validator, code) {
  if (!Array.isArray(values)) fail(code);
  const normalized = values.map((value) => clone(validator(value))).sort(descriptorOrder);
  const identities = normalized.map((value) => `${value.logicalPath}\0${value.key}`);
  if (new Set(identities).size !== identities.length) fail(code);
  return normalized;
}

function validateCommitCore(value) {
  exactKeys(value, [
    'schemaVersion', 'kind', 'formatVersion', 'ontId', 'parents', 'assertionEnvelopeVersion',
    'storeManifestVersion', 'ontManifest', 'segments', 'blobs',
  ], 'OBJECT_ONT_COMMIT');
  if (value.schemaVersion !== 1 || value.kind !== 'OpenOntologyObjectCommitV1'
    || value.formatVersion !== 'object/v1' || value.assertionEnvelopeVersion !== ASSERTION_V
    || value.storeManifestVersion !== STORE_V) fail('OBJECT_ONT_COMMIT');
  validateIdentity(value.ontId, 'OBJECT_ONT_COMMIT');
  if (!Array.isArray(value.parents) || value.parents.length > 2
    || value.parents.some((parent) => !SHA256.test(parent))
    || new Set(value.parents).size !== value.parents.length
    || stableObjectText(value.parents) !== stableObjectText([...value.parents].sort(compare))) fail('OBJECT_ONT_COMMIT');
  validateBlobDescriptor(value.ontManifest, { manifest: true });
  const segments = canonicalDescriptors(value.segments, validateSegmentDescriptor, 'OBJECT_ONT_COMMIT');
  const blobs = canonicalDescriptors(value.blobs, (row) => validateBlobDescriptor(row), 'OBJECT_ONT_COMMIT');
  if (stableObjectText(segments) !== stableObjectText(value.segments)
    || stableObjectText(blobs) !== stableObjectText(value.blobs)) fail('OBJECT_ONT_COMMIT');
  return value;
}

function commitKey(commitSha256) {
  return `commits/sha256/${validateSha256(commitSha256, 'OBJECT_ONT_COMMIT_ID').slice(7)}.json`;
}

function refKey(ontId, branch) {
  return `refs/${validateIdentity(ontId, 'OBJECT_ONT_REF')}/${validateIdentity(branch, 'OBJECT_ONT_REF')}.json`;
}

function validateRef(value, { ontId, branch } = {}) {
  exactKeys(value, [
    'schemaVersion', 'kind', 'ontId', 'branch', 'commitSha256', 'replayStatus', 'replaySha256',
  ], 'OBJECT_ONT_REF');
  if (value.schemaVersion !== 1 || value.kind !== 'OpenOntologyBranchRefV1'
    || validateIdentity(value.ontId, 'OBJECT_ONT_REF') !== value.ontId
    || validateIdentity(value.branch, 'OBJECT_ONT_REF') !== value.branch
    || !SHA256.test(value.commitSha256 ?? '') || !['CLEAN', 'CONFLICT'].includes(value.replayStatus)
    || !SHA256.test(value.replaySha256 ?? '')
    || ontId && value.ontId !== ontId || branch && value.branch !== branch) fail('OBJECT_ONT_REF');
  return value;
}

function readBackendBytes(backend, key, expectedSha256, code) {
  const result = backend.get(key);
  if (result.checksumSha256 !== expectedSha256 || objectBytesSha256(result.bytes) !== expectedSha256) fail(code);
  return result;
}

function conflictOrder(left, right) {
  return compare(left.type, right.type) || compare(left.identity, right.identity);
}

export function openObjectOntStore({ backend } = {}) {
  if (!backend || typeof backend.get !== 'function' || typeof backend.putIfAbsent !== 'function'
    || typeof backend.compareAndSwap !== 'function' || typeof backend.head !== 'function') fail('OBJECT_ONT_BACKEND');

  const putAssertionSegment = ({ logicalPath, jsonlBytes }) => {
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

  const readAssertionSegment = (descriptorInput) => {
    const descriptor = validateSegmentDescriptor(descriptorInput);
    const stored = readBackendBytes(backend, descriptor.key, descriptor.storedSha256, 'OBJECT_ONT_SEGMENT_READ');
    if (stored.bytes.length !== descriptor.storedByteLength) fail('OBJECT_ONT_SEGMENT_READ');
    let uncompressed;
    try { uncompressed = zstdDecompressSync(stored.bytes); } catch { fail('OBJECT_ONT_SEGMENT_READ'); }
    const parsed = parseAssertionJsonl(uncompressed);
    if (parsed.bytes.length !== descriptor.uncompressedByteLength
      || objectBytesSha256(parsed.bytes) !== descriptor.uncompressedSha256
      || parsed.records.length !== descriptor.lineCount
      || stableObjectSha256(segmentDigestRows(parsed.records)) !== descriptor.assertionLinesSha256) {
      fail('OBJECT_ONT_SEGMENT_READ');
    }
    return freeze({ descriptor: clone(descriptor), bytes: parsed.bytes, records: parsed.records });
  };

  const putBlob = ({ logicalPath, bytes: bytesInput, mediaType = 'application/octet-stream' }) => {
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

  const readBlob = (descriptorInput, options = {}) => {
    const descriptor = validateBlobDescriptor(descriptorInput, options);
    const result = readBackendBytes(backend, descriptor.key, descriptor.storedSha256, 'OBJECT_ONT_BLOB_READ');
    if (result.bytes.length !== descriptor.byteLength) fail('OBJECT_ONT_BLOB_READ');
    return freeze({ descriptor: clone(descriptor), bytes: result.bytes });
  };

  const readBlobRange = (descriptorInput, { start = 0, end = null } = {}) => {
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

  const readCommit = (commitSha256) => {
    const key = commitKey(commitSha256);
    const result = readBackendBytes(backend, key, commitSha256, 'OBJECT_ONT_COMMIT_READ');
    let commit;
    try { commit = JSON.parse(result.bytes.toString('utf8')); } catch { fail('OBJECT_ONT_COMMIT_READ'); }
    validateCommitCore(commit);
    if (!result.bytes.equals(Buffer.from(stableObjectText(commit)))) fail('OBJECT_ONT_COMMIT_READ');
    return freeze({ commitSha256, key, byteLength: result.bytes.length, commit });
  };

  const readRefWith = ({ ontId, branch }, replayReader) => {
    const key = refKey(ontId, branch);
    if (backend.head(key) === null) return null;
    const result = backend.get(key);
    let ref;
    try { ref = JSON.parse(result.bytes.toString('utf8')); } catch { fail('OBJECT_ONT_REF_READ'); }
    validateRef(ref, { ontId, branch });
    if (!result.bytes.equals(Buffer.from(stableObjectText(ref)))) fail('OBJECT_ONT_REF_READ');
    const replay = replayReader(ref.commitSha256);
    if (replay.status !== ref.replayStatus || replay.replaySha256 !== ref.replaySha256) fail('OBJECT_ONT_REF_READ');
    return freeze({ ref: clone(ref), version: result.version, key, checksumSha256: result.checksumSha256 });
  };
  const readRef = (input) => readRefWith(input, replayGraph);
  const readRefMetadata = (input) => readRefWith(input, replayMetadataGraph);

  const loadGraph = (tipCommitSha256, virtualCommits = new Map()) => {
    validateSha256(tipCommitSha256, 'OBJECT_ONT_COMMIT_ID');
    const commits = new Map();
    const visiting = new Set();
    const order = [];
    const visit = (commitSha256) => {
      if (commits.has(commitSha256)) return;
      if (visiting.has(commitSha256)) fail('OBJECT_ONT_COMMIT_CYCLE');
      visiting.add(commitSha256);
      const record = virtualCommits.get(commitSha256) ?? readCommit(commitSha256);
      for (const parent of record.commit.parents) visit(parent);
      visiting.delete(commitSha256);
      commits.set(commitSha256, record);
      order.push(commitSha256);
    };
    visit(tipCommitSha256);
    const ontIds = new Set([...commits.values()].map((record) => record.commit.ontId));
    if (ontIds.size !== 1) fail('OBJECT_ONT_GRAPH_SCOPE');
    return { commits, order, ontId: [...ontIds][0] };
  };

  const compileReplayGraph = ({
    tipCommitSha256,
    virtualCommits = new Map(),
    hydrateBlobs,
  }) => {
    const graph = loadGraph(tipCommitSha256, virtualCommits);
    const segmentDescriptors = new Map();
    const blobDescriptors = new Map();
    for (const commitSha256 of graph.order) {
      const commit = graph.commits.get(commitSha256).commit;
      for (const descriptor of commit.segments) {
        const identity = `${descriptor.logicalPath}\0${descriptor.key}`;
        segmentDescriptors.set(identity, descriptor);
      }
      for (const descriptor of commit.blobs) {
        const identity = `${descriptor.logicalPath}\0${descriptor.key}`;
        blobDescriptors.set(identity, descriptor);
      }
    }

    const conflicts = [];
    const blobPaths = new Map();
    for (const descriptor of blobDescriptors.values()) {
      const variants = blobPaths.get(descriptor.logicalPath) ?? new Set();
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

    const assertionVariants = new Map();
    const entriesByLine = new Map();
    const segments = [...segmentDescriptors.values()].sort(descriptorOrder).map((descriptor) => {
      const loaded = readAssertionSegment(descriptor);
      for (const record of loaded.records) {
        const variants = assertionVariants.get(record.entry.id) ?? new Map();
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
    const superseders = new Map();
    for (const entry of entriesByLine.values()) {
      if (!entry.supersedes) continue;
      const ids = superseders.get(entry.supersedes) ?? new Set();
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

    const tipManifest = graph.commits.get(tipCommitSha256).commit.ontManifest;
    const canonicalSegmentDescriptors = [...segmentDescriptors.values()].sort(descriptorOrder);
    const canonicalBlobDescriptors = [...blobDescriptors.values()].sort(descriptorOrder);
    const manifest = hydrateBlobs ? readBlob(tipManifest, { manifest: true }) : null;
    const blobs = hydrateBlobs
      ? canonicalBlobDescriptors.map((descriptor) => readBlob(descriptor)) : null;
    const ledgerGroups = new Map();
    for (const segment of segments) {
      const rows = ledgerGroups.get(segment.descriptor.logicalPath) ?? [];
      rows.push(segment);
      ledgerGroups.set(segment.descriptor.logicalPath, rows);
    }
    const ledgerFiles = [...ledgerGroups.entries()].sort(([left], [right]) => compare(left, right)).map(([logicalPath, rows]) => {
      rows.sort((left, right) => compare(left.descriptor.key, right.descriptor.key));
      const bytes = Buffer.concat(rows.map((row) => row.bytes));
      return freeze({ logicalPath, bytes, sha256: objectBytesSha256(bytes), segmentKeys: rows.map((row) => row.descriptor.key) });
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
    if (hydrateBlobs) return freeze({
      ...replayCore,
      status,
      replaySha256,
      manifest,
      segments,
      blobs,
      ledgerFiles,
      entries,
    });
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
  const replayGraph = (tipCommitSha256, virtualCommits = new Map()) => compileReplayGraph({
    tipCommitSha256,
    virtualCommits,
    hydrateBlobs: true,
  });
  const replayMetadataGraph = (tipCommitSha256, virtualCommits = new Map()) =>
    compileReplayGraph({ tipCommitSha256, virtualCommits, hydrateBlobs: false });

  const planMerge = ({ leftCommitSha256, rightCommitSha256 }) => {
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
    const previewCore = {
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
  }, { hydratePayloadBlobs }) => {
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
      replayed: write.replayed,
    });
  };
  const writeCommit = (input) => writeCommitWith(input, { hydratePayloadBlobs: true });
  const writeCommitMetadata = (input) => writeCommitWith(input, { hydratePayloadBlobs: false });

  const merge = ({ leftCommitSha256, rightCommitSha256 }) => {
    const plan = planMerge({ leftCommitSha256, rightCommitSha256 });
    if (plan.status === 'FAST_FORWARD') return freeze({ plan, receipt: null, commitSha256: plan.targetCommitSha256 });
    if (plan.status !== 'CLEAN') fail('OBJECT_ONT_MERGE_CONFLICT');
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
  }, replayReader) => {
    const commit = readCommit(commitSha256);
    if (commit.commit.ontId !== ontId) fail('OBJECT_ONT_REF_SCOPE');
    const replay = replayReader(commitSha256);
    if (replay.status === 'CONFLICT' && allowConflicts !== true) fail('OBJECT_ONT_REF_CONFLICT');
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
  const compareAndSwapRef = (input) => compareAndSwapRefWith(input, replayGraph);
  const compareAndSwapRefMetadata = (input) => compareAndSwapRefWith(input, replayMetadataGraph);

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
    replay: (tipCommitSha256) => replayGraph(tipCommitSha256),
    replayMetadata: (tipCommitSha256) => replayMetadataGraph(tipCommitSha256),
    planMerge,
    merge,
    readRef,
    readRefMetadata,
    compareAndSwapRef,
    compareAndSwapRefMetadata,
  });
}
