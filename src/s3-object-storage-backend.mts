/** Synchronous SigV4 S3-compatible backend for the canonical object contract. */
import { createHash, createHmac, randomUUID, type BinaryLike, type BinaryToTextEncoding } from 'node:crypto';
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

export interface S3ObjectBackendOptions {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string | null;
  curlPath?: string;
  now?: () => Date;
  providerConditionalWritePolicy?: boolean;
}

export interface S3ObjectBackend extends ObjectBackend {
  ensureBucket(): { bucket: string; status: number; available: true };
  head(key: string): ObjectWriteReceipt | null;
  get(key: string, options?: { start?: number; end?: number | null }): ObjectReadResult;
}

interface S3WriteReceipt extends ObjectWriteReceipt {
  generation: number;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const stable = (value: unknown): string => JSON.stringify(value, (_key: string, row: unknown) =>
  row && typeof row === 'object' && !Array.isArray(row)
    ? Object.fromEntries(Object.keys(row).sort(compare).map((key) => [key, (row as Record<string, unknown>)[key]]))
    : row) as string;
const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sha256 = (bytes: Uint8Array): string => `sha256:${sha256Hex(bytes)}`;
const digest = (value: unknown): string => sha256(Buffer.from(stable(value)));
const hmac = (key: BinaryLike, value: string, encoding?: BinaryToTextEncoding): Buffer | string =>
  encoding === undefined
    ? createHmac('sha256', key).update(value).digest()
    : createHmac('sha256', key).update(value).digest(encoding);
const fail = (code: string, details: unknown = null): never => {
  const error = new Error(code) as Error & { code: string; details?: unknown };
  error.code = code;
  if (details) error.details = details;
  throw error;
};

function exactBytes(value: ObjectBackendInput | undefined): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  return fail('OBJECT_BACKEND_BYTES');
}

function validateKey(key: string): string {
  if (typeof key !== 'string' || key.length < 1 || key.length > 1024 || key.includes('\0')
    || key.startsWith('/') || key.includes('\\')) fail('OBJECT_BACKEND_KEY');
  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) fail('OBJECT_BACKEND_KEY');
  return key;
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(bucket: string, key: string | null = null): string {
  const segments = key === null ? [bucket] : [bucket, ...validateKey(key).split('/')];
  return `/${segments.map(awsEncode).join('/')}`;
}

function amzClock(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString();
  return {
    amzDate: iso.replace(/[:-]|\.\d{3}/gu, ''),
    dateStamp: iso.slice(0, 10).replaceAll('-', ''),
  };
}

function parseHeaders(bytes: Uint8Array): { status: number; headers: Record<string, string> } {
  const blocks = Buffer.from(bytes).toString('latin1').split(/\r?\n\r?\n/u).filter((block) => /^HTTP\//u.test(block));
  if (!blocks.length) fail('OBJECT_BACKEND_S3_RESPONSE');
  const block = blocks.at(-1);
  if (!block) return fail('OBJECT_BACKEND_S3_RESPONSE');
  const lines = block.split(/\r?\n/u);
  const statusMatch = /^HTTP\/\S+\s+(\d{3})/u.exec(lines.shift() ?? '');
  if (!statusMatch) return fail('OBJECT_BACKEND_S3_RESPONSE');
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

function encodeVersion(generation: number, etag: string): string {
  if (!Number.isSafeInteger(generation) || generation < 0 || typeof etag !== 'string' || !etag) fail('OBJECT_BACKEND_VERSION');
  return `s3-v1:${generation}:${Buffer.from(etag).toString('base64url')}`;
}

function decodeVersion(version: string): { generation: number; etag: string } {
  const match = /^s3-v1:(\d+):([A-Za-z0-9_-]+)$/u.exec(version ?? '');
  if (!match) return fail('OBJECT_BACKEND_VERSION');
  const generation = Number(match?.[1]);
  const etag = Buffer.from(match?.[2] ?? '', 'base64url').toString('utf8');
  if (!Number.isSafeInteger(generation) || generation < 0 || !etag) fail('OBJECT_BACKEND_VERSION');
  return { generation, etag };
}

function makeCasEnvelope(bytes: Buffer, generation: number): Buffer {
  const core = {
    schemaVersion: 1,
    kind: 'OpenOntologyS3CasEnvelopeV1',
    generation,
    byteLength: bytes.length,
    checksumSha256: sha256(bytes),
    bytesBase64: bytes.toString('base64'),
  };
  return Buffer.from(stable({ ...core, envelopeSha256: digest(core) }));
}

function readCasEnvelope(storedBytes: Buffer, expectedGeneration: number, expectedChecksum: string, expectedLength: number): Buffer {
  let value;
  try { value = JSON.parse(storedBytes.toString('utf8')); } catch { fail('OBJECT_BACKEND_CORRUPT'); }
  const { envelopeSha256, ...core } = value && typeof value === 'object'
    ? value as Record<string, unknown> : {};
  const bytesBase64 = core.bytesBase64;
  if (core.schemaVersion !== 1 || core.kind !== 'OpenOntologyS3CasEnvelopeV1'
    || core.generation !== expectedGeneration || core.byteLength !== expectedLength
    || core.checksumSha256 !== expectedChecksum || digest(core) !== envelopeSha256) fail('OBJECT_BACKEND_CORRUPT');
  const safeBytesBase64 = typeof bytesBase64 === 'string'
    ? bytesBase64 : fail('OBJECT_BACKEND_CORRUPT');
  const bytes = Buffer.from(safeBytesBase64, 'base64');
  if (bytes.toString('base64') !== safeBytesBase64 || bytes.length !== expectedLength
    || sha256(bytes) !== expectedChecksum) fail('OBJECT_BACKEND_CORRUPT');
  return bytes;
}

export function openS3ObjectBackend({
  endpoint: endpointInput,
  region = 'us-east-1',
  bucket,
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  curlPath = '/usr/bin/curl',
  now = () => new Date(),
  providerConditionalWritePolicy = false,
}: S3ObjectBackendOptions = {}): S3ObjectBackend {
  let endpoint: URL;
  try { endpoint = new URL(endpointInput ?? ''); } catch { return fail('OBJECT_BACKEND_S3_CONFIG'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || typeof bucket !== 'string' || !BUCKET.test(bucket)
    || typeof region !== 'string' || !region || typeof accessKeyId !== 'string' || !accessKeyId
    || typeof secretAccessKey !== 'string' || !secretAccessKey || typeof now !== 'function') fail('OBJECT_BACKEND_S3_CONFIG');
  if (typeof bucket !== 'string' || typeof region !== 'string'
    || typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
    fail('OBJECT_BACKEND_S3_CONFIG');
  }
  const configuredBucket = typeof bucket === 'string' ? bucket : fail('OBJECT_BACKEND_S3_CONFIG');
  const configuredRegion = typeof region === 'string' ? region : fail('OBJECT_BACKEND_S3_CONFIG');
  const configuredAccessKeyId = typeof accessKeyId === 'string' ? accessKeyId : fail('OBJECT_BACKEND_S3_CONFIG');
  const configuredSecretAccessKey = typeof secretAccessKey === 'string' ? secretAccessKey : fail('OBJECT_BACKEND_S3_CONFIG');
  const capabilitiesCore = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologyObjectBackendCapabilitiesV1' as const,
    backend: 's3-compatible',
    endpointOrigin: endpoint.origin,
    bucket: configuredBucket,
    region: configuredRegion,
    contractSha256: digest(CANONICAL_OBJECT_BACKEND_CONTRACT),
    operations: CANONICAL_OBJECT_BACKEND_CONTRACT.operations,
    distributedObjectStore: true,
    multiProcessCas: true,
    singleProcessCas: true,
    providerConditionalWritePolicy: providerConditionalWritePolicy === true,
    mutableRefEnvelope: 'OpenOntologyS3CasEnvelopeV1',
  };
  const capabilities = Object.freeze({ ...capabilitiesCore, capabilitiesSha256: digest(capabilitiesCore) });

  const request = ({ method, key = null, headers: inputHeaders = {}, body: bodyInput = Buffer.alloc(0) }: {
    method: string;
    key?: string | null;
    headers?: Record<string, string>;
    body?: ObjectBackendInput;
  }): { status: number; headers: Record<string, string>; body: Buffer } => {
    const body = exactBytes(bodyInput);
    const clock = amzClock(now());
    const uri = canonicalUri(configuredBucket, key);
    const payloadHash = sha256Hex(body);
    const headers = Object.fromEntries(Object.entries({
      host: endpoint.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': clock.amzDate,
      ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
      ...inputHeaders,
    }).map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/gu, ' ')]));
    const signedNames = Object.keys(headers).sort(compare);
    const canonicalHeaders = `${signedNames.map((name) => `${name}:${headers[name]}`).join('\n')}\n`;
    const canonicalRequest = [method, uri, '', canonicalHeaders, signedNames.join(';'), payloadHash].join('\n');
    const scope = `${clock.dateStamp}/${configuredRegion}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${clock.amzDate}\n${scope}\n${sha256Hex(Buffer.from(canonicalRequest))}`;
    const dateKey = hmac(Buffer.from(`AWS4${configuredSecretAccessKey}`), clock.dateStamp);
    const regionKey = hmac(dateKey, configuredRegion);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${configuredAccessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${hmac(signingKey, stringToSign, 'hex')}`;

    const scratch = mkdtempSync(join(tmpdir(), 'oont-s3-request-'));
    const requestPath = join(scratch, 'request.bin');
    const responsePath = join(scratch, 'response.bin');
    const headersPath = join(scratch, 'headers.txt');
    writeFileSync(requestPath, body, { mode: 0o600 });
    try {
      const args = [
        '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '30',
        ...(method === 'HEAD' ? ['--head'] : ['--request', method]),
        '--dump-header', headersPath, '--output', responsePath, '--write-out', '%{http_code}',
      ];
      for (const [name, value] of Object.entries(headers)) args.push('--header', `${name}: ${value}`);
      if (!['GET', 'HEAD'].includes(method) || body.length) args.push('--data-binary', `@${requestPath}`);
      args.push(`${endpoint.origin}${uri}`);
      const result = spawnSync(curlPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      if (result.status !== 0) fail('OBJECT_BACKEND_S3_TRANSPORT', result.stderr?.trim());
      const parsed = parseHeaders(readFileSync(headersPath));
      const writtenStatus = Number(result.stdout.trim());
      if (parsed.status !== writtenStatus) fail('OBJECT_BACKEND_S3_RESPONSE');
      return { ...parsed, body: readFileSync(responsePath) };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };

  const metadata = (headers: Record<string, string>): {
    mode: 'raw' | 'cas-envelope';
    checksumSha256: string;
    byteLength: number;
    generation: number;
    etag: string;
    version: string;
  } => {
    const mode = headers['x-amz-meta-oont-mode'];
    const parsedMode = mode === 'raw' || mode === 'cas-envelope' ? mode : null;
    const checksumSha256 = headers['x-amz-meta-oont-sha256'];
    const byteLength = Number(headers['x-amz-meta-oont-byte-length']);
    const generation = Number(headers['x-amz-meta-oont-generation']);
    const etag = headers.etag;
    const safeMode = parsedMode === null ? fail('OBJECT_BACKEND_CORRUPT') : parsedMode;
    if (typeof checksumSha256 !== 'string' || !SHA256.test(checksumSha256)
      || !Number.isSafeInteger(byteLength) || byteLength < 0 || !Number.isSafeInteger(generation) || generation < 0
      || typeof etag !== 'string' || !etag) fail('OBJECT_BACKEND_CORRUPT');
    if (parsedMode === 'raw' && generation !== 0 || parsedMode === 'cas-envelope' && generation < 1) fail('OBJECT_BACKEND_CORRUPT');
    return { mode: safeMode, checksumSha256, byteLength, generation, etag, version: encodeVersion(generation, etag) };
  };

  const head = (keyInput: string): S3WriteReceipt | null => {
    const key = validateKey(keyInput);
    const response = request({ method: 'HEAD', key });
    if (response.status === 404) return null;
    if (response.status !== 200) fail('OBJECT_BACKEND_S3_STATUS', response.status);
    const meta = metadata(response.headers);
    return Object.freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyObjectWriteReceiptV1',
      key,
      version: meta.version,
      checksumSha256: meta.checksumSha256,
      byteLength: meta.byteLength,
      generation: meta.generation,
    });
  };

  const get = (keyInput: string, { start = 0, end = null }: { start?: number; end?: number | null } = {}): ObjectReadResult => {
    const key = validateKey(keyInput);
    const current = head(key);
    if (current === null) return fail('OBJECT_BACKEND_NOT_FOUND');
    const finalEnd = end === null ? current.byteLength : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(finalEnd)
      || start < 0 || finalEnd < start || finalEnd > current.byteLength) fail('OBJECT_BACKEND_RANGE');
    const version = decodeVersion(current.version);
    const isFull = start === 0 && finalEnd === current.byteLength;
    const headResponse = request({ method: 'HEAD', key });
    const meta = metadata(headResponse.headers);
    if (meta.version !== current.version) fail('OBJECT_BACKEND_PRECONDITION');
    let bytes;
    if (start === finalEnd) {
      bytes = Buffer.alloc(0);
      return Object.freeze({
        schemaVersion: 1,
        kind: 'OpenOntologyObjectWriteReceiptV1',
        key,
        version: current.version,
        checksumSha256: meta.checksumSha256,
        byteLength: meta.byteLength,
        generation: meta.generation,
        bytes,
        range: Object.freeze({ start, end: finalEnd }),
      });
    }
    if (meta.mode === 'raw') {
      const response = request({
        method: 'GET',
        key,
        headers: {
          'if-match': meta.etag,
          ...(isFull ? {} : { range: `bytes=${start}-${finalEnd - 1}` }),
        },
      });
      if (response.status !== (isFull ? 200 : 206)) fail('OBJECT_BACKEND_S3_STATUS', response.status);
      bytes = response.body;
      if (isFull && sha256(bytes) !== meta.checksumSha256 || bytes.length !== finalEnd - start) fail('OBJECT_BACKEND_CORRUPT');
    } else {
      const response = request({ method: 'GET', key, headers: { 'if-match': meta.etag } });
      if (response.status !== 200) fail('OBJECT_BACKEND_S3_STATUS', response.status);
      const logical = readCasEnvelope(response.body, version.generation, meta.checksumSha256, meta.byteLength);
      bytes = logical.subarray(start, finalEnd);
    }
    return Object.freeze({
      schemaVersion: 1,
      kind: 'OpenOntologyObjectWriteReceiptV1',
      key,
      version: current.version,
      checksumSha256: meta.checksumSha256,
      byteLength: meta.byteLength,
      generation: meta.generation,
      bytes,
      range: Object.freeze({ start, end: finalEnd }),
    });
  };

  const put = ({ key, logicalBytes, storedBytes, generation, mode, conditionHeaders }: {
    key: string;
    logicalBytes: Buffer;
    storedBytes: Buffer;
    generation: number;
    mode: 'raw' | 'cas-envelope';
    conditionHeaders: Record<string, string>;
  }): { response: { status: number; headers: Record<string, string>; body: Buffer }; receipt: S3WriteReceipt | null } => {
    const checksumSha256 = sha256(logicalBytes);
    const response = request({
      method: 'PUT',
      key,
      headers: {
        'content-type': 'application/octet-stream',
        'x-amz-meta-oont-mode': mode,
        'x-amz-meta-oont-sha256': checksumSha256,
        'x-amz-meta-oont-byte-length': String(logicalBytes.length),
        'x-amz-meta-oont-generation': String(generation),
        ...conditionHeaders,
      },
      body: storedBytes,
    });
    if (![200, 201].includes(response.status)) return { response, receipt: null };
    const etag = response.headers.etag;
    if (!etag) fail('OBJECT_BACKEND_S3_RESPONSE');
    return {
      response,
      receipt: Object.freeze({
        schemaVersion: 1,
        kind: 'OpenOntologyObjectWriteReceiptV1',
        key,
        version: encodeVersion(generation, etag),
        checksumSha256,
        byteLength: logicalBytes.length,
        generation,
      }),
    };
  };

  return Object.freeze({
    capabilities,
    ensureBucket() {
      const response = request({ method: 'PUT' });
      if (![200, 201, 204, 409].includes(response.status)) fail('OBJECT_BACKEND_S3_BUCKET', response.status);
      if (response.status === 409) {
        const probe = request({ method: 'HEAD' });
        if (probe.status !== 200) fail('OBJECT_BACKEND_S3_BUCKET', response.status);
      }
      return Object.freeze({ bucket: configuredBucket, status: response.status, available: true });
    },
    head,
    get,
    putIfAbsent(keyInput: string, bytesInput: ObjectBackendInput): ObjectWriteReceipt {
      const key = validateKey(keyInput);
      const bytes = exactBytes(bytesInput);
      const write = put({
        key,
        logicalBytes: bytes,
        storedBytes: bytes,
        generation: 0,
        mode: 'raw',
        conditionHeaders: { 'if-none-match': '*' },
      });
      if (write.receipt) return Object.freeze({ ...write.receipt, created: true, replayed: false });
      if (write.response.status !== 412) fail('OBJECT_BACKEND_S3_STATUS', write.response.status);
      const current = get(key);
      if (!current.bytes.equals(bytes)) fail('OBJECT_BACKEND_PRECONDITION');
      return Object.freeze({
        schemaVersion: 1,
        kind: 'OpenOntologyObjectWriteReceiptV1',
        key,
        version: current.version,
        checksumSha256: current.checksumSha256,
        byteLength: current.byteLength,
        generation: current.generation,
        created: false,
        replayed: true,
      });
    },
    compareAndSwap(keyInput: string, { expectedVersion = null, bytes: bytesInput }: {
      expectedVersion?: string | null;
      bytes?: ObjectBackendInput;
    } = {}): ObjectWriteReceipt {
      const key = validateKey(keyInput);
      const bytes = exactBytes(bytesInput);
      const expected = expectedVersion === null ? null : decodeVersion(expectedVersion);
      if (expected !== null) {
        const current = head(key);
        if (current === null || current.version !== expectedVersion) fail('OBJECT_BACKEND_PRECONDITION');
      }
      const generation = expected === null ? 1 : expected.generation + 1;
      const stored = makeCasEnvelope(bytes, generation);
      const write = put({
        key,
        logicalBytes: bytes,
        storedBytes: stored,
        generation,
        mode: 'cas-envelope',
        conditionHeaders: expected === null ? { 'if-none-match': '*' } : { 'if-match': expected.etag },
      });
      if (!write.receipt) {
        if (write.response.status === 412) return fail('OBJECT_BACKEND_PRECONDITION');
        return fail('OBJECT_BACKEND_S3_STATUS', write.response.status);
      }
      return Object.freeze({
        ...write.receipt,
        created: expected === null,
        replayed: false,
        previousVersion: expectedVersion,
      });
    },
  });
}
