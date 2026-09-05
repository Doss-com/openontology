/**
 * Question-independent compiler for source-native object identity, exact field
 * revisions, and duplicate Evidence references.
 *
 * Source adapters own format parsing. This Module owns the canonical mapping
 * from adapter spans to exact, replayable Ont navigation objects.
 */
import { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';

/** JSON-safe structural domain types shared by the source-native product lane. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type UnknownRecord = { [key: string]: unknown };

export interface SourceNativeSource {
  sourceType: string;
  relativePath: string;
  occurredAt: string;
  content: string;
  sourceSha256: string;
}

export interface SourceNativeSourceInput {
  sourceType?: unknown;
  relativePath?: unknown;
  occurredAt?: unknown;
  content?: unknown;
  sourceSha256?: unknown;
}

export interface SourceNativeEvidence {
  relativePath: string;
  sourceSha256: string;
  byteStart: number;
  byteEnd: number;
  textSha256: string;
}

export interface SourceNativeField {
  schema: 1;
  kind: 'OpenOntologySourceNativeFieldV1';
  fieldPath: string;
  value: string;
  evidence: SourceNativeEvidence;
  fieldSha256: string;
  propositionFamilyKey?: string;
  businessEntityKeys?: string[];
  canonicalValue?: JsonValue;
  canonicalProposition?: UnknownRecord;
  validAt?: string;
  knownAt?: string;
  provenanceBy?: UnknownRecord;
  actorResolutionEvidence?: UnknownRecord;
}

export interface SourceNativeFieldInput {
  fieldPath?: unknown;
  value?: unknown;
  codeUnitStart?: unknown;
  propositionFamilyKey?: unknown;
  businessEntityKeys?: unknown;
  canonicalProposition?: unknown;
  validAt?: unknown;
  knownAt?: unknown;
  canonicalValue?: unknown;
  provenanceBy?: unknown;
  actorResolutionEvidence?: unknown;
}

export interface SourceNativeCanonicalPropositionV2 extends UnknownRecord {
  kind: 'OpenOntologySourceNativeCanonicalPropositionV2';
  propositionKey: string;
  actorHome: 'ObjectDef/InstanceRef';
  stateHome: 'Claim/PropositionRevision-payload';
  actorKind: string;
  predicate: string;
  state: string;
  dimension: string;
  canonicalRoles: string[];
  modality: string;
  polarity: string;
  businessEntityKeys: string[];
  extractionAuthority: 'deterministic-source-adapter-v1';
}

export interface SourceNativeObjectIdentity {
  home: 'ObjectDef/InstanceRef';
  sourceSystem: string;
  objectType: string;
  externalId: string;
  namespace?: string;
}

export interface SourceNativeObject {
  schema: 1;
  kind: 'OpenOntologySourceNativeObjectV1';
  sourceType: string;
  relativePath: string;
  sourceSha256: string;
  occurredAt: string;
  objectIdentity: SourceNativeObjectIdentity;
  objectIdentitySha256: string;
  businessEntityKeys: string[];
  transportOriginSystem: string | null;
  fields: SourceNativeField[];
  duplicateEvidenceFieldPaths: string[];
  nativeObjectSha256: string;
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeObjectInput {
  relativePath?: unknown;
  fields?: unknown;
  objectIdentity?: unknown;
  businessEntityKeys?: unknown;
  duplicateEvidenceFieldPaths?: unknown;
  transportOriginSystem?: unknown;
}

export interface SourceNativeFieldRevision {
  schema: 1;
  kind: 'OpenOntologySourceNativeFieldRevisionV1';
  relationType: 'supersedes';
  basis: string;
  objectIdentity: SourceNativeObjectIdentity;
  objectIdentitySha256: string;
  fieldPath: string;
  sourceField: SourceNativeField;
  targetField: SourceNativeField;
  sourceOccurredAt: string;
  targetOccurredAt: string;
  revisionSha256: string;
  admissionState: 'deterministic-source-native';
  navigationOnly: true;
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeObjectMap {
  schema: 1;
  kind: 'OpenOntologySourceNativeObjectMapV1';
  sourceCount: number;
  mappedSourceCount: number;
  unsupportedSourceCount: number;
  nativeObjectCount: number;
  fieldRevisionCount: number;
  duplicateEvidenceClusterCount: number;
  businessEntityEvidenceNeighborhoodCount: number;
  parseFailureCount: number;
  adapterDiagnostics: JsonObject[];
  nativeObjects: SourceNativeObject[];
  fieldRevisions: SourceNativeFieldRevision[];
  duplicateEvidenceClusters: UnknownRecord[];
  businessEntityEvidenceNeighborhoods: UnknownRecord[];
  nativeObjectMapSha256: string;
  objectIdentityHome: 'ObjectDef/InstanceRef-plus-provenance-by';
  propositionHome: 'Claim/PropositionRevision-payload';
  relationHome: 'typed-relation-between-proposition-revisions';
  exactSupportHome: 'evidence-references-and-dependencies';
  modelCalls: 0;
  networkCalls: 0;
  questionIndependent: true;
  targetLeakage: false;
  navigationOnly: true;
  exactSourcesRemainAuthority: true;
}

interface ExactSourceInput {
  sourceType: string;
  relativePath: string;
  occurredAt: string;
  content: string;
  sourceSha256: string;
}
interface ExactFieldInput {
  fieldPath: string;
  value: string;
  codeUnitStart: number;
  propositionFamilyKey?: string | null;
  businessEntityKeys?: string[] | null;
  canonicalProposition?: UnknownRecord | null;
  validAt?: string | null;
  knownAt?: string | null;
  canonicalValue?: JsonValue | null;
  provenanceBy?: UnknownRecord | null;
  actorResolutionEvidence?: UnknownRecord | null;
}
interface ExactObjectInput {
  relativePath: string;
  fields: ExactFieldInput[];
  objectIdentity: unknown;
  businessEntityKeys: string[];
  duplicateEvidenceFieldPaths: string[];
  transportOriginSystem?: string | null;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const FIELD_PATH = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CANONICAL_ROLES = new Set([
  'action', 'actor', 'change', 'chronology', 'counterevidence', 'outcome', 'state',
]);
const PROPOSITION_MODALITIES = new Set(['observed', 'planned', 'reported', 'static-only', 'unresolved']);
const PROPOSITION_POLARITIES = new Set(['mixed', 'negative', 'positive']);
const compare = (left: unknown, right: unknown): number => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code: string): never => { const error = new TypeError(code) as TypeError & { code: string }; error.code = code; throw error; };
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isJsonValue = (value: unknown): value is JsonValue =>
  value === null || typeof value === 'string' || typeof value === 'boolean'
  || typeof value === 'number' && Number.isFinite(value)
  || Array.isArray(value) && value.every(isJsonValue)
  || isRecord(value) && Object.values(value).every(isJsonValue);
const exactRecord = (value: unknown, code: string): UnknownRecord =>
  isRecord(value) ? value : fail(code);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isJsonObject = (value: unknown): value is JsonObject =>
  isRecord(value) && Object.values(value).every(isJsonValue);
const isNativeObject = (value: unknown): value is SourceNativeObject =>
  isRecord(value) && value.kind === 'OpenOntologySourceNativeObjectV1';
const isFieldRevision = (value: unknown): value is SourceNativeFieldRevision =>
  isRecord(value) && value.kind === 'OpenOntologySourceNativeFieldRevisionV1';

function normalizeSourceInput(value: unknown): ExactSourceInput {
  const row = exactRecord(value, 'SOURCE_NATIVE_SOURCE');
  if (typeof row.sourceType !== 'string' || !row.sourceType
    || typeof row.relativePath !== 'string' || !row.relativePath
    || typeof row.occurredAt !== 'string' || !row.occurredAt
    || typeof row.content !== 'string' || !row.content
    || typeof row.sourceSha256 !== 'string' || !row.sourceSha256) {
    fail('SOURCE_NATIVE_SOURCE');
  }
  const sourceType = typeof row.sourceType === 'string' ? row.sourceType : fail('SOURCE_NATIVE_SOURCE');
  const relativePath = typeof row.relativePath === 'string' ? row.relativePath : fail('SOURCE_NATIVE_SOURCE');
  const occurredAt = typeof row.occurredAt === 'string' ? row.occurredAt : fail('SOURCE_NATIVE_SOURCE');
  const content = typeof row.content === 'string' ? row.content : fail('SOURCE_NATIVE_SOURCE');
  const sourceSha256 = typeof row.sourceSha256 === 'string' ? row.sourceSha256 : fail('SOURCE_NATIVE_SOURCE');
  return {
    sourceType, relativePath, occurredAt, content, sourceSha256,
  };
}

function normalizeFieldInput(value: unknown): ExactFieldInput {
  const row = exactRecord(value, 'SOURCE_NATIVE_FIELD_INPUT');
  const fieldPath = typeof row.fieldPath === 'string' ? row.fieldPath : '';
  const fieldValue = typeof row.value === 'string' ? row.value : '';
  const codeUnitStart = typeof row.codeUnitStart === 'number' ? row.codeUnitStart : -1;
  const propositionFamilyKey = row.propositionFamilyKey === undefined ? null
    : typeof row.propositionFamilyKey === 'string' ? row.propositionFamilyKey : fail('SOURCE_NATIVE_FIELD_INPUT');
  const businessEntityKeys = row.businessEntityKeys === undefined ? null
    : Array.isArray(row.businessEntityKeys) && row.businessEntityKeys.every((key) => typeof key === 'string')
      ? row.businessEntityKeys : fail('SOURCE_NATIVE_FIELD_INPUT');
  const canonicalProposition = row.canonicalProposition === undefined ? null
    : isRecord(row.canonicalProposition) ? row.canonicalProposition : fail('SOURCE_NATIVE_FIELD_INPUT');
  const validAt = row.validAt === undefined ? null
    : typeof row.validAt === 'string' ? row.validAt : fail('SOURCE_NATIVE_FIELD_INPUT');
  const knownAt = row.knownAt === undefined ? null
    : typeof row.knownAt === 'string' ? row.knownAt : fail('SOURCE_NATIVE_FIELD_INPUT');
  const canonicalValue = row.canonicalValue === undefined ? null
    : isJsonValue(row.canonicalValue) ? row.canonicalValue : fail('SOURCE_NATIVE_FIELD_INPUT');
  const provenanceBy = row.provenanceBy === undefined ? null
    : isRecord(row.provenanceBy) ? row.provenanceBy : fail('SOURCE_NATIVE_FIELD_INPUT');
  const actorResolutionEvidence = row.actorResolutionEvidence === undefined ? null
    : isRecord(row.actorResolutionEvidence) ? row.actorResolutionEvidence : fail('SOURCE_NATIVE_FIELD_INPUT');
  if (!fieldPath || !fieldValue || !Number.isSafeInteger(codeUnitStart) || codeUnitStart < 0) {
    fail('SOURCE_NATIVE_FIELD_INPUT');
  }
  return {
    fieldPath, value: fieldValue, codeUnitStart, propositionFamilyKey,
    businessEntityKeys, canonicalProposition, validAt, knownAt, canonicalValue,
    provenanceBy, actorResolutionEvidence,
  };
}

function normalizeObjectInput(value: unknown): ExactObjectInput {
  const row = exactRecord(value, 'SOURCE_NATIVE_OBJECT_INPUT');
  const relativePath = typeof row.relativePath === 'string' ? row.relativePath : '';
  if (!relativePath || !Array.isArray(row.fields) || row.fields.length < 1) {
    fail('SOURCE_NATIVE_OBJECT_INPUT');
  }
  const businessEntityKeys = row.businessEntityKeys === undefined ? []
    : Array.isArray(row.businessEntityKeys) && row.businessEntityKeys.every((key) => typeof key === 'string')
      ? row.businessEntityKeys : fail('SOURCE_NATIVE_BUSINESS_ENTITY_KEYS');
  const duplicateEvidenceFieldPaths = row.duplicateEvidenceFieldPaths === undefined ? []
    : Array.isArray(row.duplicateEvidenceFieldPaths)
      && row.duplicateEvidenceFieldPaths.every((path) => typeof path === 'string')
      ? row.duplicateEvidenceFieldPaths : fail('SOURCE_NATIVE_DUPLICATE_FIELDS');
  const transportOriginSystem = row.transportOriginSystem === undefined ? null
    : row.transportOriginSystem === null || typeof row.transportOriginSystem === 'string'
      ? row.transportOriginSystem : fail('SOURCE_NATIVE_TRANSPORT_ORIGIN');
  const fields: unknown[] = Array.isArray(row.fields) ? row.fields : fail('SOURCE_NATIVE_OBJECT_INPUT');
  if (fields.length < 1) fail('SOURCE_NATIVE_OBJECT_INPUT');
  return {
    relativePath,
    fields: fields.map(normalizeFieldInput),
    objectIdentity: row.objectIdentity,
    businessEntityKeys,
    duplicateEvidenceFieldPaths,
    transportOriginSystem,
  };
}

function jsonClone(value: unknown, code: string): unknown {
  const visit = (row: unknown): void => {
    if (row === null || typeof row === 'string' || typeof row === 'boolean') return;
    if (typeof row === 'number' && Number.isFinite(row)) return;
    if (Array.isArray(row)) {
      for (const child of row) visit(child);
      return;
    }
    const object = isRecord(row) ? row : fail(code);
    if (Object.getPrototypeOf(object) !== Object.prototype) fail(code);
    for (const [key, child] of Object.entries(object)) {
      if (!key || child === undefined) fail(code);
      visit(child);
    }
  };
  visit(value);
  const text = JSON.stringify(value);
  if (typeof text !== 'string') fail(code);
  return JSON.parse(text);
}

function logicalPath(value: unknown, code: string): string {
  const path = typeof value === 'string' ? value : fail(code);
  if (!path || path.length > 1024 || path.includes('\0')
    || path.startsWith('/') || path.includes('\\')) fail(code);
  if (path.split('/').some((segment: string) => !segment || segment === '.' || segment === '..')) fail(code);
  return path;
}

function validateSource(source: ExactSourceInput): SourceNativeSource {
  logicalPath(source.relativePath, 'SOURCE_NATIVE_SOURCE');
  if (!source.sourceType || source.relativePath.split('/')[0] !== source.sourceType
    || !Number.isFinite(Date.parse(source.occurredAt))
    || !source.content
    || !SHA256.test(source.sourceSha256)
    || objectBytesSha256(Buffer.from(source.content)) !== source.sourceSha256) fail('SOURCE_NATIVE_SOURCE');
  return source;
}

function validateIdentity(value: unknown): SourceNativeObjectIdentity {
  const identity = exactRecord(jsonClone(value, 'SOURCE_NATIVE_OBJECT_IDENTITY'),
    'SOURCE_NATIVE_OBJECT_IDENTITY');
  if (identity.home !== 'ObjectDef/InstanceRef'
    || typeof identity.sourceSystem !== 'string' || !identity.sourceSystem
    || typeof identity.objectType !== 'string' || !identity.objectType
    || typeof identity.externalId !== 'string' || !identity.externalId) fail('SOURCE_NATIVE_OBJECT_IDENTITY');
  const sourceSystem = typeof identity.sourceSystem === 'string' ? identity.sourceSystem : fail('SOURCE_NATIVE_OBJECT_IDENTITY');
  const objectType = typeof identity.objectType === 'string' ? identity.objectType : fail('SOURCE_NATIVE_OBJECT_IDENTITY');
  const externalId = typeof identity.externalId === 'string' ? identity.externalId : fail('SOURCE_NATIVE_OBJECT_IDENTITY');
  return freeze({
    home: 'ObjectDef/InstanceRef',
    sourceSystem, objectType, externalId,
    ...(typeof identity.namespace === 'string' ? { namespace: identity.namespace } : {}),
  });
}

function validateProvenanceBy(value: unknown): UnknownRecord | null {
  if (value === null) return null;
  const provenanceBy = exactRecord(jsonClone(value, 'SOURCE_NATIVE_PROVENANCE_BY'),
    'SOURCE_NATIVE_PROVENANCE_BY');
  const roleLabels = provenanceBy.roleLabels;
  if (provenanceBy.home !== 'ObjectDef/InstanceRef'
    || typeof provenanceBy.sourceSystem !== 'string' || !provenanceBy.sourceSystem
    || typeof provenanceBy.displayName !== 'string' || !provenanceBy.displayName.trim()
    || !isStringArray(roleLabels)
    || new Set(roleLabels).size !== roleLabels.length
    || roleLabels.some((role: string) => !role)) {
    fail('SOURCE_NATIVE_PROVENANCE_BY');
  }
  return freeze(provenanceBy);
}

function exactActorResolutionEvidence({ source, input, fieldBusinessEntityKeys }: {
  source: SourceNativeSource;
  input: UnknownRecord | null;
  fieldBusinessEntityKeys: string[] | null;
}): UnknownRecord | null {
  if (input === null) return null;
  const inputBusinessEntityKeys = input.businessEntityKeys;
  const inputValue = input.value;
  const exactBusinessEntityKeys = isStringArray(inputBusinessEntityKeys)
    ? inputBusinessEntityKeys : fail('SOURCE_NATIVE_ACTOR_RESOLUTION_EVIDENCE');
  const inputCodeUnitStart = typeof input.codeUnitStart === 'number' && Number.isSafeInteger(input.codeUnitStart)
    ? input.codeUnitStart : fail('SOURCE_NATIVE_ACTOR_RESOLUTION_EVIDENCE');
  const exactInputValue = typeof inputValue === 'string' && inputValue
    ? inputValue : fail('SOURCE_NATIVE_ACTOR_RESOLUTION_EVIDENCE');
  if (exactBusinessEntityKeys.length !== 1
    || !fieldBusinessEntityKeys?.includes(exactBusinessEntityKeys[0])
    || source.content.slice(inputCodeUnitStart, inputCodeUnitStart + exactInputValue.length)
      !== exactInputValue) {
    fail('SOURCE_NATIVE_ACTOR_RESOLUTION_EVIDENCE');
  }
  const businessEntityKeys = [...new Set(exactBusinessEntityKeys)].sort(compare);
  if (businessEntityKeys.length !== 1
    || !fieldBusinessEntityKeys?.includes(businessEntityKeys[0])
    || businessEntityKeys.length !== exactBusinessEntityKeys.length) fail('SOURCE_NATIVE_ACTOR_RESOLUTION_EVIDENCE');
  const byteStart = Buffer.byteLength(source.content.slice(0, inputCodeUnitStart));
  const byteEnd = byteStart + Buffer.byteLength(exactInputValue);
  return freeze({
    schema: 1,
    kind: 'OpenOntologyExactActorResolutionEvidenceV1',
    businessEntityKeys: freeze(businessEntityKeys),
    relativePath: source.relativePath,
    sourceSha256: source.sourceSha256,
    byteStart,
    byteEnd,
    textSha256: objectBytesSha256(Buffer.from(exactInputValue)),
    exactText: exactInputValue,
  });
}

function validateCanonicalProposition(value: UnknownRecord, {
  propositionFamilyKey,
  fieldBusinessEntityKeys,
  validAt,
  knownAt,
  code,
}: {
  propositionFamilyKey: string | null;
  fieldBusinessEntityKeys: string[] | null;
  validAt: string | null;
  knownAt: string | null;
  code: string;
}): void {
  const propositionKeys = value.businessEntityKeys;
  const canonicalRoles = value.canonicalRoles;
  const version = value.kind;
  if (!['OpenOntologySourceNativeCanonicalPropositionV1',
    'OpenOntologySourceNativeCanonicalPropositionV2'].includes(String(version))
    || value.actorHome !== 'ObjectDef/InstanceRef'
    || value.stateHome !== 'Claim/PropositionRevision-payload'
    || typeof value.actorKind !== 'string' || !value.actorKind
    || typeof value.predicate !== 'string' || !value.predicate
    || typeof value.state !== 'string' || !value.state
    || typeof value.dimension !== 'string' || !value.dimension
    || !isStringArray(propositionKeys)
    || propositionKeys.some((key: string) => !fieldBusinessEntityKeys?.includes(key))
    || value.extractionAuthority !== 'deterministic-source-adapter-v1'
    || version === 'OpenOntologySourceNativeCanonicalPropositionV2'
      && (typeof value.propositionKey !== 'string' || !value.propositionKey
        || propositionFamilyKey === null || value.dimension !== propositionFamilyKey
        || !isStringArray(canonicalRoles) || canonicalRoles.length < 1
        || new Set(canonicalRoles).size !== canonicalRoles.length
        || canonicalRoles.some((role: string) => !CANONICAL_ROLES.has(role))
        || !PROPOSITION_MODALITIES.has(String(value.modality))
        || !PROPOSITION_POLARITIES.has(String(value.polarity))
        || validAt === null || knownAt === null)) {
    fail(code);
  }
}

function exactField({ source, fieldPath, value, codeUnitStart,
  propositionFamilyKey = null, businessEntityKeys: fieldBusinessEntityKeys = null,
  canonicalProposition: canonicalPropositionInput = null, validAt = null, knownAt = null,
  canonicalValue: canonicalValueInput = null, provenanceBy: provenanceByInput = null,
  actorResolutionEvidence: actorResolutionEvidenceInput = null }: {
    source: SourceNativeSource;
    fieldPath: string;
    value: string;
    codeUnitStart: number;
    propositionFamilyKey?: string | null;
    businessEntityKeys?: string[] | null;
    canonicalProposition?: unknown;
    validAt?: string | null;
    knownAt?: string | null;
    canonicalValue?: JsonValue | null;
    provenanceBy?: UnknownRecord | null;
    actorResolutionEvidence?: UnknownRecord | null;
  }): SourceNativeField {
  if (!FIELD_PATH.test(fieldPath ?? '') || typeof value !== 'string' || !value
    || !Number.isSafeInteger(codeUnitStart) || codeUnitStart < 0
    || propositionFamilyKey !== null && !FIELD_PATH.test(propositionFamilyKey)
    || validAt !== null && (typeof validAt !== 'string' || !Number.isFinite(Date.parse(validAt)))
    || knownAt !== null && (typeof knownAt !== 'string' || !Number.isFinite(Date.parse(knownAt)))
    || fieldBusinessEntityKeys !== null
      && (!Array.isArray(fieldBusinessEntityKeys)
        || fieldBusinessEntityKeys.length < 1
        || new Set(fieldBusinessEntityKeys).size !== fieldBusinessEntityKeys.length
        || fieldBusinessEntityKeys.some((key) => typeof key !== 'string' || !key))
    || source.content.slice(codeUnitStart, codeUnitStart + value.length) !== value) {
    fail('SOURCE_NATIVE_FIELD_SPAN');
  }
  const canonicalProposition = canonicalPropositionInput === null ? null
    : exactRecord(jsonClone(canonicalPropositionInput, 'SOURCE_NATIVE_CANONICAL_PROPOSITION'),
      'SOURCE_NATIVE_CANONICAL_PROPOSITION');
  const canonicalValue = canonicalValueInput === null ? null : (() => {
    const cloned = jsonClone(canonicalValueInput, 'SOURCE_NATIVE_CANONICAL_VALUE');
    return isJsonValue(cloned) ? cloned : fail('SOURCE_NATIVE_CANONICAL_VALUE');
  })();
  const provenanceBy = validateProvenanceBy(provenanceByInput);
  const actorResolutionEvidence = exactActorResolutionEvidence({
    source,
    input: actorResolutionEvidenceInput,
    fieldBusinessEntityKeys,
  });
  if (canonicalProposition !== null) {
    validateCanonicalProposition(canonicalProposition, {
      propositionFamilyKey,
      fieldBusinessEntityKeys,
      validAt,
      knownAt,
      code: 'SOURCE_NATIVE_CANONICAL_PROPOSITION',
    });
  }
  const byteStart = Buffer.byteLength(source.content.slice(0, codeUnitStart));
  const byteEnd = byteStart + Buffer.byteLength(value);
  const core: Omit<SourceNativeField, 'fieldSha256'> = {
    schema: 1,
    kind: 'OpenOntologySourceNativeFieldV1',
    fieldPath,
    ...(propositionFamilyKey === null ? {} : { propositionFamilyKey }),
    ...(fieldBusinessEntityKeys === null ? {} : {
      businessEntityKeys: freeze([...fieldBusinessEntityKeys].sort(compare)),
    }),
    ...(canonicalProposition === null ? {} : { canonicalProposition: freeze(canonicalProposition) }),
    ...(canonicalValue === null ? {} : { canonicalValue: freeze(canonicalValue) }),
    ...(actorResolutionEvidence === null ? {} : { actorResolutionEvidence }),
    ...(validAt === null ? {} : { validAt }),
    ...(knownAt === null ? {} : { knownAt }),
    ...(provenanceBy === null ? {} : { provenanceBy }),
    value,
    evidence: freeze({
      relativePath: source.relativePath,
      sourceSha256: source.sourceSha256,
      byteStart,
      byteEnd,
      textSha256: objectBytesSha256(Buffer.from(value)),
    }),
  };
  return freeze({ ...core, fieldSha256: stableObjectSha256(core) });
}

function compileObject(input: ExactObjectInput, source: SourceNativeSource): SourceNativeObject {
  if (input?.relativePath !== source.relativePath || !Array.isArray(input.fields) || input.fields.length < 1) {
    fail('SOURCE_NATIVE_OBJECT_INPUT');
  }
  const objectIdentity = validateIdentity(input.objectIdentity);
  const businessEntityKeys = [...new Set(input.businessEntityKeys)].sort(compare);
  if (businessEntityKeys.length !== input.businessEntityKeys.length
    || businessEntityKeys.some((value) => !value)) {
    fail('SOURCE_NATIVE_BUSINESS_ENTITY_KEYS');
  }
  if (businessEntityKeys.length > 0
    && (typeof objectIdentity.namespace !== 'string' || !objectIdentity.namespace)) {
    fail('SOURCE_NATIVE_BUSINESS_ENTITY_NAMESPACE');
  }
  const fields = input.fields.map((field: ExactFieldInput) => exactField({ source, ...field }));
  if (new Set(fields.map((field) => field.fieldPath)).size !== fields.length) fail('SOURCE_NATIVE_OBJECT_FIELDS');
  if (fields.some((field) => (field.businessEntityKeys ?? [])
    .some((key) => !businessEntityKeys.includes(key)))) fail('SOURCE_NATIVE_FIELD_BUSINESS_ENTITY_KEYS');
  const duplicateEvidenceFieldPaths = [...new Set(input.duplicateEvidenceFieldPaths)].sort(compare);
  if (duplicateEvidenceFieldPaths.length !== input.duplicateEvidenceFieldPaths.length
    || duplicateEvidenceFieldPaths.some((fieldPath) => !fields.some((field) => field.fieldPath === fieldPath))) {
    fail('SOURCE_NATIVE_DUPLICATE_FIELDS');
  }
  const transportOriginSystem = input.transportOriginSystem ?? null;
  if (transportOriginSystem !== null
    && (typeof transportOriginSystem !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(transportOriginSystem)
      || transportOriginSystem === objectIdentity.sourceSystem)) {
    fail('SOURCE_NATIVE_TRANSPORT_ORIGIN');
  }
  const core: Omit<SourceNativeObject, 'nativeObjectSha256'> = {
    schema: 1,
    kind: 'OpenOntologySourceNativeObjectV1',
    sourceType: source.sourceType,
    relativePath: source.relativePath,
    sourceSha256: source.sourceSha256,
    occurredAt: source.occurredAt,
    objectIdentity,
    objectIdentitySha256: stableObjectSha256(objectIdentity),
    businessEntityKeys: freeze(businessEntityKeys),
    transportOriginSystem,
    fields: freeze(fields.sort((left: SourceNativeField, right: SourceNativeField) => compare(left.fieldPath, right.fieldPath))),
    duplicateEvidenceFieldPaths: freeze(duplicateEvidenceFieldPaths),
    exactSourcesRemainAuthority: true,
  };
  return freeze({ ...core, nativeObjectSha256: stableObjectSha256(core) });
}

function compileFieldRevisions(objects: SourceNativeObject[]): SourceNativeFieldRevision[] {
  const groups = new Map<string, Array<{
    object: SourceNativeObject; field: SourceNativeField; occurredAtMs: number;
  }>>();
  for (const object of objects) for (const field of object.fields) {
    const key = `${object.objectIdentitySha256}\0${field.fieldPath}`;
    const rows = groups.get(key) ?? [];
    rows.push({ object, field, occurredAtMs: Date.parse(object.occurredAt) });
    groups.set(key, rows);
  }
  const revisions: SourceNativeFieldRevision[] = [];
  for (const rows of groups.values()) {
    rows.sort((left, right) => left.occurredAtMs - right.occurredAtMs
      || compare(left.object.relativePath, right.object.relativePath));
    for (let index = 1; index < rows.length; index += 1) {
      const target = rows[index - 1];
      const source = rows[index];
      if (source.field.value === target.field.value) continue;
      const sourceRevisionValue = source.field.canonicalValue ?? source.field.value;
      const targetRevisionValue = target.field.canonicalValue ?? target.field.value;
      if (stableObjectText(sourceRevisionValue) === stableObjectText(targetRevisionValue)) continue;
      if (source.occurredAtMs === target.occurredAtMs) {
        fail('SOURCE_NATIVE_REVISION_ORDER');
      }
      const canonicalComparison = source.field.canonicalValue !== undefined
        || target.field.canonicalValue !== undefined;
      const core: Omit<SourceNativeFieldRevision, 'revisionSha256'> = {
        schema: 1,
        kind: 'OpenOntologySourceNativeFieldRevisionV1',
        relationType: 'supersedes',
        basis: canonicalComparison
          ? 'same-source-native-object-identity-and-changed-canonical-field'
          : 'same-source-native-object-identity-and-changed-exact-field',
        objectIdentity: source.object.objectIdentity,
        objectIdentitySha256: source.object.objectIdentitySha256,
        fieldPath: source.field.fieldPath,
        sourceField: source.field,
        targetField: target.field,
        sourceOccurredAt: source.object.occurredAt,
        targetOccurredAt: target.object.occurredAt,
        admissionState: 'deterministic-source-native',
        navigationOnly: true,
        exactSourcesRemainAuthority: true,
      };
      revisions.push(freeze({ ...core, revisionSha256: stableObjectSha256(core) }));
    }
  }
  return freeze(revisions.sort((left, right) => Date.parse(left.sourceOccurredAt) - Date.parse(right.sourceOccurredAt)
    || compare(left.fieldPath, right.fieldPath) || compare(left.revisionSha256, right.revisionSha256)));
}

function compileDuplicateEvidenceClusters(objects: SourceNativeObject[]): UnknownRecord[] {
  const groups = new Map<string, Array<{
    object: SourceNativeObject; field: SourceNativeField; propositionFamilyKey: string;
    clusterBusinessEntityKeys: string[];
  }>>();
  for (const object of objects) for (const fieldPath of object.duplicateEvidenceFieldPaths) {
    const field = object.fields.find((row: SourceNativeField) => row.fieldPath === fieldPath);
    const exactFieldValue = field ?? fail('SOURCE_NATIVE_DUPLICATE_FIELDS');
    const propositionFamilyKey = exactFieldValue.propositionFamilyKey ?? fieldPath;
    const businessEntityKeySets = exactFieldValue.businessEntityKeys === undefined
      ? [object.businessEntityKeys]
      : exactFieldValue.businessEntityKeys.map((businessEntityKey: string) => [businessEntityKey]);
    for (const clusterBusinessEntityKeys of businessEntityKeySets.length > 0
      ? businessEntityKeySets : [[]]) {
      const fingerprint = stableObjectSha256({
        namespace: object.objectIdentity.namespace,
        propositionFamilyKey,
        exactValueSha256: exactFieldValue.evidence.textSha256,
        businessEntityKeys: clusterBusinessEntityKeys,
      });
      const rows = groups.get(fingerprint) ?? [];
      rows.push({ object, field: exactFieldValue, propositionFamilyKey, clusterBusinessEntityKeys });
      groups.set(fingerprint, rows);
    }
  }
  return freeze([...groups.entries()].filter(([, rows]) => rows.length > 1).map(([fingerprint, rows]) => {
    rows.sort((left, right) => Date.parse(left.object.occurredAt) - Date.parse(right.object.occurredAt)
      || compare(left.object.relativePath, right.object.relativePath));
    const core: UnknownRecord = {
      schema: 1,
      kind: 'OpenOntologyDuplicateEvidenceClusterV1',
      duplicateEvidenceSha256: fingerprint,
      namespace: rows[0].object.objectIdentity.namespace,
      fieldPath: new Set(rows.map((row) => row.field.fieldPath)).size === 1
        ? rows[0].field.fieldPath : null,
      fieldPaths: freeze([...new Set(rows.map((row) => row.field.fieldPath))].sort(compare)),
      propositionFamilyKey: rows[0].propositionFamilyKey,
      businessEntityKeys: freeze([...rows[0].clusterBusinessEntityKeys]),
      evidence: freeze(rows.map((row) => freeze({
        objectIdentity: row.object.objectIdentity,
        occurredAt: row.object.occurredAt,
        field: row.field,
      }))),
      interpretation: 'one-byte-identical-proposition-multiple-exact-evidence-references',
      navigationOnly: true,
      exactSourcesRemainAuthority: true,
    };
    return freeze({ ...core, clusterSha256: stableObjectSha256(core) });
  }).sort((left, right) => compare(left.clusterSha256, right.clusterSha256)));
}

function compileBusinessEntityEvidenceNeighborhoods(objects: SourceNativeObject[]): UnknownRecord[] {
  const groups = new Map<string, SourceNativeObject[]>();
  for (const object of objects) for (const businessEntityKey of object.businessEntityKeys) {
    const namespace = object.objectIdentity.namespace;
    const key = `${namespace}\0${businessEntityKey}`;
    const rows = groups.get(key) ?? [];
    rows.push(object);
    groups.set(key, rows);
  }
  return freeze([...groups.entries()].filter(([, rows]) => rows.length > 1).map(([groupKey, rows]) => {
    rows.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
      || compare(left.relativePath, right.relativePath) || compare(left.nativeObjectSha256, right.nativeObjectSha256));
    const separator = groupKey.indexOf('\0');
    const namespace = groupKey.slice(0, separator);
    const businessEntityKey = groupKey.slice(separator + 1);
    const rowPaths = new Set(rows.map((row) => row.relativePath));
    const parent = new Map([...rowPaths].map((relativePath) => [relativePath, relativePath]));
    const find = (relativePath: string): string => {
      const current = parent.get(relativePath) ?? fail('SOURCE_NATIVE_MAP_NEIGHBORHOOD');
      if (current === relativePath) return current;
      const root = find(current);
      parent.set(relativePath, root);
      return root;
    };
    const union = (left: string, right: string): void => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot === rightRoot) return;
      const [first, second] = [leftRoot, rightRoot].sort(compare);
      parent.set(second, first);
    };
    const propositionSignatureByPath = new Map(rows.map((row) => {
      const duplicateFields = row.duplicateEvidenceFieldPaths.map((fieldPath) =>
        row.fields.find((field: SourceNativeField) => field.fieldPath === fieldPath))
        .filter((field): field is SourceNativeField => field !== undefined);
      const entityScopedFields = duplicateFields.filter((field) =>
        field.businessEntityKeys?.includes(businessEntityKey));
      const fingerprints = (entityScopedFields.length > 0 ? entityScopedFields : duplicateFields)
        .map((field) => stableObjectSha256({
          propositionFamilyKey: field.propositionFamilyKey ?? field.fieldPath,
          exactValueSha256: field.evidence.textSha256,
          businessEntityKey,
        }));
      return [row.relativePath, [...new Set(fingerprints)].sort(compare)];
    }));
    const sameTransport = (left: SourceNativeObject, right: SourceNativeObject) => left.transportOriginSystem === right.objectIdentity.sourceSystem
      || right.transportOriginSystem === left.objectIdentity.sourceSystem;
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      const left = rows[leftIndex];
      if (!left) continue;
      const leftSignature = propositionSignatureByPath.get(left.relativePath) ?? [];
      if (leftSignature.length < 1) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
        const right = rows[rightIndex];
        if (!right) continue;
        const rightSignature = propositionSignatureByPath.get(right.relativePath) ?? [];
        if (stableObjectSha256(leftSignature) === stableObjectSha256(rightSignature)
          && sameTransport(left, right)) {
          union(left.relativePath, right.relativePath);
        }
      }
    }
    const lineageMembers = new Map<string, string[]>();
    for (const relativePath of rowPaths) {
      const root = find(relativePath);
      const paths = lineageMembers.get(root) ?? [];
      paths.push(relativePath);
      lineageMembers.set(root, paths);
    }
    const evidenceLineageByPath = new Map<string, string>();
    for (const paths of lineageMembers.values()) {
      paths.sort(compare);
      const evidenceLineageSha256 = stableObjectSha256({ namespace, businessEntityKey, relativePaths: paths });
      for (const relativePath of paths) evidenceLineageByPath.set(relativePath, evidenceLineageSha256);
    }
    const members = rows.map((row) => {
      const evidenceLineageSha256 = evidenceLineageByPath.get(row.relativePath);
      if (!evidenceLineageSha256) fail('SOURCE_NATIVE_EVIDENCE_LINEAGE');
      return freeze({
        objectIdentity: row.objectIdentity,
        objectIdentitySha256: row.objectIdentitySha256,
        nativeObjectSha256: row.nativeObjectSha256,
        sourceSystem: row.objectIdentity.sourceSystem,
        transportOriginSystem: row.transportOriginSystem,
        evidenceLineageSha256,
        relativePath: row.relativePath,
        occurredAt: row.occurredAt,
        fieldSha256s: freeze(row.fields.map((field) => field.fieldSha256).sort(compare)),
      });
    });
    const evidenceLineageCount = new Set(members.map((row) => row.evidenceLineageSha256)).size;
    const core = {
      schema: 1,
      kind: 'OpenOntologyBusinessEntityEvidenceNeighborhoodV1',
      namespace,
      businessEntityKey,
      memberCount: members.length,
      sourceSystemCount: new Set(members.map((row) => row.sourceSystem)).size,
      evidenceLineageCount,
      dependentTransportCopyCount: members.length - evidenceLineageCount,
      lineageResolution: 'byte-identical-proposition-set-plus-transport-origin',
      transportOriginAloneCollapsesLineage: false,
      members: freeze(members),
      interpretation: 'shared-business-entity-key-navigation-not-semantic-equivalence',
      navigationOnly: true,
      exactSourcesRemainAuthority: true,
    };
    return freeze({ ...core, neighborhoodSha256: stableObjectSha256(core) });
  }).sort((left, right) => compare(left.namespace, right.namespace)
    || compare(left.businessEntityKey, right.businessEntityKey)
    || compare(left.neighborhoodSha256, right.neighborhoodSha256)));
}

function exactNestedHash(value: unknown, field: string, code: string): void {
  const record = exactRecord(value, code);
  const { [field]: observed, ...core } = record;
  if (typeof observed !== 'string' || !SHA256.test(observed)
    || stableObjectSha256(core) !== observed) fail(code);
}

function validateCompiledField(field: SourceNativeField, object: SourceNativeObject | null = null): void {
  exactNestedHash(field, 'fieldSha256', 'SOURCE_NATIVE_MAP_FIELD');
  if (field?.schema !== 1 || field.kind !== 'OpenOntologySourceNativeFieldV1'
    || !FIELD_PATH.test(field.fieldPath ?? '')
    || field.propositionFamilyKey !== undefined && !FIELD_PATH.test(field.propositionFamilyKey)
    || typeof field.value !== 'string' || !field.value
    || !field.evidence || field.evidence.relativePath !== (object?.relativePath ?? field.evidence.relativePath)
    || object !== null && field.evidence.sourceSha256 !== object.sourceSha256
    || !SHA256.test(field.evidence.sourceSha256 ?? '')
    || !Number.isSafeInteger(field.evidence.byteStart) || field.evidence.byteStart < 0
    || !Number.isSafeInteger(field.evidence.byteEnd) || field.evidence.byteEnd <= field.evidence.byteStart
    || !SHA256.test(field.evidence.textSha256 ?? '')
    || field.validAt !== undefined && !Number.isFinite(Date.parse(field.validAt))
    || field.knownAt !== undefined && !Number.isFinite(Date.parse(field.knownAt))
    || field.businessEntityKeys !== undefined
      && (!Array.isArray(field.businessEntityKeys)
        || new Set(field.businessEntityKeys).size !== field.businessEntityKeys.length
        || field.businessEntityKeys.some((key) => typeof key !== 'string' || !key))) {
    fail('SOURCE_NATIVE_MAP_FIELD');
  }
  if (field.canonicalProposition !== undefined) {
    validateCanonicalProposition(field.canonicalProposition, {
      propositionFamilyKey: field.propositionFamilyKey ?? null,
      fieldBusinessEntityKeys: field.businessEntityKeys ?? null,
      validAt: field.validAt ?? null,
      knownAt: field.knownAt ?? null,
      code: 'SOURCE_NATIVE_MAP_FIELD',
    });
  }
}

function validateCompiledObject(object: SourceNativeObject): void {
  exactNestedHash(object, 'nativeObjectSha256', 'SOURCE_NATIVE_MAP_OBJECT');
  let identity;
  try { identity = validateIdentity(object?.objectIdentity); } catch { fail('SOURCE_NATIVE_MAP_OBJECT'); }
  if (object?.schema !== 1 || object.kind !== 'OpenOntologySourceNativeObjectV1'
    || typeof object.sourceType !== 'string' || !object.sourceType
    || logicalPath(object.relativePath, 'SOURCE_NATIVE_MAP_OBJECT').split('/')[0] !== object.sourceType
    || !SHA256.test(object.sourceSha256 ?? '')
    || !Number.isFinite(Date.parse(object.occurredAt))
    || object.objectIdentitySha256 !== stableObjectSha256(identity)
    || !Array.isArray(object.businessEntityKeys)
    || new Set(object.businessEntityKeys).size !== object.businessEntityKeys.length
    || object.businessEntityKeys.some((key) => typeof key !== 'string' || !key)
    || !Array.isArray(object.fields) || object.fields.length < 1
    || new Set(object.fields.map((field) => field.fieldPath)).size !== object.fields.length
    || !Array.isArray(object.duplicateEvidenceFieldPaths)
    || new Set(object.duplicateEvidenceFieldPaths).size !== object.duplicateEvidenceFieldPaths.length
    || object.duplicateEvidenceFieldPaths.some((fieldPath) =>
      !object.fields.some((field) => field.fieldPath === fieldPath))
    || object.transportOriginSystem !== null
      && (typeof object.transportOriginSystem !== 'string'
        || !/^[a-z][a-z0-9-]{0,63}$/u.test(object.transportOriginSystem)
        || object.transportOriginSystem === object.objectIdentity.sourceSystem)
    || object.exactSourcesRemainAuthority !== true) {
    fail('SOURCE_NATIVE_MAP_OBJECT');
  }
  for (const field of object.fields) validateCompiledField(field, object);
}

function validateCompiledRevision(revision: SourceNativeFieldRevision): void {
  exactNestedHash(revision, 'revisionSha256', 'SOURCE_NATIVE_MAP_REVISION');
  if (revision?.schema !== 1 || revision.kind !== 'OpenOntologySourceNativeFieldRevisionV1'
    || revision.relationType !== 'supersedes' || !FIELD_PATH.test(revision.fieldPath ?? '')
    || revision.objectIdentitySha256 !== stableObjectSha256(revision.objectIdentity)
    || revision.sourceField?.fieldPath !== revision.fieldPath
    || revision.targetField?.fieldPath !== revision.fieldPath
    || !Number.isFinite(Date.parse(revision.sourceOccurredAt))
    || !Number.isFinite(Date.parse(revision.targetOccurredAt))
    || Date.parse(revision.sourceOccurredAt) <= Date.parse(revision.targetOccurredAt)
    || revision.admissionState !== 'deterministic-source-native'
    || revision.navigationOnly !== true || revision.exactSourcesRemainAuthority !== true) {
    fail('SOURCE_NATIVE_MAP_REVISION');
  }
  validateCompiledField(revision.sourceField);
  validateCompiledField(revision.targetField);
}

export function validateSourceNativeObjectMap(value: unknown): SourceNativeObjectMap {
  const map = exactRecord(value, 'SOURCE_NATIVE_MAP');
  if (!Array.isArray(map.nativeObjects) || !Array.isArray(map.fieldRevisions)
    || !Array.isArray(map.duplicateEvidenceClusters)
    || !Array.isArray(map.businessEntityEvidenceNeighborhoods)
    || !Array.isArray(map.adapterDiagnostics)) fail('SOURCE_NATIVE_MAP');
  const nativeObjectMapSha256 = typeof map.nativeObjectMapSha256 === 'string'
    ? map.nativeObjectMapSha256 : '';
  const sourceCount = typeof map.sourceCount === 'number' ? map.sourceCount : -1;
  const nativeObjectCount = typeof map.nativeObjectCount === 'number' ? map.nativeObjectCount : -1;
  const mappedSourceCount = typeof map.mappedSourceCount === 'number' ? map.mappedSourceCount : -1;
  const unsupportedSourceCount = typeof map.unsupportedSourceCount === 'number' ? map.unsupportedSourceCount : -1;
  const fieldRevisionCount = typeof map.fieldRevisionCount === 'number' ? map.fieldRevisionCount : -1;
  const duplicateEvidenceClusterCount = typeof map.duplicateEvidenceClusterCount === 'number' ? map.duplicateEvidenceClusterCount : -1;
  const businessEntityEvidenceNeighborhoodCount = typeof map.businessEntityEvidenceNeighborhoodCount === 'number' ? map.businessEntityEvidenceNeighborhoodCount : -1;
  const parseFailureCount = typeof map.parseFailureCount === 'number' ? map.parseFailureCount : -1;
  const nativeObjectValues: unknown[] = Array.isArray(map.nativeObjects)
    ? map.nativeObjects : fail('SOURCE_NATIVE_MAP');
  const fieldRevisionValues: unknown[] = Array.isArray(map.fieldRevisions)
    ? map.fieldRevisions : fail('SOURCE_NATIVE_MAP');
  const duplicateEvidenceClusterValues: unknown[] = Array.isArray(map.duplicateEvidenceClusters)
    ? map.duplicateEvidenceClusters : fail('SOURCE_NATIVE_MAP');
  const businessEntityEvidenceNeighborhoodValues: unknown[] = Array.isArray(map.businessEntityEvidenceNeighborhoods)
    ? map.businessEntityEvidenceNeighborhoods : fail('SOURCE_NATIVE_MAP');
  const adapterDiagnosticValues: unknown[] = Array.isArray(map.adapterDiagnostics)
    ? map.adapterDiagnostics : fail('SOURCE_NATIVE_MAP');
  if (!nativeObjectValues.every(isNativeObject)
    || !fieldRevisionValues.every(isFieldRevision)
    || !duplicateEvidenceClusterValues.every(isRecord)
    || !businessEntityEvidenceNeighborhoodValues.every(isRecord)
    || !adapterDiagnosticValues.every(isJsonObject)) fail('SOURCE_NATIVE_MAP');
  const nativeObjects = nativeObjectValues.filter(isNativeObject);
  const fieldRevisions = fieldRevisionValues.filter(isFieldRevision);
  const duplicateEvidenceClusters = duplicateEvidenceClusterValues.filter(isRecord);
  const businessEntityEvidenceNeighborhoods = businessEntityEvidenceNeighborhoodValues.filter(isRecord);
  const adapterDiagnostics = adapterDiagnosticValues.filter(isJsonObject);
  const objectIdentityHome = map.objectIdentityHome === 'ObjectDef/InstanceRef-plus-provenance-by'
    ? map.objectIdentityHome : fail('SOURCE_NATIVE_MAP');
  const propositionHome = map.propositionHome === 'Claim/PropositionRevision-payload'
    ? map.propositionHome : fail('SOURCE_NATIVE_MAP');
  const relationHome = map.relationHome === 'typed-relation-between-proposition-revisions'
    ? map.relationHome : fail('SOURCE_NATIVE_MAP');
  const exactSupportHome = map.exactSupportHome === 'evidence-references-and-dependencies'
    ? map.exactSupportHome : fail('SOURCE_NATIVE_MAP');
  const typedMap: SourceNativeObjectMap = {
    schema: 1,
    kind: 'OpenOntologySourceNativeObjectMapV1',
    sourceCount,
    mappedSourceCount,
    unsupportedSourceCount,
    nativeObjectCount,
    fieldRevisionCount,
    duplicateEvidenceClusterCount,
    businessEntityEvidenceNeighborhoodCount,
    parseFailureCount,
    adapterDiagnostics,
    nativeObjects,
    fieldRevisions,
    duplicateEvidenceClusters,
    businessEntityEvidenceNeighborhoods,
    nativeObjectMapSha256,
    objectIdentityHome,
    propositionHome,
    relationHome,
    exactSupportHome,
    modelCalls: 0, networkCalls: 0, questionIndependent: true,
    targetLeakage: false, navigationOnly: true, exactSourcesRemainAuthority: true,
  };
  const { nativeObjectMapSha256: observedHash, ...core } = typedMap;
  const mappedPaths = new Set(nativeObjects.map((object) => object.relativePath));
  if (typedMap.kind !== 'OpenOntologySourceNativeObjectMapV1'
    || !SHA256.test(observedHash) || stableObjectSha256(core) !== observedHash
    || nativeObjectCount !== nativeObjects.length
    || !Number.isSafeInteger(sourceCount) || sourceCount < 1
    || mappedSourceCount !== mappedPaths.size
    || unsupportedSourceCount !== sourceCount - mappedSourceCount
    || unsupportedSourceCount < 0
    || fieldRevisionCount !== fieldRevisions.length
    || duplicateEvidenceClusterCount !== duplicateEvidenceClusters.length
    || businessEntityEvidenceNeighborhoodCount !== businessEntityEvidenceNeighborhoods.length
    || parseFailureCount !== adapterDiagnostics.length
    || map.modelCalls !== 0 || map.networkCalls !== 0 || map.questionIndependent !== true
    || map.targetLeakage !== false || map.navigationOnly !== true
    || map.exactSourcesRemainAuthority !== true) fail('SOURCE_NATIVE_MAP');
  for (const object of nativeObjects) validateCompiledObject(object);
  for (const revision of fieldRevisions) validateCompiledRevision(revision);
  for (const cluster of duplicateEvidenceClusters) exactNestedHash(cluster, 'clusterSha256', 'SOURCE_NATIVE_MAP_CLUSTER');
  for (const neighborhood of businessEntityEvidenceNeighborhoods) {
    exactNestedHash(neighborhood, 'neighborhoodSha256', 'SOURCE_NATIVE_MAP_NEIGHBORHOOD');
  }
  return freeze(typedMap);
}

export function compileSourceNativeObjectMap({ sources, nativeObjectInputs, adapterDiagnostics = [] }: {
  sources?: unknown;
  nativeObjectInputs?: unknown;
  adapterDiagnostics?: unknown;
} = {}): SourceNativeObjectMap {
  if (!Array.isArray(sources) || sources.length < 1 || !Array.isArray(nativeObjectInputs)
    || !Array.isArray(adapterDiagnostics)) fail('SOURCE_NATIVE_INPUT');
  const sourceRows: unknown[] = Array.isArray(sources) ? sources : fail('SOURCE_NATIVE_INPUT');
  const objectRows: unknown[] = Array.isArray(nativeObjectInputs) ? nativeObjectInputs : fail('SOURCE_NATIVE_INPUT');
  const diagnosticRows: unknown[] = Array.isArray(adapterDiagnostics) ? adapterDiagnostics : fail('SOURCE_NATIVE_INPUT');
  const sourceByPath = new Map<string, SourceNativeSource>();
  for (const input of sourceRows) {
    const source = validateSource(normalizeSourceInput(input));
    if (sourceByPath.has(source.relativePath)) fail('SOURCE_NATIVE_SOURCE');
    sourceByPath.set(source.relativePath, source);
  }
  const diagnostics: JsonObject[] = diagnosticRows.map((row: unknown): JsonObject => {
    const cloned = jsonClone(row, 'SOURCE_NATIVE_DIAGNOSTIC');
    const exactDiagnostic = isJsonObject(cloned) ? cloned : fail('SOURCE_NATIVE_DIAGNOSTIC');
    return freeze(exactDiagnostic);
  });
  const objectKeys = new Set<string>();
  const nativeObjects = objectRows.map((value: unknown) => {
    const input = normalizeObjectInput(value);
    const source = sourceByPath.get(input.relativePath);
    const exactSource = source ?? fail('SOURCE_NATIVE_OBJECT_INPUT');
    const object = compileObject(input, exactSource);
    const key = `${object.relativePath}\0${object.objectIdentitySha256}`;
    if (objectKeys.has(key)) fail('SOURCE_NATIVE_OBJECT_INPUT');
    objectKeys.add(key);
    return object;
  }).sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || compare(left.relativePath, right.relativePath) || compare(left.nativeObjectSha256, right.nativeObjectSha256));
  const mappedPaths = new Set(nativeObjects.map((row) => row.relativePath));
  const fieldRevisions = compileFieldRevisions(nativeObjects);
  const duplicateEvidenceClusters = compileDuplicateEvidenceClusters(nativeObjects);
  const businessEntityEvidenceNeighborhoods = compileBusinessEntityEvidenceNeighborhoods(nativeObjects);
  const core: Omit<SourceNativeObjectMap, 'nativeObjectMapSha256'> = {
    schema: 1,
    kind: 'OpenOntologySourceNativeObjectMapV1',
    sourceCount: sourceRows.length,
    mappedSourceCount: mappedPaths.size,
    unsupportedSourceCount: sourceRows.length - mappedPaths.size,
    nativeObjectCount: nativeObjects.length,
    parseFailureCount: diagnostics.length,
    adapterDiagnostics: freeze(diagnostics),
    fieldRevisionCount: fieldRevisions.length,
    duplicateEvidenceClusterCount: duplicateEvidenceClusters.length,
    businessEntityEvidenceNeighborhoodCount: businessEntityEvidenceNeighborhoods.length,
    nativeObjects: freeze(nativeObjects),
    fieldRevisions,
    duplicateEvidenceClusters,
    businessEntityEvidenceNeighborhoods,
    objectIdentityHome: 'ObjectDef/InstanceRef-plus-provenance-by',
    propositionHome: 'Claim/PropositionRevision-payload',
    relationHome: 'typed-relation-between-proposition-revisions',
    exactSupportHome: 'evidence-references-and-dependencies',
    modelCalls: 0,
    networkCalls: 0,
    questionIndependent: true,
    targetLeakage: false,
    navigationOnly: true,
    exactSourcesRemainAuthority: true,
  };
  return validateSourceNativeObjectMap({ ...core, nativeObjectMapSha256: stableObjectSha256(core) });
}

interface ObjectBackend {
  get(key: string): { bytes: Buffer; checksumSha256: string; version: string };
  putIfAbsent(key: string, bytes: Buffer): { checksumSha256: string; version: string; replayed: boolean };
}
function validateBackend(backend: ObjectBackend | undefined, write = false): asserts backend is ObjectBackend {
  if (!backend || typeof backend.get !== 'function' || write && typeof backend.putIfAbsent !== 'function') {
    fail('SOURCE_NATIVE_BACKEND');
  }
}

export function materializeSourceNativeObjectMap({ backend, ...input }: {
  backend?: ObjectBackend;
  sources?: SourceNativeSourceInput[];
  nativeObjectInputs?: SourceNativeObjectInput[];
  adapterDiagnostics?: JsonObject[];
} = {}) {
  validateBackend(backend, true);
  const map = compileSourceNativeObjectMap(input);
  const { nativeObjectMapSha256, ...storedCore } = map;
  const bytes = Buffer.from(stableObjectText(storedCore));
  if (objectBytesSha256(bytes) !== nativeObjectMapSha256) fail('SOURCE_NATIVE_WRITE');
  const key = `source-native-object-maps/sha256/${nativeObjectMapSha256.slice(7)}.json`;
  const write = backend.putIfAbsent(key, bytes);
  if (write.checksumSha256 !== nativeObjectMapSha256) fail('SOURCE_NATIVE_WRITE');
  return freeze({
    map,
    receipt: freeze({
      schema: 1,
      kind: 'OpenOntologySourceNativeObjectMapReceiptV1',
      key,
      nativeObjectMapSha256,
      sourceCount: map.sourceCount,
      nativeObjectCount: map.nativeObjectCount,
      byteLength: bytes.length,
      version: write.version,
      replayed: write.replayed,
    }),
  });
}

export function openSourceNativeObjectMap({ backend, nativeObjectMapSha256 }: {
  backend?: ObjectBackend;
  nativeObjectMapSha256?: string;
} = {}) {
  validateBackend(backend);
  const mapHash = typeof nativeObjectMapSha256 === 'string' ? nativeObjectMapSha256 : '';
  if (!SHA256.test(mapHash)) fail('SOURCE_NATIVE_READ');
  const key = `source-native-object-maps/sha256/${mapHash.slice(7)}.json`;
  const loaded = backend.get(key);
  if (loaded.checksumSha256 !== mapHash
    || objectBytesSha256(loaded.bytes) !== mapHash) fail('SOURCE_NATIVE_READ');
  let core: unknown;
  try { core = JSON.parse(loaded.bytes.toString('utf8')); } catch { fail('SOURCE_NATIVE_READ'); }
  const exactCore = isRecord(core) ? core : fail('SOURCE_NATIVE_READ');
  if (!loaded.bytes.equals(Buffer.from(stableObjectText(exactCore)))) fail('SOURCE_NATIVE_READ');
  const map = validateSourceNativeObjectMap({ ...exactCore, nativeObjectMapSha256: mapHash });
  return freeze({ kind: 'OpenOntologySourceNativeObjectMapModuleV1', map, key, version: loaded.version });
}
