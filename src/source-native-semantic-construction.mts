/** Source-bound semantic proposals. Compilation grants no review or proof authority. */
import { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';
import { openProductState } from './source-native-artifact.mjs';
import type { Descriptor, ProductOptions } from './source-native-artifact.mjs';
import type { ProofEvidenceReference } from './proof-authority-projection.mjs';

export interface SourceNativeSemanticWitness {
  nativeObjectSha256: string;
  evidence: ProofEvidenceReference;
}

export interface SourceNativeSemanticAlias {
  value: string;
  sourceSystem: string;
  source: SourceNativeSemanticWitness;
}

/** Bounded ObjectDef profile for concepts, not a general domain-schema authoring API. */
export interface SourceNativeSemanticObjectDef {
  kind: 'ObjectDef';
  id: string;
  name: string;
  source: SourceNativeSemanticWitness;
  aliases: readonly SourceNativeSemanticAlias[];
}

export interface SourceNativeSemanticClaim {
  kind: 'Claim';
  id: string;
  about: string;
  predicate: 'mentions' | 'defines';
  source: SourceNativeSemanticWitness;
}

export interface SourceNativeSemanticSourceResult {
  sourceRef: string;
  sourceSha256: string;
  disposition: 'examined' | 'unsupported' | 'failed';
}

export interface SourceNativeSemanticConstructionInput {
  proposedBy: string;
  proposedAt: string;
  method: 'authored' | 'deterministic' | 'agentic';
  objectDefs: readonly SourceNativeSemanticObjectDef[];
  claims: readonly SourceNativeSemanticClaim[];
  coverage: readonly SourceNativeSemanticSourceResult[];
}

export type SourceNativeSemanticSourceBinding = Pick<Descriptor,
  'ontId' | 'namespace' | 'artifactSha256' | 'sourceCommitSha256' | 'sourceReplaySha256'
  | 'sourceCatalogSha256' | 'nativeObjectMapSha256'>;

export interface SourceNativeSemanticConstruction
  extends Omit<SourceNativeSemanticConstructionInput, 'coverage'> {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeSemanticConstructionV1';
  sourceBinding: SourceNativeSemanticSourceBinding;
  coverage: {
    sourceCount: number;
    examinedSourceCount: number;
    unsupportedSourceCount: number;
    failedSourceCount: number;
    unexaminedSourceCount: number;
    sourceResults: readonly SourceNativeSemanticSourceResult[];
  };
  navigationOnly: true;
  reviewRequired: true;
  exactSourcesRemainAuthority: true;
  constructionSha256: string;
}

const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_PASSAGE_BYTES = 64 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const BINDING_KEYS = ['ontId', 'namespace', 'artifactSha256', 'sourceCommitSha256',
  'sourceReplaySha256', 'sourceCatalogSha256', 'nativeObjectMapSha256'];
type Row = Record<string, unknown>;
type State = ReturnType<typeof openProductState>;
export type SourceNativeSemanticConstructionBindingContext = Pick<State, 'descriptor' | 'objectOnt'>;

function fail(suffix: string): never {
  const code = `SEMANTIC_CONSTRUCTION_${suffix}`;
  throw Object.assign(new TypeError(code), { code });
}
function row(value: unknown, keys: readonly string[]): Row {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length
    || !Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key))) {
    fail('SHAPE');
  }
  return value as Row;
}
const text = (value: unknown, max = 256): string => typeof value === 'string'
  && value.length > 0 && value.length <= max && value.trim() === value
  && !/[\u0000-\u001f\u007f]/u.test(value)
  && Buffer.from(value).toString('utf8') === value ? value : fail('TEXT');
const hash = (value: unknown): string => typeof value === 'string' && SHA256.test(value)
  ? value : fail('HASH');
const id = (value: unknown): string => typeof value === 'string' && LOCAL_ID.test(value)
  ? value : fail('ID');
const count = (value: unknown): number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0 ? value : fail('COUNT');
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) fail('SHAPE');
  if (value.length > max) fail('LIMIT');
  return Array.from(value as unknown[]);
}
const compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
function unique<T>(values: T[], key: (value: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) fail('DUPLICATE');
  return values.sort((a, b) => compare(key(a), key(b)));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function witness(value: unknown): SourceNativeSemanticWitness {
  const source = row(value, ['nativeObjectSha256', 'evidence']);
  const reference = row(source.evidence,
    ['sourceRef', 'sourceSha256', 'byteStart', 'byteEnd', 'textSha256']);
  const byteStart = count(reference.byteStart);
  const byteEnd = count(reference.byteEnd);
  if (byteEnd <= byteStart || byteEnd - byteStart > MAX_PASSAGE_BYTES) fail('SPAN');
  return {
    nativeObjectSha256: hash(source.nativeObjectSha256),
    evidence: {
      sourceRef: text(reference.sourceRef, 2048),
      sourceSha256: hash(reference.sourceSha256),
      byteStart, byteEnd, textSha256: hash(reference.textSha256),
    },
  };
}

function normalizeInput(value: unknown): SourceNativeSemanticConstructionInput {
  const input = row(value, ['proposedBy', 'proposedAt', 'method', 'objectDefs', 'claims', 'coverage']);
  const proposedAt = text(input.proposedAt);
  if (!Number.isFinite(Date.parse(proposedAt))
    || new Date(proposedAt).toISOString() !== proposedAt) fail('TIME');
  const method = input.method;
  if (method !== 'authored' && method !== 'deterministic' && method !== 'agentic') fail('METHOD');
  const objectDefs = unique(list(input.objectDefs, 64).map((value): SourceNativeSemanticObjectDef => {
    const object = row(value, ['kind', 'id', 'name', 'source', 'aliases']);
    if (object.kind !== 'ObjectDef') fail('KIND');
    const aliases = unique(list(object.aliases, 16).map((value): SourceNativeSemanticAlias => {
      const alias = row(value, ['value', 'sourceSystem', 'source']);
      return { value: text(alias.value), sourceSystem: text(alias.sourceSystem),
        source: witness(alias.source) };
    }), (alias) => stableObjectText([alias.sourceSystem, alias.value]));
    return { kind: 'ObjectDef', id: id(object.id), name: text(object.name),
      source: witness(object.source), aliases };
  }), (object) => object.id);
  const objectIds = new Set(objectDefs.map((object) => object.id));
  const claims = unique(list(input.claims, 256).map((value): SourceNativeSemanticClaim => {
    const claim = row(value, ['kind', 'id', 'about', 'predicate', 'source']);
    if (claim.kind !== 'Claim') fail('KIND');
    const predicate = claim.predicate;
    if (predicate !== 'mentions' && predicate !== 'defines') fail('PREDICATE');
    const about = id(claim.about);
    if (!objectIds.has(about)) fail('ENDPOINT');
    const claimId = id(claim.id);
    if (objectIds.has(claimId)) fail('DUPLICATE');
    return { kind: 'Claim', id: claimId, about, predicate, source: witness(claim.source) };
  }), (claim) => claim.id);
  const coverage = unique(list(input.coverage, 512).map((value): SourceNativeSemanticSourceResult => {
    const result = row(value, ['sourceRef', 'sourceSha256', 'disposition']);
    const disposition = result.disposition;
    if (disposition !== 'examined' && disposition !== 'unsupported' && disposition !== 'failed') {
      fail('COVERAGE');
    }
    return { sourceRef: text(result.sourceRef, 2048), sourceSha256: hash(result.sourceSha256),
      disposition };
  }), (result) => result.sourceRef);
  return { proposedBy: text(input.proposedBy), proposedAt, method, objectDefs, claims, coverage };
}

function sourceBinding(value: unknown): SourceNativeSemanticSourceBinding {
  const binding = row(value, BINDING_KEYS);
  return {
    ontId: text(binding.ontId), namespace: text(binding.namespace),
    artifactSha256: hash(binding.artifactSha256),
    sourceCommitSha256: hash(binding.sourceCommitSha256),
    sourceReplaySha256: hash(binding.sourceReplaySha256),
    sourceCatalogSha256: hash(binding.sourceCatalogSha256),
    nativeObjectMapSha256: hash(binding.nativeObjectMapSha256),
  };
}

function bindingFor(state: SourceNativeSemanticConstructionBindingContext): SourceNativeSemanticSourceBinding {
  return sourceBinding(Object.fromEntries(BINDING_KEYS.map((key) => [key, state.descriptor[key]])));
}

function compile(input: SourceNativeSemanticConstructionInput,
  binding: SourceNativeSemanticSourceBinding, sourceCount: number): SourceNativeSemanticConstruction {
  if (input.coverage.length > sourceCount) fail('COVERAGE');
  const core = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologySourceNativeSemanticConstructionV1' as const,
    sourceBinding: binding,
    ...input,
    coverage: {
      sourceCount,
      examinedSourceCount: input.coverage.filter((item) => item.disposition === 'examined').length,
      unsupportedSourceCount: input.coverage.filter((item) => item.disposition === 'unsupported').length,
      failedSourceCount: input.coverage.filter((item) => item.disposition === 'failed').length,
      unexaminedSourceCount: sourceCount - input.coverage.length,
      sourceResults: input.coverage,
    },
    navigationOnly: true as const,
    reviewRequired: true as const,
    exactSourcesRemainAuthority: true as const,
  };
  const result = { ...core, constructionSha256: stableObjectSha256(core) };
  if (Buffer.byteLength(stableObjectText(result)) > MAX_RECORD_BYTES) fail('LIMIT');
  return freeze(result);
}

/** Structural validity only. Rebind before review or any later activation. */
export function validateSourceNativeSemanticConstruction(value: unknown): SourceNativeSemanticConstruction {
  const record = row(value, ['schemaVersion', 'kind', 'sourceBinding', 'proposedBy', 'proposedAt',
    'method', 'objectDefs', 'claims', 'coverage', 'navigationOnly', 'reviewRequired',
    'exactSourcesRemainAuthority', 'constructionSha256']);
  const coverage = row(record.coverage, ['sourceCount', 'examinedSourceCount',
    'unsupportedSourceCount', 'failedSourceCount', 'unexaminedSourceCount', 'sourceResults']);
  const expected = compile(normalizeInput({
    proposedBy: record.proposedBy, proposedAt: record.proposedAt, method: record.method,
    objectDefs: record.objectDefs, claims: record.claims, coverage: coverage.sourceResults,
  }), sourceBinding(record.sourceBinding), count(coverage.sourceCount));
  if (stableObjectText(record) !== stableObjectText(expected)) fail('RECORD');
  return expected;
}

/** Internal: callers validate the record before binding it to one safely opened snapshot. */
export function assertSemanticConstructionBound(
  record: SourceNativeSemanticConstruction,
  state: SourceNativeSemanticConstructionBindingContext,
): void {
  if (stableObjectText(record.sourceBinding) !== stableObjectText(bindingFor(state))
    || record.coverage.sourceCount !== state.objectOnt.catalog.sourceCount) fail('BINDING');
  const sources = new Map(state.objectOnt.sources.map((source) => [source.relativePath, source]));
  const objects = new Map(state.objectOnt.map.nativeObjects.map((object) => [object.nativeObjectSha256, object]));
  const systems = new Set(state.objectOnt.map.nativeObjects
    .filter((object) => object.objectIdentity.namespace === record.sourceBinding.namespace)
    .map((object) => object.objectIdentity.sourceSystem));
  const examined = new Set<string>();
  for (const result of record.coverage.sourceResults) {
    if (sources.get(result.sourceRef)?.sourceSha256 !== result.sourceSha256) fail('COVERAGE');
    if (result.disposition === 'examined') examined.add(result.sourceRef);
  }
  const checkedSources = new Map<string, Buffer>();
  const inspect = (witness: SourceNativeSemanticWitness): { text: string; system: string } => {
    const evidence = witness.evidence;
    const object = objects.get(witness.nativeObjectSha256);
    const source = sources.get(evidence.sourceRef);
    if (!object || !source || object.objectIdentity.namespace !== record.sourceBinding.namespace
      || object.relativePath !== evidence.sourceRef || object.sourceSha256 !== evidence.sourceSha256
      || source.sourceSha256 !== evidence.sourceSha256) fail('SOURCE');
    if (!object.fields.some((field) => field.evidence.relativePath === evidence.sourceRef
      && field.evidence.sourceSha256 === evidence.sourceSha256
      && field.evidence.byteStart <= evidence.byteStart
      && field.evidence.byteEnd >= evidence.byteEnd)) fail('SOURCE');
    if (!examined.has(evidence.sourceRef)) fail('COVERAGE');
    let bytes = checkedSources.get(evidence.sourceRef);
    if (!bytes) {
      bytes = Buffer.from(source.content);
      if (objectBytesSha256(bytes) !== evidence.sourceSha256) fail('SOURCE');
      checkedSources.set(evidence.sourceRef, bytes);
    }
    const exact = bytes.subarray(evidence.byteStart, evidence.byteEnd);
    const decoded = exact.toString('utf8');
    if (evidence.byteEnd > bytes.length || objectBytesSha256(exact) !== evidence.textSha256
      || !Buffer.from(decoded).equals(exact)) fail('EVIDENCE');
    return { text: decoded, system: object.objectIdentity.sourceSystem };
  };
  const byId = new Map(record.objectDefs.map((object) => [object.id, object]));
  for (const object of record.objectDefs) {
    if (!inspect(object.source).text.includes(object.name)) fail('NAME');
    for (const alias of object.aliases) {
      if (!systems.has(alias.sourceSystem)) fail('SCOPE');
      if (!inspect(alias.source).text.includes(alias.value)) fail('NAME');
    }
  }
  for (const claim of record.claims) {
    const object = byId.get(claim.about) ?? fail('ENDPOINT');
    const source = inspect(claim.source);
    const names = [object.name, ...object.aliases
      .filter((alias) => alias.sourceSystem === source.system).map((alias) => alias.value)];
    if (!names.some((name) => source.text.includes(name))) fail('ATTACHMENT');
  }
}

/** Compile against an actual source cut. This operation writes no objects or refs. */
export function compileSourceNativeSemanticConstruction({ options = {}, input }: {
  options?: ProductOptions;
  input: SourceNativeSemanticConstructionInput;
}): SourceNativeSemanticConstruction {
  const normalized = normalizeInput(input);
  const state = openProductState(options);
  const record = compile(normalized, bindingFor(state), state.objectOnt.catalog.sourceCount);
  assertSemanticConstructionBound(record, state);
  return record;
}

/** Reopen the source authority and exact bytes, without granting Admission. */
export function rebindSourceNativeSemanticConstruction({ options = {}, construction }: {
  options?: ProductOptions;
  construction: unknown;
}): SourceNativeSemanticConstruction {
  const record = validateSourceNativeSemanticConstruction(construction);
  assertSemanticConstructionBound(record, openProductState(options));
  return record;
}
