/** Public read-only source-native product runtime. */
import { objectBytesSha256, stableObjectSha256 } from './canonical-content.mjs';
import {
  openSourceNativeCurrentFieldResolver,
  openSourceNativeHistoricalFieldResolver,
} from './source-native-field-resolver.mjs';
import { openSourceNativeExactEvidenceSession } from './source-native-evidence-session.mjs';
import { openProductState, productSources } from './source-native-artifact.mjs';
import { compileProductQueryPlan, queryPlanner } from './source-native-query-plan.mjs';

const PRODUCT_OPTIONS = new Set(['artifactRoot', 'objectBackendUri', 'objectBackendEnv']);
const MAXIMUM_OFFERED_REFERENCES = 1024;
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

export {
  buildSourceNativeProduct,
  SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE,
} from './source-native-artifact.mjs';

function productResult({ descriptor, objectOnt, intent, plan, resolution = null, matches = [],
  verificationFields = {}, resultFields = {} }) {
  const availableFields = matches.length > 0 ? [] : descriptor.querySchemas.flatMap((schema) =>
    schema.fields.map((field) => freeze({
      sourceSystem: schema.sourceSystem,
      objectType: schema.objectType,
      fieldPath: field.fieldPath,
      aliases: field.aliases,
    })));
  const core = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeProductSearchResultV2',
    state: resolution?.state ?? plan.state,
    intent,
    query: plan.query,
    mentionedExternalIds: plan.mentionedExternalIds,
    unresolvedExternalIds: plan.unresolvedExternalIds,
    selectionMode: resolution?.selectionMode ?? null,
    matches: freeze(matches),
    availableFields: freeze(availableFields),
    verification: freeze({
      artifactSha256: descriptor.artifactSha256,
      nativeObjectMapSha256: objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: objectOnt.commitSha256,
      sourceReplaySha256: objectOnt.replaySha256,
      queryPlanSha256: plan.planSha256,
      searchPathSha256: resolution?.searchPath?.searchPathSha256 ?? null,
      resolutionSha256: resolution?.resultSha256 ?? null,
      navigationProposals: resolution?.navigationProposals ?? null,
      ...verificationFields,
    }),
    policy: freeze({
      navigationOnly: true,
      exactReadRequired: true,
      exactSourcesRemainAuthority: true,
      canonicalTruthMutation: false,
    }),
    ...resultFields,
  };
  return freeze({ ...core, resultSha256: stableObjectSha256(core) });
}

export function openSourceNativeProductRuntime(options = {}, createLifecycleAdapter = null) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((name) => !PRODUCT_OPTIONS.has(name))) {
    fail('SOURCE_NATIVE_PRODUCT_OPTIONS');
  }
  const {
    artifactRoot,
    objectBackendUri = null,
    objectBackendEnv = process.env,
  } = options;
  if (createLifecycleAdapter !== null && typeof createLifecycleAdapter !== 'function') {
    fail('SOURCE_NATIVE_PRODUCT_LIFECYCLE_ADAPTER');
  }
  const { descriptor, selectedBackend, backend, store, objectOnt } = openProductState({
    artifactRoot, objectBackendUri, objectBackendEnv,
  });
  const sources = productSources(objectOnt);
  const sourceById = new Map(sources.map((source) => [source.sourceMessageId, source]));
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  const retrievalAdapterSha256 = stableObjectSha256({ adapter: 'source-native-product-bm25-v1' });
  const session = openSourceNativeExactEvidenceSession({
    namespace: descriptor.namespace,
    nativeObjectMapSha256: objectOnt.map.nativeObjectMapSha256,
    objectOnt,
    sources,
    tokenize: (value) => String(value).normalize('NFKC').toLocaleLowerCase('en-US')
      .split(/[^\p{L}\p{N}]+/gu).filter(Boolean),
    retrievalAdapter: 'source-native-product-bm25-v1',
    retrievalAdapterSha256,
    maximumSearchResults: 4,
  });
  const offered = new Map();

  const rememberOffer = (evidenceRef, offer) => {
    if (!offered.has(evidenceRef) && offered.size >= MAXIMUM_OFFERED_REFERENCES) {
      offered.delete(offered.keys().next().value);
    }
    offered.set(evidenceRef, offer);
  };

  const prepareSearch = ({ question, intent = 'current', anchorValue = null,
    typedQuery = null } = {}) => {
    if (typeof question !== 'string' || !question.trim()
      || !['current', 'next'].includes(intent)
      || anchorValue !== null && typeof anchorValue !== 'string') {
      fail('SOURCE_NATIVE_PRODUCT_SEARCH');
    }
    const exactAnchorValue = typeof anchorValue === 'string' && anchorValue.trim()
      ? anchorValue.trim() : null;
    const plan = compileProductQueryPlan({
      question,
      namespace: descriptor.namespace,
      querySchemas: descriptor.querySchemas,
      map: objectOnt.map,
      intent,
      anchorValue: exactAnchorValue,
      typedQuery,
    });
    return { question, intent, anchorValue: exactAnchorValue, typedQuery, plan };
  };

  const forgetOffers = (activityId) => {
    for (const [evidenceRef, offer] of offered) {
      if (offer.activityId === activityId) offered.delete(evidenceRef);
    }
  };
  const lifecycle = createLifecycleAdapter?.({
    descriptor,
    selectedBackend,
    backend,
    store,
    objectOnt,
    sources,
    session,
    prepareSearch,
    forgetOffers,
  }) ?? null;
  const seedSearchAdapter = lifecycle?.seedSearchAdapter
    ?? session.sourceNativeSeedSearchAdapter;

  const search = async (input = {}) => {
    const { investigationId = null, ...searchInput } = input;
    const prepared = prepareSearch(searchInput);
    const { question, intent, plan } = prepared;
    if (lifecycle === null && investigationId !== null) fail('SOURCE_NATIVE_PRODUCT_SEARCH');
    const startReceipt = lifecycle?.beginSearch(prepared, investigationId) ?? null;
    if (plan.state !== 'resolved-native-field-query'
      || intent === 'next' && plan.query.externalId === undefined) {
      const activity = lifecycle?.recordSearch({
        question, intent, plan, startReceipt,
      }) ?? null;
      const result = productResult({
        descriptor,
        objectOnt,
        intent,
        plan,
        verificationFields: lifecycle?.verificationMetadata(null) ?? {},
        resultFields: lifecycle?.resultMetadata(activity) ?? {},
      });
      lifecycle?.bindResult(activity, result);
      return result;
    }
    const common = {
      sourceNativeObjectMap: objectOnt.map,
      sourceHandles: session.sourceHandles,
      namespace: descriptor.namespace,
      sourceCommitSha256: session.sourceCommitSha256,
      sourceReplaySha256: session.sourceReplaySha256,
      sourceSearchRouteMapSha256: session.sourceSearchRouteMapSha256,
      seedSearchAdapter: plan.query.externalId === undefined
        ? session.sourceNativeSeedSearchAdapter : seedSearchAdapter,
      maximumSeedSourceMessages: 4,
      queryPlanner: queryPlanner({ namespace: descriptor.namespace, plan }),
    };
    const resolver = intent === 'current'
      ? openSourceNativeCurrentFieldResolver({
        ...common,
        sourceCatalogSha256: session.sourceCatalogSha256,
      })
      : openSourceNativeHistoricalFieldResolver({
        ...common,
        exactSourceAvailabilitySnapshot: session.exactSourceAvailabilitySnapshot,
    });
    const resolution = await resolver.search({ question, maximumSourceMessages: 4 });
    const activity = lifecycle?.recordSearch({
      question, intent, plan, startReceipt, resolution,
    }) ?? null;
    const references = resolution.evidenceUnits.flatMap((unit) =>
      unit.exactEvidenceReferences.map((reference) => ({ role: 'answer', reference })));
    if (intent === 'next' && resolution.state === 'resolved-next-field-revision') {
      const revision = objectOnt.map.fieldRevisions.find((row) =>
        row.revisionSha256 === resolution.searchPath?.revisionSha256);
      const source = revision === undefined
        ? null : sourceByPath.get(revision.targetField.evidence.relativePath);
      if (!revision || !source) fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
      references.push({
        role: 'anchor',
        reference: {
          sourceMessageId: source.sourceMessageId,
          relativePath: source.relativePath,
          sourceSha256: revision.targetField.evidence.sourceSha256,
          byteStart: revision.targetField.evidence.byteStart,
          byteEnd: revision.targetField.evidence.byteEnd,
          textSha256: revision.targetField.evidence.textSha256,
          fieldSha256: revision.targetField.fieldSha256,
          fieldPath: revision.fieldPath,
          propositionFamilyKey: revision.targetField.propositionFamilyKey ?? revision.fieldPath,
        },
      });
    }
    const matches = references.map(({ role, reference }) => {
      const source = sourceById.get(reference.sourceMessageId);
      if (!source || source.relativePath !== reference.relativePath) {
        fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
      }
      const activityFields = lifecycle?.referenceMetadata(activity) ?? {};
      const evidenceRef = `evidence:${stableObjectSha256({
        sourceCommitSha256: objectOnt.commitSha256,
        resultSha256: resolution.resultSha256,
        sourceMessageId: reference.sourceMessageId,
        fieldSha256: reference.fieldSha256,
        role,
        ...activityFields,
      }).slice(7)}`;
      rememberOffer(evidenceRef, freeze({
        resolution,
        role,
        reference,
        source,
        activityId: lifecycle?.activityId(activity) ?? null,
      }));
      return freeze({
        ref: evidenceRef,
        role,
        requiredForProof: true,
        relativePath: reference.relativePath,
        occurredAt: source.occurredAt,
        fieldPath: reference.fieldPath,
        propositionFamilyKey: reference.propositionFamilyKey,
        sourceSha256: reference.sourceSha256,
        fieldSha256: reference.fieldSha256,
      });
    });
    const result = productResult({
      descriptor,
      objectOnt,
      intent,
      plan,
      resolution,
      matches,
      verificationFields: lifecycle?.verificationMetadata(resolution) ?? {},
      resultFields: lifecycle?.resultMetadata(activity) ?? {},
    });
    lifecycle?.bindResult(activity, result);
    return result;
  };

  const read = async ({ ref: evidenceRef } = {}) => {
    const offeredEvidence = offered.get(evidenceRef);
    if (!offeredEvidence) fail('SOURCE_NATIVE_PRODUCT_READ');
    const { resolution, role, reference, source } = offeredEvidence;
    const bytes = Buffer.from(source.content);
    if (objectBytesSha256(bytes) !== source.contentSha256
      || reference.byteEnd > bytes.length || reference.byteStart < 0
      || reference.byteEnd <= reference.byteStart) fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const exactBytes = bytes.subarray(reference.byteStart, reference.byteEnd);
    if (objectBytesSha256(exactBytes) !== reference.textSha256) {
      fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    }
    const object = objectOnt.map.nativeObjects.find((row) =>
      row.relativePath === reference.relativePath
      && row.fields.some((field) => field.fieldSha256 === reference.fieldSha256));
    if (!object) fail('SOURCE_NATIVE_PRODUCT_EVIDENCE');
    const resultFields = await lifecycle?.readEvidence({
      offeredEvidence,
      exactBytes,
      object,
    }) ?? {};
    const bindingCore = {
      schemaVersion: 1,
      kind: 'OpenOntologyVerifiedSourceNativeFieldBindingV1',
      role,
      selectionMode: resolution.selectionMode,
      sourceSystem: object.objectIdentity.sourceSystem,
      objectType: object.objectIdentity.objectType,
      namespace: object.objectIdentity.namespace,
      externalId: object.objectIdentity.externalId,
      fieldPath: reference.fieldPath,
      fieldSha256: reference.fieldSha256,
      sourceSha256: reference.sourceSha256,
      resultSha256: resolution.resultSha256,
      searchPathSha256: resolution.searchPath?.searchPathSha256 ?? null,
      exactSourcesRemainAuthority: true,
    };
    const binding = freeze({ ...bindingCore, bindingSha256: stableObjectSha256(bindingCore) });
    const core = {
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeProductReadResultV1',
      ref: evidenceRef,
      exactText: exactBytes.toString('utf8'),
      evidence: freeze({
        relativePath: reference.relativePath,
        occurredAt: source.occurredAt,
        sourceSha256: reference.sourceSha256,
        byteStart: reference.byteStart,
        byteEnd: reference.byteEnd,
        textSha256: reference.textSha256,
      }),
      binding,
      sourceCommitSha256: objectOnt.commitSha256,
      sourceReplaySha256: objectOnt.replaySha256,
      immutable: true,
      exactSourcesRemainAuthority: true,
      canonicalTruthMutation: false,
      ...resultFields,
    };
    return freeze({ ...core, receiptSha256: stableObjectSha256(core) });
  };

  const verify = async (input = {}) => {
    const searchResult = await search(input);
    const reads = [];
    for (const match of searchResult.matches) {
      if (match.requiredForProof) reads.push(await read({ ref: match.ref }));
    }
    const context = reads.map((row) => freeze({
      role: row.binding.role,
      exactText: row.exactText,
      evidence: row.evidence,
      binding: row.binding,
    }));
    const completeProof = searchResult.matches.length > 0
      && searchResult.matches.filter((match) => match.requiredForProof).length === context.length;
    const core = {
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeVerificationV1',
      state: searchResult.state,
      answerable: completeProof,
      intent: searchResult.intent,
      query: searchResult.query,
      context: freeze(context),
      availableFields: searchResult.availableFields,
      verification: searchResult.verification,
      policy: searchResult.policy,
      ...(lifecycle?.verificationResult({ searchResult, reads, completeProof }) ?? {}),
    };
    return freeze({ ...core, verificationSha256: stableObjectSha256(core) });
  };

  return freeze({
    kind: 'OpenOntologySourceNativeProductV2',
    verify,
    search,
    read,
    ...(lifecycle?.methods ?? {}),
    status: () => freeze({
      schemaVersion: 1,
      kind: 'OpenOntologySourceNativeProductStatusV1',
      ontId: descriptor.ontId,
      branch: descriptor.branch,
      namespace: descriptor.namespace,
      sourceCount: objectOnt.catalog.sourceCount,
      nativeObjectCount: objectOnt.map.nativeObjectCount,
      fieldRevisionCount: objectOnt.map.fieldRevisionCount,
      artifactSha256: descriptor.artifactSha256,
      nativeObjectMapSha256: objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: objectOnt.commitSha256,
      sourceReplaySha256: objectOnt.replaySha256,
      sourceSearchRouteMapSha256: session.sourceSearchRouteMapSha256,
      objectBackend: descriptor.objectBackend,
      objectBackendCapabilities: selectedBackend.capabilities,
      canonicalTruthMutation: false,
      canonicalSourceReadOnly: true,
      readOnly: lifecycle?.readOnly ?? true,
      ...(lifecycle?.status() ?? {}),
    }),
  });
}

export function openSourceNativeProduct(options = {}) {
  return openSourceNativeProductRuntime(options);
}
