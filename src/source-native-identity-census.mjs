/** Complete source-native identity census compilation and validation. */
import { stableObjectSha256, stableObjectText } from './canonical-content.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const compare = (left, right) => Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code) => { const error = new TypeError(code); error.code = code; throw error; };
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export function compileSourceNativeObjectIdentityCensus({
  namespace,
  sourceCatalogSha256,
  sourceHandles: sourceHandleInput,
  entries: entryInput,
  adapter,
  adapterSha256,
} = {}) {
  if (typeof namespace !== 'string' || !namespace
    || !SHA256.test(sourceCatalogSha256 ?? '')
    || !Array.isArray(sourceHandleInput) || sourceHandleInput.length < 1
    || !Array.isArray(entryInput) || entryInput.length !== sourceHandleInput.length
    || typeof adapter !== 'string' || !adapter || !SHA256.test(adapterSha256 ?? '')) {
    fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS_INPUT');
  }
  const sourceHandles = sourceHandleInput.map((row) => {
    if (!Number.isSafeInteger(row?.sourceMessageId) || row.sourceMessageId < 0
      || typeof row.relativePath !== 'string' || !row.relativePath) {
      fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS_SOURCE');
    }
    return { sourceMessageId: row.sourceMessageId, relativePath: row.relativePath };
  }).sort((left, right) => left.sourceMessageId - right.sourceMessageId
    || compare(left.relativePath, right.relativePath));
  if (new Set(sourceHandles.map((row) => row.sourceMessageId)).size !== sourceHandles.length
    || new Set(sourceHandles.map((row) => row.relativePath)).size !== sourceHandles.length) {
    fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS_SOURCE');
  }
  const handleById = new Map(sourceHandles.map((row) => [row.sourceMessageId, row]));
  const entries = entryInput.map((row) => {
    const handle = handleById.get(row?.sourceMessageId);
    const identities = (row?.objectIdentities ?? []).map((identity) => {
      if (typeof identity?.sourceSystem !== 'string' || !identity.sourceSystem
        || typeof identity.objectType !== 'string' || !identity.objectType
        || typeof identity.externalId !== 'string' || !identity.externalId) {
        fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS_SOURCE');
      }
      return { sourceSystem: identity.sourceSystem, objectType: identity.objectType,
        externalId: identity.externalId };
    }).sort((left, right) => compare(stableObjectText(left), stableObjectText(right)));
    if (!handle || handle.relativePath !== row.relativePath || !SHA256.test(row.contentSha256 ?? '')
      || !Array.isArray(row.objectIdentities)
      || new Set(identities.map((identity) => stableObjectText(identity))).size !== identities.length) {
      fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS_SOURCE');
    }
    return freeze({
      sourceMessageId: row.sourceMessageId,
      relativePath: row.relativePath,
      contentSha256: row.contentSha256,
      objectIdentities: freeze(identities),
    });
  }).sort((left, right) => left.sourceMessageId - right.sourceMessageId);
  if (new Set(entries.map((row) => row.sourceMessageId)).size !== sourceHandles.length) {
    fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS_SOURCE');
  }
  const identityGroups = new Map();
  for (const row of entries) for (const identity of row.objectIdentities) {
    const key = stableObjectText(identity);
    const group = identityGroups.get(key) ?? { identity, sourceMessageIds: [] };
    group.sourceMessageIds.push(row.sourceMessageId);
    identityGroups.set(key, group);
  }
  const objectIdentities = freeze([...identityGroups.values()]
    .sort((left, right) => compare(stableObjectText(left.identity), stableObjectText(right.identity)))
    .map((row) => freeze({
      ...row.identity,
      identitySha256: stableObjectSha256({ namespace, ...row.identity }),
      sourceMessageIds: freeze([...row.sourceMessageIds].sort((left, right) => left - right)),
    })));
  const core = {
    schema: 1,
    kind: 'OpenOntologySourceNativeObjectIdentityCensusV1',
    namespace,
    sourceCatalogSha256,
    sourceHandleSetSha256: stableObjectSha256(sourceHandles),
    adapter,
    adapterSha256,
    sourceCount: sourceHandles.length,
    objectIdentityCount: objectIdentities.length,
    entries: freeze(entries),
    objectIdentities,
    coverageComplete: true,
    questionIndependent: true,
    modelCalls: 0,
    networkCalls: 0,
    targetLeakage: false,
    navigationOnly: true,
    exactSourcesRemainAuthority: true,
  };
  return freeze({ ...core, censusSha256: stableObjectSha256(core) });
}

export function validateSourceNativeObjectIdentityCensus(value) {
  const { censusSha256, ...core } = value ?? {};
  if (value?.kind !== 'OpenOntologySourceNativeObjectIdentityCensusV1'
    || !SHA256.test(censusSha256 ?? '') || stableObjectSha256(core) !== censusSha256
    || !Array.isArray(value.entries) || value.entries.length !== value.sourceCount
    || !Array.isArray(value.objectIdentities)
    || value.objectIdentities.length !== value.objectIdentityCount
    || value.coverageComplete !== true || value.questionIndependent !== true
    || value.modelCalls !== 0 || value.networkCalls !== 0 || value.targetLeakage !== false
    || value.navigationOnly !== true || value.exactSourcesRemainAuthority !== true) {
    fail('SOURCE_NATIVE_OBJECT_IDENTITY_CENSUS');
  }
  return freeze(value);
}
