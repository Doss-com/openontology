/** Deterministic field selection over a validated source-native object map. */
import { stableObjectSha256, stableObjectText } from '../canonical-content.js';
import { validateSourceNativeObjectMap } from '../source/object-map.js';
import type {
  SourceNativeField,
  SourceNativeObject,
  SourceNativeObjectIdentity,
  SourceNativeObjectMap,
} from '../source/object-map.js';
import type { SourceNativeFieldQuery } from './planner.js';

export interface SourceNativeFieldResolutionResult {
  state: string;
  query: SourceNativeFieldQuery;
  resolutionSha256: string;
  current?: {
    relativePath: string;
    objectIdentitySha256: string;
    fieldSha256: string;
    evidence: { sourceSha256: string; byteStart: number; byteEnd: number; textSha256: string };
    objectIdentity: SourceNativeObjectIdentity;
    occurredAt: string;
    value: string;
  } | null;
  suppressedRelativePaths: string[];
  revisionClosureCount: number;
  revisionClosureSha256: string;
  policy: string;
}
export interface SourceNativeFieldSuccessorResolutionResult {
  state: string;
  query: SourceNativeFieldQuery;
  resolutionSha256: string;
  anchor?:
    (NonNullable<SourceNativeFieldResolutionResult['current']> & { revisionSha256: string }) | null;
  successor?:
    (NonNullable<SourceNativeFieldResolutionResult['current']> & { revisionSha256: string }) | null;
  proofRelativePaths: string[];
  policy: string;
}

interface ResolutionCore {
  schema: 1;
  kind: 'OpenOntologySourceNativeFieldResolutionV1';
  state: string;
  nativeObjectMapSha256: string;
  query: SourceNativeFieldQuery;
  seedRelativePaths: string[];
  current: SourceNativeFieldResolutionResult['current'];
  expandedRelativePaths: string[];
  suppressedRelativePaths: string[];
  revisionPath: unknown[];
  revisionClosureCount: number;
  revisionClosureSha256: string;
  suppressedClosureCount: number;
  suppressedClosureSha256: string;
  policy: string;
  candidateQuestionReads: 1;
  candidateGoldReads: 0;
  modelCalls: 0;
  networkCalls: 0;
  targetLeakage: false;
  navigationOnly: true;
  exactInspectRequired: true;
  exactSourcesRemainAuthority: true;
}
interface SuccessorResolutionCore {
  schema: 1;
  kind: 'OpenOntologySourceNativeFieldSuccessorResolutionV1';
  state: string;
  nativeObjectMapSha256: string;
  query: SourceNativeFieldQuery;
  seedRelativePaths: string[];
  anchor: SourceNativeFieldSuccessorResolutionResult['anchor'];
  successor: SourceNativeFieldSuccessorResolutionResult['successor'];
  proofRelativePaths: string[];
  expandedRelativePaths: string[];
  revisionPath: unknown[];
  policy: string;
  candidateQuestionReads: 1;
  candidateGoldReads: 0;
  modelCalls: 0;
  networkCalls: 0;
  targetLeakage: false;
  navigationOnly: true;
  exactInspectRequired: true;
  exactSourcesRemainAuthority: true;
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

function resultCore({
  map,
  query,
  seedRelativePaths,
  state,
  current = null,
  expandedRelativePaths = [],
  suppressedRelativePaths = [],
  revisionPath = [],
  revisionClosureCount = 0,
  revisionClosureSha256 = stableObjectSha256([]),
  suppressedClosureCount = 0,
  suppressedClosureSha256 = stableObjectSha256([]),
  policy = 'unique-source-native-object-scope-then-field-revision-v1',
}: {
  map: SourceNativeObjectMap;
  query: SourceNativeFieldQuery;
  seedRelativePaths: string[];
  state: string;
  current?: SourceNativeFieldResolutionResult['current'];
  expandedRelativePaths?: string[];
  suppressedRelativePaths?: string[];
  revisionPath?: unknown[];
  revisionClosureCount?: number;
  revisionClosureSha256?: string;
  suppressedClosureCount?: number;
  suppressedClosureSha256?: string;
  policy?: string;
}): ResolutionCore {
  return {
    schema: 1,
    kind: 'OpenOntologySourceNativeFieldResolutionV1',
    state,
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    query: freeze({ ...query }),
    seedRelativePaths: freeze([...seedRelativePaths]),
    current,
    expandedRelativePaths: freeze([...expandedRelativePaths]),
    suppressedRelativePaths: freeze([...suppressedRelativePaths]),
    revisionPath: freeze([...revisionPath]),
    revisionClosureCount,
    revisionClosureSha256,
    suppressedClosureCount,
    suppressedClosureSha256,
    policy,
    candidateQuestionReads: 1,
    candidateGoldReads: 0,
    modelCalls: 0,
    networkCalls: 0,
    targetLeakage: false,
    navigationOnly: true,
    exactInspectRequired: true,
    exactSourcesRemainAuthority: true,
  };
}

function successorResultCore({
  map,
  query,
  seedRelativePaths,
  state,
  anchor = null,
  successor = null,
  proofRelativePaths = [],
  expandedRelativePaths = [],
  revisionPath = [],
  policy = 'bm25-seed-then-direct-source-native-field-successor-v1',
}: {
  map: SourceNativeObjectMap;
  query: SourceNativeFieldQuery;
  seedRelativePaths: string[];
  state: string;
  anchor?: SourceNativeFieldSuccessorResolutionResult['anchor'];
  successor?: SourceNativeFieldSuccessorResolutionResult['successor'];
  proofRelativePaths?: string[];
  expandedRelativePaths?: string[];
  revisionPath?: unknown[];
  policy?: string;
}): SuccessorResolutionCore {
  return {
    schema: 1,
    kind: 'OpenOntologySourceNativeFieldSuccessorResolutionV1',
    state,
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    query: freeze({ ...query }),
    seedRelativePaths: freeze([...seedRelativePaths]),
    anchor,
    successor,
    proofRelativePaths: freeze([...proofRelativePaths]),
    expandedRelativePaths: freeze([...expandedRelativePaths]),
    revisionPath: freeze([...revisionPath]),
    policy,
    candidateQuestionReads: 1,
    candidateGoldReads: 0,
    modelCalls: 0,
    networkCalls: 0,
    targetLeakage: false,
    navigationOnly: true,
    exactInspectRequired: true,
    exactSourcesRemainAuthority: true,
  };
}

export function resolveSourceNativeField({
  sourceNativeObjectMap: mapInput,
  seedRelativePaths: seedValues,
  query: queryInput,
}: {
  sourceNativeObjectMap?: SourceNativeObjectMap;
  seedRelativePaths?: string[];
  query?: SourceNativeFieldQuery;
} = {}): SourceNativeFieldResolutionResult {
  const query = queryInput ?? fail('SOURCE_NATIVE_RESOLVER_INPUT');
  const seedInput = seedValues ?? [];
  const map = (() => {
    try {
      return validateSourceNativeObjectMap(mapInput ?? fail('SOURCE_NATIVE_RESOLVER_MAP'));
    } catch {
      return fail('SOURCE_NATIVE_RESOLVER_MAP');
    }
  })();
  if (
    !Array.isArray(seedInput) ||
    seedInput.some((value) => typeof value !== 'string' || !value) ||
    new Set(seedInput).size !== seedInput.length ||
    typeof query?.sourceSystem !== 'string' ||
    !query.sourceSystem ||
    typeof query.objectType !== 'string' ||
    !query.objectType ||
    (query.externalId !== undefined &&
      (typeof query.externalId !== 'string' || !query.externalId)) ||
    typeof query.fieldPath !== 'string' ||
    !query.fieldPath
  )
    fail('SOURCE_NATIVE_RESOLVER_INPUT');
  const seedRelativePaths = [...seedInput].sort();
  const scopedMatches = map.nativeObjects.filter(
    (row) =>
      row.objectIdentity.sourceSystem === query.sourceSystem &&
      row.objectIdentity.objectType === query.objectType &&
      (query.namespace === undefined || row.objectIdentity.namespace === query.namespace) &&
      (query.externalId === undefined || row.objectIdentity.externalId === query.externalId),
  );
  const scopedIdentityIds = new Set(scopedMatches.map((row) => row.objectIdentitySha256));
  const selectedIdentitySha256 = scopedIdentityIds.size === 1 ? [...scopedIdentityIds][0] : null;
  const selectedIdentityObject =
    selectedIdentitySha256 === null
      ? null
      : scopedMatches.find((row) => row.objectIdentitySha256 === selectedIdentitySha256);
  const derivedExternalId = selectedIdentityObject?.objectIdentity.externalId ?? query.externalId;
  const resolvedQuery = { ...query, externalId: derivedExternalId };
  const policy = 'unique-source-native-object-scope-then-field-revision-v1';
  if (selectedIdentitySha256 === null || derivedExternalId === undefined) {
    const core = resultCore({
      map,
      query: resolvedQuery,
      seedRelativePaths,
      state:
        scopedIdentityIds.size > 1
          ? 'unavailable-native-object-scope-ambiguous'
          : 'unavailable-native-object-not-seeded',
      policy,
    });
    return freeze({ ...core, resolutionSha256: stableObjectSha256(core) });
  }
  const versions = map.nativeObjects
    .filter((row) => row.objectIdentitySha256 === selectedIdentitySha256)
    .map((object) => ({
      object,
      field: object.fields.find((field) => field.fieldPath === resolvedQuery.fieldPath),
    }))
    .filter(
      (row): row is { object: SourceNativeObject; field: SourceNativeField } =>
        row.field !== undefined,
    )
    .sort(
      (left, right) =>
        Date.parse(left.object.occurredAt) - Date.parse(right.object.occurredAt) ||
        compare(left.object.relativePath, right.object.relativePath),
    );
  if (versions.length < 1) {
    const core = resultCore({
      map,
      query: resolvedQuery,
      seedRelativePaths,
      state: 'unavailable-native-field-not-present',
      policy,
    });
    return freeze({ ...core, resolutionSha256: stableObjectSha256(core) });
  }
  const latest = versions.at(-1)!;
  const current = freeze({
    objectIdentity: latest.object.objectIdentity,
    objectIdentitySha256: latest.object.objectIdentitySha256,
    occurredAt: latest.object.occurredAt,
    relativePath: latest.object.relativePath,
    value: latest.field.value,
    fieldSha256: latest.field.fieldSha256,
    evidence: latest.field.evidence,
  });
  const revisionClosure = map.fieldRevisions
    .filter(
      (row) =>
        row.objectIdentitySha256 === latest.object.objectIdentitySha256 &&
        row.fieldPath === resolvedQuery.fieldPath,
    )
    .sort(
      (left, right) =>
        Date.parse(left.sourceOccurredAt) - Date.parse(right.sourceOccurredAt) ||
        compare(left.revisionSha256, right.revisionSha256),
    );
  const revisionClosureSha256 = stableObjectSha256(
    revisionClosure.map((row) => row.revisionSha256),
  );
  const seededSupersededVersion =
    versions
      .filter(
        (row) =>
          seedRelativePaths.includes(row.object.relativePath) &&
          row.field.value !== latest.field.value,
      )
      .at(-1) ?? null;
  const supersededVersion =
    seededSupersededVersion ??
    versions
      .filter(
        (row) =>
          row.object.relativePath !== latest.object.relativePath &&
          row.field.value !== latest.field.value,
      )
      .at(-1) ??
    null;
  const revisionPath =
    supersededVersion === null
      ? []
      : [
          freeze(
            (() => {
              const transitionCore = {
                schema: 1,
                kind: 'OpenOntologySourceNativeFieldResolutionTransitionV1',
                relationType: 'supersedes',
                basis: 'same-source-native-object-identity-and-ordered-field-closure',
                objectIdentity: latest.object.objectIdentity,
                objectIdentitySha256: latest.object.objectIdentitySha256,
                fieldPath: resolvedQuery.fieldPath,
                sourceField: latest.field,
                targetField: supersededVersion.field,
                sourceOccurredAt: latest.object.occurredAt,
                targetOccurredAt: supersededVersion.object.occurredAt,
                revisionClosureCount: revisionClosure.length,
                revisionClosureSha256,
                admissionState: 'deterministic-source-native',
                navigationOnly: true,
                exactSourcesRemainAuthority: true,
              };
              return { ...transitionCore, transitionSha256: stableObjectSha256(transitionCore) };
            })(),
          ),
        ];
  const expandedRelativePaths = seedRelativePaths.includes(latest.object.relativePath)
    ? []
    : [latest.object.relativePath];
  const suppressedClosure = [
    ...new Set(
      versions
        .filter(
          (row) =>
            row.object.relativePath !== latest.object.relativePath &&
            row.field.value !== latest.field.value,
        )
        .map((row) => row.object.relativePath),
    ),
  ].sort();
  const suppressedRelativePaths = suppressedClosure.filter((relativePath) =>
    seedRelativePaths.includes(relativePath),
  );
  const core = resultCore({
    map,
    query: resolvedQuery,
    seedRelativePaths,
    state: 'resolved-current-field',
    current,
    expandedRelativePaths,
    suppressedRelativePaths,
    revisionPath,
    revisionClosureCount: revisionClosure.length,
    revisionClosureSha256,
    suppressedClosureCount: suppressedClosure.length,
    suppressedClosureSha256: stableObjectSha256(suppressedClosure),
    policy,
  });
  return freeze({ ...core, resolutionSha256: stableObjectSha256(core) });
}

/** Resolve exactly one direct field revision after a seeded historical source. */
export function resolveSourceNativeFieldSuccessor({
  sourceNativeObjectMap: mapInput,
  seedRelativePaths: seedValues,
  query: queryInput,
}: {
  sourceNativeObjectMap?: SourceNativeObjectMap;
  seedRelativePaths?: string[];
  query?: SourceNativeFieldQuery;
} = {}): SourceNativeFieldSuccessorResolutionResult {
  const query = queryInput ?? fail('SOURCE_NATIVE_SUCCESSOR_RESOLVER_INPUT');
  const seedInput = seedValues ?? [];
  const map = (() => {
    try {
      return validateSourceNativeObjectMap(mapInput ?? fail('SOURCE_NATIVE_RESOLVER_MAP'));
    } catch {
      return fail('SOURCE_NATIVE_RESOLVER_MAP');
    }
  })();
  if (
    !Array.isArray(seedInput) ||
    (seedInput.length < 1 && !SHA256.test(query?.anchorFieldSha256 ?? '')) ||
    seedInput.some((value) => typeof value !== 'string' || !value) ||
    new Set(seedInput).size !== seedInput.length ||
    typeof query?.sourceSystem !== 'string' ||
    !query.sourceSystem ||
    typeof query.objectType !== 'string' ||
    !query.objectType ||
    typeof query.externalId !== 'string' ||
    !query.externalId ||
    typeof query.fieldPath !== 'string' ||
    !query.fieldPath ||
    (query.anchorFieldSha256 !== undefined && !SHA256.test(query.anchorFieldSha256))
  ) {
    fail('SOURCE_NATIVE_SUCCESSOR_RESOLVER_INPUT');
  }
  const seedRelativePaths = [...seedInput].sort(compare);
  const matchingSeeds = map.nativeObjects.filter(
    (row) =>
      seedRelativePaths.includes(row.relativePath) &&
      row.objectIdentity.sourceSystem === query.sourceSystem &&
      row.objectIdentity.objectType === query.objectType &&
      row.objectIdentity.externalId === query.externalId &&
      (query.namespace === undefined || row.objectIdentity.namespace === query.namespace) &&
      row.fields.some((field) => field.fieldPath === query.fieldPath),
  );
  const scopedMatches =
    query.anchorFieldSha256 === undefined
      ? []
      : map.nativeObjects.filter(
          (row) =>
            row.objectIdentity.sourceSystem === query.sourceSystem &&
            row.objectIdentity.objectType === query.objectType &&
            row.objectIdentity.externalId === query.externalId &&
            (query.namespace === undefined || row.objectIdentity.namespace === query.namespace),
        );
  const identityIds = new Set(
    (query.anchorFieldSha256 === undefined ? matchingSeeds : scopedMatches).map(
      (row) => row.objectIdentitySha256,
    ),
  );
  const resolvedQuery = freeze({ ...query });
  if (identityIds.size !== 1) {
    const core = successorResultCore({
      map,
      query: resolvedQuery,
      seedRelativePaths,
      state:
        identityIds.size > 1
          ? 'unavailable-native-object-seed-ambiguous'
          : 'unavailable-native-object-not-seeded',
    });
    return freeze({ ...core, resolutionSha256: stableObjectSha256(core) });
  }
  const objectIdentitySha256 = [...identityIds][0];
  const seedFieldByPath = new Map(
    matchingSeeds.map((object) => [
      object.relativePath,
      object.fields.find((field) => field.fieldPath === query.fieldPath),
    ]),
  );
  const revisions = map.fieldRevisions.filter(
    (row) =>
      row.objectIdentitySha256 === objectIdentitySha256 &&
      row.fieldPath === query.fieldPath &&
      (query.anchorFieldSha256 === undefined
        ? seedFieldByPath.get(row.targetField.evidence.relativePath)?.fieldSha256 ===
          row.targetField.fieldSha256
        : row.targetField.fieldSha256 === query.anchorFieldSha256),
  );
  const policy =
    query.anchorFieldSha256 === undefined
      ? 'bm25-seed-then-direct-source-native-field-successor-v1'
      : 'exact-anchor-field-then-direct-source-native-field-successor-v2';
  if (revisions.length !== 1) {
    const core = successorResultCore({
      map,
      query: resolvedQuery,
      seedRelativePaths,
      state:
        revisions.length > 1
          ? 'unavailable-native-field-successor-ambiguous'
          : 'unavailable-native-field-successor-not-present',
      policy,
    });
    return freeze({ ...core, resolutionSha256: stableObjectSha256(core) });
  }
  const revision = revisions[0];
  if (!revision) fail('SOURCE_NATIVE_SUCCESSOR_RESOLVER_INPUT');
  const anchor = freeze({
    objectIdentity: revision.objectIdentity,
    objectIdentitySha256,
    occurredAt: revision.targetOccurredAt,
    relativePath: revision.targetField.evidence.relativePath,
    value: revision.targetField.value,
    fieldSha256: revision.targetField.fieldSha256,
    evidence: revision.targetField.evidence,
    revisionSha256: revision.revisionSha256,
  });
  const successorObjects = map.nativeObjects.filter(
    (object) =>
      object.objectIdentitySha256 === objectIdentitySha256 &&
      object.occurredAt === revision.sourceOccurredAt &&
      object.fields.some(
        (field) =>
          field.fieldPath === query.fieldPath &&
          stableObjectText(field.canonicalValue ?? field.value) ===
            stableObjectText(revision.sourceField.canonicalValue ?? revision.sourceField.value),
      ),
  );
  const proofRelativePaths = [...new Set(successorObjects.map((row) => row.relativePath))].sort(
    compare,
  );
  if (!proofRelativePaths.includes(revision.sourceField.evidence.relativePath)) {
    fail('SOURCE_NATIVE_SUCCESSOR_PROOF_CLOSURE');
  }
  const successor = freeze({
    objectIdentity: revision.objectIdentity,
    objectIdentitySha256,
    occurredAt: revision.sourceOccurredAt,
    relativePath: revision.sourceField.evidence.relativePath,
    value: revision.sourceField.value,
    fieldSha256: revision.sourceField.fieldSha256,
    evidence: revision.sourceField.evidence,
    revisionSha256: revision.revisionSha256,
  });
  const transitionCore = {
    schema: 1,
    kind: 'OpenOntologySourceNativeFieldSuccessorTransitionV1',
    relationType: 'supersedes',
    basis: revision.basis,
    objectIdentity: revision.objectIdentity,
    objectIdentitySha256,
    fieldPath: revision.fieldPath,
    sourceFieldSha256: revision.sourceField.fieldSha256,
    targetFieldSha256: revision.targetField.fieldSha256,
    sourceOccurredAt: revision.sourceOccurredAt,
    targetOccurredAt: revision.targetOccurredAt,
    revisionSha256: revision.revisionSha256,
    admissionState: revision.admissionState,
    navigationOnly: true,
    exactSourcesRemainAuthority: true,
  };
  const transition = freeze({
    ...transitionCore,
    transitionSha256: stableObjectSha256(transitionCore),
  });
  const expandedRelativePaths = proofRelativePaths.filter(
    (relativePath) => !seedRelativePaths.includes(relativePath),
  );
  const core = successorResultCore({
    map,
    query: resolvedQuery,
    seedRelativePaths,
    state: 'resolved-next-field-revision',
    anchor,
    successor,
    proofRelativePaths,
    expandedRelativePaths,
    revisionPath: [transition],
    policy,
  });
  return freeze({ ...core, resolutionSha256: stableObjectSha256(core) });
}
