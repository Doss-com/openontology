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
import {
  objectBytesSha256,
  stableObjectSha256,
  stableObjectText,
} from './canonical-content.mjs';
import { openObjectOntStore } from './object-ont-store.mjs';
import {
  materializeSourceNativeObjectOnt,
  openSourceNativeObjectOnt,
} from './source-native-object-ont.mjs';
import { compileSourceNativeObjectMap } from './source-native-object-map.mjs';
import { normalizeSourceNativeQuerySchemas } from './source-native-query-planner.mjs';

const ARTIFACT_FILE = 'source-native.json';
const OBJECTS_DIRECTORY = 'objects';
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const fail = (code) => {
  const error = new TypeError(code);
  error.code = code;
  throw error;
};
const freeze = (value) => {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function exactDirectory(pathInput, { create = false } = {}) {
  if (typeof pathInput !== 'string' || !pathInput) fail('SOURCE_NATIVE_PRODUCT_ROOT');
  const root = resolve(pathInput);
  if (dirname(root) === root) fail('SOURCE_NATIVE_PRODUCT_ROOT');
  if (!existsSync(root)) {
    if (!create) fail('SOURCE_NATIVE_PRODUCT_ROOT');
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  const status = lstatSync(root);
  if (!status.isDirectory() || status.isSymbolicLink()) fail('SOURCE_NATIVE_PRODUCT_ROOT');
  return root;
}

function normalizeSources(input) {
  if (!Array.isArray(input) || input.length < 1) fail('SOURCE_NATIVE_PRODUCT_SOURCES');
  return freeze(input.map((source) => {
    if (typeof source?.content !== 'string' || !source.content) fail('SOURCE_NATIVE_PRODUCT_SOURCES');
    const sourceSha256 = objectBytesSha256(Buffer.from(source.content));
    if (source.sourceSha256 !== undefined && source.sourceSha256 !== sourceSha256) {
      fail('SOURCE_NATIVE_PRODUCT_SOURCES');
    }
    return freeze({ ...source, sourceSha256 });
  }));
}

function normalizeNativeObjects(input, sources) {
  if (!Array.isArray(input) || input.length < 1) fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  return freeze(input.map((object) => {
    const source = sourceByPath.get(object?.relativePath);
    if (!source || !Array.isArray(object.fields) || object.fields.length < 1) {
      fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
    }
    const fields = object.fields.map((field) => {
      if (typeof field?.value !== 'string' || !field.value) fail('SOURCE_NATIVE_PRODUCT_OBJECTS');
      let codeUnitStart = field.codeUnitStart;
      if (codeUnitStart === undefined) {
        codeUnitStart = source.content.indexOf(field.value);
        if (codeUnitStart < 0 || source.content.indexOf(field.value, codeUnitStart + 1) >= 0) {
          fail('SOURCE_NATIVE_PRODUCT_FIELD_AMBIGUOUS');
        }
      }
      return freeze({ ...field, codeUnitStart });
    });
    return freeze({ ...object, fields: freeze(fields) });
  }));
}

function validateBuildInput(input) {
  if (input?.schemaVersion !== 1 || input.kind !== 'OpenOntologySourceNativeBuildInputV1'
    || typeof input.ontId !== 'string' || !input.ontId
    || typeof input.namespace !== 'string' || !input.namespace
    || input.branch !== undefined && (typeof input.branch !== 'string' || !input.branch)) {
    fail('SOURCE_NATIVE_PRODUCT_INPUT');
  }
  let querySchemas;
  try { querySchemas = normalizeSourceNativeQuerySchemas(input.querySchemas); } catch {
    fail('SOURCE_NATIVE_PRODUCT_SCHEMAS');
  }
  const sources = normalizeSources(input.sources);
  const nativeObjectInputs = normalizeNativeObjects(input.nativeObjectInputs, sources);
  if (nativeObjectInputs.some((object) => object.objectIdentity?.namespace !== input.namespace)) {
    fail('SOURCE_NATIVE_PRODUCT_NAMESPACE');
  }
  const mappedPaths = new Set(nativeObjectInputs.map((object) => object.relativePath));
  if (mappedPaths.size !== sources.length
    || sources.some((source) => !mappedPaths.has(source.relativePath))) {
    fail('SOURCE_NATIVE_PRODUCT_INCOMPLETE_ADAPTER_COVERAGE');
  }
  return freeze({
    ontId: input.ontId,
    branch: input.branch ?? 'main',
    namespace: input.namespace,
    querySchemas,
    sources,
    nativeObjectInputs,
    adapterDiagnostics: input.adapterDiagnostics ?? [],
  });
}

function descriptorCore(input, receipt, objectBackend) {
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

function validBackendDescriptor(value) {
  if (value === `./${OBJECTS_DIRECTORY}`) return true;
  try { return normalizeCanonicalObjectBackendUri(value) === value; } catch { return false; }
}

function selectProductBackend({ root, descriptorBackend = null, requestedUri = null, env = process.env }) {
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
    capabilities: selected.capabilities,
  });
}

function validateDescriptor(value) {
  const { artifactSha256, ...core } = value ?? {};
  if (value?.schemaVersion !== 1 || value.kind !== 'OpenOntologySourceNativeProductArtifactV1'
    || typeof value.ontId !== 'string' || !value.ontId
    || typeof value.branch !== 'string' || !value.branch
    || typeof value.namespace !== 'string' || !value.namespace
    || !SHA256.test(value.sourceCommitSha256 ?? '')
    || !SHA256.test(value.sourceReplaySha256 ?? '')
    || !SHA256.test(value.sourceCatalogSha256 ?? '')
    || !SHA256.test(value.nativeObjectMapSha256 ?? '')
    || !validBackendDescriptor(value.objectBackend)
    || value.readOnly !== true || value.canonicalTruthMutation !== false
    || value.exactSourcesRemainAuthority !== true
    || !SHA256.test(artifactSha256 ?? '') || stableObjectSha256(core) !== artifactSha256) {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  }
  try { normalizeSourceNativeQuerySchemas(value.querySchemas); } catch {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  }
  return freeze(value);
}

function writeDescriptor(root, descriptor) {
  const path = join(root, ARTIFACT_FILE);
  const bytes = Buffer.from(`${stableObjectText(descriptor)}\n`);
  if (existsSync(path)) {
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1
      || !readFileSync(path).equals(bytes)) fail('SOURCE_NATIVE_PRODUCT_ARTIFACT_CONFLICT');
    return;
  }
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
}

function readDescriptor(root) {
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

export function openProductState({ artifactRoot, objectBackendUri = null,
  objectBackendEnv = process.env } = {}) {
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
  const ref = store.readRefMetadata({ ontId: descriptor.ontId, branch: descriptor.branch });
  if (ref === null || ref.ref.commitSha256 !== descriptor.sourceCommitSha256
    || ref.ref.replaySha256 !== descriptor.sourceReplaySha256) fail('SOURCE_NATIVE_PRODUCT_REF');
  const objectOnt = openSourceNativeObjectOnt({
    backend,
    ontId: descriptor.ontId,
    commitSha256: descriptor.sourceCommitSha256,
  });
  if (objectOnt.map.nativeObjectMapSha256 !== descriptor.nativeObjectMapSha256
    || objectOnt.catalog.sourceCatalogSha256 !== descriptor.sourceCatalogSha256) {
    fail('SOURCE_NATIVE_PRODUCT_ARTIFACT');
  }
  return { descriptor, selectedBackend, backend, store, objectOnt };
}

export function productSources(objectOnt) {
  return freeze(objectOnt.sources.map((source, index) => freeze({
    sourceMessageId: index + 1,
    ordinal: index + 1,
    relativePath: source.relativePath,
    occurredAt: source.occurredAt,
    content: source.content,
    contentSha256: source.sourceSha256,
  })));
}

export function buildSourceNativeProduct({ artifactRoot, input, objectBackendUri = null,
  objectBackendEnv = process.env } = {}) {
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
    expectedVersion: current?.version ?? null,
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
