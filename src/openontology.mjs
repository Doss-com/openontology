/** Public SDK entrypoint over proof-closing OpenOntology products. */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  openSourceNativeProduct,
  SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE,
} from './source-native-product.mjs';

const fail = (code) => {
  const error = new TypeError(code);
  error.code = code;
  throw error;
};

function query(input) {
  if (typeof input === 'string') {
    if (!input.trim()) fail('OPENONTOLOGY_QUERY');
    return { question: input };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('OPENONTOLOGY_QUERY');
  }
  if (Object.keys(input).some((name) =>
    !['question', 'intent', 'anchorValue', 'scope'].includes(name))) {
    fail('OPENONTOLOGY_QUERY');
  }
  if (input.scope === undefined) return input;
  const { scope, ...rest } = input;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
    || Object.keys(scope).some((name) =>
      !['sourceSystem', 'objectType', 'externalId', 'field'].includes(name))
    || typeof scope.sourceSystem !== 'string' || !scope.sourceSystem
    || typeof scope.objectType !== 'string' || !scope.objectType
    || typeof scope.field !== 'string' || !scope.field
    || scope.externalId !== undefined
      && (typeof scope.externalId !== 'string' || !scope.externalId)) {
    fail('OPENONTOLOGY_QUERY');
  }
  return {
    ...rest,
    typedQuery: {
      sourceSystem: scope.sourceSystem,
      objectType: scope.objectType,
      fieldPath: scope.field,
      ...(scope.externalId === undefined ? {} : { externalId: scope.externalId }),
    },
  };
}

function reference(input) {
  if (typeof input === 'string') {
    if (!input) fail('OPENONTOLOGY_REFERENCE');
    return { ref: input };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 1 || typeof input.ref !== 'string' || !input.ref) {
    fail('OPENONTOLOGY_REFERENCE');
  }
  return input;
}

export function openOntology(options = {}) {
  const allowedOptions = new Set(['artifactRoot', 'objectBackendUri', 'objectBackendEnv']);
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((name) => !allowedOptions.has(name))) {
    fail('OPENONTOLOGY_OPTIONS');
  }
  if (typeof options?.artifactRoot !== 'string' || !options.artifactRoot) {
    fail('OPENONTOLOGY_OPTIONS');
  }
  const root = resolve(options.artifactRoot);
  if (!existsSync(join(root, SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE))) {
    fail('OPENONTOLOGY_ARTIFACT');
  }
  const product = openSourceNativeProduct(options);
  return Object.freeze({
    kind: 'OpenOntologyClientV2',
    verify: (input) => product.verify(query(input)),
    search: (input) => product.search(query(input)),
    read: (input) => product.read(reference(input)),
    status: () => product.status(),
  });
}
