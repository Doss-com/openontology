/** Synchronous Google Cloud Storage backend for the canonical object contract. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CANONICAL_OBJECT_BACKEND_CONTRACT } from './object-storage-backend.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GENERATION = /^[1-9][0-9]*$/u;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u;
const compare = (left, right) => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const stable = (value) => JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort(compare).map((key) => [key, row[key]]))
  : row);
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digest = (value) => sha256(Buffer.from(stable(value)));
const fail = (code, details = null) => {
  const error = new Error(code);
  error.code = code;
  if (details !== null) error.details = details;
  throw error;
};

function exactBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  fail('OBJECT_BACKEND_BYTES');
}

function validateKey(key) {
  if (typeof key !== 'string' || key.length < 1 || Buffer.byteLength(key) > 1024 || key.includes('\0')
    || key.startsWith('/') || key.includes('\\')) fail('OBJECT_BACKEND_KEY');
  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail('OBJECT_BACKEND_KEY');
  }
  return key;
}

function exactToken(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 16_384
    || /[\u0000-\u001f\u007f]/u.test(value)) fail('OBJECT_BACKEND_GCS_AUTH');
  return value;
}

function encodeVersion(generation) {
  if (!GENERATION.test(generation ?? '')) fail('OBJECT_BACKEND_VERSION');
  return `gcs-v1:${generation}`;
}

function decodeVersion(version) {
  const match = /^gcs-v1:([1-9][0-9]*)$/u.exec(version ?? '');
  if (!match) fail('OBJECT_BACKEND_VERSION');
  return { generation: match[1] };
}

function parseHeaders(bytes) {
  const blocks = bytes.toString('latin1').split(/\r?\n\r?\n/u).filter((block) => /^HTTP\//u.test(block));
  if (!blocks.length) fail('OBJECT_BACKEND_GCS_RESPONSE');
  const lines = blocks.at(-1).split(/\r?\n/u);
  const statusMatch = /^HTTP\/\S+\s+(\d{3})/u.exec(lines.shift());
  if (!statusMatch) fail('OBJECT_BACKEND_GCS_RESPONSE');
  const headers = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return { status: Number(statusMatch[1]), headers };
}

function curlTransport({ method, url, headers, body = Buffer.alloc(0), curlPath = '/usr/bin/curl' }) {
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

function parseJson(response, code) {
  try { return JSON.parse(exactBytes(response.body).toString('utf8')); } catch { fail(code); }
}

function multipartUpload(key, bytes, checksumSha256) {
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
  accessToken = null,
  accessTokenProvider = null,
  endpoint: endpointInput = 'https://storage.googleapis.com',
  curlPath = '/usr/bin/curl',
  transport = curlTransport,
} = {}) {
  let endpoint;
  try { endpoint = new URL(endpointInput); } catch { fail('OBJECT_BACKEND_GCS_CONFIG'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search
    || endpoint.hash || endpoint.pathname !== '/' || !BUCKET.test(bucket ?? '')
    || typeof transport !== 'function' || typeof curlPath !== 'string' || !curlPath
    || (accessToken === null) === (accessTokenProvider === null)
    || accessTokenProvider !== null && typeof accessTokenProvider !== 'function') {
    fail('OBJECT_BACKEND_GCS_CONFIG');
  }
  if (accessToken !== null) {
    try { exactToken(accessToken); } catch { fail('OBJECT_BACKEND_GCS_CONFIG'); }
  }

  const capabilitiesCore = {
    schemaVersion: 1,
    kind: 'OpenOntologyObjectBackendCapabilitiesV1',
    backend: 'gcs',
    endpointOrigin: endpoint.origin,
    bucket,
    contractSha256: digest(CANONICAL_OBJECT_BACKEND_CONTRACT),
    operations: CANONICAL_OBJECT_BACKEND_CONTRACT.operations,
    distributedObjectStore: true,
    multiProcessCas: true,
    singleProcessCas: true,
    providerConditionalWritePolicy: true,
    nativeGenerationPreconditions: true,
    opaqueGenerationVersions: true,
  };
  const capabilities = Object.freeze({ ...capabilitiesCore, capabilitiesSha256: digest(capabilitiesCore) });
  const token = () => exactToken(accessTokenProvider === null ? accessToken : accessTokenProvider());
  const call = ({ method, url, headers = {}, body = Buffer.alloc(0) }) => {
    const response = transport({
      method,
      url,
      headers: { authorization: `Bearer ${token()}`, ...headers },
      body,
      curlPath,
    });
    if (!response || !Number.isInteger(response.status) || !response.headers
      || !Buffer.isBuffer(response.body)) fail('OBJECT_BACKEND_GCS_RESPONSE');
    return response;
  };
  const bucketUrl = `${endpoint.origin}/storage/v1/b/${encodeURIComponent(bucket)}`;
  const objectUrl = (key) => `${bucketUrl}/o/${encodeURIComponent(validateKey(key))}`;
  const uploadUrl = (key, expectedGeneration) => {
    const url = new URL(`${endpoint.origin}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
    url.searchParams.set('uploadType', 'multipart');
    url.searchParams.set('name', validateKey(key));
    url.searchParams.set('ifGenerationMatch', expectedGeneration);
    return url.href;
  };

  const exactMetadata = (value, expectedKey = null) => {
    const lengthText = value?.metadata?.['oont-byte-length'];
    const sizeText = value?.size;
    if (value?.bucket !== bucket || typeof value.name !== 'string'
      || expectedKey !== null && value.name !== expectedKey
      || !GENERATION.test(value.generation ?? '') || !/^(0|[1-9][0-9]*)$/u.test(sizeText ?? '')
      || lengthText !== sizeText || !SHA256.test(value?.metadata?.['oont-sha256'] ?? '')) {
      fail('OBJECT_BACKEND_CORRUPT');
    }
    const byteLength = Number(sizeText);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) fail('OBJECT_BACKEND_CORRUPT');
    return {
      key: value.name,
      generation: value.generation,
      version: encodeVersion(value.generation),
      byteLength,
      checksumSha256: value.metadata['oont-sha256'],
    };
  };
  const receipt = (metadata, extra = {}) => Object.freeze({
    schemaVersion: 1,
    kind: 'OpenOntologyObjectWriteReceiptV1',
    key: metadata.key,
    version: metadata.version,
    checksumSha256: metadata.checksumSha256,
    byteLength: metadata.byteLength,
    generation: metadata.generation,
    ...extra,
  });
  const head = (keyInput) => {
    const key = validateKey(keyInput);
    const response = call({ method: 'GET', url: objectUrl(key) });
    if (response.status === 404) return null;
    if (response.status !== 200) fail('OBJECT_BACKEND_GCS_STATUS', response.status);
    return receipt(exactMetadata(parseJson(response, 'OBJECT_BACKEND_GCS_RESPONSE'), key));
  };
  const get = (keyInput, { start = 0, end = null } = {}) => {
    const key = validateKey(keyInput);
    const current = head(key);
    if (current === null) fail('OBJECT_BACKEND_NOT_FOUND');
    const finalEnd = end === null ? current.byteLength : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(finalEnd)
      || start < 0 || finalEnd < start || finalEnd > current.byteLength) fail('OBJECT_BACKEND_RANGE');
    if (start === finalEnd) {
      return Object.freeze({ ...current, bytes: Buffer.alloc(0), range: Object.freeze({ start, end: finalEnd }) });
    }
    const url = new URL(objectUrl(key));
    url.searchParams.set('alt', 'media');
    url.searchParams.set('ifGenerationMatch', current.generation);
    const full = start === 0 && finalEnd === current.byteLength;
    const response = call({
      method: 'GET',
      url: url.href,
      headers: full ? {} : { range: `bytes=${start}-${finalEnd - 1}` },
    });
    if (response.status === 412 || response.status === 404) fail('OBJECT_BACKEND_PRECONDITION');
    if (response.status !== (full ? 200 : 206)) fail('OBJECT_BACKEND_GCS_STATUS', response.status);
    const bytes = exactBytes(response.body);
    if (bytes.length !== finalEnd - start || full && sha256(bytes) !== current.checksumSha256) {
      fail('OBJECT_BACKEND_CORRUPT');
    }
    return Object.freeze({ ...current, bytes, range: Object.freeze({ start, end: finalEnd }) });
  };
  const put = (key, bytes, expectedGeneration) => {
    const checksumSha256 = sha256(bytes);
    const multipart = multipartUpload(key, bytes, checksumSha256);
    const response = call({
      method: 'POST',
      url: uploadUrl(key, expectedGeneration),
      headers: { 'content-type': multipart.contentType },
      body: multipart.body,
    });
    if (response.status === 412) return null;
    if (![200, 201].includes(response.status)) fail('OBJECT_BACKEND_GCS_STATUS', response.status);
    const metadata = exactMetadata(parseJson(response, 'OBJECT_BACKEND_GCS_RESPONSE'), key);
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
      const value = parseJson(response, 'OBJECT_BACKEND_GCS_RESPONSE');
      if (value?.name !== bucket) fail('OBJECT_BACKEND_GCS_RESPONSE');
      return Object.freeze({ bucket, status: response.status, available: true });
    },
    head,
    get,
    putIfAbsent(keyInput, bytesInput) {
      const key = validateKey(keyInput);
      const bytes = exactBytes(bytesInput);
      const written = put(key, bytes, '0');
      if (written !== null) return Object.freeze({ ...written, created: true, replayed: false });
      const current = get(key);
      if (!current.bytes.equals(bytes)) fail('OBJECT_BACKEND_PRECONDITION');
      const { bytes: _bytes, range: _range, ...currentReceipt } = current;
      return Object.freeze({ ...currentReceipt, created: false, replayed: true });
    },
    compareAndSwap(keyInput, { expectedVersion = null, bytes: bytesInput } = {}) {
      const key = validateKey(keyInput);
      const bytes = exactBytes(bytesInput);
      const expected = expectedVersion === null ? null : decodeVersion(expectedVersion);
      const written = put(key, bytes, expected?.generation ?? '0');
      if (written === null) fail('OBJECT_BACKEND_PRECONDITION');
      return Object.freeze({
        ...written,
        created: expected === null,
        replayed: false,
        previousVersion: expectedVersion,
      });
    },
  });
}
