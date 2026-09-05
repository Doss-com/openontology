/** Deterministic point-in-time selection over a complete source-native field map. */
import { stableObjectSha256 } from './canonical-content.mjs';
import {
  compileFieldRevisions,
  validateSourceNativeObjectMap,
} from './source-native-object-map.mjs';
import type {
  SourceNativeField,
  SourceNativeFieldRevision,
  SourceNativeObject,
  SourceNativeObjectIdentity,
  SourceNativeObjectMap,
} from './source-native-object-map.mjs';
import type { SourceNativeFieldQuery } from './source-native-query-planner.mjs';

export type SourceNativeHistoricalFieldState = string;

export interface SourceNativeHistoricalSelectedField {
  relativePath: string;
  objectIdentitySha256: string;
  fieldSha256: string;
  evidence: {
    sourceSha256: string;
    byteStart: number;
    byteEnd: number;
    textSha256: string;
  };
  objectIdentity: SourceNativeObjectIdentity;
  occurredAt: string;
  value: string;
  validAt: string;
  knownAt: string;
}

export interface SourceNativeHistoricalFieldResolutionResult {
  state: SourceNativeHistoricalFieldState;
  query: SourceNativeFieldQuery;
  at: string;
  selected: SourceNativeHistoricalSelectedField | null;
  nativeObjectMapSha256: string;
  sourceObservedThrough: string | null;
  observationClosureCount: number;
  observationClosureSha256: string;
  revisionClosureCount: number;
  revisionClosureSha256: string;
  applicableRevisionSha256s: string[];
  activeSupersessionIds: string[];
  derivedValidAtFieldCount: number;
  complete: boolean;
  ambiguous: boolean;
  controls: {
    mappedCoverageComplete: boolean;
    adapterDiagnosticsClear: boolean;
    revisionCensusComplete: boolean;
  };
  temporalProfile: 'source-native-basic-retrospective-v1';
  resolutionSha256: string;
}

const UTC_MILLISECOND_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const compare = (left: unknown, right: unknown): number => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Validate and return the exact UTC millisecond timestamp used by this profile. */
export function normalizeSourceNativeHistoricalTime(value: unknown): string {
  if (typeof value !== 'string' || !UTC_MILLISECOND_TIMESTAMP.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail('SOURCE_NATIVE_HISTORICAL_TIME');
  }
  return String(value);
}

function validAt(field: SourceNativeField, object: SourceNativeObject): string {
  return field.validAt ?? object.occurredAt;
}

function knownAt(field: SourceNativeField, object: SourceNativeObject): string {
  return field.knownAt ?? object.occurredAt;
}

function fieldEndpointKey(relativePath: string, field: SourceNativeField): string {
  return `${relativePath}\0${field.fieldSha256}`;
}

function stateClassKey(field: SourceNativeField): string {
  return stableObjectSha256({
    effectiveCanonicalValue: field.canonicalValue ?? field.value,
    propositionFamilyKey: field.propositionFamilyKey ?? null,
    businessEntityKeys: field.businessEntityKeys ?? null,
    canonicalProposition: field.canonicalProposition ?? null,
    provenanceBy: field.provenanceBy ?? null,
    actorResolutionEvidence: field.actorResolutionEvidence ?? null,
  });
}

interface Observation {
  object: SourceNativeObject;
  field: SourceNativeField;
  observedOrder: number;
  validAt: string;
  knownAt: string;
  validAtMs: number;
  stateClassKey: string;
}

interface StateClass {
  key: string;
  observations: Observation[];
}

function compareObservation(left: Observation, right: Observation): number {
  return left.observedOrder - right.observedOrder
    || compare(left.object.relativePath, right.object.relativePath)
    || compare(left.field.fieldSha256, right.field.fieldSha256);
}

function scopedObservations(objects: SourceNativeObject[], fieldPath: string): Observation[] {
  const orderedObjects = [...objects].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || compare(left.relativePath, right.relativePath)
    || compare(left.nativeObjectSha256, right.nativeObjectSha256));
  return orderedObjects.flatMap((object, observedOrder) => {
    const field = object.fields.find((candidate) => candidate.fieldPath === fieldPath);
    if (field === undefined) return [];
    const effectiveValidAt = validAt(field, object);
    const effectiveKnownAt = knownAt(field, object);
    const validAtMs = Date.parse(effectiveValidAt);
    if (!Number.isFinite(validAtMs) || !Number.isFinite(Date.parse(effectiveKnownAt))) {
      fail('SOURCE_NATIVE_HISTORICAL_FIELD_MAP');
    }
    return [{ object, field, observedOrder, validAt: effectiveValidAt,
      knownAt: effectiveKnownAt, validAtMs, stateClassKey: stateClassKey(field) }];
  }).sort(compareObservation);
}

function consecutiveStateClasses(observations: Observation[]): StateClass[] {
  const classes: StateClass[] = [];
  for (const observation of observations) {
    const previous = classes.at(-1);
    if (previous?.key === observation.stateClassKey) {
      previous.observations.push(observation);
    } else {
      classes.push({ key: observation.stateClassKey, observations: [observation] });
    }
  }
  return classes;
}

function expectedRevisionCensus(map: SourceNativeObjectMap): {
  revisions: SourceNativeFieldRevision[];
  complete: boolean;
} {
  try {
    const revisions = compileFieldRevisions(map.nativeObjects);
    return {
      revisions,
      complete: revisions.length === map.fieldRevisions.length
        && stableObjectSha256(revisions) === stableObjectSha256(map.fieldRevisions),
    };
  } catch {
    return { revisions: [], complete: false };
  }
}

function emptyResult({ map, query, at, state, controls, sourceObservedThrough = null,
  observationClosure = [], revisionClosure = [], applicableRevisionHashes = [],
  activeSupersessionIds = [], derivedValidAtFieldCount = 0, ambiguous = false }: {
    map: SourceNativeObjectMap;
    query: SourceNativeFieldQuery;
    at: string;
    state: string;
    controls: SourceNativeHistoricalFieldResolutionResult['controls'];
    sourceObservedThrough?: string | null;
    observationClosure?: SourceNativeObject[];
    revisionClosure?: SourceNativeFieldRevision[];
    applicableRevisionHashes?: string[];
    activeSupersessionIds?: string[];
    derivedValidAtFieldCount?: number;
    ambiguous?: boolean;
}): SourceNativeHistoricalFieldResolutionResult {
  const core = {
    schema: 1,
    kind: 'OpenOntologySourceNativeHistoricalFieldResolutionV1',
    state,
    query: freeze({ ...query }),
    at,
    selected: null,
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    sourceObservedThrough,
    observationClosureCount: observationClosure.length,
    observationClosureSha256: stableObjectSha256(observationClosure.map((row) => row.nativeObjectSha256)),
    revisionClosureCount: revisionClosure.length,
    revisionClosureSha256: stableObjectSha256(revisionClosure.map((row) => row.revisionSha256)),
    applicableRevisionSha256s: freeze([...applicableRevisionHashes].sort(compare)),
    activeSupersessionIds: freeze([...activeSupersessionIds].sort(compare)),
    derivedValidAtFieldCount,
    complete: controls.mappedCoverageComplete && controls.adapterDiagnosticsClear
      && controls.revisionCensusComplete,
    ambiguous,
    controls: freeze({ ...controls }),
    temporalProfile: 'source-native-basic-retrospective-v1' as const,
  };
  return freeze({ ...core, resolutionSha256: stableObjectSha256(core) });
}

/** Resolve one native field's recorded state at an exact requested instant. */
export function resolveSourceNativeFieldAt({ sourceNativeObjectMap: mapInput,
  query: queryInput, at: atInput }: {
    sourceNativeObjectMap?: SourceNativeObjectMap;
    query?: SourceNativeFieldQuery;
    at?: unknown;
  } = {}): SourceNativeHistoricalFieldResolutionResult {
  const at = normalizeSourceNativeHistoricalTime(atInput);
  const query = queryInput ?? fail('SOURCE_NATIVE_HISTORICAL_FIELD_INPUT');
  if (typeof query?.sourceSystem !== 'string' || !query.sourceSystem
    || typeof query.objectType !== 'string' || !query.objectType
    || typeof query.fieldPath !== 'string' || !query.fieldPath
    || query.namespace !== undefined && (typeof query.namespace !== 'string' || !query.namespace)
    || query.externalId !== undefined && (typeof query.externalId !== 'string' || !query.externalId)
    || query.anchorFieldSha256 !== undefined && !SHA256.test(query.anchorFieldSha256)) {
    fail('SOURCE_NATIVE_HISTORICAL_FIELD_INPUT');
  }
  const map: SourceNativeObjectMap = (() => {
    try {
      return validateSourceNativeObjectMap(mapInput ?? fail('SOURCE_NATIVE_HISTORICAL_FIELD_MAP'));
    } catch {
      return fail('SOURCE_NATIVE_HISTORICAL_FIELD_MAP');
    }
  })();
  const census = expectedRevisionCensus(map);
  const controls = {
    mappedCoverageComplete: map.mappedSourceCount === map.sourceCount
      && map.unsupportedSourceCount === 0,
    adapterDiagnosticsClear: map.parseFailureCount === 0
      && map.adapterDiagnostics.length === 0,
    revisionCensusComplete: census.complete,
  };
  const complete = controls.mappedCoverageComplete && controls.adapterDiagnosticsClear
    && controls.revisionCensusComplete;
  const resolvedQuery: SourceNativeFieldQuery = { ...query };
  if (!complete) {
    return emptyResult({ map, query: resolvedQuery, at,
      state: 'unavailable-incomplete-recorded-field-chronology', controls });
  }

  const scopedMatches = map.nativeObjects.filter((object) =>
    object.objectIdentity.sourceSystem === query.sourceSystem
    && object.objectIdentity.objectType === query.objectType
    && (query.namespace === undefined || object.objectIdentity.namespace === query.namespace)
    && (query.externalId === undefined || object.objectIdentity.externalId === query.externalId));
  const identityIds = [...new Set(scopedMatches.map((object) => object.objectIdentitySha256))];
  if (identityIds.length !== 1) {
    return emptyResult({ map, query: resolvedQuery, at,
      state: identityIds.length > 1 ? 'unavailable-native-object-scope-ambiguous'
        : 'unavailable-native-object-not-seeded', controls, ambiguous: identityIds.length > 1 });
  }
  const objectIdentitySha256 = identityIds[0]!;
  const selectedIdentity = scopedMatches.find((object) =>
    object.objectIdentitySha256 === objectIdentitySha256)!.objectIdentity;
  resolvedQuery.externalId = selectedIdentity.externalId;
  const identityObjects = map.nativeObjects.filter((object) =>
    object.objectIdentitySha256 === objectIdentitySha256);
  const observations = scopedObservations(identityObjects, query.fieldPath);
  const revisionClosure = map.fieldRevisions.filter((revision) =>
    revision.objectIdentitySha256 === objectIdentitySha256 && revision.fieldPath === query.fieldPath)
    .sort((left, right) => Date.parse(left.sourceOccurredAt) - Date.parse(right.sourceOccurredAt)
      || compare(left.revisionSha256, right.revisionSha256));
  if (observations.length < 1) {
    return emptyResult({ map, query: resolvedQuery, at,
      state: 'unavailable-native-field-not-present', controls,
      observationClosure: [], revisionClosure });
  }
  const sourceObservedThrough = map.nativeObjects.reduce<string | null>((latest, object) => {
    if (latest === null || Date.parse(object.occurredAt) > Date.parse(latest)) return object.occurredAt;
    return latest;
  }, null);
  const observationClosure = observations.map((observation) => observation.object);
  const derivedValidAtFieldCount = observations.filter((observation) =>
    observation.field.validAt === undefined).length;
  const atMs = Date.parse(at);
  const firstValidAtMs = observations.reduce((earliest, observation) =>
    Math.min(earliest, observation.validAtMs), Number.POSITIVE_INFINITY);
  if (sourceObservedThrough !== null && atMs > Date.parse(sourceObservedThrough)) {
    return emptyResult({ map, query: resolvedQuery, at,
      state: 'unavailable-native-historical-field-beyond-source-horizon', controls,
      sourceObservedThrough, observationClosure, revisionClosure, derivedValidAtFieldCount });
  }
  if (atMs < firstValidAtMs) {
    return emptyResult({ map, query: resolvedQuery, at,
      state: 'unavailable-native-historical-field-not-yet-valid', controls,
      sourceObservedThrough, observationClosure, revisionClosure, derivedValidAtFieldCount });
  }

  const classes = consecutiveStateClasses(observations);
  const classByObservation = new Map<Observation, StateClass>();
  for (const candidate of classes) {
    for (const observation of candidate.observations) classByObservation.set(observation, candidate);
  }
  const observationByEndpoint = new Map(observations.map((observation) => [
    fieldEndpointKey(observation.object.relativePath, observation.field), observation,
  ]));
  const eligibleClasses = new Set(classes.filter((candidate) =>
    candidate.observations.some((observation) => observation.validAtMs <= atMs)));
  const applicableRevisions = revisionClosure.filter((revision) => {
    const source = observationByEndpoint.get(fieldEndpointKey(revision.sourceField.evidence.relativePath, revision.sourceField));
    const target = observationByEndpoint.get(fieldEndpointKey(revision.targetField.evidence.relativePath, revision.targetField));
    return source !== undefined && target !== undefined
      && source.validAtMs <= atMs && target.validAtMs <= atMs;
  });
  const activeSupersessionIds = applicableRevisions.map((revision) => revision.revisionSha256);
  for (const revision of applicableRevisions) {
    const sourceObservation = observationByEndpoint.get(fieldEndpointKey(
      revision.sourceField.evidence.relativePath, revision.sourceField));
    const targetObservation = observationByEndpoint.get(fieldEndpointKey(
      revision.targetField.evidence.relativePath, revision.targetField));
    if (sourceObservation === undefined || targetObservation === undefined) continue;
    const sourceClass = classByObservation.get(sourceObservation);
    const targetClass = classByObservation.get(targetObservation);
    if (sourceClass !== undefined && targetClass !== undefined && sourceClass !== targetClass) {
      eligibleClasses.delete(targetClass);
    }
  }
  const survivingClasses = [...eligibleClasses];
  if (survivingClasses.length !== 1) {
    return emptyResult({ map, query: resolvedQuery, at,
      state: 'unavailable-native-historical-field-ambiguous', controls,
      sourceObservedThrough, observationClosure, revisionClosure,
      applicableRevisionHashes: activeSupersessionIds,
      activeSupersessionIds, derivedValidAtFieldCount, ambiguous: true });
  }
  const selectedClass = survivingClasses[0]!;
  const selectedObservation = selectedClass.observations.filter((observation) =>
    observation.validAtMs <= atMs).sort(compareObservation).at(-1);
  if (selectedObservation === undefined) {
    return emptyResult({ map, query: resolvedQuery, at,
      state: 'unavailable-native-historical-field-ambiguous', controls,
      sourceObservedThrough, observationClosure, revisionClosure,
      applicableRevisionHashes: activeSupersessionIds,
      activeSupersessionIds, derivedValidAtFieldCount, ambiguous: true });
  }
  const selected = freeze({
    objectIdentity: selectedObservation.object.objectIdentity,
    objectIdentitySha256: selectedObservation.object.objectIdentitySha256,
    occurredAt: selectedObservation.object.occurredAt,
    relativePath: selectedObservation.object.relativePath,
    value: selectedObservation.field.value,
    fieldSha256: selectedObservation.field.fieldSha256,
    evidence: selectedObservation.field.evidence,
    validAt: selectedObservation.validAt,
    knownAt: selectedObservation.knownAt,
  });
  const core = {
    schema: 1,
    kind: 'OpenOntologySourceNativeHistoricalFieldResolutionV1',
    state: 'resolved-historical-field',
    query: freeze({ ...resolvedQuery }),
    at,
    selected,
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    sourceObservedThrough,
    observationClosureCount: observationClosure.length,
    observationClosureSha256: stableObjectSha256(observationClosure.map((row) => row.nativeObjectSha256)),
    revisionClosureCount: revisionClosure.length,
    revisionClosureSha256: stableObjectSha256(revisionClosure.map((row) => row.revisionSha256)),
    applicableRevisionSha256s: freeze(activeSupersessionIds.slice().sort(compare)),
    activeSupersessionIds: freeze(activeSupersessionIds.slice().sort(compare)),
    derivedValidAtFieldCount,
    complete,
    ambiguous: false,
    controls: freeze({ ...controls }),
    temporalProfile: 'source-native-basic-retrospective-v1' as const,
  };
  return freeze({ ...core, resolutionSha256: stableObjectSha256(core) });
}
