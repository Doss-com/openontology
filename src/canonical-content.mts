/** Deterministic content encoding and addressing for immutable Ont records. */
import { createHash, type Hash } from 'node:crypto';

const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));

/** Values accepted by the canonical JSON text boundary. */
export type CanonicalJsonValue = null | boolean | number | string | object;

const stringifyStableObjectText = (value: unknown): string | undefined =>
  JSON.stringify(value, (_key: string, row: unknown) =>
    row && typeof row === 'object' && !Array.isArray(row)
      ? Object.fromEntries(Object.keys(row).sort(compare).map((key) => [key, (row as Record<string, unknown>)[key]]))
      : row);

export const stableObjectText = (value: CanonicalJsonValue): string => {
  const text = stringifyStableObjectText(value);
  if (text === undefined) throw new TypeError('canonical value must serialize to JSON text');
  return text;
};

export const objectBytesSha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const STREAM_HASH_FALLBACK = Symbol('STREAM_HASH_FALLBACK');

function updateStableObjectHash(hash: Hash, input: unknown, key: string, ancestors: Set<object>): void {
  let value = input;
  const objectWithToJson = value && typeof value === 'object'
    ? value as { toJSON?: (key: string) => unknown } : null;
  if (typeof objectWithToJson?.toJSON === 'function') {
    value = objectWithToJson.toJSON(key);
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
      const child = value[index] as unknown;
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
        hash.update('null');
      } else {
        updateStableObjectHash(hash, child, String(index), ancestors);
      }
    }
    hash.update(']');
  } else {
    const ordered = Object.fromEntries(
      Object.keys(value).sort(compare)
        .map((childKey) => [childKey, (value as Record<string, unknown>)[childKey]]),
    );
    hash.update('{');
    let emitted = 0;
    for (const childKey of Object.keys(ordered)) {
      const child = (ordered as Record<string, unknown>)[childKey];
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

export const stableObjectSha256 = (value: unknown): string => {
  const hash = createHash('sha256');
  try {
    updateStableObjectHash(hash, value, '', new Set());
    return `sha256:${hash.digest('hex')}`;
  } catch (error) {
    if (error !== STREAM_HASH_FALLBACK) throw error;
    const text = stringifyStableObjectText(value);
    if (text === undefined) throw new TypeError('canonical value must serialize to JSON text');
    return objectBytesSha256(Buffer.from(text));
  }
};
