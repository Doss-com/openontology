/** Compile source-native canonical propositions into one authoritative proof census. */
import { stableObjectSha256 } from '../canonical-content.js';
import { compileProofAuthorityProjection } from '../proof/authority-projection.js';
import type {
  ProofAuthorityItem,
  ProofAuthorityProjection,
  ProofAuthorityRelation,
} from '../proof/authority-projection.js';
import { validateSourceNativeObjectMap } from './object-map.js';
import { normalizeSourceNativeHistoricalTime, resolveSourceNativeFieldAt,
  sourceNativeFieldStateSha256 } from '../query/historical-field.js';
import type {
  SourceNativeCanonicalPropositionV2,
  SourceNativeField,
  SourceNativeObject,
  SourceNativeObjectMap,
} from './object-map.js';

const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const isV2 = (value: unknown): value is SourceNativeCanonicalPropositionV2 =>
  value !== null && typeof value === 'object'
  && (value as { kind?: unknown }).kind === 'OpenOntologySourceNativeCanonicalPropositionV2';

export interface CompileSourceNativeProofAuthorityProjectionInput {
  sourceNativeObjectMap?: SourceNativeObjectMap;
  namespace?: string;
  rootPropositionKeys?: readonly string[];
  at?: string | null;
}

export function compileSourceNativeProofAuthorityProjection({
  sourceNativeObjectMap: mapInput,
  namespace,
  rootPropositionKeys: rootPropositionKeyInput,
  at: atInput = null,
}: CompileSourceNativeProofAuthorityProjectionInput = {}): ProofAuthorityProjection {
  const map = validateSourceNativeObjectMap(mapInput);
  const at = atInput === null ? null : normalizeSourceNativeHistoricalTime(atInput);
  if (typeof namespace !== 'string' || !namespace
    || rootPropositionKeyInput !== undefined
      && (!Array.isArray(rootPropositionKeyInput)
        || rootPropositionKeyInput.length < 1
        || rootPropositionKeyInput.some((key) => typeof key !== 'string' || !key)
        || new Set(rootPropositionKeyInput).size !== rootPropositionKeyInput.length)) {
    fail('SOURCE_NATIVE_SEMANTIC_PROJECTION_INPUT');
  }
  const rootPropositionKeys = rootPropositionKeyInput === undefined ? null
    : [...rootPropositionKeyInput].sort(compare);
  const bindings: Array<{
    item: ProofAuthorityItem;
    fieldSha256: string;
    objectIdentitySha256: string;
    field: SourceNativeField;
    object: SourceNativeObject;
  }> = [];
  const relations: ProofAuthorityRelation[] = [];
  for (const object of map.nativeObjects) {
    if (object.objectIdentity.namespace !== namespace) continue;
    for (const field of object.fields) {
      const proposition = field.canonicalProposition;
      if (!isV2(proposition)) continue;
      if (field.validAt === undefined || field.knownAt === undefined) {
        fail('SOURCE_NATIVE_SEMANTIC_PROJECTION_FIELD');
      }
      const validAt = field.validAt ?? fail('SOURCE_NATIVE_SEMANTIC_PROJECTION_FIELD');
      const knownAt = field.knownAt ?? fail('SOURCE_NATIVE_SEMANTIC_PROJECTION_FIELD');
      bindings.push({
        item: {
          sourceProjectionItemId: proposition.propositionKey,
          familyId: proposition.dimension,
          canonicalRoles: proposition.canonicalRoles,
          modality: proposition.modality,
          polarity: proposition.polarity,
          actorRef: object.objectIdentitySha256,
          validAt,
          knownAt,
          exactEvidenceReferences: [{
            sourceRef: field.evidence.relativePath,
            sourceSha256: field.evidence.sourceSha256,
            byteStart: field.evidence.byteStart,
            byteEnd: field.evidence.byteEnd,
            textSha256: field.evidence.textSha256,
          }],
        },
        fieldSha256: field.fieldSha256,
        objectIdentitySha256: object.objectIdentitySha256,
        field,
        object,
      });
      relations.push(...proposition.relations.map((relation) => ({
        type: relation.type,
        sourceProjectionItemId: proposition.propositionKey,
        targetProjectionItemId: relation.targetPropositionKey,
      })));
    }
  }
  const itemIds = new Set(bindings.map((row) => row.item.sourceProjectionItemId));
  if (bindings.length < 1 || at === null && itemIds.size !== bindings.length) {
    fail('SOURCE_NATIVE_SEMANTIC_PROJECTION_EMPTY_OR_DUPLICATE');
  }
  if (at !== null && itemIds.size !== bindings.length) {
    const byKey = new Map<string, typeof bindings>();
    for (const binding of bindings) {
      const key = binding.item.sourceProjectionItemId;
      const group = byKey.get(key) ?? [];
      group.push(binding);
      byKey.set(key, group);
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const first = group[0] ?? fail('SOURCE_NATIVE_HISTORICAL_SEMANTIC_CENSUS');
      const stateSha256 = sourceNativeFieldStateSha256(first.field);
      if (group.some((row) => row.objectIdentitySha256 !== first.objectIdentitySha256
        || row.field.fieldPath !== first.field.fieldPath
        || sourceNativeFieldStateSha256(row.field) !== stateSha256)) {
        fail('SOURCE_NATIVE_HISTORICAL_SEMANTIC_CENSUS');
      }
      const observations = map.nativeObjects
        .filter((object) => object.objectIdentitySha256 === first.objectIdentitySha256)
        .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
          || compare(left.relativePath, right.relativePath))
        .flatMap((object) => object.fields.filter((field) => field.fieldPath === first.field.fieldPath));
      const repeatedFields = new Set(group.map((row) => row.fieldSha256));
      const firstIndex = observations.findIndex((field) => repeatedFields.has(field.fieldSha256));
      const lastIndex = observations.reduce((last, field, index) =>
        repeatedFields.has(field.fieldSha256) ? index : last, -1);
      if (firstIndex < 0 || observations.slice(firstIndex, lastIndex + 1)
        .some((field) => sourceNativeFieldStateSha256(field) !== stateSha256)) {
        fail('SOURCE_NATIVE_HISTORICAL_SEMANTIC_CENSUS');
      }
    }
  }
  if (relations.some((relation) => !itemIds.has(relation.targetProjectionItemId))) {
    fail('SOURCE_NATIVE_SEMANTIC_PROJECTION_RELATION_TARGET');
  }
  const selectedIds = rootPropositionKeys === null ? itemIds : new Set(rootPropositionKeys);
  if (rootPropositionKeys?.some((key) => !itemIds.has(key))) {
    fail('SOURCE_NATIVE_SEMANTIC_PROJECTION_ROOT');
  }
  if (rootPropositionKeys !== null) {
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const relation of relations) {
        if (selectedIds.has(relation.targetProjectionItemId)
          && !selectedIds.has(relation.sourceProjectionItemId)) {
          selectedIds.add(relation.sourceProjectionItemId);
          expanded = true;
        }
      }
    }
  }
  let selectedBindings = bindings.filter((row) =>
    selectedIds.has(row.item.sourceProjectionItemId));
  let selectedRelations = relations.filter((relation) =>
    selectedIds.has(relation.sourceProjectionItemId)
      && selectedIds.has(relation.targetProjectionItemId));
  if (at !== null) {
    const selectedFields = new Set<string>();
    const visited = new Set<string>();
    for (const binding of selectedBindings) {
      const { object, field } = binding;
      const key = `${object.objectIdentitySha256}\0${field.fieldPath}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const resolution = resolveSourceNativeFieldAt({ sourceNativeObjectMap: map, at,
        query: { ...object.objectIdentity, fieldPath: field.fieldPath } });
      if (resolution.state === 'unavailable-native-historical-field-not-yet-valid') continue;
      if (resolution.state !== 'resolved-historical-field' || resolution.selected === null) {
        fail('SOURCE_NATIVE_HISTORICAL_SEMANTIC_CENSUS');
      }
      const selected = resolution.selected ?? fail('SOURCE_NATIVE_HISTORICAL_SEMANTIC_CENSUS');
      selectedFields.add(selected.fieldSha256);
    }
    selectedBindings = selectedBindings.filter((row) => selectedFields.has(row.fieldSha256));
    const activeIds = new Set(selectedBindings.map((row) => row.item.sourceProjectionItemId));
    if (activeIds.size !== selectedBindings.length
      || rootPropositionKeys?.some((key) => !activeIds.has(key))) {
      fail('SOURCE_NATIVE_HISTORICAL_SEMANTIC_CENSUS');
    }
    selectedRelations = selectedRelations.filter((relation) => activeIds.has(relation.sourceProjectionItemId)
      && activeIds.has(relation.targetProjectionItemId));
    selectedRelations = [...new Map(selectedRelations.map((relation) =>
      [stableObjectSha256(relation), relation])).values()];
    if (rootPropositionKeys !== null) {
      const connected = new Set(rootPropositionKeys);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const relation of selectedRelations) {
          if (connected.has(relation.targetProjectionItemId) && !connected.has(relation.sourceProjectionItemId)) {
            connected.add(relation.sourceProjectionItemId);
            expanded = true;
          }
        }
      }
      selectedBindings = selectedBindings.filter((row) => connected.has(row.item.sourceProjectionItemId));
      selectedRelations = selectedRelations.filter((relation) => connected.has(relation.sourceProjectionItemId)
        && connected.has(relation.targetProjectionItemId));
    }
  }
  const sourceProjectionSha256 = stableObjectSha256({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeSemanticProjectionInputV1',
    namespace,
    rootPropositionKeys,
    nativeObjectMapSha256: map.nativeObjectMapSha256,
    ...(at === null ? {} : { at, temporalProfile: 'source-native-basic-retrospective-v1' }),
    bindings: selectedBindings.map((row) => ({
      sourceProjectionItemId: row.item.sourceProjectionItemId,
      fieldSha256: row.fieldSha256,
      objectIdentitySha256: row.objectIdentitySha256,
    })),
  });
  return compileProofAuthorityProjection({
    sourceProjectionKind: 'OpenOntologySourceNativeSemanticProjectionV1',
    sourceProjectionSha256,
    items: selectedBindings.map((row) => row.item),
    relations: selectedRelations,
  });
}
