/** Bounded metadata discovery over one validated source-native Object map. */
import { stableObjectSha256, stableObjectText } from '../canonical-content.js';
import type { QuerySchema } from '../query/planner.js';
import type { SourceNativeObjectIdentity } from '../source/object-map.js';
import type { Descriptor, ObjectOnt } from '../source/artifact.js';
import type {
  SourceNativeObjectDiscoveryCoverage,
  SourceNativeObjectDiscoveryInput,
  SourceNativeObjectDiscoveryObject,
  SourceNativeObjectDiscoveryResult,
  SourceNativeObjectDiscoveryScope,
  SourceNativeObjectDiscoverySourceBinding,
} from './discovery-types.js';
export type {
  SourceNativeObjectDiscoveryCoverage,
  SourceNativeObjectDiscoveryInput,
  SourceNativeObjectDiscoveryObject,
  SourceNativeObjectDiscoveryResult,
  SourceNativeObjectDiscoveryScope,
  SourceNativeObjectDiscoverySourceBinding,
} from './discovery-types.js';

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 64;
const MAXIMUM_PAGE_BYTES = 256 * 1024;
const MAXIMUM_CURSORS = 128;
const MAXIMUM_TEXT = 256;

type NormalizedSourceNativeObjectDiscoveryInput = {
  browse: 'objects';
  scope: SourceNativeObjectDiscoveryScope | null;
  limit: number;
  cursor: string | null;
};

export interface SourceNativeObjectDiscoveryCursor {
  clientId: string;
  querySha256: string;
  sourceBindingSha256: string;
  offset: number;
}

const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > MAXIMUM_TEXT ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.from(value).toString('utf8') !== value
  )
    fail(code);
  return value as string;
}

export function normalizeSourceNativeObjectDiscoveryInput(
  value: unknown,
  code = 'SOURCE_NATIVE_PRODUCT_DISCOVERY_QUERY',
): NormalizedSourceNativeObjectDiscoveryInput {
  const input = record(value, code);
  if (
    Object.keys(input).some((name) => !['browse', 'scope', 'limit', 'cursor'].includes(name)) ||
    input.browse !== 'objects'
  )
    fail(code);
  const scope =
    input.scope === undefined
      ? null
      : (() => {
          const raw = record(input.scope, code);
          if (
            Object.keys(raw).some(
              (name) => !['sourceSystem', 'objectType', 'externalId'].includes(name),
            )
          )
            fail(code);
          const sourceSystem = boundedText(raw.sourceSystem, code);
          const objectType =
            raw.objectType === undefined ? undefined : boundedText(raw.objectType, code);
          const externalId =
            raw.externalId === undefined ? undefined : boundedText(raw.externalId, code);
          if (externalId !== undefined && objectType === undefined) fail(code);
          return freeze({
            sourceSystem,
            ...(objectType === undefined ? {} : { objectType }),
            ...(externalId === undefined ? {} : { externalId }),
          });
        })();
  const rawLimit = input.limit === undefined ? DEFAULT_LIMIT : input.limit;
  if (
    typeof rawLimit !== 'number' ||
    !Number.isSafeInteger(rawLimit) ||
    rawLimit < 1 ||
    rawLimit > MAXIMUM_LIMIT
  )
    fail(code);
  const limit = rawLimit as number;
  const cursor = input.cursor === undefined ? null : boundedText(input.cursor, code);
  return freeze({
    browse: 'objects',
    scope,
    limit,
    cursor,
  }) as NormalizedSourceNativeObjectDiscoveryInput;
}

function identityKey(identity: SourceNativeObjectIdentity): string {
  return stableObjectText(identity);
}

function sourceBinding(
  descriptor: Descriptor,
  objectOnt: ObjectOnt,
): SourceNativeObjectDiscoverySourceBinding {
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeObjectDiscoverySourceBindingV1',
    ontId: descriptor.ontId,
    branch: descriptor.branch,
    namespace: descriptor.namespace,
    artifactSha256: descriptor.artifactSha256,
    sourceCommitSha256: objectOnt.commitSha256,
    sourceReplaySha256: objectOnt.replaySha256,
    sourceCatalogSha256: objectOnt.catalog.sourceCatalogSha256,
    nativeObjectMapSha256: objectOnt.map.nativeObjectMapSha256,
  });
}

function queryableFieldsByType(querySchemas: QuerySchema[]): Map<string, Set<string>> {
  return new Map(
    querySchemas.map((schema) => [
      `${schema.sourceSystem}\0${schema.objectType}`,
      new Set(schema.fields.map((field) => field.fieldPath)),
    ]),
  );
}

export function compileSourceNativeObjectDiscoveryInventory(
  descriptor: Descriptor,
  objectOnt: ObjectOnt,
): SourceNativeObjectDiscoveryObject[] {
  const queryable = queryableFieldsByType(descriptor.querySchemas);
  const groups = new Map<string, SourceNativeObjectDiscoveryObject>();
  for (const object of objectOnt.map.nativeObjects) {
    const identity = object.objectIdentity;
    if (identity.namespace !== descriptor.namespace) continue;
    const key = identityKey(identity);
    const existing = groups.get(key);
    const fields = existing?.fields ?? [];
    const declared = queryable.get(`${identity.sourceSystem}\0${identity.objectType}`);
    for (const field of object.fields) {
      if (declared?.has(field.fieldPath) && !fields.includes(field.fieldPath))
        fields.push(field.fieldPath);
    }
    if (existing !== undefined) {
      existing.fields = fields;
    } else {
      groups.set(key, {
        objectIdentity: freeze({ ...identity }),
        objectIdentitySha256: object.objectIdentitySha256,
        fields,
      });
    }
  }
  return [...groups.values()]
    .map((object) => freeze({ ...object, fields: freeze([...object.fields].sort(compare)) }))
    .sort(
      (left, right) =>
        compare(left.objectIdentity.sourceSystem, right.objectIdentity.sourceSystem) ||
        compare(left.objectIdentity.objectType, right.objectIdentity.objectType) ||
        compare(left.objectIdentity.externalId, right.objectIdentity.externalId) ||
        compare(left.objectIdentity.namespace ?? '', right.objectIdentity.namespace ?? ''),
    );
}

function rememberCursor(
  cursors: Map<string, SourceNativeObjectDiscoveryCursor>,
  token: string,
  cursor: SourceNativeObjectDiscoveryCursor,
): void {
  if (!cursors.has(token) && cursors.size >= MAXIMUM_CURSORS) {
    const first = cursors.keys().next().value;
    if (first !== undefined) cursors.delete(first);
  }
  cursors.set(token, cursor);
}

function cursorToken(cursor: SourceNativeObjectDiscoveryCursor): string {
  return `objects:${stableObjectSha256({ kind: 'OpenOntologySourceNativeObjectDiscoveryCursorV1', ...cursor }).slice(7)}`;
}

function pageResult({
  normalized,
  rows,
  totalObjects,
  nextCursor,
  binding,
  coverage,
}: {
  normalized: NormalizedSourceNativeObjectDiscoveryInput;
  rows: SourceNativeObjectDiscoveryObject[];
  totalObjects: number;
  nextCursor: string | null;
  binding: SourceNativeObjectDiscoverySourceBinding;
  coverage: SourceNativeObjectDiscoveryCoverage;
}): SourceNativeObjectDiscoveryResult {
  const core = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologySourceNativeObjectDiscoveryResultV1' as const,
    browse: 'objects' as const,
    scope: normalized.scope,
    objects: freeze(rows),
    totalObjects,
    returnedObjects: rows.length,
    nextCursor,
    sourceBinding: binding,
    coverage,
    freshness: 'unknown' as const,
    navigationOnly: true as const,
    absenceProven: false as const,
    exactSourcesRemainAuthority: true as const,
    canonicalTruthMutation: false as const,
  };
  const result = freeze({ ...core, resultSha256: stableObjectSha256(core) });
  if (Buffer.byteLength(stableObjectText(result), 'utf8') > MAXIMUM_PAGE_BYTES)
    fail('SOURCE_NATIVE_PRODUCT_DISCOVERY_PAGE');
  return result;
}

export function openSourceNativeObjectDiscovery({
  descriptor,
  objectOnt,
  input,
  cursors,
  clientId,
  inventory,
}: {
  descriptor: Descriptor;
  objectOnt: ObjectOnt;
  input: SourceNativeObjectDiscoveryInput;
  cursors: Map<string, SourceNativeObjectDiscoveryCursor>;
  clientId: string;
  inventory: SourceNativeObjectDiscoveryObject[];
}): SourceNativeObjectDiscoveryResult {
  const normalized = normalizeSourceNativeObjectDiscoveryInput(input);
  const binding = sourceBinding(descriptor, objectOnt);
  const sourceBindingSha256 = stableObjectSha256(binding);
  const querySha256 = stableObjectSha256({ browse: 'objects', scope: normalized.scope });
  const stored =
    normalized.cursor === null
      ? null
      : (cursors.get(normalized.cursor) ?? fail('SOURCE_NATIVE_PRODUCT_DISCOVERY_CURSOR'));
  if (
    stored !== null &&
    (stored.clientId !== clientId ||
      stored.querySha256 !== querySha256 ||
      stored.sourceBindingSha256 !== sourceBindingSha256)
  )
    fail('SOURCE_NATIVE_PRODUCT_DISCOVERY_CURSOR_STALE');
  const offset = stored?.offset ?? 0;
  const rows = inventory.filter(
    (row) =>
      normalized.scope === null ||
      (row.objectIdentity.sourceSystem === normalized.scope.sourceSystem &&
        (normalized.scope.objectType === undefined ||
          row.objectIdentity.objectType === normalized.scope.objectType) &&
        (normalized.scope.externalId === undefined ||
          row.objectIdentity.externalId === normalized.scope.externalId)),
  );
  if (offset < 0 || offset > rows.length) fail('SOURCE_NATIVE_PRODUCT_DISCOVERY_CURSOR_STALE');
  const coverage = freeze({
    sourceCount: objectOnt.map.sourceCount,
    mappedSourceCount: objectOnt.map.mappedSourceCount,
    unsupportedSourceCount: objectOnt.map.unsupportedSourceCount,
    parseFailureCount: objectOnt.map.parseFailureCount,
    complete:
      objectOnt.map.mappedSourceCount === objectOnt.map.sourceCount &&
      objectOnt.map.unsupportedSourceCount === 0 &&
      objectOnt.map.parseFailureCount === 0,
  });
  const remaining = rows.length - offset;
  const candidateLimit = Math.min(normalized.limit, Math.max(remaining, 0));
  for (let count = candidateLimit; count >= 0; count -= 1) {
    if (count === 0 && remaining > 0) fail('SOURCE_NATIVE_PRODUCT_DISCOVERY_PAGE');
    const selected = rows.slice(offset, offset + count);
    const hasMore = offset + count < rows.length;
    const next = hasMore
      ? cursorToken({ clientId, querySha256, sourceBindingSha256, offset: offset + count })
      : null;
    try {
      const result = pageResult({
        normalized,
        rows: selected,
        totalObjects: rows.length,
        nextCursor: next,
        binding,
        coverage,
      });
      if (next !== null) {
        rememberCursor(cursors, next, {
          clientId,
          querySha256,
          sourceBindingSha256,
          offset: offset + count,
        });
      }
      return result;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'SOURCE_NATIVE_PRODUCT_DISCOVERY_PAGE' ||
        count === 0
      )
        throw error;
    }
  }
  return fail('SOURCE_NATIVE_PRODUCT_DISCOVERY_PAGE');
}
