/** Completeness verification for one current recorded field over a bound source cut. */
import { stableObjectSha256, stableObjectText } from '../../canonical-content.js';
import type { SourceNativeFieldResolutionResult } from '../field-resolution.js';
import type { SourceHandle } from './evidence-session.js';
import { validateSourceNativeObjectMap } from '../../source/object-map.js';
import type {
  SourceNativeField,
  SourceNativeObject,
  SourceNativeObjectIdentity,
  SourceNativeObjectMap,
} from '../../source/object-map.js';

export type SourceNativeCurrentFieldProofDisposition = 'sufficient' | 'insufficient';

export interface SourceNativeCurrentFieldChronologyVerification {
  schema: 1;
  kind: 'OpenOntologySourceNativeCurrentFieldChronologyVerificationV1';
  state:
    | 'verified-complete-recorded-field-chronology'
    | 'unverified-incomplete-recorded-field-chronology';
  proofDisposition: SourceNativeCurrentFieldProofDisposition;
  scope: 'latest-recorded-field-over-bound-source-cut';
  objectIdentity: SourceNativeObjectIdentity;
  objectIdentitySha256: string;
  fieldPath: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceCatalogSha256: string | null;
  sourceHandleSetSha256: string;
  nativeObjectMapSha256: string;
  fieldResolutionSha256: string;
  sourceCount: number;
  mappedSourceCount: number;
  identityObservationCount: number;
  fieldObservationCount: number;
  fieldRevisionCount: number;
  chronologySha256: string;
  revisionClosureSha256: string;
  currentFieldSha256: string;
  currentSourceSha256: string;
  currentRelativePath: string;
  currentOccurredAt: string;
  unmetRequirements: string[];
  questionIndependentMap: true;
  navigationOnly: true;
  exactInspectRequired: true;
  exactSourcesRemainAuthority: true;
  verificationSha256: string;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
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

function fieldFor(object: SourceNativeObject, fieldPath: string): SourceNativeField | null {
  return object.fields.find((field) => field.fieldPath === fieldPath) ?? null;
}

function sameIdentity(
  left: SourceNativeObjectIdentity,
  right: SourceNativeObjectIdentity,
): boolean {
  return (
    left.sourceSystem === right.sourceSystem &&
    left.objectType === right.objectType &&
    left.namespace === right.namespace &&
    left.externalId === right.externalId
  );
}

export function compileSourceNativeCurrentFieldChronologyVerification({
  sourceNativeObjectMap: mapInput,
  resolution,
  sourceCommitSha256,
  sourceReplaySha256,
  sourceCatalogSha256,
  sourceHandles: sourceHandleInput,
}: {
  sourceNativeObjectMap?: SourceNativeObjectMap;
  resolution?: SourceNativeFieldResolutionResult;
  sourceCommitSha256?: string;
  sourceReplaySha256?: string;
  sourceCatalogSha256?: string | null;
  sourceHandles?: SourceHandle[];
} = {}): SourceNativeCurrentFieldChronologyVerification {
  const map = (() => {
    try {
      return validateSourceNativeObjectMap(mapInput);
    } catch {
      return fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_MAP');
    }
  })();
  if (
    resolution?.state !== 'resolved-current-field' ||
    resolution.current == null ||
    !SHA256.test(resolution.resolutionSha256 ?? '') ||
    !SHA256.test(sourceCommitSha256 ?? '') ||
    !SHA256.test(sourceReplaySha256 ?? '') ||
    (sourceCatalogSha256 !== null && !SHA256.test(sourceCatalogSha256 ?? '')) ||
    !Array.isArray(sourceHandleInput) ||
    sourceHandleInput.length < 1
  ) {
    fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_INPUT');
  }
  const sourceRows = sourceHandleInput ?? fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_INPUT');
  const sourceHandles = sourceRows
    .map((row) => {
      if (
        !Number.isSafeInteger(row?.sourceMessageId) ||
        row.sourceMessageId < 0 ||
        typeof row.relativePath !== 'string' ||
        !row.relativePath
      ) {
        fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_SOURCE_HANDLE');
      }
      return { sourceMessageId: row.sourceMessageId, relativePath: row.relativePath };
    })
    .sort(
      (left, right) =>
        left.sourceMessageId - right.sourceMessageId ||
        compare(left.relativePath, right.relativePath),
    );
  if (
    new Set(sourceHandles.map((row) => row.sourceMessageId)).size !== sourceHandles.length ||
    new Set(sourceHandles.map((row) => row.relativePath)).size !== sourceHandles.length
  ) {
    fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_SOURCE_HANDLE');
  }
  const exactResolution = resolution ?? fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_INPUT');
  const current = exactResolution.current ?? fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_INPUT');
  const query = exactResolution.query;
  if (
    query.externalId === undefined ||
    query.externalId !== current.objectIdentity.externalId ||
    query.sourceSystem !== current.objectIdentity.sourceSystem ||
    query.objectType !== current.objectIdentity.objectType ||
    (query.namespace !== undefined && query.namespace !== current.objectIdentity.namespace)
  ) {
    fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_IDENTITY');
  }
  const identityObjects = map.nativeObjects
    .filter((object) => sameIdentity(object.objectIdentity, current.objectIdentity))
    .sort(
      (left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
        compare(left.relativePath, right.relativePath),
    );
  const fieldObservations = identityObjects
    .map((object) => ({
      object,
      field: fieldFor(object, query.fieldPath),
    }))
    .filter(
      (row): row is { object: SourceNativeObject; field: SourceNativeField } => row.field !== null,
    );
  const latest = fieldObservations.at(-1) ?? fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_FIELD');
  const mappedCurrent =
    latest.object.relativePath === current.relativePath &&
    latest.object.occurredAt === current.occurredAt &&
    latest.field.fieldSha256 === current.fieldSha256 &&
    latest.field.evidence.sourceSha256 === current.evidence.sourceSha256;
  if (!mappedCurrent) fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_CURRENT');
  const revisions = map.fieldRevisions
    .filter(
      (revision) =>
        revision.objectIdentitySha256 === latest.object.objectIdentitySha256 &&
        revision.fieldPath === query.fieldPath,
    )
    .sort(
      (left, right) =>
        Date.parse(left.sourceOccurredAt) - Date.parse(right.sourceOccurredAt) ||
        compare(left.revisionSha256, right.revisionSha256),
    );
  const revisionClosureSha256 = stableObjectSha256(revisions.map((row) => row.revisionSha256));
  if (
    exactResolution.revisionClosureCount !== revisions.length ||
    exactResolution.revisionClosureSha256 !== revisionClosureSha256
  ) {
    fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_CLOSURE');
  }
  const chronology = identityObjects.map((object) => {
    const field = fieldFor(object, query.fieldPath);
    return freeze({
      relativePath: object.relativePath,
      sourceSha256: object.sourceSha256,
      occurredAt: object.occurredAt,
      nativeObjectSha256: object.nativeObjectSha256,
      fieldSha256: field?.fieldSha256 ?? null,
    });
  });
  const unmetRequirements: string[] = [];
  if (sourceCatalogSha256 === null) unmetRequirements.push('bound-source-catalog');
  const mappedPaths = new Set(map.nativeObjects.map((object) => object.relativePath));
  if (
    map.sourceCount !== sourceHandles.length ||
    map.mappedSourceCount !== map.sourceCount ||
    map.unsupportedSourceCount !== 0 ||
    mappedPaths.size !== sourceHandles.length ||
    sourceHandles.some((handle) => !mappedPaths.has(handle.relativePath))
  ) {
    unmetRequirements.push('complete-source-coverage');
  }
  if (map.parseFailureCount !== 0) unmetRequirements.push('zero-adapter-failures');
  const latestOccurredAt = latest.object.occurredAt;
  const latestValues = new Set(
    fieldObservations
      .filter((row) => row.object.occurredAt === latestOccurredAt)
      .map((row) => stableObjectText(row.field.value)),
  );
  if (latestValues.size !== 1) unmetRequirements.push('unique-latest-field-value');
  const proofDisposition: SourceNativeCurrentFieldProofDisposition =
    unmetRequirements.length === 0 ? 'sufficient' : 'insufficient';
  const core = {
    schema: 1 as const,
    kind: 'OpenOntologySourceNativeCurrentFieldChronologyVerificationV1' as const,
    state:
      proofDisposition === 'sufficient'
        ? ('verified-complete-recorded-field-chronology' as const)
        : ('unverified-incomplete-recorded-field-chronology' as const),
    proofDisposition,
    scope: 'latest-recorded-field-over-bound-source-cut' as const,
    objectIdentity: current.objectIdentity,
    objectIdentitySha256: latest.object.objectIdentitySha256,
    fieldPath: query.fieldPath,
    sourceCommitSha256: sourceCommitSha256 ?? fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_INPUT'),
    sourceReplaySha256: sourceReplaySha256 ?? fail('SOURCE_NATIVE_CURRENT_FIELD_CHRONOLOGY_INPUT'),
    sourceCatalogSha256: sourceCatalogSha256 ?? null,
    sourceHandleSetSha256: stableObjectSha256(sourceHandles),
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    fieldResolutionSha256: exactResolution.resolutionSha256,
    sourceCount: sourceHandles.length,
    mappedSourceCount: map.mappedSourceCount,
    identityObservationCount: identityObjects.length,
    fieldObservationCount: fieldObservations.length,
    fieldRevisionCount: revisions.length,
    chronologySha256: stableObjectSha256(chronology),
    revisionClosureSha256,
    currentFieldSha256: current.fieldSha256,
    currentSourceSha256: current.evidence.sourceSha256,
    currentRelativePath: current.relativePath,
    currentOccurredAt: current.occurredAt,
    unmetRequirements: freeze(unmetRequirements),
    questionIndependentMap: true as const,
    navigationOnly: true as const,
    exactInspectRequired: true as const,
    exactSourcesRemainAuthority: true as const,
  };
  return freeze({ ...core, verificationSha256: stableObjectSha256(core) });
}
