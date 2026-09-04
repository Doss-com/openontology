/** Canonical object-backend URI selection. */
import { fileURLToPath } from 'node:url';
import { openGcsObjectBackend } from './gcs-object-storage-backend.mjs';
import { openFileObjectBackend } from './object-storage-backend.mjs';
import { openS3ObjectBackend } from './s3-object-storage-backend.mjs';

const fail = (code) => { const error = new TypeError(code); error.code = code; throw error; };

export function normalizeCanonicalObjectBackendUri(uriInput) {
  let uri;
  try { uri = new URL(uriInput); } catch { fail('CANONICAL_OBJECT_BACKEND_URI'); }
  if (uri.username || uri.password || uri.search || uri.hash) fail('CANONICAL_OBJECT_BACKEND_URI');
  if (uri.protocol === 'file:') {
    if (uri.hostname && uri.hostname !== 'localhost') fail('CANONICAL_OBJECT_BACKEND_URI');
    try { fileURLToPath(uri); } catch { fail('CANONICAL_OBJECT_BACKEND_URI'); }
    return uri.href;
  }
  if (['s3:', 'gs:'].includes(uri.protocol)
    && uri.hostname && (!uri.pathname || uri.pathname === '/')) {
    return `${uri.protocol}//${uri.hostname}`;
  }
  fail('CANONICAL_OBJECT_BACKEND_URI');
}

export function openCanonicalObjectBackend({ uri: uriInput, env = process.env } = {}) {
  const normalizedUri = normalizeCanonicalObjectBackendUri(uriInput);
  const uri = new URL(normalizedUri);
  let backend;
  if (uri.protocol === 'file:') {
    let root;
    try { root = fileURLToPath(uri); } catch { fail('CANONICAL_OBJECT_BACKEND_URI'); }
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
  } else fail('CANONICAL_OBJECT_BACKEND_URI');
  return Object.freeze({
    uri: normalizedUri,
    backend,
    capabilities: backend.capabilities,
  });
}
