/** Deterministic content encoding and addressing for immutable Ont records. */
import { createHash } from 'node:crypto';

const compare = (left, right) => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));

export const stableObjectText = (value) => JSON.stringify(value, (_key, row) =>
  row && typeof row === 'object' && !Array.isArray(row)
    ? Object.fromEntries(Object.keys(row).sort(compare).map((key) => [key, row[key]]))
    : row);

export const objectBytesSha256 = (bytes) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const STREAM_HASH_FALLBACK = Symbol('STREAM_HASH_FALLBACK');

function updateStableObjectHash(hash, input, key, ancestors) {
  let value = input;
  if (value && typeof value === 'object' && typeof value.toJSON === 'function') {
    value = value.toJSON(key);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string') {
    hash.update(JSON.stringify(value));
    return;
  }
  if (!value || typeof value !== 'object') throw STREAM_HASH_FALLBACK;
  if (ancestors.has(value)) throw STREAM_HASH_FALLBACK;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw STREAM_HASH_FALLBACK;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    hash.update('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) hash.update(',');
      const child = value[index];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
        hash.update('null');
      } else {
        updateStableObjectHash(hash, child, String(index), ancestors);
      }
    }
    hash.update(']');
  } else {
    hash.update('{');
    let emitted = 0;
    for (const childKey of Object.keys(value).sort(compare)) {
      const child = value[childKey];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
      if (emitted > 0) hash.update(',');
      hash.update(JSON.stringify(childKey));
      hash.update(':');
      updateStableObjectHash(hash, child, childKey, ancestors);
      emitted += 1;
    }
    hash.update('}');
  }
  ancestors.delete(value);
}

export const stableObjectSha256 = (value) => {
  const hash = createHash('sha256');
  try {
    updateStableObjectHash(hash, value, '', new Set());
    return `sha256:${hash.digest('hex')}`;
  } catch (error) {
    if (error !== STREAM_HASH_FALLBACK) throw error;
    return objectBytesSha256(Buffer.from(stableObjectText(value)));
  }
};
