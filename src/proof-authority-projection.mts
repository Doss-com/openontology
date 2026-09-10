/** Content-addressed proof census derived from one immutable source projection. */
import { stableObjectSha256, stableObjectText } from './canonical-content.mjs';

export interface ProofEvidenceReference {
  sourceRef: string;
  sourceSha256: string;
  byteStart: number;
  byteEnd: number;
  textSha256: string;
}

export interface ProofAuthorityItem {
  sourceProjectionItemId: string;
  familyId: string;
  canonicalRoles: readonly string[];
  modality: string;
  polarity: string;
  actorRef: string | null;
  validAt: string | null;
  knownAt: string | null;
  exactEvidenceReferences: readonly ProofEvidenceReference[];
}

export interface ProofAuthorityRelation {
  type: string;
  sourceProjectionItemId: string;
  targetProjectionItemId: string;
}

export interface SourceProjectionAuthority {
  sourceProjectionKind: string;
  sourceProjectionSha256: string;
  proofCensusSha256: string;
}

export interface ProofAuthorityProjection extends SourceProjectionAuthority {
  schemaVersion: 1;
  kind: 'OpenOntologyProofAuthorityProjectionV1';
  items: readonly ProofAuthorityItem[];
  relations: readonly ProofAuthorityRelation[];
}

export interface CompileProofAuthorityProjectionInput {
  sourceProjectionKind?: unknown;
  sourceProjectionSha256?: unknown;
  items?: unknown;
  relations?: unknown;
}

type UnknownRecord = Record<string, unknown>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COUNTEREVIDENCE_RELATION_TYPES = new Set(['contradicts', 'qualifies']);
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (): never => {
  const error = new TypeError('PROOF_AUTHORITY_PROJECTION') as TypeError & { code: string };
  error.code = error.message;
  throw error;
};
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const plain = (value: unknown): value is UnknownRecord => value !== null
  && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (row: UnknownRecord, keys: string[]): boolean =>
  Object.keys(row).length === keys.length
  && Object.keys(row).every((key) => keys.includes(key));
const exactTimeOrNull = (value: unknown): value is string | null => value === null
  || typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
const unknownList = (value: unknown): unknown[] => Array.isArray(value) ? value : fail();
const nonemptyString = (value: unknown): string => typeof value === 'string' && value.length > 0
  ? value : fail();
const sha256String = (value: unknown): string => typeof value === 'string' && SHA256.test(value)
  ? value : fail();
const safeInteger = (value: unknown): number => typeof value === 'number'
  && Number.isSafeInteger(value) ? value : fail();
const timeOrNull = (value: unknown): string | null => exactTimeOrNull(value) ? value : fail();

function normalizeEvidenceReference(value: unknown): ProofEvidenceReference {
  const row = plain(value) ? value : fail();
  if (!exactKeys(row, ['sourceRef', 'sourceSha256', 'byteStart', 'byteEnd', 'textSha256'])) fail();
  const sourceRef = nonemptyString(row.sourceRef);
  const sourceSha256 = sha256String(row.sourceSha256);
  const byteStart = safeInteger(row.byteStart);
  const byteEnd = safeInteger(row.byteEnd);
  const textSha256 = sha256String(row.textSha256);
  if (byteStart < 0 || byteEnd <= byteStart) fail();
  return freeze({
    sourceRef,
    sourceSha256,
    byteStart,
    byteEnd,
    textSha256,
  });
}

export function normalizeProofAuthorityItem(value: unknown): ProofAuthorityItem {
  const row = plain(value) ? value : fail();
  if (!exactKeys(row, [
      'sourceProjectionItemId', 'familyId', 'canonicalRoles', 'modality', 'polarity',
      'actorRef', 'validAt', 'knownAt', 'exactEvidenceReferences',
    ])) fail();
  const sourceProjectionItemId = nonemptyString(row.sourceProjectionItemId);
  const familyId = nonemptyString(row.familyId);
  const canonicalRoleValues = unknownList(row.canonicalRoles);
  if (canonicalRoleValues.length < 1
    || !canonicalRoleValues.every((role) => typeof role === 'string' && role.length > 0)) fail();
  const canonicalRoles = [...new Set(canonicalRoleValues as string[])].sort(compare);
  if (canonicalRoles.length !== canonicalRoleValues.length) fail();
  const modality = nonemptyString(row.modality);
  const polarity = nonemptyString(row.polarity);
  const actorRef = row.actorRef === null ? null : nonemptyString(row.actorRef);
  const validAt = timeOrNull(row.validAt);
  const knownAt = timeOrNull(row.knownAt);
  const exactEvidenceReferences = unknownList(row.exactEvidenceReferences)
    .map(normalizeEvidenceReference)
    .sort((left, right) => compare(stableObjectText(left), stableObjectText(right)));
  if (new Set(exactEvidenceReferences.map(stableObjectText)).size
    !== exactEvidenceReferences.length) fail();
  return freeze({
    sourceProjectionItemId,
    familyId,
    canonicalRoles: freeze(canonicalRoles),
    modality,
    polarity,
    actorRef,
    validAt,
    knownAt,
    exactEvidenceReferences: freeze(exactEvidenceReferences),
  });
}

export function normalizeProofAuthorityRelation(value: unknown,
  itemIds: Set<string>): ProofAuthorityRelation {
  const row = plain(value) ? value : fail();
  if (!exactKeys(row, ['type', 'sourceProjectionItemId', 'targetProjectionItemId'])) fail();
  const type = nonemptyString(row.type);
  const sourceProjectionItemId = nonemptyString(row.sourceProjectionItemId);
  const targetProjectionItemId = nonemptyString(row.targetProjectionItemId);
  if (sourceProjectionItemId === targetProjectionItemId
    || !itemIds.has(sourceProjectionItemId)
    || !itemIds.has(targetProjectionItemId)) fail();
  return freeze({
    type,
    sourceProjectionItemId,
    targetProjectionItemId,
  });
}

export function normalizeSourceProjectionAuthority(value: unknown): SourceProjectionAuthority {
  const row = plain(value) ? value : fail();
  if (!exactKeys(row, [
      'sourceProjectionKind', 'sourceProjectionSha256', 'proofCensusSha256',
    ])) fail();
  return freeze({
    sourceProjectionKind: nonemptyString(row.sourceProjectionKind),
    sourceProjectionSha256: sha256String(row.sourceProjectionSha256),
    proofCensusSha256: sha256String(row.proofCensusSha256),
  });
}

export function compileProofAuthorityProjection({
  sourceProjectionKind,
  sourceProjectionSha256,
  items: inputItems,
  relations: inputRelations,
}: CompileProofAuthorityProjectionInput = {}): ProofAuthorityProjection {
  const exactSourceProjectionKind = nonemptyString(sourceProjectionKind);
  const exactSourceProjectionSha256 = sha256String(sourceProjectionSha256);
  const items = unknownList(inputItems).map(normalizeProofAuthorityItem)
    .sort((left, right) => compare(left.sourceProjectionItemId, right.sourceProjectionItemId));
  const itemIds = new Set(items.map((item) => item.sourceProjectionItemId));
  if (itemIds.size !== items.length) fail();
  const itemById = new Map(items.map((item) => [item.sourceProjectionItemId, item]));
  const relations = unknownList(inputRelations)
    .map((relation) => normalizeProofAuthorityRelation(relation, itemIds))
    .sort((left, right) => compare(stableObjectText(left), stableObjectText(right)));
  if (new Set(relations.map(stableObjectText)).size !== relations.length) fail();
  if (relations.some((relation) => COUNTEREVIDENCE_RELATION_TYPES.has(relation.type)
    && !itemById.get(relation.sourceProjectionItemId)?.canonicalRoles
      .includes('counterevidence'))) fail();
  const core = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologyProofAuthorityProjectionV1' as const,
    sourceProjectionKind: exactSourceProjectionKind,
    sourceProjectionSha256: exactSourceProjectionSha256,
    items: freeze(items),
    relations: freeze(relations),
  };
  return freeze({ ...core, proofCensusSha256: stableObjectSha256(core) });
}

export function validateProofAuthorityProjection(value: unknown): ProofAuthorityProjection {
  const row = plain(value) ? value : fail();
  const expected = compileProofAuthorityProjection({
    sourceProjectionKind: row.sourceProjectionKind,
    sourceProjectionSha256: row.sourceProjectionSha256,
    items: row.items,
    relations: row.relations,
  });
  if (stableObjectText(row) !== stableObjectText(expected)) fail();
  return freeze(structuredClone(expected));
}

export function proofAuthorityForProjection(value: unknown): SourceProjectionAuthority {
  const projection = validateProofAuthorityProjection(value);
  return freeze({
    sourceProjectionKind: projection.sourceProjectionKind,
    sourceProjectionSha256: projection.sourceProjectionSha256,
    proofCensusSha256: projection.proofCensusSha256,
  });
}
