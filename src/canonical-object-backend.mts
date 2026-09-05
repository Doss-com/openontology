/** Canonical object-backend URI selection. */
import { fileURLToPath } from 'node:url';
import type { ObjectBackend, ObjectBackendCapabilities } from './object-storage-backend.mjs';
import { openGcsObjectBackend } from './gcs-object-storage-backend.mjs';
import { openFileObjectBackend } from './object-storage-backend.mjs';
import { openS3ObjectBackend } from './s3-object-storage-backend.mjs';

export interface CanonicalObjectBackendSelection {
  uri: string;
  backend: ObjectBackend;
  capabilities: ObjectBackendCapabilities;
}

interface CanonicalObjectBackendEnvironmentValues {
  readonly [key: string]: string | (() => string) | null | undefined;
  readonly OONT_GCS_ACCESS_TOKEN?: string;
  readonly OONT_GCS_ACCESS_TOKEN_PROVIDER?: (() => string) | null;
  readonly OONT_GCS_ENDPOINT?: string;
  readonly OONT_S3_ENDPOINT?: string;
  readonly OONT_S3_REGION?: string;
  readonly OONT_S3_ACCESS_KEY_ID?: string;
  readonly OONT_S3_SECRET_ACCESS_KEY?: string;
  readonly OONT_S3_SESSION_TOKEN?: string | null;
  readonly OONT_S3_CONDITIONAL_WRITE_POLICY?: string;
}
export type CanonicalObjectBackendEnvironment = CanonicalObjectBackendEnvironmentValues | NodeJS.ProcessEnv;

type BackendEnvironmentValue = string | (() => string) | null | undefined;

const optionalText = (value: BackendEnvironmentValue): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  return fail('CANONICAL_OBJECT_BACKEND_URI');
};

const optionalProvider = (value: BackendEnvironmentValue): (() => string) | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'function') return value;
  return fail('CANONICAL_OBJECT_BACKEND_URI');
};

const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};

export function normalizeCanonicalObjectBackendUri(uriInput: string | undefined): string {
  let uri: URL;
  try { uri = new URL(uriInput ?? ''); } catch { return fail('CANONICAL_OBJECT_BACKEND_URI'); }
  if (uri.username || uri.password || uri.search || uri.hash) fail('CANONICAL_OBJECT_BACKEND_URI');
  if (uri.protocol === 'gs:' && typeof uriInput === 'string') {
    const rawPath = /^gs:\/\/[^\/?#]*(\/[^?#]*)?$/iu.exec(uriInput)?.[1] ?? '';
    for (const segment of rawPath.split('/')) {
      let decodedSegment: string;
      try { decodedSegment = decodeURIComponent(segment); } catch { return fail('CANONICAL_OBJECT_BACKEND_URI'); }
      if (decodedSegment !== segment || decodedSegment === '.' || decodedSegment === '..') {
        fail('CANONICAL_OBJECT_BACKEND_URI');
      }
    }
  }
  if (uri.protocol === 'file:') {
    if (uri.hostname && uri.hostname !== 'localhost') fail('CANONICAL_OBJECT_BACKEND_URI');
    try { fileURLToPath(uri); } catch { return fail('CANONICAL_OBJECT_BACKEND_URI'); }
    return uri.href;
  }
  if (['s3:', 'gs:'].includes(uri.protocol) && uri.hostname) {
    if (!uri.pathname || uri.pathname === '/') return `${uri.protocol}//${uri.hostname}`;
    if (uri.protocol !== 'gs:' || uriInput !== uri.href) fail('CANONICAL_OBJECT_BACKEND_URI');
    const prefix = uri.pathname.slice(1);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u.test(prefix)
      || prefix.endsWith('/') || prefix.includes('//')
      || prefix.split('/').some((part) => ['.', '..'].includes(part))) {
      fail('CANONICAL_OBJECT_BACKEND_URI');
    }
    return `${uri.protocol}//${uri.hostname}/${prefix}`;
  }
  return fail('CANONICAL_OBJECT_BACKEND_URI');
}

export function openCanonicalObjectBackend({
  uri: uriInput,
  env = process.env,
}: { uri?: string; env?: CanonicalObjectBackendEnvironment } = {}): CanonicalObjectBackendSelection {
  const normalizedUri = normalizeCanonicalObjectBackendUri(uriInput);
  const uri = new URL(normalizedUri);
  let backend: ObjectBackend;
  if (uri.protocol === 'file:') {
    let root: string;
    try { root = fileURLToPath(uri); } catch { return fail('CANONICAL_OBJECT_BACKEND_URI'); }
    backend = openFileObjectBackend({ root });
  } else if (uri.protocol === 's3:') {
    if (!env || typeof env !== 'object'
      || !['enforced', undefined].includes(optionalText(env.OONT_S3_CONDITIONAL_WRITE_POLICY))) {
      fail('CANONICAL_OBJECT_BACKEND_URI');
    }
    backend = openS3ObjectBackend({
      endpoint: optionalText(env.OONT_S3_ENDPOINT),
      region: optionalText(env.OONT_S3_REGION) ?? 'us-east-1',
      bucket: uri.hostname,
      accessKeyId: optionalText(env.OONT_S3_ACCESS_KEY_ID),
      secretAccessKey: optionalText(env.OONT_S3_SECRET_ACCESS_KEY),
      sessionToken: optionalText(env.OONT_S3_SESSION_TOKEN) ?? null,
      providerConditionalWritePolicy: optionalText(env.OONT_S3_CONDITIONAL_WRITE_POLICY) === 'enforced',
    });
  } else if (uri.protocol === 'gs:') {
    if (!env || typeof env !== 'object') {
      fail('CANONICAL_OBJECT_BACKEND_URI');
    }
    backend = openGcsObjectBackend({
      bucket: uri.hostname,
      prefix: uri.pathname.slice(1) || null,
      accessToken: optionalText(env.OONT_GCS_ACCESS_TOKEN) ?? null,
      accessTokenProvider: optionalProvider(env.OONT_GCS_ACCESS_TOKEN_PROVIDER),
      endpoint: optionalText(env.OONT_GCS_ENDPOINT) ?? 'https://storage.googleapis.com',
    });
  } else return fail('CANONICAL_OBJECT_BACKEND_URI');
  return Object.freeze({
    uri: normalizedUri,
    backend,
    capabilities: backend.capabilities,
  });
}
