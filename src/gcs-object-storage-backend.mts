/** Synchronous Google Cloud Storage backend for the canonical object contract. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CANONICAL_OBJECT_BACKEND_CONTRACT,
  type ObjectBackend,
  type ObjectBackendInput,
  type ObjectReadResult,
  type ObjectWriteReceipt,
} from './object-storage-backend.mjs';

export interface GcsTransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Buffer;
  curlPath: string;
}

export interface GcsTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export type GcsTransport = (request: GcsTransportRequest) => GcsTransportResponse;

export interface GcsObjectBackendOptions {
  bucket?: string;
  prefix?: string | null;
  accessToken?: string | null;
  accessTokenProvider?: (() => string) | null;
  endpoint?: string;
  curlPath?: string;
  transport?: GcsTransport;
  maximumReadAttempts?: number;
  retryDelay?: (attempt: number) => void;
}

export interface GcsObjectBackend extends ObjectBackend {
  ensureBucket(): { bucket: string; status: number; available: true };
  head(key: string): ObjectWriteReceipt | null;
  get(key: string, options?: { start?: number; end?: number | null }): ObjectReadResult;
}

interface GcsWriteReceipt extends ObjectWriteReceipt {
  generation: string;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GENERATION = /^[1-9][0-9]*$/u;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u;
const PREFIX = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u;
const RETRYABLE_READ_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const stable = (value: unknown): string => JSON.stringify(value, (_key: string, row: unknown) =>
  row && typeof row === 'object' && !Array.isArray(row)
    ? Object.fromEntries(Object.keys(row).sort(compare).map((key) => [key, (row as Record<string, unknown>)[key]]))
    : row) as string;
const sha256 = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digest = (value: unknown): string => sha256(Buffer.from(stable(value)));
const fail = (code: string, details: unknown = null): never => {
  const error = new Error(code) as Error & { code: string; details?: unknown };
  error.code = code;
  if (details !== null) error.details = details;
  throw error;
};

const defaultRetryDelay = (attempt: number): void => {
  const milliseconds = Math.min(1_000, 100 * (2 ** (attempt - 1)));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

function exactBytes(value: ObjectBackendInput | undefined): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  return fail('OBJECT_BACKEND_BYTES');
}

function validateKey(key: string): string {
  if (typeof key !== 'string' || key.length < 1 || Buffer.byteLength(key) > 1024 || key.includes('\0')
    || key.startsWith('/') || key.includes('\\')) fail('OBJECT_BACKEND_KEY');
  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail('OBJECT_BACKEND_KEY');
  }
  return key;
}

function validatePrefix(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !PREFIX.test(value) || value.endsWith('/')
    || value.includes('//') || value.split('/').some((part) => ['.', '..'].includes(part))) {
    fail('OBJECT_BACKEND_GCS_CONFIG');
  }
  return value;
}

function exactToken(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 16_384 || /\s/u.test(value)
    || /[\u0000-\u001f\u007f]/u.test(value)) fail('OBJECT_BACKEND_GCS_AUTH');
  return value;
}

function encodeVersion(generation: string): string {
  if (!GENERATION.test(generation ?? '')) fail('OBJECT_BACKEND_VERSION');
  return `gcs-v1:${generation}`;
}

function decodeVersion(version: string): { generation: string } {
  const match = /^gcs-v1:([1-9][0-9]*)$/u.exec(version ?? '');
  if (!match) fail('OBJECT_BACKEND_VERSION');
  return { generation: match?.[1] ?? fail('OBJECT_BACKEND_VERSION') };
}

function parseHeaders(bytes: Uint8Array): { status: number; headers: Record<string, string> } {
  const blocks = Buffer.from(bytes).toString('latin1').split(/\r?\n\r?\n/u).filter((block) => /^HTTP\//u.test(block));
  if (!blocks.length) fail('OBJECT_BACKEND_GCS_RESPONSE');
  const block = blocks.at(-1);
  if (!block) return fail('OBJECT_BACKEND_GCS_RESPONSE');
  const lines = block.split(/\r?\n/u);
  const statusMatch = /^HTTP\/\S+\s+(\d{3})/u.exec(lines.shift() ?? '');
  if (!statusMatch) return fail('OBJECT_BACKEND_GCS_RESPONSE');
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return { status: Number(statusMatch?.[1]), headers };
}

function curlTransport({ method, url, headers, body = Buffer.alloc(0), curlPath = '/usr/bin/curl' }: GcsTransportRequest): GcsTransportResponse {
  const scratch = mkdtempSync(join(tmpdir(), 'oont-gcs-request-'));
  const requestPath = join(scratch, 'request.bin');
  const requestHeadersPath = join(scratch, 'request-headers.txt');
  const responsePath = join(scratch, 'response.bin');
  const responseHeadersPath = join(scratch, 'response-headers.txt');
  writeFileSync(requestPath, body, { mode: 0o600 });
  writeFileSync(
    requestHeadersPath,
    `${Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\n')}\n`,
    { mode: 0o600 },
  );
  try {
    const args = [
      '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '120',
      '--request', method,
      '--header', `@${requestHeadersPath}`,
      '--dump-header', responseHeadersPath,
      '--output', responsePath,
      '--write-out', '%{http_code}',
    ];
    if (method !== 'GET' || body.length) args.push('--data-binary', `@${requestPath}`);
    args.push(url);
    const result = spawnSync(curlPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) fail('OBJECT_BACKEND_GCS_TRANSPORT', result.stderr?.trim());
    const parsed = parseHeaders(readFileSync(responseHeadersPath));
    if (parsed.status !== Number(result.stdout.trim())) fail('OBJECT_BACKEND_GCS_RESPONSE');
    return { ...parsed, body: readFileSync(responsePath) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function parseJson<T>(response: GcsTransportResponse, code: string): T {
  try { return JSON.parse(exactBytes(response.body).toString('utf8')) as T; } catch { return fail(code); }
}

function multipartUpload(key: string, bytes: Buffer, checksumSha256: string): { contentType: string; body: Buffer } {
  let boundary;
  let marker;
  do {
    boundary = `oont-${randomUUID()}`;
    marker = Buffer.from(`--${boundary}`);
  } while (bytes.includes(marker));
  const metadata = Buffer.from(JSON.stringify({
    name: key,
    contentType: 'application/octet-stream',
    metadata: {
      'oont-byte-length': String(bytes.length),
      'oont-sha256': checksumSha256,
    },
  }));
  const body = Buffer.concat([
    marker,
    Buffer.from('\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'),
    metadata,
    Buffer.from('\r\n'),
    marker,
    Buffer.from('\r\nContent-Type: application/octet-stream\r\n\r\n'),
    bytes,
    Buffer.from('\r\n'),
    marker,
    Buffer.from('--\r\n'),
  ]);
  return { contentType: `multipart/related; boundary=${boundary}`, body };
}

export function openGcsObjectBackend({
  bucket,
  prefix: prefixInput = null,
  accessToken = null,
  accessTokenProvider = null,
  endpoint: endpointInput = 'https://storage.googleapis.com',
  curlPath = '/usr/bin/curl',
  transport = curlTransport,
  maximumReadAttempts = 3,
  retryDelay = defaultRetryDelay,
}: GcsObjectBackendOptions = {}): GcsObjectBackend {
  let endpoint: URL;
  try { endpoint = new URL(endpointInput); } catch { return fail('OBJECT_BACKEND_GCS_CONFIG'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search
    || endpoint.hash || endpoint.pathname !== '/' || typeof bucket !== 'string' || !BUCKET.test(bucket)
    || typeof transport !== 'function' || typeof curlPath !== 'string' || !curlPath
    || !Number.isSafeInteger(maximumReadAttempts) || maximumReadAttempts < 1 || maximumReadAttempts > 10
    || typeof retryDelay !== 'function'
    || (accessToken === null) === (accessTokenProvider === null)
    || accessTokenProvider !== null && typeof accessTokenProvider !== 'function') {
    fail('OBJECT_BACKEND_GCS_CONFIG');
  }
  if (accessToken !== null) {
    try { exactToken(accessToken); } catch { fail('OBJECT_BACKEND_GCS_CONFIG'); }
  }
  const configuredBucket = typeof bucket === 'string'
    ? bucket : fail('OBJECT_BACKEND_GCS_CONFIG');
  const prefix = validatePrefix(prefixInput);
  const providerKey = (keyInput: string): string => {
    const key = validateKey(keyInput);
    const physicalKey = prefix === null ? key : `${prefix}/${key}`;
    if (Buffer.byteLength(physicalKey) > 1024) fail('OBJECT_BACKEND_KEY');
    return physicalKey;
  };

  const capabilitiesCore = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologyObjectBackendCapabilitiesV1' as const,
    backend: 'gcs',
    endpointOrigin: endpoint.origin,
    bucket: configuredBucket,
    keyPrefix: prefix,
    contractSha256: digest(CANONICAL_OBJECT_BACKEND_CONTRACT),
    operations: CANONICAL_OBJECT_BACKEND_CONTRACT.operations,
    distributedObjectStore: true,
    multiProcessCas: true,
    singleProcessCas: true,
    providerConditionalWritePolicy: true,
    nativeGenerationPreconditions: true,
    opaqueGenerationVersions: true,
    boundedReadRetries: true,
    maximumReadAttempts,
  };
  const capabilities = Object.freeze({ ...capabilitiesCore, capabilitiesSha256: digest(capabilitiesCore) });
  const token = (): string => accessTokenProvider === null
    ? exactToken(accessToken ?? fail('OBJECT_BACKEND_GCS_CONFIG'))
    : exactToken(accessTokenProvider());
  const call = ({ method, url, headers = {}, body = Buffer.alloc(0) }: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: Buffer;
  }): GcsTransportResponse => {
    for (let attempt = 1; attempt <= maximumReadAttempts; attempt += 1) {
      let response: GcsTransportResponse;
      try {
        response = transport({
          method,
          url,
          headers: { authorization: `Bearer ${token()}`, ...headers },
          body,
          curlPath,
        });
      } catch (error) {
        if (method !== 'GET' || !(error && typeof error === 'object' && 'code' in error
          && error.code === 'OBJECT_BACKEND_GCS_TRANSPORT') || attempt === maximumReadAttempts) {
          throw error;
        }
        retryDelay(attempt);
        continue;
      }
      if (!response || !Number.isInteger(response.status) || !response.headers
        || !Buffer.isBuffer(response.body)) fail('OBJECT_BACKEND_GCS_RESPONSE');
      if (method === 'GET' && RETRYABLE_READ_STATUS.has(response.status)
        && attempt < maximumReadAttempts) {
        retryDelay(attempt);
        continue;
      }
      return response;
    }
    return fail('OBJECT_BACKEND_GCS_TRANSPORT');
  };
  const bucketUrl = `${endpoint.origin}/storage/v1/b/${encodeURIComponent(configuredBucket)}`;
  const objectUrl = (key: string): string => `${bucketUrl}/o/${encodeURIComponent(providerKey(key))}`;
  const downloadUrl = (key: string): string => `${endpoint.origin}/${encodeURIComponent(configuredBucket)}/${
    providerKey(key).split('/').map(encodeURIComponent).join('/')}`;
  const uploadUrl = (key: string, expectedGeneration: string): string => {
    const url = new URL(`${endpoint.origin}/upload/storage/v1/b/${encodeURIComponent(configuredBucket)}/o`);
    url.searchParams.set('uploadType', 'multipart');
    url.searchParams.set('name', providerKey(key));
    url.searchParams.set('ifGenerationMatch', expectedGeneration);
    return url.href;
  };

  const exactMetadata = (value: Record<string, unknown>, expectedProviderKey: string | null = null,
    logicalKey: string = expectedProviderKey ?? fail('OBJECT_BACKEND_CORRUPT')): {
    key: string;
    generation: string;
    version: string;
    byteLength: number;
    checksumSha256: string;
  } => {
    const metadata = value.metadata && typeof value.metadata === 'object'
      ? value.metadata as Record<string, unknown> : {};
    const lengthText = metadata['oont-byte-length'];
    const sizeText = value.size;
    const generation = value.generation;
    const name = value.name;
    const checksumSha256 = metadata['oont-sha256'];
    const safeName = value.bucket === configuredBucket && typeof name === 'string'
      && (expectedProviderKey === null || name === expectedProviderKey)
      ? name : fail('OBJECT_BACKEND_CORRUPT');
    const safeGeneration = typeof generation === 'string' && GENERATION.test(generation)
      ? generation : fail('OBJECT_BACKEND_CORRUPT');
    const safeSizeText = typeof sizeText === 'string' && /^(0|[1-9][0-9]*)$/u.test(sizeText)
      && lengthText === sizeText ? sizeText : fail('OBJECT_BACKEND_CORRUPT');
    const safeChecksumSha256 = typeof checksumSha256 === 'string' && SHA256.test(checksumSha256)
      ? checksumSha256 : fail('OBJECT_BACKEND_CORRUPT');
    const byteLength = Number(safeSizeText);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) fail('OBJECT_BACKEND_CORRUPT');
    return {
      key: logicalKey,
      generation: safeGeneration,
      version: encodeVersion(safeGeneration),
      byteLength,
      checksumSha256: safeChecksumSha256,
    };
  };
  const receipt = (metadata: ReturnType<typeof exactMetadata>, extra: Record<string, unknown> = {}): GcsWriteReceipt => Object.freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyObjectWriteReceiptV1',
    key: metadata.key,
    version: metadata.version,
    checksumSha256: metadata.checksumSha256,
    byteLength: metadata.byteLength,
    generation: metadata.generation,
    ...extra,
  });
  const downloadMetadata = (headers: Record<string, string>, key: string): ReturnType<typeof exactMetadata> => {
    const generation = headers['x-goog-generation'];
    const byteLengthText = headers['x-goog-meta-oont-byte-length'];
    const checksumSha256 = headers['x-goog-meta-oont-sha256'];
    if (!GENERATION.test(generation ?? '')
      || !/^(?:0|[1-9][0-9]*)$/u.test(byteLengthText ?? '')
      || !SHA256.test(checksumSha256 ?? '')) fail('OBJECT_BACKEND_CORRUPT');
    const byteLength = Number(byteLengthText);
    if (!Number.isSafeInteger(byteLength)) fail('OBJECT_BACKEND_CORRUPT');
    return {
      key,
      generation,
      version: encodeVersion(generation),
      byteLength,
      checksumSha256,
    };
  };
  const head = (keyInput: string): GcsWriteReceipt | null => {
    const key = validateKey(keyInput);
    const response = call({ method: 'GET', url: objectUrl(key) });
    if (response.status === 404) return null;
    if (response.status !== 200) fail('OBJECT_BACKEND_GCS_STATUS', response.status);
    return receipt(exactMetadata(
      parseJson<Record<string, unknown>>(response, 'OBJECT_BACKEND_GCS_RESPONSE'), providerKey(key), key,
    ));
  };
  const get = (keyInput: string, { start = 0, end = null }: { start?: number; end?: number | null } = {}): ObjectReadResult => {
    const key = validateKey(keyInput);
    if (!Number.isSafeInteger(start) || start < 0
      || end !== null && (!Number.isSafeInteger(end) || end < start)) fail('OBJECT_BACKEND_RANGE');
    if (end === start) {
      const current = head(key) ?? fail('OBJECT_BACKEND_NOT_FOUND');
      if (end > current.byteLength) fail('OBJECT_BACKEND_RANGE');
      return Object.freeze({
        ...current,
        bytes: Buffer.alloc(0),
        range: Object.freeze({ start, end }),
      });
    }
    const full = start === 0 && end === null;
    const response = call({
      method: 'GET',
      url: downloadUrl(key),
      headers: full ? {} : { range: `bytes=${start}-${end === null ? '' : end - 1}` },
    });
    if (response.status === 404) fail('OBJECT_BACKEND_NOT_FOUND');
    if (response.status === 416) fail('OBJECT_BACKEND_RANGE');
    if (response.status !== (full ? 200 : 206)) fail('OBJECT_BACKEND_GCS_STATUS', response.status);
    const current = receipt(downloadMetadata(response.headers, key));
    const bytes = exactBytes(response.body);
    if (response.headers['content-length'] !== String(bytes.length)) fail('OBJECT_BACKEND_CORRUPT');
    let finalEnd: number;
    if (full) {
      finalEnd = current.byteLength;
      if (bytes.length !== current.byteLength || sha256(bytes) !== current.checksumSha256) {
        fail('OBJECT_BACKEND_CORRUPT');
      }
    } else {
      const range = /^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/u
        .exec(response.headers['content-range'] ?? '');
      const rangeStart = Number(range?.[1]);
      const rangeEnd = Number(range?.[2]) + 1;
      const total = Number(range?.[3]);
      finalEnd = end ?? total;
      if (!range || !Number.isSafeInteger(total) || rangeStart !== start
        || rangeEnd !== finalEnd || total !== current.byteLength
        || finalEnd > total || bytes.length !== finalEnd - start) {
        fail('OBJECT_BACKEND_CORRUPT');
      }
    }
    return Object.freeze({ ...current, bytes, range: Object.freeze({ start, end: finalEnd }) });
  };
  const put = (key: string, bytes: Buffer, expectedGeneration: string): GcsWriteReceipt | null => {
    const checksumSha256 = sha256(bytes);
    const multipart = multipartUpload(providerKey(key), bytes, checksumSha256);
    const response = call({
      method: 'POST',
      url: uploadUrl(key, expectedGeneration),
      headers: { 'content-type': multipart.contentType },
      body: multipart.body,
    });
    if (response.status === 412) return null;
    if (![200, 201].includes(response.status)) fail('OBJECT_BACKEND_GCS_STATUS', response.status);
    const metadata = exactMetadata(
      parseJson<Record<string, unknown>>(response, 'OBJECT_BACKEND_GCS_RESPONSE'), providerKey(key), key,
    );
    if (metadata.checksumSha256 !== checksumSha256 || metadata.byteLength !== bytes.length) {
      fail('OBJECT_BACKEND_CORRUPT');
    }
    return receipt(metadata);
  };

  return Object.freeze({
    capabilities,
    ensureBucket() {
      const response = call({ method: 'GET', url: bucketUrl });
      if (response.status !== 200) fail('OBJECT_BACKEND_GCS_BUCKET', response.status);
      const value = parseJson<Record<string, unknown>>(response, 'OBJECT_BACKEND_GCS_RESPONSE');
      if (value?.name !== configuredBucket) fail('OBJECT_BACKEND_GCS_RESPONSE');
      return Object.freeze({ bucket: configuredBucket, status: response.status, available: true });
    },
    head,
    get,
    putIfAbsent(keyInput: string, bytesInput: ObjectBackendInput): ObjectWriteReceipt {
      const key = validateKey(keyInput);
      const bytes = exactBytes(bytesInput);
      const written = put(key, bytes, '0');
      if (written !== null) return Object.freeze({ ...written, created: true, replayed: false });
      const current = get(key);
      if (!current.bytes.equals(bytes)) fail('OBJECT_BACKEND_PRECONDITION');
      const { bytes: _bytes, range: _range, ...currentReceipt } = current;
      return Object.freeze({ ...currentReceipt, created: false, replayed: true });
    },
    compareAndSwap(keyInput: string, { expectedVersion = null, bytes: bytesInput }: {
      expectedVersion?: string | null;
      bytes?: ObjectBackendInput;
    } = {}): ObjectWriteReceipt {
      const key = validateKey(keyInput);
      const bytes = exactBytes(bytesInput);
      const expected = expectedVersion === null ? null : decodeVersion(expectedVersion);
      const written = put(key, bytes, expected?.generation ?? '0');
      if (written === null) return fail('OBJECT_BACKEND_PRECONDITION');
      return Object.freeze({
        ...written,
        created: expected === null,
        replayed: false,
        previousVersion: expectedVersion,
      });
    },
  });
}
