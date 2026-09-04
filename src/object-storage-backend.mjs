/** Provider-neutral canonical object backend contract and local reference adapter. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const compare = (left, right) => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const canonical = (value) => JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort(compare).map((key) => [key, row[key]]))
  : row);
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const objectSha256 = (value) => sha256(Buffer.from(canonical(value)));
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };

function validateKey(key) {
  if (typeof key !== 'string' || key.length < 1 || key.length > 1024 || key.includes('\0')
    || key.startsWith('/') || key.includes('\\')) fail('OBJECT_BACKEND_KEY');
  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) fail('OBJECT_BACKEND_KEY');
  return key;
}

function exactBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  fail('OBJECT_BACKEND_BYTES');
}

function ensureDirectory(path) {
  if (existsSync(path)) {
    const status = lstatSync(path);
    if (!status.isDirectory() || status.isSymbolicLink()) fail('OBJECT_BACKEND_DIRECTORY');
    return;
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const status = lstatSync(path);
  if (!status.isDirectory() || status.isSymbolicLink()) fail('OBJECT_BACKEND_DIRECTORY');
}

function syncDirectory(path) {
  const descriptor = openSync(path, constants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function atomicReplace(path, bytes) {
  ensureDirectory(dirname(path));
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  const descriptor = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

function withKeyLock(lockPath, operation) {
  ensureDirectory(dirname(lockPath));
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') fail('OBJECT_BACKEND_BUSY');
    throw error;
  }
  writeFileSync(join(lockPath, 'owner.json'), `${canonical({ pid: process.pid })}\n`, { mode: 0o600 });
  syncDirectory(dirname(lockPath));
  try {
    return operation();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
    syncDirectory(dirname(lockPath));
  }
}

function makeEnvelope({ key, bytes, generation }) {
  const core = {
    schemaVersion: 1,
    kind: 'OpenOntologyFileObjectV1',
    key,
    generation,
    byteLength: bytes.length,
    checksumSha256: sha256(bytes),
    bytesBase64: bytes.toString('base64'),
  };
  return { ...core, envelopeSha256: objectSha256(core) };
}

function validateEnvelope(value, expectedKey) {
  const { envelopeSha256, ...core } = value ?? {};
  if (core.schemaVersion !== 1 || core.kind !== 'OpenOntologyFileObjectV1'
    || core.key !== expectedKey || !Number.isSafeInteger(core.generation) || core.generation < 1
    || !Number.isSafeInteger(core.byteLength) || core.byteLength < 0
    || !SHA256.test(core.checksumSha256 ?? '') || typeof core.bytesBase64 !== 'string'
    || objectSha256(core) !== envelopeSha256) fail('OBJECT_BACKEND_CORRUPT');
  const bytes = Buffer.from(core.bytesBase64, 'base64');
  if (bytes.toString('base64') !== core.bytesBase64 || bytes.length !== core.byteLength
    || sha256(bytes) !== core.checksumSha256) fail('OBJECT_BACKEND_CORRUPT');
  return { value, bytes };
}

function versionOf(envelope) {
  return `file-v1:${envelope.generation}:${envelope.envelopeSha256}`;
}

export const CANONICAL_OBJECT_BACKEND_CONTRACT = Object.freeze({
  schemaVersion: 1,
  kind: 'OpenOntologyCanonicalObjectBackendContractV1',
  operations: Object.freeze({
    putIfAbsent: 'required',
    compareAndSwap: 'required',
    rangeGet: 'required',
    checksummedBytes: 'required',
  }),
  correctness: Object.freeze({
    immutableObjectsAddressedByExactBytes: true,
    mutableRefsRequireOpaqueVersion: true,
    listingRequiredForReads: false,
    lastWriterWinsAllowed: false,
  }),
});

export function openFileObjectBackend({ root: rootInput } = {}) {
  if (typeof rootInput !== 'string' || !rootInput) fail('OBJECT_BACKEND_ROOT');
  const root = resolve(rootInput);
  if (dirname(root) === root) fail('OBJECT_BACKEND_ROOT');
  ensureDirectory(root);
  const objectsRoot = join(root, 'objects');
  const locksRoot = join(root, 'locks');
  ensureDirectory(objectsRoot);
  ensureDirectory(locksRoot);

  const capabilitiesCore = {
    schemaVersion: 1,
    kind: 'OpenOntologyObjectBackendCapabilitiesV1',
    backend: 'file',
    contractSha256: objectSha256(CANONICAL_OBJECT_BACKEND_CONTRACT),
    operations: CANONICAL_OBJECT_BACKEND_CONTRACT.operations,
    distributedObjectStore: false,
    multiProcessCas: false,
    singleProcessCas: true,
    providerConditionalWritePolicy: false,
  };
  const capabilities = Object.freeze({
    ...capabilitiesCore,
    capabilitiesSha256: objectSha256(capabilitiesCore),
  });
  const capabilitiesPath = join(root, 'BACKEND.json');
  const capabilitiesBytes = Buffer.from(`${canonical(capabilities)}\n`);
  if (!existsSync(capabilitiesPath)) atomicReplace(capabilitiesPath, capabilitiesBytes);
  else if (!readFileSync(capabilitiesPath).equals(capabilitiesBytes)) fail('OBJECT_BACKEND_CAPABILITIES');

  const pathsFor = (keyInput) => {
    const key = validateKey(keyInput);
    const keySha256 = sha256(Buffer.from(key));
    const hex = keySha256.slice(7);
    return {
      key,
      objectPath: join(objectsRoot, hex.slice(0, 2), `${hex.slice(2)}.json`),
      lockPath: join(locksRoot, `${hex}.lock`),
    };
  };
  const readCurrent = ({ key, objectPath }) => {
    if (!existsSync(objectPath)) return null;
    const status = lstatSync(objectPath);
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) fail('OBJECT_BACKEND_CORRUPT');
    let parsed;
    try { parsed = JSON.parse(readFileSync(objectPath, 'utf8')); } catch { fail('OBJECT_BACKEND_CORRUPT'); }
    return validateEnvelope(parsed, key);
  };
  const receipt = (key, envelope, extra = {}) => Object.freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyObjectWriteReceiptV1',
    key,
    version: versionOf(envelope),
    checksumSha256: envelope.checksumSha256,
    byteLength: envelope.byteLength,
    ...extra,
  });

  return Object.freeze({
    capabilities,
    head(keyInput) {
      const paths = pathsFor(keyInput);
      const current = readCurrent(paths);
      if (current === null) return null;
      return receipt(paths.key, current.value, { generation: current.value.generation });
    },
    get(keyInput, { start = 0, end = null } = {}) {
      const paths = pathsFor(keyInput);
      const current = readCurrent(paths);
      if (current === null) fail('OBJECT_BACKEND_NOT_FOUND');
      const finalEnd = end === null ? current.bytes.length : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(finalEnd)
        || start < 0 || finalEnd < start || finalEnd > current.bytes.length) fail('OBJECT_BACKEND_RANGE');
      return Object.freeze({
        ...receipt(paths.key, current.value, { generation: current.value.generation }),
        bytes: current.bytes.subarray(start, finalEnd),
        range: Object.freeze({ start, end: finalEnd }),
      });
    },
    putIfAbsent(keyInput, bytesInput) {
      const paths = pathsFor(keyInput);
      const bytes = exactBytes(bytesInput);
      return withKeyLock(paths.lockPath, () => {
        const current = readCurrent(paths);
        if (current !== null) {
          if (current.bytes.equals(bytes)) return receipt(paths.key, current.value, { created: false, replayed: true });
          fail('OBJECT_BACKEND_PRECONDITION');
        }
        const envelope = makeEnvelope({ key: paths.key, bytes, generation: 1 });
        atomicReplace(paths.objectPath, Buffer.from(`${canonical(envelope)}\n`));
        return receipt(paths.key, envelope, { created: true, replayed: false });
      });
    },
    compareAndSwap(keyInput, { expectedVersion = null, bytes: bytesInput } = {}) {
      const paths = pathsFor(keyInput);
      const bytes = exactBytes(bytesInput);
      if (expectedVersion !== null && (typeof expectedVersion !== 'string' || !expectedVersion)) {
        fail('OBJECT_BACKEND_VERSION');
      }
      return withKeyLock(paths.lockPath, () => {
        const current = readCurrent(paths);
        const currentVersion = current === null ? null : versionOf(current.value);
        if (currentVersion !== expectedVersion) fail('OBJECT_BACKEND_PRECONDITION');
        const envelope = makeEnvelope({
          key: paths.key,
          bytes,
          generation: current === null ? 1 : current.value.generation + 1,
        });
        atomicReplace(paths.objectPath, Buffer.from(`${canonical(envelope)}\n`));
        return receipt(paths.key, envelope, {
          created: current === null,
          replayed: false,
          previousVersion: currentVersion,
        });
      });
    },
  });
}
