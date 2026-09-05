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

export type ObjectBackendInput = string | Uint8Array;

export interface ObjectRange {
  start: number;
  end: number;
}

export interface ObjectBackendCapabilities {
  schemaVersion: 1;
  kind: 'OpenOntologyObjectBackendCapabilitiesV1';
  backend: string;
  contractSha256: string;
  operations: Readonly<Record<string, string>>;
  distributedObjectStore: boolean;
  multiProcessCas: boolean;
  singleProcessCas: boolean;
  providerConditionalWritePolicy: boolean;
  [key: string]: unknown;
}

export interface ObjectWriteReceipt {
  schemaVersion: 1;
  kind: 'OpenOntologyObjectWriteReceiptV1';
  key: string;
  version: string;
  checksumSha256: string;
  byteLength: number;
  generation?: number | string;
  created?: boolean;
  replayed?: boolean;
  previousVersion?: string | null;
  [key: string]: unknown;
}

export interface ObjectReadResult extends ObjectWriteReceipt {
  bytes: Buffer;
  range: ObjectRange;
}

export interface ObjectBackend {
  capabilities: ObjectBackendCapabilities;
  head(key: string): ObjectWriteReceipt | null;
  get(key: string, options?: { start?: number; end?: number | null }): ObjectReadResult;
  putIfAbsent(key: string, bytes: ObjectBackendInput): ObjectWriteReceipt;
  compareAndSwap(key: string, options: {
    expectedVersion?: string | null;
    bytes: ObjectBackendInput;
  }): ObjectWriteReceipt;
  ensureBucket?: () => { bucket: string; status: number; available: true };
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const canonical = (value: unknown): string => JSON.stringify(value, (_key: string, row: unknown) =>
  row && typeof row === 'object' && !Array.isArray(row)
    ? Object.fromEntries(Object.keys(row).sort(compare).map((key) => [key, (row as Record<string, unknown>)[key]]))
    : row) as string;
const sha256 = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const objectSha256 = (value: unknown): string => sha256(Buffer.from(canonical(value)));
const fail = (code: string): never => {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  throw error;
};

function validateKey(key: string): string {
  if (typeof key !== 'string' || key.length < 1 || key.length > 1024 || key.includes('\0')
    || key.startsWith('/') || key.includes('\\')) fail('OBJECT_BACKEND_KEY');
  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) fail('OBJECT_BACKEND_KEY');
  return key;
}

function exactBytes(value: ObjectBackendInput | undefined): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  return fail('OBJECT_BACKEND_BYTES');
}

function ensureDirectory(path: string): void {
  if (existsSync(path)) {
    const status = lstatSync(path);
    if (!status.isDirectory() || status.isSymbolicLink()) fail('OBJECT_BACKEND_DIRECTORY');
    return;
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const status = lstatSync(path);
  if (!status.isDirectory() || status.isSymbolicLink()) fail('OBJECT_BACKEND_DIRECTORY');
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function atomicReplace(path: string, bytes: Uint8Array): void {
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

function withKeyLock<T>(lockPath: string, operation: () => T): T {
  ensureDirectory(dirname(lockPath));
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      fail('OBJECT_BACKEND_BUSY');
    }
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

interface FileObjectEnvelope {
  schemaVersion: 1;
  kind: 'OpenOntologyFileObjectV1';
  key: string;
  generation: number;
  byteLength: number;
  checksumSha256: string;
  bytesBase64: string;
  envelopeSha256: string;
}

function makeEnvelope({ key, bytes, generation }: {
  key: string;
  bytes: Buffer;
  generation: number;
}): FileObjectEnvelope {
  const core = {
    schemaVersion: 1,
    kind: 'OpenOntologyFileObjectV1',
    key,
    generation,
    byteLength: bytes.length,
    checksumSha256: sha256(bytes),
    bytesBase64: bytes.toString('base64'),
  };
  return { ...core, envelopeSha256: objectSha256(core) } as FileObjectEnvelope;
}

function validateEnvelope(value: unknown, expectedKey: string): { value: FileObjectEnvelope; bytes: Buffer } {
  const { envelopeSha256, ...core } = value && typeof value === 'object'
    ? value as Record<string, unknown> : {};
  const generation = core.generation;
  const byteLength = core.byteLength;
  const checksumSha256 = core.checksumSha256;
  const bytesBase64 = core.bytesBase64;
  if (core.schemaVersion !== 1 || core.kind !== 'OpenOntologyFileObjectV1'
    || core.key !== expectedKey || typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1
    || typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0
    || typeof checksumSha256 !== 'string' || !SHA256.test(checksumSha256)
    || objectSha256(core) !== envelopeSha256) fail('OBJECT_BACKEND_CORRUPT');
  const safeBytesBase64 = typeof bytesBase64 === 'string'
    ? bytesBase64 : fail('OBJECT_BACKEND_CORRUPT');
  const bytes = Buffer.from(safeBytesBase64, 'base64');
  if (bytes.toString('base64') !== safeBytesBase64 || bytes.length !== byteLength
    || sha256(bytes) !== checksumSha256) fail('OBJECT_BACKEND_CORRUPT');
  return { value: value as FileObjectEnvelope, bytes };
}

function versionOf(envelope: FileObjectEnvelope): string {
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

export function openFileObjectBackend({ root: rootInput }: { root?: string } = {}): ObjectBackend {
  if (typeof rootInput !== 'string' || !rootInput) fail('OBJECT_BACKEND_ROOT');
  const root = resolve(typeof rootInput === 'string' && rootInput
    ? rootInput : fail('OBJECT_BACKEND_ROOT'));
  if (dirname(root) === root) fail('OBJECT_BACKEND_ROOT');
  ensureDirectory(root);
  const objectsRoot = join(root, 'objects');
  const locksRoot = join(root, 'locks');
  ensureDirectory(objectsRoot);
  ensureDirectory(locksRoot);

  const capabilitiesCore = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologyObjectBackendCapabilitiesV1' as const,
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

  const pathsFor = (keyInput: string): { key: string; objectPath: string; lockPath: string } => {
    const key = validateKey(keyInput);
    const keySha256 = sha256(Buffer.from(key));
    const hex = keySha256.slice(7);
    return {
      key,
      objectPath: join(objectsRoot, hex.slice(0, 2), `${hex.slice(2)}.json`),
      lockPath: join(locksRoot, `${hex}.lock`),
    };
  };
  const readCurrent = ({ key, objectPath }: { key: string; objectPath: string }): { value: FileObjectEnvelope; bytes: Buffer } | null => {
    if (!existsSync(objectPath)) return null;
    const status = lstatSync(objectPath);
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) fail('OBJECT_BACKEND_CORRUPT');
    let parsed;
    try { parsed = JSON.parse(readFileSync(objectPath, 'utf8')); } catch { fail('OBJECT_BACKEND_CORRUPT'); }
    return validateEnvelope(parsed, key);
  };
  const receipt = (key: string, envelope: FileObjectEnvelope, extra: Record<string, unknown> = {}): ObjectWriteReceipt => Object.freeze({
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
    head(keyInput: string): ObjectWriteReceipt | null {
      const paths = pathsFor(keyInput);
      const current = readCurrent(paths);
      if (current === null) return null;
      return receipt(paths.key, current.value, { generation: current.value.generation });
    },
    get(keyInput: string, { start = 0, end = null }: { start?: number; end?: number | null } = {}): ObjectReadResult {
      const paths = pathsFor(keyInput);
      const current = readCurrent(paths);
      if (current === null) return fail('OBJECT_BACKEND_NOT_FOUND');
      const finalEnd = end === null ? current.bytes.length : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(finalEnd)
        || start < 0 || finalEnd < start || finalEnd > current.bytes.length) fail('OBJECT_BACKEND_RANGE');
      return Object.freeze({
        ...receipt(paths.key, current.value, { generation: current.value.generation }),
        bytes: current.bytes.subarray(start, finalEnd),
        range: Object.freeze({ start, end: finalEnd }),
      });
    },
    putIfAbsent(keyInput: string, bytesInput: ObjectBackendInput): ObjectWriteReceipt {
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
    compareAndSwap(keyInput: string, { expectedVersion = null, bytes: bytesInput }: {
      expectedVersion?: string | null;
      bytes?: ObjectBackendInput;
    } = {}): ObjectWriteReceipt {
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
