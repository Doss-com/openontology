/** Stable entry envelope used by object-native Ont segments. */
import { createHash } from 'node:crypto';

export const ASSERTION_V = 'oont.assertion/v1';
export const STORE_V = 'oont.ont/v1';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

const seedValue = (entry, names) => {
  for (const name of names) {
    if (entry[name] !== undefined) return entry[name];
  }
  return null;
};

export function mintEntryId(entry) {
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
}) {
  const when = occurredAt ?? validFrom;
  if (CONCLUSION_KINDS.has(kind) && !(evidence?.length > 0)) {
    throw new Error(`a '${kind}' conclusion cannot be written without evidence `
      + `[G29, ED19]. Two evidence-free conclusions about one element are indistinguishable by `
      + `construction, so this would also collide with any other. About: ${about ?? 'ont'}`);
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

export function encodeEntry(entry) {
  return JSON.stringify(entry);
}

export function entryProblem(entry) {
  if (!entry || typeof entry !== 'object') return 'not a JSON object';
  if (entry.v !== ASSERTION_V) {
    return `unknown envelope version '${entry.v}' (this oont reads ${ASSERTION_V})`;
  }
  if (typeof entry.id !== 'string' || !entry.id.startsWith('as_')) return 'missing id';
  if (typeof entry.kind !== 'string') return 'missing kind';
  if (typeof entry.producer !== 'string') return 'missing producer';
  if (entry.recordedAt != null && typeof entry.recordedAt !== 'string') {
    return 'recordedAt must be an ISO string';
  }
  const expected = mintEntryId(entry);
  if (expected !== entry.id) {
    return `id ${entry.id} does not match its content (expected ${expected}); `
      + 'the line was edited without re-hashing';
  }
  return null;
}

export function compareEntries(left, right) {
  const leftRecordedAt = left.recordedAt ?? '';
  const rightRecordedAt = right.recordedAt ?? '';
  if (leftRecordedAt !== rightRecordedAt) return leftRecordedAt < rightRecordedAt ? -1 : 1;
  const leftOrdinal = left.body?.ordinal ?? 0;
  const rightOrdinal = right.body?.ordinal ?? 0;
  if (leftOrdinal !== rightOrdinal) return leftOrdinal - rightOrdinal;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
