/** Concept discovery and exact passage reads, composed with the existing factual verifier. */
import { randomUUID } from 'node:crypto';
import { objectBytesSha256, stableObjectSha256 } from './canonical-content.mjs';
import { openSourceNativeProductWithAdmittedKnowledge } from './source-native-admitted-knowledge.mjs';
import type { SourceNativeAdmissionTrustEntry } from './source-native-admitted-knowledge.mjs';
import { createConstructionLedgerReader } from './source-native-construction-admission.mjs';
import type {
  SourceNativeConstructionAdmissionRecord, SourceNativeConstructionLedger,
} from './source-native-construction-admission.mjs';
import type { ProductOptions } from './source-native-artifact.mjs';
import type { SourceNativeObject, SourceNativeObjectIdentity } from './source-native-object-map.mjs';
import type {
  ProductSearchInput, SourceNativeProductLifecycleAdapterFactory, SourceNativeProductRuntimeContext,
} from './source-native-product.mjs';
import type { SourceNativeSemanticWitness } from './source-native-semantic-construction.mjs';

export interface SourceNativeConstructionSearchInput {
  term: string;
  scope?: { sourceSystem: string; objectType?: string };
  conceptId?: string;
  limit?: number;
  cursor?: string;
}
export type SourceNativeConstructionAttachmentRole = 'name' | 'alias' | 'mentions' | 'defines';
export type SourceNativeConstructionLedgerSummary = Omit<SourceNativeConstructionLedger, 'activeRecords'> & {
  activeRecordCount: number;
};
export interface SourceNativeConstructionMatch {
  ref: string;
  conceptId: string;
  nativeObject: SourceNativeObjectIdentity;
  relativePath: string;
  occurredAt: string;
  sourceSha256: string;
  roles: readonly SourceNativeConstructionAttachmentRole[];
  requiredForProof: false;
}
export interface SourceNativeConstructionSearchResult {
  schemaVersion: 1;
  kind: 'OpenOntologyConstructionSearchResultV1';
  state: 'resolved-construction-navigation' | 'ambiguous-construction-navigation'
    | 'no-construction-match' | 'unavailable-construction-navigation';
  query: { term: string; scope: SourceNativeConstructionSearchInput['scope'] | null; conceptId: string | null };
  concepts: readonly { id: string; name: string }[];
  totalConcepts: number;
  totalMatches: number;
  matches: readonly SourceNativeConstructionMatch[];
  nextCursor: string | null;
  projectionSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  ledger: SourceNativeConstructionLedgerSummary;
  absenceProven: false;
  policy: { navigationOnly: true; exactReadRequired: true; exactSourcesRemainAuthority: true; canonicalTruthMutation: false };
  resultSha256: string;
}
export interface SourceNativeConstructionReadResult {
  schemaVersion: 1;
  kind: 'OpenOntologyConstructionReadResultV1';
  ref: string;
  exactText: string;
  evidence: SourceNativeSemanticWitness['evidence'];
  binding: {
    kind: 'OpenOntologyConstructionPassageBindingV1';
    conceptId: string;
    roles: readonly SourceNativeConstructionAttachmentRole[];
    nativeObject: SourceNativeObjectIdentity;
    nativeObjectSha256: string;
    constructionSha256: string;
    admissionRecordSha256: string;
    navigationOnly: true;
    exactSourcesRemainAuthority: true;
  };
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  receiptSha256: string;
}

interface Passage {
  record: SourceNativeConstructionAdmissionRecord;
  conceptId: string;
  source: SourceNativeSemanticWitness;
  object: SourceNativeObject;
  roles: SourceNativeConstructionAttachmentRole[];
}
interface Cursor { querySha256: string; projectionSha256: string; offset: number }
const compare = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const normalized = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('en-US');
function fail(suffix: string): never {
  const code = `CONSTRUCTION_NAVIGATION_${suffix}`;
  throw Object.assign(new TypeError(code), { code });
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || !Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key))) fail('INPUT');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.from(value).toString('utf8') !== value) fail('INPUT');
  return value.trim();
}
function searchInput(input: SourceNativeConstructionSearchInput) {
  const value = row(input, ['term', 'scope', 'conceptId', 'limit', 'cursor']);
  const term = text(value.term);
  const scope = value.scope === undefined ? null : (() => {
    const scopeInput = row(value.scope, ['sourceSystem', 'objectType']);
    return { sourceSystem: text(scopeInput.sourceSystem),
      ...(scopeInput.objectType === undefined ? {} : { objectType: text(scopeInput.objectType) }) };
  })();
  const conceptId = value.conceptId === undefined ? null : text(value.conceptId, 128);
  if (conceptId !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(conceptId)) fail('INPUT');
  const limit = value.limit === undefined ? 20 : value.limit;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) fail('INPUT');
  const cursor = value.cursor === undefined ? null : text(value.cursor);
  return { term, scope, conceptId, limit, cursor };
}
function summary(ledger: SourceNativeConstructionLedger): SourceNativeConstructionLedgerSummary {
  const { activeRecords, ...counts } = ledger;
  return freeze({ ...counts, activeRecordCount: activeRecords.length });
}
function remember<T>(map: Map<string, T>, key: string, value: T, maximum: number): void {
  if (map.size >= maximum) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, value);
}

/** Control-plane configuration stays at the kernel boundary; no new proof authority is introduced. */
export function openSourceNativeProductWithConstruction(options: ProductOptions = {}, configuration: {
  trustRegistry: readonly SourceNativeAdmissionTrustEntry[];
  knowledgeBranch?: string;
}, createLifecycleAdapter: SourceNativeProductLifecycleAdapterFactory | null = null) {
  row(configuration, ['trustRegistry', 'knowledgeBranch']);
  if (createLifecycleAdapter !== null && typeof createLifecycleAdapter !== 'function') fail('INPUT');
  let captured: SourceNativeProductRuntimeContext | null = null;
  const base = openSourceNativeProductWithAdmittedKnowledge(options, configuration, (context) => {
    captured = context;
    return createLifecycleAdapter?.(context) ?? null;
  });
  const context = captured as SourceNativeProductRuntimeContext | null;
  if (!context) fail('CONTEXT');
  const reader = createConstructionLedgerReader(context, configuration.trustRegistry, configuration.knowledgeBranch);
  let ledger = reader.read();
  const objects = new Map(context.objectOnt.map.nativeObjects.map((object) => [object.nativeObjectSha256, object]));
  const sources = new Map(context.objectOnt.sources.map((source) => [source.relativePath, source]));
  const offered = new Map<string, Passage>();
  const cursors = new Map<string, Cursor>();

  const search = async (input: ProductSearchInput | SourceNativeConstructionSearchInput) => {
    if (!input || typeof input !== 'object' || !Object.hasOwn(input, 'term')) return base.search(input as ProductSearchInput);
    const { term, scope, conceptId, limit, cursor } = searchInput(input as SourceNativeConstructionSearchInput);
    ledger = reader.read();
    const projectionSha256 = stableObjectSha256({ artifactSha256: context.descriptor.artifactSha256,
      activeRecordSha256s: ledger.activeRecords.map((record) => record.recordSha256).sort(compare) });
    const querySha256 = stableObjectSha256({ term: normalized(term), scope, conceptId });
    const page = cursor === null ? null : cursors.get(cursor) ?? fail('CURSOR');
    if (page && (page.querySha256 !== querySha256 || page.projectionSha256 !== projectionSha256)) fail('CURSOR_STALE');
    const offset = page?.offset ?? 0;
    const constructions = new Map<string, SourceNativeConstructionAdmissionRecord>();
    for (const record of [...ledger.activeRecords].sort((a, b) => compare(a.recordSha256, b.recordSha256))) {
      if (!constructions.has(record.construction.constructionSha256)) constructions.set(record.construction.constructionSha256, record);
    }
    const concepts: { id: string; name: string; passages: Passage[] }[] = [];
    for (const record of constructions.values()) {
      for (const definition of record.construction.objectDefs) {
        if (conceptId !== null && definition.id !== conceptId) continue;
        if (normalized(definition.name) !== normalized(term) && !definition.aliases.some((alias) =>
          normalized(alias.value) === normalized(term) && (scope === null || alias.sourceSystem === scope.sourceSystem))) continue;
        const passages = new Map<string, Passage>();
        const add = (source: SourceNativeSemanticWitness, role: SourceNativeConstructionAttachmentRole) => {
          const object = objects.get(source.nativeObjectSha256) ?? fail('BINDING');
          if (scope && (object.objectIdentity.sourceSystem !== scope.sourceSystem
            || scope.objectType !== undefined && object.objectIdentity.objectType !== scope.objectType)) return;
          const key = stableObjectSha256(source);
          const passage = passages.get(key) ?? { record, conceptId: definition.id, source, object, roles: [] };
          if (!passage.roles.includes(role)) passage.roles.push(role);
          passages.set(key, passage);
        };
        add(definition.source, 'name');
        for (const alias of definition.aliases) add(alias.source, 'alias');
        for (const claim of record.construction.claims.filter((claim) => claim.about === definition.id)) add(claim.source, claim.predicate);
        if (passages.size > 0) concepts.push({ id: definition.id, name: definition.name,
          passages: [...passages].sort(([a], [b]) => compare(a, b)).map(([, passage]) =>
            ({ ...passage, roles: passage.roles.sort(compare) })) });
      }
    }
    concepts.sort((a, b) => compare(a.id, b.id));
    const allPassages = concepts.flatMap((concept) => concept.passages);
    const totalMatches = allPassages.length;
    const state: SourceNativeConstructionSearchResult['state'] = concepts.length > 1
      ? 'ambiguous-construction-navigation'
      : concepts.length === 1 ? 'resolved-construction-navigation'
        : ledger.state === 'degraded' ? 'unavailable-construction-navigation' : 'no-construction-match';
    const selected = allPassages.slice(offset, offset + limit);
    const matches = selected.map((passage): SourceNativeConstructionMatch => {
      const ref = `construction:${randomUUID()}`;
      remember(offered, ref, freeze(passage), 1024);
      const source = sources.get(passage.source.evidence.sourceRef) ?? fail('BINDING');
      return { ref, conceptId: passage.conceptId, nativeObject: passage.object.objectIdentity,
        relativePath: source.relativePath, occurredAt: source.occurredAt, sourceSha256: source.sourceSha256,
        roles: passage.roles, requiredForProof: false };
    });
    let nextCursor: string | null = null;
    if (allPassages.length > offset + limit) {
      nextCursor = `construction-page:${randomUUID()}`;
      remember(cursors, nextCursor, { querySha256, projectionSha256, offset: offset + limit }, 128);
    }
    const visibleConceptIds = new Set(selected.map((passage) => passage.conceptId));
    const pageConcepts = concepts.filter((concept) => visibleConceptIds.has(concept.id))
      .map(({ id, name }) => ({ id, name }));
    const core = { schemaVersion: 1 as const, kind: 'OpenOntologyConstructionSearchResultV1' as const,
      state, query: { term, scope, conceptId }, concepts: pageConcepts,
      totalConcepts: concepts.length, totalMatches, matches, nextCursor, projectionSha256,
      sourceCommitSha256: context.objectOnt.commitSha256, sourceReplaySha256: context.objectOnt.replaySha256,
      ledger: summary(ledger), absenceProven: false as const,
      policy: { navigationOnly: true as const, exactReadRequired: true as const,
        exactSourcesRemainAuthority: true as const, canonicalTruthMutation: false as const } };
    return freeze({ ...core, resultSha256: stableObjectSha256(core) }) satisfies SourceNativeConstructionSearchResult;
  };

  const read = async (input: { ref: string }) => {
    const value = row(input, ['ref']);
    const ref = text(value.ref);
    if (!ref.startsWith('construction:')) return base.read({ ref });
    const passage = offered.get(ref) ?? fail('REFERENCE');
    ledger = reader.read();
    if (!ledger.activeRecords.some((record) => record.recordSha256 === passage.record.recordSha256)) fail('REFERENCE_INELIGIBLE');
    const reference = passage.source.evidence;
    const source = sources.get(reference.sourceRef) ?? fail('BINDING');
    const object = objects.get(passage.source.nativeObjectSha256) ?? fail('BINDING');
    const bytes = Buffer.from(source.content);
    const exact = bytes.subarray(reference.byteStart, reference.byteEnd);
    const exactText = exact.toString('utf8');
    if (object.objectIdentity.namespace !== context.descriptor.namespace
      || object.relativePath !== reference.sourceRef || object.sourceSha256 !== reference.sourceSha256
      || objectBytesSha256(bytes) !== reference.sourceSha256 || reference.byteStart < 0
      || reference.byteEnd > bytes.length || reference.byteEnd <= reference.byteStart
      || reference.byteEnd - reference.byteStart > 64 * 1024
      || objectBytesSha256(exact) !== reference.textSha256 || !Buffer.from(exactText).equals(exact)
      || !object.fields.some((field) => field.evidence.relativePath === reference.sourceRef
        && field.evidence.sourceSha256 === reference.sourceSha256
        && field.evidence.byteStart <= reference.byteStart && field.evidence.byteEnd >= reference.byteEnd)) fail('EVIDENCE');
    const core = { schemaVersion: 1 as const, kind: 'OpenOntologyConstructionReadResultV1' as const,
      ref, exactText, evidence: reference,
      binding: { kind: 'OpenOntologyConstructionPassageBindingV1' as const, conceptId: passage.conceptId,
        roles: passage.roles, nativeObject: object.objectIdentity, nativeObjectSha256: object.nativeObjectSha256,
        constructionSha256: passage.record.construction.constructionSha256,
        admissionRecordSha256: passage.record.recordSha256, navigationOnly: true as const, exactSourcesRemainAuthority: true as const },
      sourceCommitSha256: context.objectOnt.commitSha256, sourceReplaySha256: context.objectOnt.replaySha256 };
    return freeze({ ...core, receiptSha256: stableObjectSha256(core) }) satisfies SourceNativeConstructionReadResult;
  };
  return freeze({ ...base, kind: 'OpenOntologySourceNativeConstructionProductV1' as const,
    search, read, status: () => freeze({ ...base.status(), construction: summary(ledger) }) });
}

export type SourceNativeConstructionProduct = ReturnType<typeof openSourceNativeProductWithConstruction>;
