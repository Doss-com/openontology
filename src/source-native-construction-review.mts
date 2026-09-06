/** Full-source semantic review input and unsigned judgments. No signing or Admission. */
import { stableObjectSha256, stableObjectText } from './canonical-content.mjs';
import { openProductState } from './source-native-artifact.mjs';
import type { ProductOptions } from './source-native-artifact.mjs';
import type { SourceNativeObjectIdentity, SourceNativeSource } from './source-native-object-map.mjs';
import { assertSemanticConstructionBound, validateSourceNativeSemanticConstruction } from './source-native-semantic-construction.mjs';
import type { SourceNativeSemanticConstruction, SourceNativeSemanticWitness } from './source-native-semantic-construction.mjs';

export interface SourceNativeConstructionReviewItem {
  kind: 'preferred-name' | 'scoped-alias' | 'mentions' | 'defines';
  objectDefId: string;
  name: string;
  alias: { value: string; sourceSystem: string } | null;
  claimId: string | null;
  nativeObject: SourceNativeObjectIdentity;
  source: SourceNativeSemanticWitness;
  itemSha256: string;
}
export interface SourceNativeConstructionReviewPacket {
  schemaVersion: 1;
  kind: 'OpenOntologyConstructionReviewPacketV1';
  constructionSha256: string;
  sourceBinding: SourceNativeSemanticConstruction['sourceBinding'];
  coverage: SourceNativeSemanticConstruction['coverage'];
  items: readonly SourceNativeConstructionReviewItem[];
  sources: readonly SourceNativeSource[];
  navigationOnly: true;
  exactSourcesRemainAuthority: true;
  packetSha256: string;
}
export interface SourceNativeConstructionReviewDecision {
  itemSha256: string;
  decision: 'accept' | 'reject' | 'abstain';
  reason: string;
  citations: readonly { sourceRef: string; quote: string }[];
}
export interface SourceNativeConstructionReviewResponse {
  packetSha256: string;
  decisions: readonly SourceNativeConstructionReviewDecision[];
}
export interface SourceNativeConstructionSemanticReview {
  schemaVersion: 1;
  kind: 'OpenOntologyConstructionSemanticReviewV1';
  constructionSha256: string;
  packetSha256: string;
  decisions: readonly SourceNativeConstructionReviewDecision[];
  acceptedItemCount: number;
  rejectedItemCount: number;
  abstainedItemCount: number;
  disposition: 'accepted' | 'rejected' | 'needs-review';
  admissionGranted: false;
  navigationOnly: true;
  exactSourcesRemainAuthority: true;
  reviewSha256: string;
}
export interface SourceNativeConstructionReviewSession {
  packet: SourceNativeConstructionReviewPacket;
  responseSchema: Readonly<Record<string, unknown>>;
  evaluate(response: unknown): SourceNativeConstructionSemanticReview;
}

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ITEMS = 128;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const compare = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
function fail(suffix: string): never {
  const code = `CONSTRUCTION_REVIEW_${suffix}`;
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
    || Reflect.ownKeys(value).length !== keys.length
    || !Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key))) fail('SHAPE');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum
    || Buffer.from(value).toString('utf8') !== value) fail('TEXT');
  return value;
}
function hash(value: unknown): string {
  return typeof value === 'string' && SHA256.test(value) ? value : fail('HASH');
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value)) fail('SHAPE');
  if (value.length > maximum) fail('LIMIT');
  return Array.from(value as unknown[]);
}
function boundedJson(value: SourceNativeConstructionReviewPacket | SourceNativeConstructionReviewResponse): void {
  if (Buffer.byteLength(stableObjectText(value)) > MAX_JSON_BYTES) fail('LIMIT');
}

/** The reviewer receives complete cited documents, not only proposer-selected snippets. */
export function openSourceNativeConstructionReview(input: {
  options?: ProductOptions;
  construction: unknown;
}): SourceNativeConstructionReviewSession {
  if (!input || typeof input !== 'object') fail('SHAPE');
  row(input, Object.hasOwn(input, 'options') ? ['options', 'construction'] : ['construction']);
  const construction = validateSourceNativeSemanticConstruction(input.construction);
  if (construction.objectDefs.length === 0) fail('EMPTY');
  const itemCount = construction.objectDefs.reduce((count, item) => count + 1 + item.aliases.length, construction.claims.length);
  if (itemCount > MAX_ITEMS) fail('LIMIT');
  const sourceRefs = new Set([
    ...construction.objectDefs.flatMap(item => [item.source, ...item.aliases.map(alias => alias.source)]),
    ...construction.claims.map(item => item.source),
  ].map(source => source.evidence.sourceRef));
  if (sourceRefs.size > 32) fail('LIMIT');
  const state = openProductState(input.options ?? {});
  assertSemanticConstructionBound(construction, state);
  const nativeObjects = new Map(state.objectOnt.map.nativeObjects.map(item => [item.nativeObjectSha256, item.objectIdentity]));
  const definitions = new Map(construction.objectDefs.map(item => [item.id, item]));
  const items: SourceNativeConstructionReviewItem[] = [];
  const add = (kind: SourceNativeConstructionReviewItem['kind'], objectDefId: string,
    source: SourceNativeSemanticWitness, alias: SourceNativeConstructionReviewItem['alias'] = null,
    claimId: string | null = null): void => {
    const core = { kind, objectDefId, name: definitions.get(objectDefId)?.name ?? fail('BINDING'),
      alias, claimId, nativeObject: nativeObjects.get(source.nativeObjectSha256) ?? fail('BINDING'), source };
    items.push({ ...core, itemSha256: stableObjectSha256(core) });
  };
  for (const definition of construction.objectDefs) {
    add('preferred-name', definition.id, definition.source);
    for (const alias of definition.aliases) add('scoped-alias', definition.id, alias.source,
      { value: alias.value, sourceSystem: alias.sourceSystem });
  }
  for (const claim of construction.claims) add(claim.predicate, claim.about, claim.source, null, claim.id);
  const sources: SourceNativeSource[] = state.objectOnt.sources.filter(source => sourceRefs.has(source.relativePath))
    .map(source => ({ relativePath: source.relativePath, sourceType: source.sourceType, occurredAt: source.occurredAt,
      sourceSha256: source.sourceSha256, content: source.content }));
  sources.sort((a, b) => compare(a.relativePath, b.relativePath));
  if (sources.reduce((bytes, source) => bytes + Buffer.byteLength(source.content), 0) > 256 * 1024) fail('LIMIT');
  const core = { schemaVersion: 1 as const, kind: 'OpenOntologyConstructionReviewPacketV1' as const,
    constructionSha256: construction.constructionSha256, sourceBinding: construction.sourceBinding,
    coverage: construction.coverage, items, sources, navigationOnly: true as const, exactSourcesRemainAuthority: true as const };
  const packet: SourceNativeConstructionReviewPacket = freeze({ ...core, packetSha256: stableObjectSha256(core) });
  boundedJson(packet);
  const itemsByHash = new Map(items.map(item => [item.itemSha256, item]));
  const sourcesByRef = new Map(sources.map(source => [source.relativePath, source]));
  const responseSchema = freeze({
    type: 'object',
    required: ['packetSha256', 'decisions'],
    additionalProperties: false,
    properties: {
      packetSha256: { type: 'string', enum: [packet.packetSha256] },
      decisions: {
        type: 'array', minItems: packet.items.length, maxItems: packet.items.length,
        items: {
          type: 'object',
          required: ['itemSha256', 'decision', 'reason', 'citations'],
          additionalProperties: false,
          properties: {
            itemSha256: { type: 'string', enum: packet.items.map(item => item.itemSha256) },
            decision: { type: 'string', enum: ['accept', 'reject', 'abstain'] },
            reason: { type: 'string', minLength: 1, maxLength: 2048, pattern: '\\S' },
            citations: {
              type: 'array', minItems: 1, maxItems: 8,
              items: {
                type: 'object',
                required: ['sourceRef', 'quote'],
                additionalProperties: false,
                properties: {
                  sourceRef: { type: 'string', enum: sources.map(source => source.relativePath) },
                  quote: { type: 'string', minLength: 1, maxLength: 4096, pattern: '\\S' },
                },
              },
            },
          },
        },
      },
    },
  });

  const evaluate = (response: unknown): SourceNativeConstructionSemanticReview => {
    const value = row(response, ['packetSha256', 'decisions']);
    if (hash(value.packetSha256) !== packet.packetSha256) fail('PACKET');
    const decisions = new Map<string, SourceNativeConstructionReviewDecision>();
    for (const raw of list(value.decisions, MAX_ITEMS)) {
      const decision = row(raw, ['itemSha256', 'decision', 'reason', 'citations']);
      const itemSha256 = hash(decision.itemSha256);
      const item = itemsByHash.get(itemSha256) ?? fail('ITEM');
      if (decisions.has(itemSha256)) fail('DUPLICATE');
      if (decision.decision !== 'accept' && decision.decision !== 'reject' && decision.decision !== 'abstain') fail('DECISION');
      const reason = text(decision.reason, 2048);
      const citations = list(decision.citations, 8).map(rawCitation => {
        const citation = row(rawCitation, ['sourceRef', 'quote']);
        const sourceRef = text(citation.sourceRef, 4096);
        const source = sourcesByRef.get(sourceRef) ?? fail('CITATION');
        const quote = text(citation.quote, 4096);
        if (!source.content.includes(quote)) fail('CITATION');
        return { sourceRef, quote };
      });
      if (!citations.some(citation => citation.sourceRef === item.source.evidence.sourceRef)) fail('CITATION');
      decisions.set(itemSha256, { itemSha256, decision: decision.decision, reason, citations });
    }
    if (decisions.size !== packet.items.length) fail('INCOMPLETE');
    const ordered = items.map(item => decisions.get(item.itemSha256) ?? fail('INCOMPLETE'));
    boundedJson({ packetSha256: packet.packetSha256, decisions: ordered });
    const acceptedItemCount = ordered.filter(item => item.decision === 'accept').length;
    const rejectedItemCount = ordered.filter(item => item.decision === 'reject').length;
    const abstainedItemCount = ordered.filter(item => item.decision === 'abstain').length;
    const disposition: SourceNativeConstructionSemanticReview['disposition'] = rejectedItemCount > 0
      ? 'rejected' : abstainedItemCount > 0 ? 'needs-review' : 'accepted';
    const result = { schemaVersion: 1 as const, kind: 'OpenOntologyConstructionSemanticReviewV1' as const,
      constructionSha256: construction.constructionSha256, packetSha256: packet.packetSha256,
      decisions: ordered, acceptedItemCount, rejectedItemCount, abstainedItemCount, disposition,
      admissionGranted: false as const, navigationOnly: true as const, exactSourcesRemainAuthority: true as const };
    return freeze({ ...result, reviewSha256: stableObjectSha256(result) });
  };
  return freeze({ packet, responseSchema, evaluate });
}
