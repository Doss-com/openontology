/**
 * Question-independent compiler for source-native object identity, exact field
 * revisions, and duplicate Evidence references.
 *
 * Source adapters own format parsing. This Module owns the canonical mapping
 * from adapter spans to exact, replayable Ont navigation objects.
 */
import { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const FIELD_PATH = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const compare = (left, right) => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code) => { const error = new TypeError(code); error.code = code; throw error; };
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function jsonClone(value, code) {
  const visit = (row) => {
    if (row === null || typeof row === 'string' || typeof row === 'boolean') return;
    if (typeof row === 'number' && Number.isFinite(row)) return;
    if (Array.isArray(row)) {
      for (const child of row) visit(child);
      return;
    }
    if (!row || typeof row !== 'object' || Object.getPrototypeOf(row) !== Object.prototype) fail(code);
    for (const [key, child] of Object.entries(row)) {
      if (!key || child === undefined) fail(code);
      visit(child);
    }
  };
  visit(value);
  return JSON.parse(JSON.stringify(value));
}

function logicalPath(value, code) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0')
    || value.startsWith('/') || value.includes('\\')) fail(code);
  if (value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) fail(code);
  return value;
}

function validateSource(source) {
  logicalPath(source?.relativePath, 'SOURCE_NATIVE_SOURCE');
  if (typeof source.sourceType !== 'string' || !source.sourceType
    || source.relativePath.split('/')[0] !== source.sourceType
    || typeof source.occurredAt !== 'string' || !Number.isFinite(Date.parse(source.occurredAt))
    || typeof source.content !== 'string' || !source.content
    || !SHA256.test(source.sourceSha256 ?? '')
    || objectBytesSha256(Buffer.from(source.content)) !== source.sourceSha256) fail('SOURCE_NATIVE_SOURCE');
  return source;
}

function validateIdentity(value) {
  const identity = jsonClone(value, 'SOURCE_NATIVE_OBJECT_IDENTITY');
  if (identity.home !== 'ObjectDef/InstanceRef'
    || typeof identity.sourceSystem !== 'string' || !identity.sourceSystem
    || typeof identity.objectType !== 'string' || !identity.objectType
    || typeof identity.externalId !== 'string' || !identity.externalId) fail('SOURCE_NATIVE_OBJECT_IDENTITY');
  return freeze(identity);
}

function validateProvenanceBy(value) {
  if (value === null) return null;
  const provenanceBy = jsonClone(value, 'SOURCE_NATIVE_PROVENANCE_BY');
  if (provenanceBy.home !== 'ObjectDef/InstanceRef'
    || typeof provenanceBy.sourceSystem !== 'string' || !provenanceBy.sourceSystem
    || typeof provenanceBy.displayName !== 'string' || !provenanceBy.displayName.trim()
    || !Array.isArray(provenanceBy.roleLabels)
    || new Set(provenanceBy.roleLabels).size !== provenanceBy.roleLabels.length
    || provenanceBy.roleLabels.some((role) => typeof role !== 'string' || !role)) {
    fail('SOURCE_NATIVE_PROVENANCE_BY');
  }
  return freeze(provenanceBy);
}

function exactActorResolutionEvidence({ source, input, fieldBusinessEntityKeys }) {
  if (input === null) return null;
  const businessEntityKeys = [...new Set(input?.businessEntityKeys ?? [])].sort(compare);
  if (!Array.isArray(input?.businessEntityKeys) || businessEntityKeys.length !== 1
    || businessEntityKeys.length !== input.businessEntityKeys.length
    || !fieldBusinessEntityKeys?.includes(businessEntityKeys[0])
    || typeof input.value !== 'string' || !input.value
    || !Number.isSafeInteger(input.codeUnitStart) || input.codeUnitStart < 0
    || source.content.slice(input.codeUnitStart, input.codeUnitStart + input.value.length)
      !== input.value) {
    fail('SOURCE_NATIVE_ACTOR_RESOLUTION_EVIDENCE');
  }
  const byteStart = Buffer.byteLength(source.content.slice(0, input.codeUnitStart));
  const byteEnd = byteStart + Buffer.byteLength(input.value);
  return freeze({
    schema: 1,
    kind: 'OpenOntologyExactActorResolutionEvidenceV1',
    businessEntityKeys: freeze(businessEntityKeys),
    relativePath: source.relativePath,
    sourceSha256: source.sourceSha256,
    byteStart,
    byteEnd,
    textSha256: objectBytesSha256(Buffer.from(input.value)),
    exactText: input.value,
  });
}

function exactField({ source, fieldPath, value, codeUnitStart,
  propositionFamilyKey = null, businessEntityKeys: fieldBusinessEntityKeys = null,
  canonicalProposition: canonicalPropositionInput = null, validAt = null,
  canonicalValue: canonicalValueInput = null, provenanceBy: provenanceByInput = null,
  actorResolutionEvidence: actorResolutionEvidenceInput = null }) {
  if (!FIELD_PATH.test(fieldPath ?? '') || typeof value !== 'string' || !value
    || !Number.isSafeInteger(codeUnitStart) || codeUnitStart < 0
    || propositionFamilyKey !== null && !FIELD_PATH.test(propositionFamilyKey)
    || validAt !== null && (typeof validAt !== 'string' || !Number.isFinite(Date.parse(validAt)))
    || fieldBusinessEntityKeys !== null
      && (!Array.isArray(fieldBusinessEntityKeys)
        || fieldBusinessEntityKeys.length < 1
        || new Set(fieldBusinessEntityKeys).size !== fieldBusinessEntityKeys.length
        || fieldBusinessEntityKeys.some((key) => typeof key !== 'string' || !key))
    || source.content.slice(codeUnitStart, codeUnitStart + value.length) !== value) {
    fail('SOURCE_NATIVE_FIELD_SPAN');
  }
  const canonicalProposition = canonicalPropositionInput === null ? null
    : jsonClone(canonicalPropositionInput, 'SOURCE_NATIVE_CANONICAL_PROPOSITION');
  const canonicalValue = canonicalValueInput === null ? null
    : jsonClone(canonicalValueInput, 'SOURCE_NATIVE_CANONICAL_VALUE');
  const provenanceBy = validateProvenanceBy(provenanceByInput);
  const actorResolutionEvidence = exactActorResolutionEvidence({
    source,
    input: actorResolutionEvidenceInput,
    fieldBusinessEntityKeys,
  });
  if (canonicalProposition !== null
    && (canonicalProposition.kind !== 'OpenOntologySourceNativeCanonicalPropositionV1'
      || canonicalProposition.actorHome !== 'ObjectDef/InstanceRef'
      || canonicalProposition.stateHome !== 'Claim/PropositionRevision-payload'
      || typeof canonicalProposition.actorKind !== 'string' || !canonicalProposition.actorKind
      || typeof canonicalProposition.predicate !== 'string' || !canonicalProposition.predicate
      || typeof canonicalProposition.state !== 'string' || !canonicalProposition.state
      || typeof canonicalProposition.dimension !== 'string' || !canonicalProposition.dimension
      || !Array.isArray(canonicalProposition.businessEntityKeys)
      || canonicalProposition.businessEntityKeys.some((key) =>
        !fieldBusinessEntityKeys?.includes(key))
      || canonicalProposition.extractionAuthority !== 'deterministic-source-adapter-v1')) {
    fail('SOURCE_NATIVE_CANONICAL_PROPOSITION');
  }
  const byteStart = Buffer.byteLength(source.content.slice(0, codeUnitStart));
  const byteEnd = byteStart + Buffer.byteLength(value);
  const core = {
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

function compileObject(input, source) {
  if (input?.relativePath !== source.relativePath || !Array.isArray(input.fields) || input.fields.length < 1) {
    fail('SOURCE_NATIVE_OBJECT_INPUT');
  }
  const objectIdentity = validateIdentity(input.objectIdentity);
  const businessEntityKeys = [...new Set(input.businessEntityKeys ?? [])].sort(compare);
  if (!Array.isArray(input.businessEntityKeys ?? [])
    || businessEntityKeys.length !== (input.businessEntityKeys ?? []).length
    || businessEntityKeys.some((value) => typeof value !== 'string' || !value)) {
    fail('SOURCE_NATIVE_BUSINESS_ENTITY_KEYS');
  }
  if (businessEntityKeys.length > 0
    && (typeof objectIdentity.namespace !== 'string' || !objectIdentity.namespace)) {
    fail('SOURCE_NATIVE_BUSINESS_ENTITY_NAMESPACE');
  }
  const fields = input.fields.map((field) => exactField({ source, ...field }));
  if (new Set(fields.map((field) => field.fieldPath)).size !== fields.length) fail('SOURCE_NATIVE_OBJECT_FIELDS');
  if (fields.some((field) => (field.businessEntityKeys ?? [])
    .some((key) => !businessEntityKeys.includes(key)))) fail('SOURCE_NATIVE_FIELD_BUSINESS_ENTITY_KEYS');
  const duplicateEvidenceFieldPaths = [...new Set(input.duplicateEvidenceFieldPaths ?? [])].sort(compare);
  if (!Array.isArray(input.duplicateEvidenceFieldPaths ?? [])
    || duplicateEvidenceFieldPaths.length !== (input.duplicateEvidenceFieldPaths ?? []).length
    || duplicateEvidenceFieldPaths.some((fieldPath) => !fields.some((field) => field.fieldPath === fieldPath))) {
    fail('SOURCE_NATIVE_DUPLICATE_FIELDS');
  }
  const transportOriginSystem = input.transportOriginSystem ?? null;
  if (transportOriginSystem !== null
    && (typeof transportOriginSystem !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(transportOriginSystem)
      || transportOriginSystem === objectIdentity.sourceSystem)) {
    fail('SOURCE_NATIVE_TRANSPORT_ORIGIN');
  }
  const core = {
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
    fields: freeze(fields.sort((left, right) => compare(left.fieldPath, right.fieldPath))),
    duplicateEvidenceFieldPaths: freeze(duplicateEvidenceFieldPaths),
    exactSourcesRemainAuthority: true,
  };
  return freeze({ ...core, nativeObjectSha256: stableObjectSha256(core) });
}

function compileFieldRevisions(objects) {
  const groups = new Map();
  for (const object of objects) for (const field of object.fields) {
    const key = `${object.objectIdentitySha256}\0${field.fieldPath}`;
    const rows = groups.get(key) ?? [];
    rows.push({ object, field, occurredAtMs: Date.parse(object.occurredAt) });
    groups.set(key, rows);
  }
  const revisions = [];
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
      const core = {
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

function compileDuplicateEvidenceClusters(objects) {
  const groups = new Map();
  for (const object of objects) for (const fieldPath of object.duplicateEvidenceFieldPaths) {
    const field = object.fields.find((row) => row.fieldPath === fieldPath);
    const propositionFamilyKey = field.propositionFamilyKey ?? fieldPath;
    const businessEntityKeySets = field.businessEntityKeys === undefined
      ? [object.businessEntityKeys]
      : field.businessEntityKeys.map((businessEntityKey) => [businessEntityKey]);
    for (const clusterBusinessEntityKeys of businessEntityKeySets.length > 0
      ? businessEntityKeySets : [[]]) {
      const fingerprint = stableObjectSha256({
        namespace: object.objectIdentity.namespace,
        propositionFamilyKey,
        exactValueSha256: field.evidence.textSha256,
        businessEntityKeys: clusterBusinessEntityKeys,
      });
      const rows = groups.get(fingerprint) ?? [];
      rows.push({ object, field, propositionFamilyKey, clusterBusinessEntityKeys });
      groups.set(fingerprint, rows);
    }
  }
  return freeze([...groups.entries()].filter(([, rows]) => rows.length > 1).map(([fingerprint, rows]) => {
    rows.sort((left, right) => Date.parse(left.object.occurredAt) - Date.parse(right.object.occurredAt)
      || compare(left.object.relativePath, right.object.relativePath));
    const core = {
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

function compileBusinessEntityEvidenceNeighborhoods(objects) {
  const groups = new Map();
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
    const find = (relativePath) => {
      const current = parent.get(relativePath);
      if (current === relativePath) return current;
      const root = find(current);
      parent.set(relativePath, root);
      return root;
    };
    const union = (left, right) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot === rightRoot) return;
      const [first, second] = [leftRoot, rightRoot].sort(compare);
      parent.set(second, first);
    };
    const propositionSignatureByPath = new Map(rows.map((row) => {
      const duplicateFields = row.duplicateEvidenceFieldPaths.map((fieldPath) =>
        row.fields.find((field) => field.fieldPath === fieldPath)).filter(Boolean);
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
    const sameTransport = (left, right) => left.transportOriginSystem === right.objectIdentity.sourceSystem
      || right.transportOriginSystem === left.objectIdentity.sourceSystem;
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      const left = rows[leftIndex];
      const leftSignature = propositionSignatureByPath.get(left.relativePath);
      if (leftSignature.length < 1) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
        const right = rows[rightIndex];
        const rightSignature = propositionSignatureByPath.get(right.relativePath);
        if (stableObjectSha256(leftSignature) === stableObjectSha256(rightSignature)
          && sameTransport(left, right)) {
          union(left.relativePath, right.relativePath);
        }
      }
    }
    const lineageMembers = new Map();
    for (const relativePath of rowPaths) {
      const root = find(relativePath);
      const paths = lineageMembers.get(root) ?? [];
      paths.push(relativePath);
      lineageMembers.set(root, paths);
    }
    const evidenceLineageByPath = new Map();
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

function exactNestedHash(value, field, code) {
  const { [field]: observed, ...core } = value ?? {};
  if (!SHA256.test(observed ?? '') || stableObjectSha256(core) !== observed) fail(code);
}

function validateCompiledField(field, object = null) {
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
    || field.businessEntityKeys !== undefined
      && (!Array.isArray(field.businessEntityKeys)
        || new Set(field.businessEntityKeys).size !== field.businessEntityKeys.length
        || field.businessEntityKeys.some((key) => typeof key !== 'string' || !key))) {
    fail('SOURCE_NATIVE_MAP_FIELD');
  }
}

function validateCompiledObject(object) {
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

function validateCompiledRevision(revision) {
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

export function validateSourceNativeObjectMap(value) {
  const { nativeObjectMapSha256, ...core } = value ?? {};
  const mappedPaths = new Set((value?.nativeObjects ?? []).map((object) => object.relativePath));
  if (value?.kind !== 'OpenOntologySourceNativeObjectMapV1'
    || !SHA256.test(nativeObjectMapSha256 ?? '') || stableObjectSha256(core) !== nativeObjectMapSha256
    || !Array.isArray(value.nativeObjects) || value.nativeObjectCount !== value.nativeObjects.length
    || !Number.isSafeInteger(value.sourceCount) || value.sourceCount < 1
    || value.mappedSourceCount !== mappedPaths.size
    || value.unsupportedSourceCount !== value.sourceCount - value.mappedSourceCount
    || value.unsupportedSourceCount < 0
    || !Array.isArray(value.fieldRevisions) || value.fieldRevisionCount !== value.fieldRevisions.length
    || !Array.isArray(value.duplicateEvidenceClusters)
    || value.duplicateEvidenceClusterCount !== value.duplicateEvidenceClusters.length
    || !Array.isArray(value.businessEntityEvidenceNeighborhoods)
    || value.businessEntityEvidenceNeighborhoodCount !== value.businessEntityEvidenceNeighborhoods.length
    || !Array.isArray(value.adapterDiagnostics) || value.parseFailureCount !== value.adapterDiagnostics.length
    || value.modelCalls !== 0 || value.networkCalls !== 0 || value.questionIndependent !== true
    || value.targetLeakage !== false || value.navigationOnly !== true
    || value.exactSourcesRemainAuthority !== true) fail('SOURCE_NATIVE_MAP');
  for (const object of value.nativeObjects) validateCompiledObject(object);
  for (const revision of value.fieldRevisions) validateCompiledRevision(revision);
  for (const cluster of value.duplicateEvidenceClusters) exactNestedHash(cluster, 'clusterSha256', 'SOURCE_NATIVE_MAP_CLUSTER');
  for (const neighborhood of value.businessEntityEvidenceNeighborhoods) {
    exactNestedHash(neighborhood, 'neighborhoodSha256', 'SOURCE_NATIVE_MAP_NEIGHBORHOOD');
  }
  return freeze(value);
}

export function compileSourceNativeObjectMap({ sources, nativeObjectInputs, adapterDiagnostics = [] } = {}) {
  if (!Array.isArray(sources) || sources.length < 1 || !Array.isArray(nativeObjectInputs)
    || !Array.isArray(adapterDiagnostics)) fail('SOURCE_NATIVE_INPUT');
  const sourceByPath = new Map();
  for (const input of sources) {
    const source = validateSource(input);
    if (sourceByPath.has(source.relativePath)) fail('SOURCE_NATIVE_SOURCE');
    sourceByPath.set(source.relativePath, source);
  }
  const diagnostics = adapterDiagnostics.map((row) => freeze(jsonClone(row, 'SOURCE_NATIVE_DIAGNOSTIC')));
  const objectKeys = new Set();
  const nativeObjects = nativeObjectInputs.map((input) => {
    const source = sourceByPath.get(input?.relativePath);
    if (!source) fail('SOURCE_NATIVE_OBJECT_INPUT');
    const object = compileObject(input, source);
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
  const core = {
    schema: 1,
    kind: 'OpenOntologySourceNativeObjectMapV1',
    sourceCount: sources.length,
    mappedSourceCount: mappedPaths.size,
    unsupportedSourceCount: sources.length - mappedPaths.size,
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

function validateBackend(backend, write = false) {
  if (!backend || typeof backend.get !== 'function' || write && typeof backend.putIfAbsent !== 'function') {
    fail('SOURCE_NATIVE_BACKEND');
  }
}

export function materializeSourceNativeObjectMap({ backend, ...input } = {}) {
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

export function openSourceNativeObjectMap({ backend, nativeObjectMapSha256 } = {}) {
  validateBackend(backend);
  if (!SHA256.test(nativeObjectMapSha256 ?? '')) fail('SOURCE_NATIVE_READ');
  const key = `source-native-object-maps/sha256/${nativeObjectMapSha256.slice(7)}.json`;
  const loaded = backend.get(key);
  if (loaded.checksumSha256 !== nativeObjectMapSha256
    || objectBytesSha256(loaded.bytes) !== nativeObjectMapSha256) fail('SOURCE_NATIVE_READ');
  let core;
  try { core = JSON.parse(loaded.bytes.toString('utf8')); } catch { fail('SOURCE_NATIVE_READ'); }
  if (!loaded.bytes.equals(Buffer.from(stableObjectText(core)))) fail('SOURCE_NATIVE_READ');
  const map = validateSourceNativeObjectMap({ ...core, nativeObjectMapSha256 });
  return freeze({ kind: 'OpenOntologySourceNativeObjectMapModuleV1', map, key, version: loaded.version });
}
