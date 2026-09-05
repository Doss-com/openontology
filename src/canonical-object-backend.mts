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

type BackendEnvironment = Record<string, string | undefined>;

const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};

export function normalizeCanonicalObjectBackendUri(uriInput: string | undefined): string {
  let uri: URL;
  try { uri = new URL(uriInput ?? ''); } catch { return fail('CANONICAL_OBJECT_BACKEND_URI'); }
  if (uri.username || uri.password || uri.search || uri.hash) fail('CANONICAL_OBJECT_BACKEND_URI');
  if (uri.protocol === 'file:') {
    if (uri.hostname && uri.hostname !== 'localhost') fail('CANONICAL_OBJECT_BACKEND_URI');
    try { fileURLToPath(uri); } catch { return fail('CANONICAL_OBJECT_BACKEND_URI'); }
    return uri.href;
  }
  if (['s3:', 'gs:'].includes(uri.protocol)
    && uri.hostname && (!uri.pathname || uri.pathname === '/')) {
    return `${uri.protocol}//${uri.hostname}`;
  }
  return fail('CANONICAL_OBJECT_BACKEND_URI');
}

export function openCanonicalObjectBackend({
  uri: uriInput,
  env = process.env,
}: { uri?: string; env?: BackendEnvironment } = {}): CanonicalObjectBackendSelection {
  const normalizedUri = normalizeCanonicalObjectBackendUri(uriInput);
  const uri = new URL(normalizedUri);
  let backend: ObjectBackend;
  if (uri.protocol === 'file:') {
    let root: string;
    try { root = fileURLToPath(uri); } catch { return fail('CANONICAL_OBJECT_BACKEND_URI'); }
    backend = openFileObjectBackend({ root });
  } else if (uri.protocol === 's3:') {
    if (!env || typeof env !== 'object'
      || !['enforced', undefined].includes(env.OONT_S3_CONDITIONAL_WRITE_POLICY)) {
      fail('CANONICAL_OBJECT_BACKEND_URI');
    }
    backend = openS3ObjectBackend({
      endpoint: env.OONT_S3_ENDPOINT,
      region: env.OONT_S3_REGION ?? 'us-east-1',
      bucket: uri.hostname,
      accessKeyId: env.OONT_S3_ACCESS_KEY_ID,
      secretAccessKey: env.OONT_S3_SECRET_ACCESS_KEY,
      sessionToken: env.OONT_S3_SESSION_TOKEN ?? null,
      providerConditionalWritePolicy: env.OONT_S3_CONDITIONAL_WRITE_POLICY === 'enforced',
    });
  } else if (uri.protocol === 'gs:') {
    if (!env || typeof env !== 'object') {
      fail('CANONICAL_OBJECT_BACKEND_URI');
    }
    backend = openGcsObjectBackend({
      bucket: uri.hostname,
      accessToken: env.OONT_GCS_ACCESS_TOKEN,
      endpoint: env.OONT_GCS_ENDPOINT ?? 'https://storage.googleapis.com',
    });
  } else return fail('CANONICAL_OBJECT_BACKEND_URI');
  return Object.freeze({
    uri: normalizedUri,
    backend,
    capabilities: backend.capabilities,
  });
}
