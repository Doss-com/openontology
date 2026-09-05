/** Compile source-native canonical propositions into one authoritative proof census. */
import { stableObjectSha256 } from './canonical-content.mjs';
import { compileProofAuthorityProjection } from './proof-authority-projection.mjs';
import type {
  ProofAuthorityItem,
  ProofAuthorityProjection,
  ProofAuthorityRelation,
} from './proof-authority-projection.mjs';
import { validateSourceNativeObjectMap } from './source-native-object-map.mjs';
import type {
  SourceNativeCanonicalPropositionV2,
  SourceNativeObjectMap,
} from './source-native-object-map.mjs';

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
}

export function compileSourceNativeProofAuthorityProjection({
  sourceNativeObjectMap: mapInput,
  namespace,
  rootPropositionKeys: rootPropositionKeyInput,
}: CompileSourceNativeProofAuthorityProjectionInput = {}): ProofAuthorityProjection {
  const map = validateSourceNativeObjectMap(mapInput);
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
      });
      relations.push(...proposition.relations.map((relation) => ({
        type: relation.type,
        sourceProjectionItemId: proposition.propositionKey,
        targetProjectionItemId: relation.targetPropositionKey,
      })));
    }
  }
  const itemIds = new Set(bindings.map((row) => row.item.sourceProjectionItemId));
  if (bindings.length < 1 || itemIds.size !== bindings.length) {
    fail('SOURCE_NATIVE_SEMANTIC_PROJECTION_EMPTY_OR_DUPLICATE');
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
  const selectedBindings = bindings.filter((row) =>
    selectedIds.has(row.item.sourceProjectionItemId));
  const selectedRelations = relations.filter((relation) =>
    selectedIds.has(relation.sourceProjectionItemId)
      && selectedIds.has(relation.targetProjectionItemId));
  const sourceProjectionSha256 = stableObjectSha256({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeSemanticProjectionInputV1',
    namespace,
    rootPropositionKeys,
    nativeObjectMapSha256: map.nativeObjectMapSha256,
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
