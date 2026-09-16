/** Stable entry envelope used by object-native Ont segments. */
import { createHash } from 'node:crypto';

export interface AssertionEntry {
  v: string;
  id: string;
  kind: string;
  about?: string;
  body?: Record<string, unknown>;
  provenance?: string;
  evidence?: readonly unknown[];
  producer: string;
  occurredAt?: string;
  recordedAt?: string | null;
  supersedes?: string;
  [key: string]: unknown;
}

export interface AssertionInput {
  kind: string;
  about?: string;
  body?: Record<string, unknown>;
  provenance?: string;
  evidence?: readonly unknown[];
  producer?: string;
  occurredAt?: string;
  validFrom?: string;
  recordedAt?: string | null;
  supersedes?: string;
}

export const ASSERTION_V = 'oont.assertion/v1';
export const STORE_V = 'oont.ont/v1';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const seedValue = (entry: Record<string, unknown>, names: readonly string[]): unknown => {
  for (const name of names) {
    if (entry[name] !== undefined) return entry[name];
  }
  return null;
};

export function mintEntryId(entry: Record<string, unknown>): string {
  const seed = canonicalJson({
    kind: entry.kind,
    about: entry.about,
    body: entry.body,
    provenance: entry.provenance,
    evidence: entry.evidence ?? [],
    producer: entry.producer,
    // Keep the original seed key stable while accepting the ratified field name.
    validFrom: seedValue(entry, ['occurredAt', 'validFrom']),
  });
  return `as_${sha256Hex(seed).slice(0, 32)}`;
}

const CONCLUSION_KINDS = new Set(['finding']);

// WIRE-COMPAT: validFrom remains accepted for previously authored entry callers.
export function entry({
  kind,
  about,
  body,
  provenance,
  evidence,
  producer,
  occurredAt,
  validFrom,
  recordedAt,
  supersedes,
}: AssertionInput): AssertionEntry {
  const when = occurredAt ?? validFrom;
  if (CONCLUSION_KINDS.has(kind) && !((evidence?.length ?? 0) > 0)) {
    throw new Error(
      `a '${kind}' conclusion cannot be written without evidence ` +
        `[G29, ED19]. Two evidence-free conclusions about one element are indistinguishable by ` +
        `construction, so this would also collide with any other. About: ${about ?? 'ont'}`,
    );
  }
  const core = {
    kind,
    about: about ?? 'ont',
    body: body ?? {},
    provenance: provenance ?? 'derived',
    ...(evidence?.length ? { evidence } : {}),
    producer: producer ?? 'unknown',
    ...(when ? { occurredAt: when } : {}),
  };
  return {
    v: ASSERTION_V,
    id: mintEntryId({ ...core, evidence: evidence ?? [] }),
    ...core,
    recordedAt: recordedAt ?? when ?? null,
    ...(supersedes ? { supersedes } : {}),
  };
}

export function encodeEntry(entry: AssertionEntry): string {
  return JSON.stringify(entry);
}

export function entryProblem(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return 'not a JSON object';
  const record = entry as Record<string, unknown>;
  if (record.v !== ASSERTION_V) {
    return `unknown envelope version '${record.v}' (this oont reads ${ASSERTION_V})`;
  }
  if (typeof record.id !== 'string' || !record.id.startsWith('as_')) return 'missing id';
  if (typeof record.kind !== 'string') return 'missing kind';
  if (typeof record.producer !== 'string') return 'missing producer';
  if (record.recordedAt != null && typeof record.recordedAt !== 'string') {
    return 'recordedAt must be an ISO string';
  }
  const expected = mintEntryId(record);
  if (expected !== record.id) {
    return (
      `id ${record.id} does not match its content (expected ${expected}); ` +
      'the line was edited without re-hashing'
    );
  }
  return null;
}

export function compareEntries(left: AssertionEntry, right: AssertionEntry): number {
  const leftRecordedAt = left.recordedAt ?? '';
  const rightRecordedAt = right.recordedAt ?? '';
  if (leftRecordedAt !== rightRecordedAt) return leftRecordedAt < rightRecordedAt ? -1 : 1;
  const leftOrdinal = typeof left.body?.ordinal === 'number' ? left.body.ordinal : 0;
  const rightOrdinal = typeof right.body?.ordinal === 'number' ? right.body.ordinal : 0;
  if (leftOrdinal !== rightOrdinal) return leftOrdinal - rightOrdinal;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
