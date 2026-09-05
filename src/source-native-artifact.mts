/** Build and reopen one immutable source-native Ont artifact. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  normalizeCanonicalObjectBackendUri,
  openCanonicalObjectBackend,
} from './canonical-object-backend.mjs';
import type { CanonicalObjectBackendEnvironment } from './canonical-object-backend.mjs';
import {
  objectBytesSha256,
  stableObjectSha256,
  stableObjectText,
} from './canonical-content.mjs';
import { openObjectOntStore } from './object-ont-store.mjs';
import {
  materializeSourceNativeObjectOnt,
  openSourceNativeObjectOntAtCut,
  openSourceNativeObjectOntIndex,
  openSourceNativeObjectOntRefAtCut,
  openSourceNativeObjectOntRefIndex,
} from './source-native-object-ont.mjs';
import { compileSourceNativeObjectMap } from './source-native-object-map.mjs';
import { normalizeSourceNativeQuerySchemas } from './source-native-query-planner.mjs';
import type {
  JsonObject,
  SourceNativeFieldInput,
  SourceNativeObjectInput,
  SourceNativeObjectMap,
  SourceNativeSourceInput,
  UnknownRecord,
} from './source-native-object-map.mjs';
import type { QuerySchema } from './source-native-query-planner.mjs';

const ARTIFACT_FILE = 'source-native.json';
const RESOURCE_FILE = 'source-native-resource.json';
const OBJECTS_DIRECTORY = 'objects';
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
interface ValidatedBuildInput {
  ontId: string;
  branch: string;
  namespace: string;
  querySchemas: QuerySchema[];
  sources: SourceNativeSourceInput[];
  nativeObjectInputs: SourceNativeObjectInput[];
  adapterDiagnostics: JsonObject[];
}
export interface Descriptor extends UnknownRecord {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeProductArtifactV1';
  ontId: string;
  branch: string;
  namespace: string;
  querySchemas: QuerySchema[];
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceCatalogSha256: string;
  nativeObjectMapSha256: string;
  objectBackend: string;
  artifactSha256: string;
}
export interface Resource extends UnknownRecord {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeProductResourceV1';
  ontId: string;
  branch: string;
  sourceHistoryAnchorCommitSha256: string;
  namespace: string;
  querySchemas: QuerySchema[];
  objectBackend: string;
  readOnly: true;
  canonicalTruthMutation: false;
  exactSourcesRemainAuthority: true;
  resourceSha256: string;
}
export interface SourceNativeProductResourceReceipt extends UnknownRecord {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeProductResourceReceiptV1';
  resourceRoot: string;
  resourceSha256: string;
  ontId: string;
  branch: string;
  sourceHistoryAnchorCommitSha256: string;
  objectBackend: string;
  replayed: boolean;
}
export interface SourceNativeProductResourceBindingReceipt extends UnknownRecord {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeProductResourceBindingReceiptV1';
  resourceSha256: string;
  artifactRoot: string;
  artifactSha256: string;
  ontId: string;
  branch: string;
  sourceHistoryAnchorCommitSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  replayMetadataSource: 'graph' | 'checkpoint';
  replayIndexCheckpointSha256: string | null;
  replayIndexCheckpointByteLength: number | null;
  refVersion: string;
  replayed: boolean;
  readOnly: true;
  exactSourcesRemainAuthority: true;
}
export interface ProductOptions {
  artifactRoot?: string;
  objectBackendUri?: string | null;
  objectBackendEnv?: CanonicalObjectBackendEnvironment;
}
interface NormalizedSource extends SourceNativeSourceInput {
  relativePath: string;
  content: string;
  sourceSha256: string;
  sourceType: string;
  occurredAt: string;
}
interface NormalizedField extends SourceNativeFieldInput {
  value: string;
  codeUnitStart: number;
}
interface NormalizedObject extends SourceNativeObjectInput {
  relativePath: string;
  fields: NormalizedField[];
}
export interface ObjectOnt {
  map: SourceNativeObjectMap;
  catalog: { sourceCatalogSha256: string; sourceCount: number };
  sources: Array<{ relativePath: string; occurredAt: string; content: string; sourceSha256: string }>;
  commitSha256: string;
  replaySha256: string;
}
export interface ProductSource extends UnknownRecord {
  sourceMessageId: number;
  ordinal: number;
  relativePath: string;
  occurredAt: string;
  content: string;
  contentSha256: string;
}
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const freeze = <T,>(value: T): T => {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isJsonValue = (value: unknown): value is import('./source-native-object-map.mjs').JsonValue =>
  value === null || typeof value === 'string' || typeof value === 'boolean'
  || typeof value === 'number' && Number.isFinite(value)
  || Array.isArray(value) && value.every(isJsonValue)
  || isRecord(value) && Object.values(value).every(isJsonValue);
const normalizeDiagnostics = (value: unknown): JsonObject[] => {
  if (!Array.isArray(value) || value.some((row) => !isRecord(row)
    || !Object.values(row).every(isJsonValue))) fail('SOURCE_NATIVE_PRODUCT_INPUT');
  return value as JsonObject[];
};

function exactDirectory(pathInput: unknown, { create = false }: { create?: boolean } = {}): string {
  if (typeof pathInput !== 'string' || !pathInput) fail('SOURCE_NATIVE_PRODUCT_ROOT');
  const exactPath = typeof pathInput === 'string'
    ? pathInput : fail('SOURCE_NATIVE_PRODUCT_ROOT');
  const root = resolve(exactPath);
  if (dirname(root) === root) fail('SOURCE_NATIVE_PRODUCT_ROOT');
  if (!existsSync(root)) {
    if (!create) fail('SOURCE_NATIVE_PRODUCT_ROOT');
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  const status = lstatSync(root);
  if (!status.isDirectory() || status.isSymbolicLink()) fail('SOURCE_NATIVE_PRODUCT_ROOT');
  return root;
}

function normalizeSources(input: unknown): NormalizedSource[] {
  if (!Array.isArray(input) || input.length < 1) fail('SOURCE_NATIVE_PRODUCT_SOURCES');
  const rows: unknown[] = Array.isArray(input) ? input : fail('SOURCE_NATIVE_PRODUCT_SOURCES');
  return freeze(rows.map((value: unknown) => {
    const source = isRecord(value) ? value : fail('SOURCE_NATIVE_PRODUCT_SOURCES');
    if (typeof source.content !== 'string' || !source.content) fail('SOURCE_NATIVE_PRODUCT_SOURCES');
    const content: string = typeof source.content === 'string' ? source.content
      : fail('SOURCE_NATIVE_PRODUCT_SOURCES');
    const sourceSha256 = objectBytesSha256(Buffer.from(content));
    if (source.sourceSha256 !== undefined && source.sourceSha256 !== sourceSha256) {
      fail('SOURCE_NATIVE_PRODUCT_SOURCES');
    }
    const relativePath = typeof source.relativePath === 'string' ? source.relativePath : '';
    const sourceType = typeof source.sourceType === 'string' ? source.sourceType : '';
    const occurredAt = typeof source.occurredAt === 'string' ? source.occurredAt : '';
    if (!relativePath || !sourceType || !occurredAt) fail('SOURCE_NATIVE_PRODUCT_SOURCES');
    return freeze({ ...source, sourceSha256,
      relativePath,
      content,
      sourceType,
      occurredAt,
    });
  }));
}

function normalizeNativeObjects(input: unknown, sources: NormalizedSource[]): NormalizedObject[] {
  if (!Array.isArray(input) || input.length < 1) fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
  const rows: unknown[] = Array.isArray(input) ? input : fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  return freeze(rows.map((value: unknown) => {
    const object = isRecord(value) ? value : fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
    const source = sourceByPath.get(typeof object.relativePath === 'string' ? object.relativePath : '');
    if (!source || !Array.isArray(object.fields) || object.fields.length < 1) {
      fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
    }
    const sourceRecord = source ?? fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
    const fields = (object.fields as unknown[]).map((fieldValue: unknown) => {
      const field = isRecord(fieldValue) ? fieldValue : fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
      if (typeof field.value !== 'string' || !field.value) fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
      const fieldText: string = typeof field.value === 'string'
        ? field.value : fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
      let codeUnitStart = typeof field.codeUnitStart === 'number' ? field.codeUnitStart : undefined;
      if (codeUnitStart === undefined) {
        codeUnitStart = sourceRecord.content.indexOf(fieldText);
        if (codeUnitStart < 0 || sourceRecord.content.indexOf(fieldText, codeUnitStart + 1) >= 0) {
          fail('SOURCE_NATIVE_PRODUCT_FIELD_AMBIGUOUS');
        }
      }
      const exactCodeUnitStart = codeUnitStart ?? fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
      return freeze({ ...field, value: fieldText, codeUnitStart: exactCodeUnitStart });
    });
    const relativePath = typeof object.relativePath === 'string' ? object.relativePath
      : fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
    return freeze({ ...object, relativePath, fields: freeze(fields) });
  }));
}

function validateBuildInput(input: unknown): ValidatedBuildInput {
  const buildInput = isRecord(input) ? input : fail('SOURCE_NATIVE_PRODUCT_INPUT');
  const ontId = typeof buildInput.ontId === 'string' ? buildInput.ontId : fail('SOURCE_NATIVE_PRODUCT_INPUT');
  const namespace = typeof buildInput.namespace === 'string' ? buildInput.namespace : fail('SOURCE_NATIVE_PRODUCT_INPUT');
  if (buildInput.schemaVersion !== 1 || buildInput.kind !== 'OpenOntologySourceNativeBuildInputV1'
    || !ontId || !namespace
    || buildInput.branch !== undefined && (typeof buildInput.branch !== 'string' || !buildInput.branch)) {
    fail('SOURCE_NATIVE_PRODUCT_INPUT');
  }
  let querySchemas: QuerySchema[] = [];
  try { querySchemas = normalizeSourceNativeQuerySchemas(buildInput.querySchemas); } catch {
    fail('SOURCE_NATIVE_PRODUCT_SCHEMAS');
  }
  const sources = normalizeSources(buildInput.sources);
  const nativeObjectInputs = normalizeNativeObjects(buildInput.nativeObjectInputs, sources);
  if (nativeObjectInputs.some((object) => !isRecord(object.objectIdentity)
    || object.objectIdentity.namespace !== namespace)) {
    fail('SOURCE_NATIVE_PRODUCT_NAMESPACE');
  }
  const mappedPaths = new Set(nativeObjectInputs.map((object) => object.relativePath));
  if (mappedPaths.size !== sources.length
    || sources.some((source) => !mappedPaths.has(source.relativePath))) {
    fail('SOURCE_NATIVE_PRODUCT_INCOMPLETE_ADAPTER_COVERAGE');
  }
  return freeze({
    ontId,
    branch: typeof buildInput.branch === 'string' ? buildInput.branch : 'main',
    namespace,
    querySchemas,
    sources,
    nativeObjectInputs,
    adapterDiagnostics: normalizeDiagnostics(buildInput.adapterDiagnostics ?? []),
  });
}

function descriptorCore(input: { ontId: string; branch: string; namespace: string; querySchemas: QuerySchema[] }, receipt: { commitSha256: string; replaySha256: string; sourceCatalogSha256: string; nativeObjectMapSha256: string }, objectBackend: string): UnknownRecord {
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeProductArtifactV1',
    ontId: input.ontId,
    branch: input.branch,
    namespace: input.namespace,
    querySchemas: input.querySchemas,
    sourceCommitSha256: receipt.commitSha256,
    sourceReplaySha256: receipt.replaySha256,
    sourceCatalogSha256: receipt.sourceCatalogSha256,
    nativeObjectMapSha256: receipt.nativeObjectMapSha256,
    objectBackend,
    readOnly: true,
    canonicalTruthMutation: false,
    exactSourcesRemainAuthority: true,
  };
}

function validBackendDescriptor(value: unknown): value is string {
  if (value === `./${OBJECTS_DIRECTORY}`) return true;
  if (typeof value !== 'string') return false;
  try { return normalizeCanonicalObjectBackendUri(value) === value; } catch { return false; }
}

function productBackendDescriptor(root: string, canonicalUri: string): string {
  return canonicalUri === pathToFileURL(join(root, OBJECTS_DIRECTORY)).href
    ? `./${OBJECTS_DIRECTORY}` : canonicalUri;
}

function selectProductBackend({ root, descriptorBackend = null, requestedUri = null, env = process.env }: { root: string; descriptorBackend?: string | null; requestedUri?: string | null; env?: CanonicalObjectBackendEnvironment }) {
  const localUri = pathToFileURL(join(root, OBJECTS_DIRECTORY)).href;
  const configuredUri = requestedUri ?? (descriptorBackend === `./${OBJECTS_DIRECTORY}`
    || descriptorBackend === null ? localUri : descriptorBackend);
  const selected = openCanonicalObjectBackend({ uri: configuredUri, env });
  const storedDescriptor = selected.uri === localUri ? `./${OBJECTS_DIRECTORY}` : selected.uri;
  if (descriptorBackend !== null && storedDescriptor !== descriptorBackend) {
    fail('SOURCE_NATIVE_PRODUCT_BACKEND_CONFLICT');
  }
  return freeze({
    backend: selected.backend,
    descriptor: storedDescriptor,
    uri: selected.uri,
    capabilities: selected.capabilities,
  });
}

function resourceCore(descriptor: Descriptor, objectBackend: string): UnknownRecord {
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeProductResourceV1',
    ontId: descriptor.ontId,
    branch: descriptor.branch,
    sourceHistoryAnchorCommitSha256: descriptor.sourceCommitSha256,
    namespace: descriptor.namespace,
    querySchemas: descriptor.querySchemas,
    objectBackend,
    readOnly: true,
    canonicalTruthMutation: false,
    exactSourcesRemainAuthority: true,
  };
}

function validateResource(value: unknown): Resource {
  const record = isRecord(value) ? value : fail('SOURCE_NATIVE_PRODUCT_RESOURCE');
  const { resourceSha256, ...core } = record;
  const expectedKeys = [
    'branch',
    'canonicalTruthMutation',
    'exactSourcesRemainAuthority',
    'kind',
    'namespace',
    'objectBackend',
    'ontId',
    'querySchemas',
    'readOnly',
    'resourceSha256',
    'schemaVersion',
    'sourceHistoryAnchorCommitSha256',
  ].sort();
  if (Object.keys(record).sort().join('\0') !== expectedKeys.join('\0')
    || record.schemaVersion !== 1
    || record.kind !== 'OpenOntologySourceNativeProductResourceV1'
    || typeof record.ontId !== 'string' || !record.ontId
    || typeof record.branch !== 'string' || !record.branch
    || !SHA256.test(typeof record.sourceHistoryAnchorCommitSha256 === 'string'
      ? record.sourceHistoryAnchorCommitSha256 : '')
    || typeof record.namespace !== 'string' || !record.namespace
    || typeof record.objectBackend !== 'string'
    || record.objectBackend === `./${OBJECTS_DIRECTORY}`
    || !validBackendDescriptor(record.objectBackend)
    || record.readOnly !== true || record.canonicalTruthMutation !== false
    || record.exactSourcesRemainAuthority !== true
    || !SHA256.test(typeof resourceSha256 === 'string' ? resourceSha256 : '')
    || stableObjectSha256(core) !== resourceSha256) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE');
  }
  let querySchemas: QuerySchema[] = [];
  try { querySchemas = normalizeSourceNativeQuerySchemas(record.querySchemas); } catch {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE');
  }
  if (stableObjectText(querySchemas) !== stableObjectText(record.querySchemas as QuerySchema[])) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE');
  }
  return freeze(record as Resource);
}

export function validateSourceNativeProductResource(value: unknown): Resource {
  return validateResource(value);
}

function writeCreateOnce(path: string, bytes: Buffer, conflictCode: string): boolean {
  const existingMatches = (): boolean => {
    if (!existsSync(path)) return false;
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1
      || !readFileSync(path).equals(bytes)) fail(conflictCode);
    return true;
  };
  if (existingMatches()) return true;
  try {
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'EEXIST' && existingMatches()) return true;
    throw error;
  }
  return false;
}

function writeResource(root: string, resource: Resource): boolean {
  return writeCreateOnce(
    join(root, RESOURCE_FILE),
    Buffer.from(`${stableObjectText(resource)}\n`),
    'SOURCE_NATIVE_PRODUCT_RESOURCE_CONFLICT',
  );
}

function readResource(root: string): Resource {
  const path = join(root, RESOURCE_FILE);
  if (!existsSync(path)) fail('SOURCE_NATIVE_PRODUCT_RESOURCE');
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE');
  }
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE');
  }
  if (!isRecord(value)) fail('SOURCE_NATIVE_PRODUCT_RESOURCE');
  return validateResource(value as UnknownRecord);
}

function assertResourceProfile(resource: Resource, objectOnt: { map: SourceNativeObjectMap }): void {
  const schemas = new Map(resource.querySchemas.map((schema) => [
    `${schema.sourceSystem}\0${schema.objectType}`,
    new Set(schema.fields.map((field) => field.fieldPath)),
  ]));
  if (objectOnt.map.nativeObjects.some((object) => {
    const { sourceSystem, objectType, namespace } = object.objectIdentity;
    const fields = schemas.get(`${sourceSystem}\0${objectType}`);
    return namespace !== resource.namespace || !fields
      || object.fields.some((field) => !fields.has(field.fieldPath));
  })) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE_PROFILE');
  }
}

function validateDescriptor(value: UnknownRecord): Descriptor {
  const { artifactSha256, ...core } = value ?? {};
  const sourceCommitSha256 = typeof value.sourceCommitSha256 === 'string' ? value.sourceCommitSha256 : '';
  const sourceReplaySha256 = typeof value.sourceReplaySha256 === 'string' ? value.sourceReplaySha256 : '';
  const sourceCatalogSha256 = typeof value.sourceCatalogSha256 === 'string' ? value.sourceCatalogSha256 : '';
  const nativeObjectMapSha256 = typeof value.nativeObjectMapSha256 === 'string' ? value.nativeObjectMapSha256 : '';
  const artifactHash = typeof artifactSha256 === 'string' ? artifactSha256 : '';
  if (value?.schemaVersion !== 1 || value.kind !== 'OpenOntologySourceNativeProductArtifactV1'
    || typeof value.ontId !== 'string' || !value.ontId
    || typeof value.branch !== 'string' || !value.branch
    || typeof value.namespace !== 'string' || !value.namespace
    || !SHA256.test(sourceCommitSha256)
    || !SHA256.test(sourceReplaySha256)
    || !SHA256.test(sourceCatalogSha256)
    || !SHA256.test(nativeObjectMapSha256)
    || !validBackendDescriptor(value.objectBackend)
    || value.readOnly !== true || value.canonicalTruthMutation !== false
    || value.exactSourcesRemainAuthority !== true
    || !SHA256.test(artifactHash) || stableObjectSha256(core) !== artifactHash) {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  }
  if (!Array.isArray(value.querySchemas)) fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  try { normalizeSourceNativeQuerySchemas(value.querySchemas); } catch {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  }
  return freeze(value as Descriptor);
}

function writeDescriptor(root: string, descriptor: Descriptor): boolean {
  return writeCreateOnce(
    join(root, ARTIFACT_FILE),
    Buffer.from(`${stableObjectText(descriptor)}\n`),
    'SOURCE_NATIVE_PRODUCT_ARTIFACT_CONFLICT',
  );
}

function readDescriptor(root: string): Descriptor {
  const path = join(root, ARTIFACT_FILE);
  if (!existsSync(path)) fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  }
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { fail('SOURCE_NATIVE_PRODUCT_ARTIFACT'); }
  return validateDescriptor(value);
}

/** Read and validate one immutable source-cut artifact descriptor. */
export function readSourceNativeProductArtifactDescriptor({ artifactRoot }: { artifactRoot?: string } = {}): Descriptor {
  return readDescriptor(exactDirectory(artifactRoot));
}

interface ResourceCreateOptions {
  artifactRoot?: string;
  resourceRoot?: string;
  objectBackendEnv?: CanonicalObjectBackendEnvironment;
}
interface ResourceBindOptions {
  resourceRoot?: string;
  artifactRoot?: string;
  expectedSourceCommitSha256?: string | null;
  objectBackendEnv?: CanonicalObjectBackendEnvironment;
}

export function createSourceNativeProductResource({
  artifactRoot,
  resourceRoot,
  objectBackendEnv = process.env,
}: ResourceCreateOptions = {}): SourceNativeProductResourceReceipt {
  const sourceRoot = exactDirectory(artifactRoot);
  const targetRoot = exactDirectory(resourceRoot, { create: true });
  const descriptor = readDescriptor(sourceRoot);
  const selectedBackend = selectProductBackend({
    root: sourceRoot,
    descriptorBackend: descriptor.objectBackend,
    env: objectBackendEnv,
  });
  const objectOnt = openSourceNativeObjectOntIndex({
    backend: selectedBackend.backend,
    ontId: descriptor.ontId,
    commitSha256: descriptor.sourceCommitSha256,
  });
  if (objectOnt.replaySha256 !== descriptor.sourceReplaySha256
    || objectOnt.map.nativeObjectMapSha256 !== descriptor.nativeObjectMapSha256
    || objectOnt.catalog.sourceCatalogSha256 !== descriptor.sourceCatalogSha256) {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  }
  const core = resourceCore(descriptor, selectedBackend.uri);
  const resource = validateResource({ ...core, resourceSha256: stableObjectSha256(core) });
  assertResourceProfile(resource, objectOnt);
  const replayed = writeResource(targetRoot, resource);
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeProductResourceReceiptV1',
    resourceRoot: targetRoot,
    resourceSha256: resource.resourceSha256,
    ontId: resource.ontId,
    branch: resource.branch,
    sourceHistoryAnchorCommitSha256: resource.sourceHistoryAnchorCommitSha256,
    objectBackend: resource.objectBackend,
    replayed,
  });
}

export function bindSourceNativeProductResource({
  resourceRoot,
  artifactRoot,
  expectedSourceCommitSha256 = null,
  objectBackendEnv = process.env,
}: ResourceBindOptions = {}): SourceNativeProductResourceBindingReceipt {
  if (expectedSourceCommitSha256 !== null
    && (typeof expectedSourceCommitSha256 !== 'string'
      || !SHA256.test(expectedSourceCommitSha256))) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE_BIND');
  }
  const sourceRoot = exactDirectory(resourceRoot);
  const targetRoot = exactDirectory(artifactRoot, { create: true });
  const resource = readResource(sourceRoot);
  const selectedBackend = openCanonicalObjectBackend({
    uri: resource.objectBackend,
    env: objectBackendEnv,
  });
  const branchCut = openSourceNativeObjectOntRefIndex({
    backend: selectedBackend.backend,
    ontId: resource.ontId,
    branch: resource.branch,
  });
  if (branchCut === null) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE_REF');
  }
  const selectedCut = branchCut ?? fail('SOURCE_NATIVE_PRODUCT_RESOURCE_REF');
  if (expectedSourceCommitSha256 !== null
    && selectedCut.ref.commitSha256 !== expectedSourceCommitSha256) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE_REF');
  }
  if (!selectedCut.commitOrder.includes(resource.sourceHistoryAnchorCommitSha256)) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE_HISTORY');
  }
  const { objectOnt } = selectedCut;
  if (objectOnt.replaySha256 !== selectedCut.ref.replaySha256) {
    fail('SOURCE_NATIVE_PRODUCT_RESOURCE_REF');
  }
  assertResourceProfile(resource, objectOnt);
  const core = descriptorCore(resource, {
    commitSha256: objectOnt.commitSha256,
    replaySha256: objectOnt.replaySha256,
    sourceCatalogSha256: objectOnt.catalog.sourceCatalogSha256,
    nativeObjectMapSha256: objectOnt.map.nativeObjectMapSha256,
  }, productBackendDescriptor(targetRoot, selectedBackend.uri));
  const descriptor = validateDescriptor({ ...core, artifactSha256: stableObjectSha256(core) });
  const replayed = writeDescriptor(targetRoot, descriptor);
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeProductResourceBindingReceiptV1',
    resourceSha256: resource.resourceSha256,
    artifactRoot: targetRoot,
    artifactSha256: descriptor.artifactSha256,
    ontId: resource.ontId,
    branch: resource.branch,
    sourceHistoryAnchorCommitSha256: resource.sourceHistoryAnchorCommitSha256,
    sourceCommitSha256: objectOnt.commitSha256,
    sourceReplaySha256: objectOnt.replaySha256,
    replayMetadataSource: selectedCut.replayMetadataSource,
    replayIndexCheckpointSha256: selectedCut.replayIndexCheckpointSha256,
    replayIndexCheckpointByteLength: selectedCut.replayIndexCheckpointByteLength,
    refVersion: selectedCut.version,
    replayed,
    readOnly: true,
    exactSourcesRemainAuthority: true,
  });
}

function openProductArtifactState({ artifactRoot, objectBackendUri = null,
  objectBackendEnv = process.env }: ProductOptions = {}, requireCurrentRef: boolean) {
  const root = exactDirectory(artifactRoot);
  const descriptor = readDescriptor(root);
  const selectedBackend = selectProductBackend({
    root,
    descriptorBackend: descriptor.objectBackend,
    requestedUri: objectBackendUri,
    env: objectBackendEnv,
  });
  const { backend } = selectedBackend;
  const store = openObjectOntStore({ backend });
  let selectedCut: ReturnType<typeof openSourceNativeObjectOntAtCut>;
  if (requireCurrentRef) {
    selectedCut = openSourceNativeObjectOntRefAtCut({
      backend,
      ontId: descriptor.ontId,
      branch: descriptor.branch,
      expectedCommitSha256: descriptor.sourceCommitSha256,
      expectedReplaySha256: descriptor.sourceReplaySha256,
    }) ?? fail('SOURCE_NATIVE_PRODUCT_REF');
  } else {
    try {
      selectedCut = openSourceNativeObjectOntAtCut({
        backend,
        ontId: descriptor.ontId,
        commitSha256: descriptor.sourceCommitSha256,
        replaySha256: descriptor.sourceReplaySha256,
      });
    } catch (error: unknown) {
      if (isRecord(error) && error.code === 'SOURCE_NATIVE_OBJECT_ONT_OPEN') {
        fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
      }
      throw error;
    }
  }
  const { objectOnt, replayMetadataSource, replayIndexCheckpointSha256,
    replayIndexCheckpointByteLength } = selectedCut;
  if (objectOnt.replaySha256 !== descriptor.sourceReplaySha256
    || objectOnt.map.nativeObjectMapSha256 !== descriptor.nativeObjectMapSha256
    || objectOnt.catalog.sourceCatalogSha256 !== descriptor.sourceCatalogSha256) {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  }
  return {
    descriptor,
    selectedBackend,
    backend,
    store,
    objectOnt,
    replayMetadataSource,
    replayIndexCheckpointSha256,
    replayIndexCheckpointByteLength,
  };
}

export function openProductState(options: ProductOptions = {}) {
  return openProductArtifactState(options, true);
}

/** Reopen and validate one immutable artifact cut without following its mutable branch ref. */
export function openExactProductArtifactState(options: ProductOptions = {}) {
  return openProductArtifactState(options, false);
}

export function productSources(objectOnt: ObjectOnt): ProductSource[] {
  return freeze(objectOnt.sources.map((source, index: number) => freeze({
    sourceMessageId: index + 1,
    ordinal: index + 1,
    relativePath: source.relativePath,
    occurredAt: source.occurredAt,
    content: source.content,
    contentSha256: source.sourceSha256,
  })));
}

export function buildSourceNativeProduct({ artifactRoot, input, objectBackendUri = null,
  objectBackendEnv = process.env }: ProductOptions & { input?: unknown } = {}) {
  const root = exactDirectory(artifactRoot, { create: true });
  const normalized = validateBuildInput(input);
  const expectedMap = compileSourceNativeObjectMap({
    sources: normalized.sources,
    nativeObjectInputs: normalized.nativeObjectInputs,
    adapterDiagnostics: normalized.adapterDiagnostics,
  });
  const descriptorPath = join(root, ARTIFACT_FILE);
  const existingDescriptor = existsSync(descriptorPath) ? readDescriptor(root) : null;
  if (existingDescriptor !== null
    && (existingDescriptor.ontId !== normalized.ontId
      || existingDescriptor.branch !== normalized.branch
      || existingDescriptor.namespace !== normalized.namespace
      || stableObjectText(existingDescriptor.querySchemas) !== stableObjectText(normalized.querySchemas)
      || existingDescriptor.nativeObjectMapSha256 !== expectedMap.nativeObjectMapSha256)) {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT_CONFLICT');
  }
  const selectedBackend = selectProductBackend({
    root,
    descriptorBackend: existingDescriptor?.objectBackend ?? null,
    requestedUri: objectBackendUri,
    env: objectBackendEnv,
  });
  const { backend } = selectedBackend;
  const current = openObjectOntStore({ backend }).readRefMetadata({
    ontId: normalized.ontId,
    branch: normalized.branch,
  });
  const built = materializeSourceNativeObjectOnt({
    backend,
    ontId: normalized.ontId,
    branch: normalized.branch,
    expectedVersion: current === null ? null : current.version,
    sources: normalized.sources,
    nativeObjectInputs: normalized.nativeObjectInputs,
    adapterDiagnostics: normalized.adapterDiagnostics,
  });
  const core = descriptorCore(normalized, built.receipt, selectedBackend.descriptor);
  const descriptor = validateDescriptor({ ...core, artifactSha256: stableObjectSha256(core) });
  writeDescriptor(root, descriptor);
  return freeze({
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeProductBuildResultV1',
    artifactRoot: root,
    artifactSha256: descriptor.artifactSha256,
    receipt: built.receipt,
  });
}

export const SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE = ARTIFACT_FILE;
export const SOURCE_NATIVE_PRODUCT_RESOURCE_FILE = RESOURCE_FILE;
