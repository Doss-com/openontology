import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  compileProofAuthorityProjection,
  compileProofSufficiencyContract,
  buildSourceNativeProduct,
  compileSourceNativeAdmittedKnowledgeBundle,
  compileSourceNativeAdmissionRecord,
  compileSourceNativeSemanticKnowledgeBundle,
  openSourceNativeProductRuntime,
  openSourceNativeProductWithAdmittedKnowledge,
  openProductState,
  proofAuthorityForProjection,
  sourceNativeAdmissionStatement,
  sourceNativeProposalStatement,
  stableObjectText,
  writeSourceNativeAdmittedKnowledge,
} from '../dist/src/kernel.mjs';
import { objectBytesSha256 } from '../dist/src/canonical-content.mjs';

function buildInput() {
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'admitted-knowledge-test',
    namespace: 'northwind',
    querySchemas: [{
      sourceSystem: 'linear',
      objectType: 'issue',
      aliases: ['issue'],
      fields: [{ fieldPath: 'status', aliases: ['status'] }],
    }],
    sources: [{
      relativePath: 'linear/northwind/issue-1.txt',
      sourceType: 'linear',
      occurredAt: '2026-09-04T12:00:00.000Z',
      content: 'Ready',
    }],
    nativeObjectInputs: [{
      relativePath: 'linear/northwind/issue-1.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'linear',
        objectType: 'issue',
        namespace: 'northwind',
        externalId: 'issue-1',
      },
      fields: [{ fieldPath: 'status', value: 'Ready' }],
    }],
  };
}

function buildSemanticInput({ stateModality = 'observed' } = {}) {
  const input = buildInput();
  input.querySchemas[0].fields.push({
    fieldPath: 'statusException', aliases: ['status exception'],
  });
  input.sources.push({
    relativePath: 'linear/northwind/issue-1-exception.txt',
    sourceType: 'linear',
    occurredAt: '2026-09-04T12:01:00.000Z',
    content: 'Manual approval absent',
  });
  input.nativeObjectInputs[0].businessEntityKeys = ['issue:issue-1'];
  input.nativeObjectInputs[0].fields[0] = {
    fieldPath: 'status', value: 'Ready', propositionFamilyKey: 'issue-status',
    businessEntityKeys: ['issue:issue-1'], validAt: '2026-09-04T11:59:00.000Z',
    knownAt: '2026-09-04T12:00:00.000Z',
    canonicalProposition: {
      kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
      propositionKey: 'issue-1-status-ready',
      actorHome: 'ObjectDef/InstanceRef',
      stateHome: 'Claim/PropositionRevision-payload',
      actorKind: 'issue', predicate: 'has-status', state: 'Ready',
      dimension: 'issue-status', canonicalRoles: ['state'],
      modality: stateModality, polarity: 'positive', businessEntityKeys: ['issue:issue-1'],
      extractionAuthority: 'deterministic-source-adapter-v1', relations: [],
    },
  };
  input.nativeObjectInputs.push({
    relativePath: 'linear/northwind/issue-1-exception.txt',
    objectIdentity: input.nativeObjectInputs[0].objectIdentity,
    businessEntityKeys: ['issue:issue-1'],
    fields: [{
      fieldPath: 'statusException', value: 'Manual approval absent',
      propositionFamilyKey: 'issue-status-exception',
      businessEntityKeys: ['issue:issue-1'], validAt: '2026-09-04T11:58:00.000Z',
      knownAt: '2026-09-04T12:01:00.000Z',
      canonicalProposition: {
        kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
        propositionKey: 'issue-1-manual-approval-absent',
        actorHome: 'ObjectDef/InstanceRef',
        stateHome: 'Claim/PropositionRevision-payload',
        actorKind: 'issue', predicate: 'has-status-exception',
        state: 'Manual approval absent', dimension: 'issue-status-exception',
        canonicalRoles: ['counterevidence'], modality: 'observed', polarity: 'negative',
        businessEntityKeys: ['issue:issue-1'],
        extractionAuthority: 'deterministic-source-adapter-v1',
        relations: [{
          kind: 'OpenOntologySourceNativePropositionRelationV1', type: 'qualifies',
          targetPropositionKey: 'issue-1-status-ready',
        }],
      },
    }],
  });
  return input;
}

function authorityFor(context, source = context.sources[0]) {
  const evidence = {
    sourceRef: source.relativePath,
    sourceSha256: source.contentSha256,
    byteStart: 0,
    byteEnd: Buffer.byteLength(source.content),
    textSha256: objectBytesSha256(Buffer.from(source.content)),
  };
  return compileProofAuthorityProjection({
    sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
    sourceProjectionSha256: objectBytesSha256(Buffer.from('projection-v1')),
    items: [{
      sourceProjectionItemId: 'status-current',
      familyId: 'issue-status',
      canonicalRoles: ['state'],
      modality: 'observed',
      polarity: 'positive',
      actorRef: 'linear:issue:northwind:issue-1',
      validAt: source.occurredAt,
      knownAt: source.occurredAt,
      exactEvidenceReferences: [evidence],
    }],
    relations: [],
  });
}

function contractFor(authority) {
  return compileProofSufficiencyContract({
    questionKind: 'current-issue-status',
    sourceProjectionAuthority: proofAuthorityForProjection(authority),
    sufficiencyRule: 'Close state, exact support, and complete invalidator census.',
    stopWhen: 'Every required obligation and authoritative relation census is closed.',
    obligations: [{
      obligationId: 'state',
      propositionFamily: 'state',
      role: 'support',
      required: true,
      relationshipAnyOf: [],
      description: 'Current status state.',
      expectedSourceProjectionItemIds: ['status-current'],
      minimumCount: 1,
    }, {
      obligationId: 'exact-support',
      propositionFamily: 'exact-support',
      role: 'support',
      required: true,
      relationshipAnyOf: [],
      description: 'Exact source bytes for the state.',
      minimumCount: 1,
      sameFamilyAsObligationId: 'state',
    }, {
      obligationId: 'counterevidence',
      propositionFamily: 'counterevidence',
      role: 'invalidator',
      required: true,
      relationshipAnyOf: ['contradicts', 'qualifies'],
      description: 'Complete counterevidence census.',
      minimumCount: 0,
      relationshipDirection: 'outbound',
      relationshipTargetPropositionFamily: 'state',
    }],
  });
}

function buildContext(root) {
  let context;
  buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
  openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
    context = value;
    return null;
  });
  return context;
}

function admitBundle(bundle, {
  proposerKeys = generateKeyPairSync('ed25519'),
  reviewerKeys = generateKeyPairSync('ed25519'),
  issuerId = 'independent-reviewer',
  admittedAt = '2026-09-05T08:05:00.000Z',
  supersedesRecordSha256s = [],
} = {}) {
  const proposalStatement = sourceNativeProposalStatement({ bundle });
  const statement = sourceNativeAdmissionStatement({
    bundle,
    issuerId,
    admittedAt,
    supersedesRecordSha256s,
  });
  const record = compileSourceNativeAdmissionRecord({
    bundle,
    proposalStatement,
    proposalSignatureBase64: sign(
      null,
      Buffer.from(stableObjectText(proposalStatement)),
      proposerKeys.privateKey,
    ).toString('base64'),
    statement,
    signatureBase64: sign(
      null,
      Buffer.from(stableObjectText(statement)),
      reviewerKeys.privateKey,
    ).toString('base64'),
  });
  const trustRegistry = [{
    issuerId: bundle.proposedBy,
    publicKeyPem: proposerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: ['proposer'],
  }, {
    issuerId,
    publicKeyPem: reviewerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: ['reviewer'],
  }];
  return { proposerKeys, record, reviewerKeys, trustRegistry };
}

function queryBindingFor(prepared) {
  return {
    question: prepared.question,
    anchorValue: prepared.anchorValue,
    typedQuery: prepared.typedQuery,
    query: prepared.plan.query,
    queryPlanSha256: prepared.plan.planSha256,
    questionSha256: prepared.plan.questionSha256,
    intent: prepared.intent,
  };
}

function createAdmittedFixture(root, {
  question = 'What is the current issue status for issue-1?',
  evidence = (value) => value,
} = {}) {
  const context = buildContext(root);
  const prepared = context.prepareSearch({ question });
  const initialAuthority = authorityFor(context);
  const initialItem = initialAuthority.items[0];
  const authorityProjection = compileProofAuthorityProjection({
    sourceProjectionKind: initialAuthority.sourceProjectionKind,
    sourceProjectionSha256: initialAuthority.sourceProjectionSha256,
    items: [{
      ...initialItem,
      exactEvidenceReferences: initialItem.exactEvidenceReferences.map(evidence),
    }],
    relations: initialAuthority.relations,
  });
  const contract = contractFor(authorityProjection);
  const item = authorityProjection.items[0];
  const bundle = compileSourceNativeAdmittedKnowledgeBundle({
    proposedBy: 'investigator-agent',
    proposedAt: '2026-09-05T08:00:00.000Z',
    ontId: context.descriptor.ontId,
    namespace: context.descriptor.namespace,
    artifactSha256: context.descriptor.artifactSha256,
    nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
    sourceCommitSha256: context.objectOnt.commitSha256,
    sourceReplaySha256: context.objectOnt.replaySha256,
    queryBinding: queryBindingFor(prepared),
    proofSufficiencyContract: contract,
    proofAuthorityProjection: authorityProjection,
    propositions: [{ revisionId: 'status-current-r1', ...item }],
    relations: [],
  });
  const { proposerKeys, record, trustRegistry } = admitBundle(bundle);
  const write = writeSourceNativeAdmittedKnowledge({
    options: { artifactRoot: root },
    record,
    trustRegistry,
  });
  const product = openSourceNativeProductWithAdmittedKnowledge(
    { artifactRoot: root },
    { trustRegistry },
  );
  return {
    bundle, context, product, proposerKeys, question, record, trustRegistry, write,
  };
}

test('admitted opening preserves lifecycle extensions and status on a reuse hit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-lifecycle-extension-'));
  try {
    const { question, trustRegistry } = createAdmittedFixture(root);
    let factoryCalls = 0;
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry },
      (context) => {
        factoryCalls += 1;
        assert.equal(typeof context.prepareSearch, 'function');
        return {
          methods: { lifecycleProbe: () => 'preserved' },
          status: () => ({ lifecycleState: 'ready' }),
        };
      },
    );
    assert.equal(factoryCalls, 1);
    assert.equal(product.lifecycleProbe(), 'preserved');
    const status = product.status();
    assert.equal(status.lifecycleState, 'ready');
    assert.equal(status.admittedKnowledge.state, 'ready');
    const verification = await product.verify({ question });
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.equal(verification.verification.rawSearchCalls, 0);
    const navigation = await product.search({ question });
    assert.equal(navigation.kind, 'OpenOntologySourceNativeProductSearchResultV2');
    assert.equal((await product.read({ ref: navigation.matches[0].ref })).exactText, 'Ready');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('admitted opening invokes lifecycle hooks on an ordinary verification miss', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-lifecycle-miss-'));
  try {
    const { trustRegistry } = createAdmittedFixture(root);
    let beginSearchCalls = 0;
    let recordSearchCalls = 0;
    let verificationResultCalls = 0;
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry },
      () => ({
        beginSearch: () => {
          beginSearchCalls += 1;
          return { lifecycleActivity: 'fresh' };
        },
        recordSearch: () => {
          recordSearchCalls += 1;
          return { lifecycleRecord: 'fresh' };
        },
        verificationResult: () => {
          verificationResultCalls += 1;
          return { lifecycleVerification: 'fresh' };
        },
      }),
    );
    const verification = await product.verify({
      question: 'Please tell me the current issue status for issue-1.',
    });
    assert.equal(verification.kind, 'OpenOntologySourceNativeVerificationV1');
    assert.equal(verification.state, 'resolved-current-field');
    assert.equal(verification.answerable, true);
    assert.equal(verification.lifecycleVerification, 'fresh');
    assert.equal(beginSearchCalls, 1);
    assert.equal(recordSearchCalls, 1);
    assert.equal(verificationResultCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit investigation bypasses admitted reuse and records fresh work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-lifecycle-investigation-'));
  try {
    const { question, trustRegistry } = createAdmittedFixture(root);
    let beginSearchCalls = 0;
    let recordSearchCalls = 0;
    let verificationResultCalls = 0;
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry },
      () => ({
        beginSearch: (_prepared, investigationId) => {
          beginSearchCalls += 1;
          assert.equal(investigationId, 'investigation-1');
          return { lifecycleActivity: investigationId };
        },
        recordSearch: () => {
          recordSearchCalls += 1;
          return { lifecycleRecord: 'investigation-1' };
        },
        verificationResult: () => {
          verificationResultCalls += 1;
          return { lifecycleVerification: 'investigation-1' };
        },
      }),
    );
    const verification = await product.verify({
      question,
      investigationId: 'investigation-1',
    });
    assert.equal(verification.kind, 'OpenOntologySourceNativeVerificationV1');
    assert.equal(verification.state, 'resolved-current-field');
    assert.equal(verification.answerable, true);
    assert.equal(verification.verification.navigationProposals.rawSearchExecuted, true);
    assert.equal(verification.lifecycleVerification, 'investigation-1');
    assert.equal(beginSearchCalls, 1);
    assert.equal(recordSearchCalls, 1);
    assert.equal(verificationResultCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('admitted opening rejects a nonfunction lifecycle factory', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-lifecycle-invalid-factory-'));
  try {
    const { trustRegistry } = createAdmittedFixture(root);
    assert.throws(() => openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry },
      { notAFactory: true },
    ), { code: 'SOURCE_NATIVE_PRODUCT_LIFECYCLE_ADAPTER' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reviewer revocation falls back to ordinary lifecycle verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-lifecycle-revoked-reviewer-'));
  try {
    const { question, trustRegistry } = createAdmittedFixture(root);
    let beginSearchCalls = 0;
    let recordSearchCalls = 0;
    const revokedTrustRegistry = trustRegistry.filter((entry) => entry.roles.includes('proposer'));
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: revokedTrustRegistry },
      () => ({
        beginSearch: () => {
          beginSearchCalls += 1;
          return null;
        },
        recordSearch: () => {
          recordSearchCalls += 1;
          return null;
        },
      }),
    );
    const verification = await product.verify({ question });
    assert.equal(verification.kind, 'OpenOntologySourceNativeVerificationV1');
    assert.equal(verification.state, 'resolved-current-field');
    assert.equal(verification.answerable, true);
    assert.equal(verification.verification.navigationProposals.rawSearchExecuted, true);
    assert.equal(product.status().admittedKnowledge.state, 'degraded');
    assert.equal(beginSearchCalls, 1);
    assert.equal(recordSearchCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createEvidenceAdmission(root, {
  content,
  proposedBy = 'evidence-budget-investigator',
}) {
  const input = buildInput();
  input.sources[0] = {
    ...input.sources[0],
    content,
  };
  input.nativeObjectInputs[0] = {
    ...input.nativeObjectInputs[0],
    fields: [{ fieldPath: 'status', value: input.sources[0].content }],
  };
  buildSourceNativeProduct({ artifactRoot: root, input });
  let context;
  openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
    context = value;
    return null;
  });
  const question = 'What is the current issue status for issue-1?';
  const prepared = context.prepareSearch({ question });
  const authorityProjection = authorityFor(context);
  const bundle = compileSourceNativeAdmittedKnowledgeBundle({
    proposedBy,
    proposedAt: '2026-09-05T08:00:00.000Z',
    ontId: context.descriptor.ontId,
    namespace: context.descriptor.namespace,
    artifactSha256: context.descriptor.artifactSha256,
    nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
    sourceCommitSha256: context.objectOnt.commitSha256,
    sourceReplaySha256: context.objectOnt.replaySha256,
    queryBinding: queryBindingFor(prepared),
    proofSufficiencyContract: contractFor(authorityProjection),
    proofAuthorityProjection: authorityProjection,
    propositions: [{
      revisionId: 'status-current-r1',
      ...authorityProjection.items[0],
    }],
    relations: [],
  });
  const admitted = admitBundle(bundle);
  return { ...admitted, context, question };
}

function createOversizedEvidenceAdmission(root) {
  return createEvidenceAdmission(root, {
    content: 'x'.repeat((64 * 1024) + 1),
    proposedBy: 'byte-budget-investigator',
  });
}

function createContextUnitDenseAdmission(root, invalidatorCount = 64) {
  const input = buildInput();
  input.sources[0] = {
    ...input.sources[0],
    content: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  };
  input.nativeObjectInputs[0] = {
    ...input.nativeObjectInputs[0],
    fields: [{ fieldPath: 'status', value: input.sources[0].content }],
  };
  buildSourceNativeProduct({ artifactRoot: root, input });
  let context;
  openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
    context = value;
    return null;
  });
  const question = 'What is the current issue status for issue-1?';
  const prepared = context.prepareSearch({ question });
  const source = context.sources[0];
  const sourceBytes = Buffer.from(source.content);
  const reference = (byteStart, byteEnd) => ({
    sourceRef: source.relativePath,
    sourceSha256: source.contentSha256,
    byteStart,
    byteEnd,
    textSha256: objectBytesSha256(sourceBytes.subarray(byteStart, byteEnd)),
  });
  const supportItem = {
    sourceProjectionItemId: 'status-current',
    familyId: 'issue-status',
    canonicalRoles: ['state'],
    modality: 'observed',
    polarity: 'positive',
    actorRef: 'linear:issue:northwind:issue-1',
    validAt: source.occurredAt,
    knownAt: source.occurredAt,
    exactEvidenceReferences: [reference(0, sourceBytes.length)],
  };
  const invalidatorItems = Array.from({ length: invalidatorCount }, (_, index) => ({
    sourceProjectionItemId: `counterevidence-${String(index).padStart(2, '0')}`,
    familyId: `issue-status-counter-${String(index).padStart(2, '0')}`,
    canonicalRoles: ['counterevidence'],
    modality: 'observed',
    polarity: 'negative',
    actorRef: 'linear:issue:northwind:issue-1',
    validAt: source.occurredAt,
    knownAt: source.occurredAt,
    exactEvidenceReferences: [reference(index, index + 1)],
  }));
  const authorityProjection = compileProofAuthorityProjection({
    sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
    sourceProjectionSha256: objectBytesSha256(Buffer.from(
      `proof-unit-count-${invalidatorCount}`,
    )),
    items: [supportItem, ...invalidatorItems],
    relations: invalidatorItems.map((item) => ({
      type: 'qualifies',
      sourceProjectionItemId: item.sourceProjectionItemId,
      targetProjectionItemId: supportItem.sourceProjectionItemId,
    })),
  });
  const authorityById = new Map(authorityProjection.items.map((item) =>
    [item.sourceProjectionItemId, item]));
  const bundle = compileSourceNativeAdmittedKnowledgeBundle({
    proposedBy: 'count-budget-investigator',
    proposedAt: '2026-09-05T08:00:00.000Z',
    ontId: context.descriptor.ontId,
    namespace: context.descriptor.namespace,
    artifactSha256: context.descriptor.artifactSha256,
    nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
    sourceCommitSha256: context.objectOnt.commitSha256,
    sourceReplaySha256: context.objectOnt.replaySha256,
    queryBinding: queryBindingFor(prepared),
    proofSufficiencyContract: contractFor(authorityProjection),
    proofAuthorityProjection: authorityProjection,
    propositions: [{
      revisionId: 'status-current-r1',
      ...authorityById.get(supportItem.sourceProjectionItemId),
    }, ...invalidatorItems.map((item, index) => ({
      revisionId: `counterevidence-r${String(index).padStart(2, '0')}`,
      ...authorityById.get(item.sourceProjectionItemId),
    }))],
    relations: invalidatorItems.map((_item, index) => ({
      type: 'qualifies',
      sourceRevisionId: `counterevidence-r${String(index).padStart(2, '0')}`,
      targetRevisionId: 'status-current-r1',
    })),
  });
  return { ...admitBundle(bundle), bundle, context, question };
}

function plantAdmission(root, context, record) {
  const state = openProductState({ artifactRoot: root });
  const branch = `knowledge-${context.objectOnt.commitSha256.slice(7, 23)}`;
  const current = state.store.readRefMetadata({
    ontId: context.descriptor.ontId,
    branch,
  });
  const blob = state.store.putBlob({
    logicalPath: `blobs/knowledge-ledger/admitted/${record.recordSha256.slice(7)}.json`,
    bytes: Buffer.from(stableObjectText(record)),
    mediaType: 'application/vnd.openontology.admission+json',
  });
  const parentCommitSha256 = current?.ref.commitSha256 ?? context.objectOnt.commitSha256;
  const parent = state.store.readCommit(parentCommitSha256).commit;
  const receipt = state.store.writeCommitMetadata({
    ontId: context.descriptor.ontId,
    parents: [parentCommitSha256],
    ontManifest: parent.ontManifest,
    blobs: [blob],
  });
  state.store.compareAndSwapRefMetadata({
    ontId: context.descriptor.ontId,
    branch,
    expectedVersion: current?.version ?? null,
    commitSha256: receipt.commitSha256,
  });
}

function recompileSemanticBundle(original, {
  sourceProjectionKind = original.proofAuthorityProjection.sourceProjectionKind,
  mutateItem = (item) => item,
} = {}) {
  const authorityProjection = compileProofAuthorityProjection({
    sourceProjectionKind,
    sourceProjectionSha256: original.proofAuthorityProjection.sourceProjectionSha256,
    items: original.proofAuthorityProjection.items.map(mutateItem),
    relations: original.proofAuthorityProjection.relations,
  });
  const originalContract = original.proofSufficiencyContract;
  const proofSufficiencyContract = compileProofSufficiencyContract({
    questionKind: originalContract.questionKind,
    obligations: originalContract.obligations,
    sourceProjectionAuthority: proofAuthorityForProjection(authorityProjection),
    sufficiencyRule: originalContract.sufficiencyRule,
    stopWhen: originalContract.stopWhen,
  });
  const itemsById = new Map(authorityProjection.items.map((item) =>
    [item.sourceProjectionItemId, item]));
  return compileSourceNativeAdmittedKnowledgeBundle({
    proposedBy: original.proposedBy,
    proposedAt: original.proposedAt,
    ontId: original.ontId,
    namespace: original.namespace,
    artifactSha256: original.artifactSha256,
    nativeObjectMapSha256: original.nativeObjectMapSha256,
    sourceCommitSha256: original.sourceCommitSha256,
    sourceReplaySha256: original.sourceReplaySha256,
    queryBinding: original.queryBinding,
    proofSufficiencyContract,
    proofAuthorityProjection: authorityProjection,
    propositions: original.propositions.map((proposition) => ({
      revisionId: proposition.revisionId,
      ...(itemsById.get(proposition.sourceProjectionItemId) ??
        assert.fail(`missing semantic item ${proposition.sourceProjectionItemId}`)),
    })),
    relations: original.relations,
  });
}

function recompileSemanticBundleWithContract(original, proofSufficiencyContract) {
  return compileSourceNativeAdmittedKnowledgeBundle({
    proposedBy: original.proposedBy,
    proposedAt: original.proposedAt,
    ontId: original.ontId,
    namespace: original.namespace,
    artifactSha256: original.artifactSha256,
    nativeObjectMapSha256: original.nativeObjectMapSha256,
    sourceCommitSha256: original.sourceCommitSha256,
    sourceReplaySha256: original.sourceReplaySha256,
    queryBinding: original.queryBinding,
    proofSufficiencyContract,
    proofAuthorityProjection: original.proofAuthorityProjection,
    propositions: original.propositions,
    relations: original.relations,
  });
}

test('cold verify reuses an independently admitted proof and reinspects exact Evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admitted-knowledge-'));
  try {
    const { product, question, record, trustRegistry, write } = createAdmittedFixture(root);
    assert.equal(product.kind, 'OpenOntologySourceNativeAdmittedKnowledgeProductV1');
    assert.equal(write.replayed, false);
    assert.equal(writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record,
      trustRegistry,
    }).replayed, true);
    const verification = await product.verify({ question });
    assert.equal(verification.kind, 'OpenOntologySourceNativeAdmittedKnowledgeVerificationV1');
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.equal(verification.answerable, true);
    assert.equal(verification.proofDisposition, 'supported');
    assert.deepEqual(verification.context.map((row) => row.exactText), ['Ready']);
    assert.deepEqual(verification.context.map((row) => row.role), ['answer']);
    assert.equal(verification.verification.rawSearchExecuted, false);
    assert.equal(verification.verification.rawSearchCalls, 0);
    assert.equal(verification.verification.modelCalls, 0);
    assert.equal(verification.verification.exactSourceInspectionCount, 1);
    assert.equal(verification.verification.admissionRecordSha256, record.recordSha256);
    const navigation = await product.search({ question });
    assert.equal(navigation.kind, 'OpenOntologySourceNativeProductSearchResultV2');
    assert.equal(navigation.verification.navigationProposals.rawSearchExecuted, true);
    const exactRead = await product.read({ ref: navigation.matches[0].ref });
    assert.equal(exactRead.kind, 'OpenOntologySourceNativeProductReadResultV1');
    assert.equal(exactRead.exactText, 'Ready');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary semantic verification compiles into cold admitted reuse', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-admitted-knowledge-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticInput() });
    const query = {
      question: 'What is the current issue status for issue-1?',
      typedQuery: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
        fieldPath: 'status',
      },
    };
    const bundle = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query,
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    assert.equal(bundle.proofEvaluation.proofDisposition, 'qualified');
    assert.equal(bundle.propositions.length, 2);
    assert.equal(bundle.relations.length, 1);
    const admitted = admitBundle(bundle);
    writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    });

    const cold = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: admitted.trustRegistry },
    );
    const verified = await cold.verify(query);
    assert.equal(verified.kind, 'OpenOntologySourceNativeAdmittedKnowledgeVerificationV1');
    assert.equal(verified.proofDisposition, 'qualified');
    assert.equal(verified.verification.rawSearchExecuted, false);
    assert.equal(verified.verification.exactSourceInspectionCount, 1);
    assert.deepEqual(verified.context.map((row) => [row.role, row.exactText]), [
      ['answer', 'Ready'],
      ['counterevidence', 'Manual approval absent'],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects a native contract that makes the answer optional', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-minimum-proof-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticInput() });
    let context;
    openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
      context = value;
      return null;
    });
    const query = {
      question: 'What is the current issue status for issue-1?',
      typedQuery: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
        fieldPath: 'status',
      },
    };
    const original = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query,
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    const weakContract = compileProofSufficiencyContract({
      questionKind: original.proofSufficiencyContract.questionKind,
      sourceProjectionAuthority: proofAuthorityForProjection(
        original.proofAuthorityProjection,
      ),
      sufficiencyRule: 'Close exact support and the complete invalidator census.',
      stopWhen: 'Every required obligation and authoritative relation census is closed.',
      obligations: [{
        obligationId: 'optional-answer',
        propositionFamily: 'state',
        role: 'support',
        required: false,
        relationshipAnyOf: [],
        description: 'Optional current status state.',
      }, {
        obligationId: 'required-exact',
        propositionFamily: 'exact-support',
        role: 'support',
        required: true,
        relationshipAnyOf: [],
        description: 'Exact source bytes for the state.',
        minimumCount: 1,
        sameFamilyAsObligationId: 'optional-answer',
      }, {
        obligationId: 'required-counterevidence',
        propositionFamily: 'counterevidence',
        role: 'invalidator',
        required: true,
        relationshipAnyOf: ['contradicts', 'qualifies'],
        description: 'Complete counterevidence census.',
        minimumCount: 0,
        relationshipDirection: 'outbound',
        relationshipTargetPropositionFamily: 'state',
      }],
    });
    const forged = recompileSemanticBundleWithContract(original, weakContract);
    const admitted = admitBundle(forged);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SOURCE_BINDING' });
    plantAdmission(root, context, admitted.record);
    const cold = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: admitted.trustRegistry },
    );
    assert.equal(cold.status().admittedKnowledge.invalidAdmissionRecordCount, 1);
    const fallback = await cold.verify(query);
    assert.equal(fallback.kind, 'OpenOntologySourceNativeVerificationV1');
    assert.equal(fallback.proofDisposition, 'qualified');
    assert.deepEqual(fallback.context.map((row) => [row.role, row.exactText]), [
      ['answer', 'Ready'],
      ['counterevidence', 'Manual approval absent'],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects a native contract whose exact support links only optional support', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-minimum-exact-link-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticInput() });
    const query = {
      question: 'What is the current issue status for issue-1?',
      typedQuery: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
        fieldPath: 'status',
      },
    };
    const original = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query,
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    const weakContract = compileProofSufficiencyContract({
      questionKind: original.proofSufficiencyContract.questionKind,
      sourceProjectionAuthority: proofAuthorityForProjection(
        original.proofAuthorityProjection,
      ),
      sufficiencyRule: 'Close support and the complete invalidator census.',
      stopWhen: 'Every required obligation and authoritative relation census is closed.',
      obligations: [{
        obligationId: 'optional-answer',
        propositionFamily: 'state',
        role: 'support',
        required: false,
        relationshipAnyOf: [],
        description: 'Optional current status state.',
      }, {
        obligationId: 'required-answer',
        propositionFamily: 'state',
        role: 'support',
        required: true,
        relationshipAnyOf: [],
        description: 'Required current status state.',
        minimumCount: 1,
      }, {
        obligationId: 'required-exact',
        propositionFamily: 'exact-support',
        role: 'support',
        required: true,
        relationshipAnyOf: [],
        description: 'Exact source bytes for the state.',
        minimumCount: 1,
        sameFamilyAsObligationId: 'optional-answer',
      }, {
        obligationId: 'required-counterevidence',
        propositionFamily: 'counterevidence',
        role: 'invalidator',
        required: true,
        relationshipAnyOf: ['contradicts', 'qualifies'],
        description: 'Complete counterevidence census.',
        minimumCount: 0,
        relationshipDirection: 'outbound',
        relationshipTargetPropositionFamily: 'state',
      }],
    });
    const forged = recompileSemanticBundleWithContract(original, weakContract);
    const admitted = admitBundle(forged);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SOURCE_BINDING' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects a native contract with the wrong semantic question kind', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-minimum-kind-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticInput() });
    const query = {
      question: 'What is the current issue status for issue-1?',
      typedQuery: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
        fieldPath: 'status',
      },
    };
    const original = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query,
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    const wrongQuestionKind = compileProofSufficiencyContract({
      questionKind: 'source-native-outcome',
      sourceProjectionAuthority: proofAuthorityForProjection(
        original.proofAuthorityProjection,
      ),
      sufficiencyRule: original.proofSufficiencyContract.sufficiencyRule,
      stopWhen: original.proofSufficiencyContract.stopWhen,
      obligations: original.proofSufficiencyContract.obligations,
    });
    const forged = recompileSemanticBundleWithContract(original, wrongQuestionKind);
    const admitted = admitBundle(forged);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SOURCE_BINDING' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native minimum proof accepts renamed IDs and a compatible stronger support requirement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-minimum-positive-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticInput() });
    const query = {
      question: 'What is the current issue status for issue-1?',
      typedQuery: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
        fieldPath: 'status',
      },
    };
    const original = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query,
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    const strongerContract = compileProofSufficiencyContract({
      questionKind: original.proofSufficiencyContract.questionKind,
      sourceProjectionAuthority: proofAuthorityForProjection(
        original.proofAuthorityProjection,
      ),
      sufficiencyRule: 'Close the named current state, exact support, and complete invalidator census.',
      stopWhen: 'Every required obligation and authoritative relation census is closed.',
      obligations: [{
        obligationId: 'renamed-current-state',
        propositionFamily: 'state',
        role: 'support',
        required: true,
        relationshipAnyOf: [],
        description: 'The named current status state is present.',
        expectedSourceProjectionItemIds: ['issue-1-status-ready'],
        minimumCount: 1,
      }, {
        obligationId: 'renamed-exact-bytes',
        propositionFamily: 'exact-support',
        role: 'support',
        required: true,
        relationshipAnyOf: [],
        description: 'Exact source bytes for the named state.',
        minimumCount: 1,
        sameFamilyAsObligationId: 'renamed-current-state',
      }, {
        obligationId: 'renamed-counter-census',
        propositionFamily: 'counterevidence',
        role: 'invalidator',
        required: true,
        relationshipAnyOf: ['contradicts', 'qualifies'],
        description: 'Complete counterevidence census.',
        minimumCount: 0,
        relationshipDirection: 'outbound',
        relationshipTargetPropositionFamily: 'state',
      }],
    });
    const valid = recompileSemanticBundleWithContract(original, strongerContract);
    const admitted = admitBundle(valid);
    const write = writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    });
    assert.equal(write.replayed, false);
    const cold = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: admitted.trustRegistry },
    );
    const verified = await cold.verify(query);
    assert.equal(verified.proofDisposition, 'qualified');
    assert.equal(verified.verification.rawSearchExecuted, false);
    assert.deepEqual(verified.context.map((row) => [row.role, row.exactText]), [
      ['answer', 'Ready'],
      ['counterevidence', 'Manual approval absent'],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native minimum proof does not require observed modality for a recorded answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-minimum-recorded-'));
  try {
    buildSourceNativeProduct({
      artifactRoot: root,
      input: buildSemanticInput({ stateModality: 'planned' }),
    });
    const query = {
      question: 'What is the current issue status for issue-1?',
      typedQuery: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
        fieldPath: 'status',
      },
    };
    const bundle = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query,
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    const admitted = admitBundle(bundle);
    writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    });
    const cold = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: admitted.trustRegistry },
    );
    const verified = await cold.verify(query);
    assert.equal(verified.proofDisposition, 'qualified');
    assert.equal(verified.verification.rawSearchExecuted, false);
    assert.deepEqual(verified.context.map((row) => [row.role, row.exactText]), [
      ['answer', 'Ready'],
      ['counterevidence', 'Manual approval absent'],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects a signed semantic bundle with a stripped native census', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-admission-rebinding-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticInput() });
    let context;
    openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
      context = value;
      return null;
    });
    const query = {
      question: 'What is the current issue status for issue-1?',
      typedQuery: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
        fieldPath: 'status',
      },
    };
    const original = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query,
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    const retainedItems = original.proofAuthorityProjection.items.filter((item) =>
      item.canonicalRoles.includes('state'));
    const strippedAuthority = compileProofAuthorityProjection({
      sourceProjectionKind: original.proofAuthorityProjection.sourceProjectionKind,
      sourceProjectionSha256: original.proofAuthorityProjection.sourceProjectionSha256,
      items: retainedItems,
      relations: [],
    });
    const originalContract = original.proofSufficiencyContract;
    const strippedContract = compileProofSufficiencyContract({
      questionKind: originalContract.questionKind,
      obligations: originalContract.obligations,
      sourceProjectionAuthority: proofAuthorityForProjection(strippedAuthority),
      sufficiencyRule: originalContract.sufficiencyRule,
      stopWhen: originalContract.stopWhen,
    });
    const strippedBundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: original.proposedBy,
      proposedAt: original.proposedAt,
      ontId: original.ontId,
      namespace: original.namespace,
      artifactSha256: original.artifactSha256,
      nativeObjectMapSha256: original.nativeObjectMapSha256,
      sourceCommitSha256: original.sourceCommitSha256,
      sourceReplaySha256: original.sourceReplaySha256,
      queryBinding: original.queryBinding,
      proofSufficiencyContract: strippedContract,
      proofAuthorityProjection: strippedAuthority,
      propositions: original.propositions.filter((proposition) =>
        retainedItems.some((item) =>
          item.sourceProjectionItemId === proposition.sourceProjectionItemId)),
      relations: [],
    });
    const admitted = admitBundle(strippedBundle);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SOURCE_BINDING' });
    plantAdmission(root, context, admitted.record);
    const cold = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: admitted.trustRegistry },
    );
    const status = cold.status();
    assert.equal(status.admittedKnowledge.invalidAdmissionRecordCount, 1);
    const fallback = await cold.verify(query);
    assert.equal(fallback.kind, 'OpenOntologySourceNativeVerificationV1');
    assert.equal(fallback.proofDisposition, 'qualified');
    assert.deepEqual(fallback.context.map((row) => [row.role, row.exactText]), [
      ['answer', 'Ready'],
      ['counterevidence', 'Manual approval absent'],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects semantic actor and modality drift', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-admission-actor-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticInput() });
    const original = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query: {
        question: 'What is the current issue status for issue-1?',
        typedQuery: {
          sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
          fieldPath: 'status',
        },
      },
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    for (const mutateItem of [
      (item) => item.canonicalRoles.includes('state') ? {
        ...item, actorRef: 'linear:issue:northwind:other-issue',
      } : item,
      (item) => item.canonicalRoles.includes('state') ? {
        ...item, modality: 'inferred',
      } : item,
    ]) {
      const forged = recompileSemanticBundle(original, { mutateItem });
      const admitted = admitBundle(forged);
      assert.throws(() => writeSourceNativeAdmittedKnowledge({
        options: { artifactRoot: root },
        record: admitted.record,
        trustRegistry: admitted.trustRegistry,
      }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SOURCE_BINDING' });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects a renamed semantic projection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-admission-kind-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticInput() });
    const original = await compileSourceNativeSemanticKnowledgeBundle({
      options: { artifactRoot: root },
      query: {
        question: 'What is the current issue status for issue-1?',
        typedQuery: {
          sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
          fieldPath: 'status',
        },
      },
      proposedBy: 'semantic-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
    });
    const forged = recompileSemanticBundle(original, {
      sourceProjectionKind: 'OpenOntologyRenamedSemanticProjectionV1',
    });
    const admitted = admitBundle(forged);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SOURCE_BINDING' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission refuses when its exact Evidence span does not match Corpus bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admitted-evidence-refusal-'));
  try {
    assert.throws(() => createAdmittedFixture(root, {
      evidence: (value) => ({
        ...value,
        textSha256: objectBytesSha256(Buffer.from('Not Ready')),
      }),
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a different question binding cannot reuse admitted context and takes the ordinary proof path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admitted-query-binding-'));
  try {
    const { product, record } = createAdmittedFixture(root);
    const verification = await product.verify({
      question: 'Please tell me the current issue status for issue-1.',
    });
    assert.equal(verification.kind, 'OpenOntologySourceNativeVerificationV1');
    assert.equal(verification.state, 'resolved-current-field');
    assert.equal(verification.answerable, true);
    assert.deepEqual(verification.context.map((row) => row.exactText), ['Ready']);
    assert.equal(verification.verification.navigationProposals.rawSearchExecuted, true);
    assert.notEqual(verification.verification.admissionRecordSha256, record.recordSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Admission compilation refuses an omitted counterevidence item from the authority census', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admitted-counterevidence-'));
  try {
    const context = buildContext(root);
    const question = 'What is the current issue status for issue-1?';
    const prepared = context.prepareSearch({ question });
    const stateItem = authorityFor(context).items[0];
    const counterevidenceItem = {
      ...stateItem,
      sourceProjectionItemId: 'status-counterevidence',
      familyId: 'issue-status-counterevidence',
      canonicalRoles: ['counterevidence'],
      polarity: 'negative',
    };
    const authorityProjection = compileProofAuthorityProjection({
      sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
      sourceProjectionSha256: objectBytesSha256(Buffer.from('projection-with-counterevidence')),
      items: [stateItem, counterevidenceItem],
      relations: [{
        type: 'qualifies',
        sourceProjectionItemId: 'status-counterevidence',
        targetProjectionItemId: 'status-current',
      }],
    });
    const contract = contractFor(authorityProjection);
    assert.throws(() => compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'investigator-agent',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contract,
      proofAuthorityProjection: authorityProjection,
      propositions: [{ revisionId: 'status-current-r1', ...stateItem }],
      relations: [],
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROOF' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Admission compilation refuses relation direction drift from the authority census', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admitted-relation-drift-'));
  try {
    const context = buildContext(root);
    const question = 'What is the current issue status for issue-1?';
    const prepared = context.prepareSearch({ question });
    const stateItem = authorityFor(context).items[0];
    const counterevidenceItem = {
      ...stateItem,
      sourceProjectionItemId: 'status-counterevidence',
      familyId: 'issue-status-counterevidence',
      canonicalRoles: ['counterevidence'],
      polarity: 'negative',
    };
    const authorityProjection = compileProofAuthorityProjection({
      sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
      sourceProjectionSha256: objectBytesSha256(Buffer.from('projection-with-relation')),
      items: [stateItem, counterevidenceItem],
      relations: [{
        type: 'qualifies',
        sourceProjectionItemId: 'status-counterevidence',
        targetProjectionItemId: 'status-current',
      }],
    });
    assert.throws(() => compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'investigator-agent',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(authorityProjection),
      proofAuthorityProjection: authorityProjection,
      propositions: [
        { revisionId: 'status-current-r1', ...stateItem },
        { revisionId: 'status-counterevidence-r1', ...counterevidenceItem },
      ],
      relations: [{
        type: 'qualifies',
        sourceRevisionId: 'status-current-r1',
        targetRevisionId: 'status-counterevidence-r1',
      }],
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_PROOF' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Admission compilation refuses a contract bound to a different authority projection', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admitted-authority-mismatch-'));
  try {
    const context = buildContext(root);
    const question = 'What is the current issue status for issue-1?';
    const prepared = context.prepareSearch({ question });
    const expectedAuthority = authorityFor(context);
    const suppliedAuthority = compileProofAuthorityProjection({
      sourceProjectionKind: expectedAuthority.sourceProjectionKind,
      sourceProjectionSha256: objectBytesSha256(Buffer.from('different-projection')),
      items: expectedAuthority.items,
      relations: expectedAuthority.relations,
    });
    assert.throws(() => compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'investigator-agent',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(expectedAuthority),
      proofAuthorityProjection: suppliedAuthority,
      propositions: [{
        revisionId: 'status-current-r1',
        ...suppliedAuthority.items[0],
      }],
      relations: [],
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_AUTHORITY' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a different typed scope cannot reuse admitted context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admitted-scope-binding-'));
  try {
    const { product, question, record } = createAdmittedFixture(root);
    const verification = await product.verify({
      question,
      typedQuery: {
        sourceSystem: 'linear',
        objectType: 'issue',
        externalId: 'issue-2',
        fieldPath: 'status',
      },
    });
    assert.equal(verification.state,
      'verified-native-object-absent-from-bound-source-catalog');
    assert.equal(verification.answerable, false);
    assert.deepEqual(verification.context, []);
    assert.equal(verification.verification.navigationProposals.rawSearchExecuted, false);
    assert.equal(verification.verification.navigationProposals.state, 'not-run');
    assert.equal(verification.verification.absenceReceipt.objectIdentity.externalId, 'issue-2');
    assert.equal(verification.verification.absenceReceipt.worldAbsenceAuthorized, false);
    assert.notEqual(verification.verification.admissionRecordSha256, record.recordSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects proof whose primary Evidence belongs to another object', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-evidence-scope-'));
  try {
    const input = buildInput();
    input.sources.push({
      relativePath: 'linear/northwind/issue-2.txt',
      sourceType: 'linear',
      occurredAt: '2026-09-04T13:00:00.000Z',
      content: 'Blocked',
    });
    input.nativeObjectInputs.push({
      relativePath: 'linear/northwind/issue-2.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'linear',
        objectType: 'issue',
        namespace: 'northwind',
        externalId: 'issue-2',
      },
      fields: [{ fieldPath: 'status', value: 'Blocked' }],
    });
    buildSourceNativeProduct({ artifactRoot: root, input });
    let context;
    openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
      context = value;
      return null;
    });
    const question = 'What is the current issue status for issue-1?';
    const prepared = context.prepareSearch({ question });
    const wrongSource = context.sources.find((source) =>
      source.relativePath.endsWith('issue-2.txt'));
    const authorityProjection = authorityFor(context, wrongSource);
    const bundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'investigator-agent',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(authorityProjection),
      proofAuthorityProjection: authorityProjection,
      propositions: [{
        revisionId: 'wrong-object-status-r1',
        ...authorityProjection.items[0],
      }],
      relations: [],
    });
    const { record, trustRegistry } = admitBundle(bundle);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record,
      trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission binds a next query to the exact successor Evidence, not its anchor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-successor-scope-'));
  try {
    const input = buildInput();
    input.sources[0] = {
      ...input.sources[0],
      relativePath: 'linear/northwind/issue-1-t1.txt',
    };
    input.nativeObjectInputs[0] = {
      ...input.nativeObjectInputs[0],
      relativePath: 'linear/northwind/issue-1-t1.txt',
    };
    input.sources.push({
      relativePath: 'linear/northwind/issue-1-t2.txt',
      sourceType: 'linear',
      occurredAt: '2026-09-04T13:00:00.000Z',
      content: 'Done',
    });
    input.nativeObjectInputs.push({
      relativePath: 'linear/northwind/issue-1-t2.txt',
      objectIdentity: input.nativeObjectInputs[0].objectIdentity,
      fields: [{ fieldPath: 'status', value: 'Done' }],
    });
    buildSourceNativeProduct({ artifactRoot: root, input });
    let context;
    openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
      context = value;
      return null;
    });
    const question = 'What status immediately followed Ready for issue-1?';
    const prepared = context.prepareSearch({ question, intent: 'next' });
    const anchorSource = context.sources.find((source) =>
      source.relativePath.endsWith('issue-1-t1.txt'));
    const successorSource = context.sources.find((source) =>
      source.relativePath.endsWith('issue-1-t2.txt'));
    const compile = (source, proposedBy) => {
      const authorityProjection = authorityFor(context, source);
      return compileSourceNativeAdmittedKnowledgeBundle({
        proposedBy,
        proposedAt: '2026-09-05T08:00:00.000Z',
        ontId: context.descriptor.ontId,
        namespace: context.descriptor.namespace,
        artifactSha256: context.descriptor.artifactSha256,
        nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
        sourceCommitSha256: context.objectOnt.commitSha256,
        sourceReplaySha256: context.objectOnt.replaySha256,
        queryBinding: queryBindingFor(prepared),
        proofSufficiencyContract: contractFor(authorityProjection),
        proofAuthorityProjection: authorityProjection,
        propositions: [{
          revisionId: 'status-successor-r1',
          ...authorityProjection.items[0],
        }],
        relations: [],
      });
    };
    const wrong = admitBundle(compile(anchorSource, 'anchor-investigator'));
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: wrong.record,
      trustRegistry: wrong.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE' });

    const correct = admitBundle(compile(successorSource, 'successor-investigator'));
    writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: correct.record,
      trustRegistry: correct.trustRegistry,
    });
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: correct.trustRegistry },
    );
    const verification = await product.verify({ question, intent: 'next' });
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.deepEqual(verification.context.map((row) => ({
      role: row.role,
      exactText: row.exactText,
    })), [{ role: 'answer', exactText: 'Done' }, {
      role: 'anchor', exactText: 'Ready',
    }]);
    assert.deepEqual(verification.context.map((row) => row.binding.kind), [
      'OpenOntologyAdmittedProofBindingV1',
      'OpenOntologyAdmittedQueryAnchorBindingV1',
    ]);
    assert.equal(verification.verification.exactSourceInspectionCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects mixed-object primary support Evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-mixed-object-scope-'));
  try {
    const input = buildInput();
    input.sources.push({
      relativePath: 'linear/northwind/issue-2.txt',
      sourceType: 'linear',
      occurredAt: '2026-09-04T13:00:00.000Z',
      content: 'Blocked',
    });
    input.nativeObjectInputs.push({
      relativePath: 'linear/northwind/issue-2.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'linear',
        objectType: 'issue',
        namespace: 'northwind',
        externalId: 'issue-2',
      },
      fields: [{ fieldPath: 'status', value: 'Blocked' }],
    });
    buildSourceNativeProduct({ artifactRoot: root, input });
    let context;
    openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
      context = value;
      return null;
    });
    const prepared = context.prepareSearch({
      question: 'What is the current issue status for issue-1?',
    });
    const primary = authorityFor(context).items[0];
    const otherSource = context.sources.find((source) =>
      source.relativePath.endsWith('issue-2.txt'));
    const otherEvidence = authorityFor(context, otherSource).items[0]
      .exactEvidenceReferences[0];
    const authorityProjection = compileProofAuthorityProjection({
      sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
      sourceProjectionSha256: objectBytesSha256(Buffer.from('mixed-object-projection')),
      items: [{
        ...primary,
        exactEvidenceReferences: [...primary.exactEvidenceReferences, otherEvidence],
      }],
      relations: [],
    });
    const bundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'mixed-object-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(authorityProjection),
      proofAuthorityProjection: authorityProjection,
      propositions: [{ revisionId: 'status-current-r1', ...authorityProjection.items[0] }],
      relations: [],
    });
    const admitted = admitBundle(bundle);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission rejects unrelated propositions outside every required proof obligation', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-unbound-proposition-'));
  try {
    const input = buildInput();
    input.sources.push({
      relativePath: 'linear/northwind/issue-2.txt',
      sourceType: 'linear',
      occurredAt: '2026-09-04T13:00:00.000Z',
      content: 'Blocked',
    });
    input.nativeObjectInputs.push({
      relativePath: 'linear/northwind/issue-2.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'linear', objectType: 'issue',
        namespace: 'northwind', externalId: 'issue-2',
      },
      fields: [{ fieldPath: 'status', value: 'Blocked' }],
    });
    buildSourceNativeProduct({ artifactRoot: root, input });
    let context;
    openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
      context = value;
      return null;
    });
    const prepared = context.prepareSearch({
      question: 'What is the current issue status for issue-1?',
    });
    const answer = authorityFor(context).items[0];
    const otherSource = context.sources.find((source) =>
      source.relativePath.endsWith('issue-2.txt'));
    const unrelated = {
      ...authorityFor(context, otherSource).items[0],
      sourceProjectionItemId: 'unrelated-note',
      familyId: 'unrelated',
      canonicalRoles: ['note'],
      actorRef: 'linear:issue:northwind:issue-2',
    };
    const authorityProjection = compileProofAuthorityProjection({
      sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
      sourceProjectionSha256: objectBytesSha256(Buffer.from('unbound-proposition-projection')),
      items: [answer, unrelated],
      relations: [],
    });
    const bundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'unbound-proposition-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(authorityProjection),
      proofAuthorityProjection: authorityProjection,
      propositions: [{ revisionId: 'status-current-r1', ...answer }, {
        revisionId: 'unrelated-note-r1',
        ...unrelated,
      }],
      relations: [],
    });
    const admitted = admitBundle(bundle);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_SCOPE' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cold verified context exposes content hashes instead of proposer-authored semantic labels', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-compact-context-'));
  try {
    const context = buildContext(root);
    const prepared = context.prepareSearch({
      question: 'What is the current issue status for issue-1?',
    });
    const untrustedLabel = 'proposer-authored-free-text-'.repeat(200);
    const base = authorityFor(context).items[0];
    const authorityProjection = compileProofAuthorityProjection({
      sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
      sourceProjectionSha256: objectBytesSha256(Buffer.from('compact-context-projection')),
      items: [{
        ...base,
        familyId: untrustedLabel,
        canonicalRoles: ['state', untrustedLabel],
      }],
      relations: [],
    });
    const bundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'compact-context-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(authorityProjection),
      proofAuthorityProjection: authorityProjection,
      propositions: [{ revisionId: untrustedLabel, ...authorityProjection.items[0] }],
      relations: [],
    });
    const admitted = admitBundle(bundle);
    writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    });
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: admitted.trustRegistry },
    );
    const verification = await product.verify({ question: prepared.question });
    const encoded = JSON.stringify(verification);
    assert.equal(encoded.includes(untrustedLabel), false);
    assert.ok(Buffer.byteLength(encoded) < 10_000);
    assert.match(verification.context[0].binding.proofUnitSha256, /^sha256:[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a proposer cannot admit its own knowledge bundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-independence-'));
  try {
    const { bundle } = createAdmittedFixture(root);
    assert.throws(() => sourceNativeAdmissionStatement({
      bundle,
      issuerId: bundle.proposedBy,
      admittedAt: '2026-09-05T08:05:00.000Z',
    }), { code: 'SOURCE_NATIVE_ADMISSION_INDEPENDENCE' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a proposer key cannot self-admit under a different reviewer label', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-key-independence-'));
  try {
    const { bundle, proposerKeys, record } = createAdmittedFixture(root);
    const statement = sourceNativeAdmissionStatement({
      bundle,
      issuerId: 'relabeled-reviewer',
      admittedAt: '2026-09-05T08:06:00.000Z',
    });
    const relabeled = compileSourceNativeAdmissionRecord({
      bundle,
      proposalStatement: record.proposalStatement,
      proposalSignatureBase64: record.proposalSignatureBase64,
      statement,
      signatureBase64: sign(
        null,
        Buffer.from(stableObjectText(statement)),
        proposerKeys.privateKey,
      ).toString('base64'),
    });
    const samePublicKey = proposerKeys.publicKey.export({ type: 'spki', format: 'pem' });
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: relabeled,
      trustRegistry: [{
        issuerId: bundle.proposedBy,
        publicKeyPem: samePublicKey,
        roles: ['proposer'],
      }, {
        issuerId: 'relabeled-reviewer',
        publicKeyPem: samePublicKey,
        roles: ['reviewer'],
      }],
    }), { code: 'SOURCE_NATIVE_ADMISSION_AUTHENTICATION' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a proposer-only trusted key cannot exercise reviewer authority', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-reviewer-role-'));
  try {
    const { record, trustRegistry } = createAdmittedFixture(root);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record,
      trustRegistry: trustRegistry.map((entry) => entry.issuerId === 'independent-reviewer'
        ? { ...entry, roles: ['proposer'] }
        : entry),
    }), { code: 'SOURCE_NATIVE_ADMISSION_AUTHENTICATION' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission refuses a structurally valid record with an invalid signature', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-signature-'));
  try {
    const { bundle, record, trustRegistry } = createAdmittedFixture(root);
    const forged = compileSourceNativeAdmissionRecord({
      bundle,
      proposalStatement: record.proposalStatement,
      proposalSignatureBase64: record.proposalSignatureBase64,
      statement: record.statement,
      signatureBase64: Buffer.alloc(64).toString('base64'),
    });
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: forged,
      trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMISSION_AUTHENTICATION' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cold reuse treats two Admissions of the same bundle as reviewer agreement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-ambiguity-'));
  try {
    const { bundle, question, record, trustRegistry } = createAdmittedFixture(root);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const statement = sourceNativeAdmissionStatement({
      bundle,
      issuerId: 'second-independent-reviewer',
      admittedAt: '2026-09-05T08:06:00.000Z',
    });
    const secondRecord = compileSourceNativeAdmissionRecord({
      bundle,
      proposalStatement: record.proposalStatement,
      proposalSignatureBase64: record.proposalSignatureBase64,
      statement,
      signatureBase64: sign(
        null,
        Buffer.from(stableObjectText(statement)),
        privateKey,
      ).toString('base64'),
    });
    const completeTrustRegistry = [...trustRegistry, {
      issuerId: 'second-independent-reviewer',
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      roles: ['reviewer'],
    }];
    writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: secondRecord,
      trustRegistry: completeTrustRegistry,
    });
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: completeTrustRegistry },
    );
    const verification = await product.verify({ question });
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.equal(verification.answerable, true);
    assert.deepEqual(verification.context.map((row) => row.exactText), ['Ready']);
    assert.deepEqual(verification.verification.admissionIssuerIds,
      ['independent-reviewer', 'second-independent-reviewer']);
    assert.equal(verification.verification.rawSearchCalls, 0);
    assert.equal(verification.verification.exactSourceInspectionCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cold reuse refuses distinct admitted proof bundles for the same exact query', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-conflict-'));
  try {
    const { bundle, context, question, trustRegistry } = createAdmittedFixture(root);
    const conflictingAuthority = compileProofAuthorityProjection({
      sourceProjectionKind: bundle.proofAuthorityProjection.sourceProjectionKind,
      sourceProjectionSha256: objectBytesSha256(Buffer.from('conflicting-projection')),
      items: [{
        ...bundle.proofAuthorityProjection.items[0],
        polarity: 'negative',
      }],
      relations: [],
    });
    const conflictingBundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'competing-investigator-agent',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: bundle.queryBinding,
      proofSufficiencyContract: contractFor(conflictingAuthority),
      proofAuthorityProjection: conflictingAuthority,
      propositions: [{
        revisionId: 'status-current-conflicting-r1',
        ...conflictingAuthority.items[0],
      }],
      relations: [],
    });
    const competing = admitBundle(conflictingBundle, {
      issuerId: 'competing-independent-reviewer',
    });
    const completeTrustRegistry = [...trustRegistry, ...competing.trustRegistry];
    writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: competing.record,
      trustRegistry: completeTrustRegistry,
    });
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: completeTrustRegistry },
    );
    const verification = await product.verify({ question });
    assert.equal(verification.kind, 'OpenOntologySourceNativeAdmittedKnowledgeVerificationV1');
    assert.equal(verification.state, 'unavailable-admitted-knowledge-ambiguous');
    assert.equal(verification.answerable, false);
    assert.deepEqual(verification.context, []);
    assert.equal(verification.verification.rawSearchCalls, 0);
    assert.equal(verification.verification.exactSourceInspectionCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a signed later Admission can supersede a conflicting Admission without deleting history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-supersession-'));
  try {
    const { bundle, context, question, record, trustRegistry } = createAdmittedFixture(root);
    const conflictingAuthority = compileProofAuthorityProjection({
      sourceProjectionKind: bundle.proofAuthorityProjection.sourceProjectionKind,
      sourceProjectionSha256: objectBytesSha256(Buffer.from('superseded-projection')),
      items: [{
        ...bundle.proofAuthorityProjection.items[0],
        polarity: 'negative',
      }],
      relations: [],
    });
    const conflictingBundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'superseded-investigator-agent',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: bundle.queryBinding,
      proofSufficiencyContract: contractFor(conflictingAuthority),
      proofAuthorityProjection: conflictingAuthority,
      propositions: [{
        revisionId: 'status-current-superseded-r1',
        ...conflictingAuthority.items[0],
      }],
      relations: [],
    });
    const conflicting = admitBundle(conflictingBundle, {
      issuerId: 'superseded-independent-reviewer',
    });
    const correctingReviewer = generateKeyPairSync('ed25519');
    const correctingStatement = sourceNativeAdmissionStatement({
      bundle,
      issuerId: 'correcting-independent-reviewer',
      admittedAt: '2026-09-05T08:10:00.000Z',
      supersedesRecordSha256s: [conflicting.record.recordSha256],
    });
    const correction = compileSourceNativeAdmissionRecord({
      bundle,
      proposalStatement: record.proposalStatement,
      proposalSignatureBase64: record.proposalSignatureBase64,
      statement: correctingStatement,
      signatureBase64: sign(
        null,
        Buffer.from(stableObjectText(correctingStatement)),
        correctingReviewer.privateKey,
      ).toString('base64'),
    });
    const completeTrustRegistry = [
      ...trustRegistry,
      ...conflicting.trustRegistry,
      {
        issuerId: 'correcting-independent-reviewer',
        publicKeyPem: correctingReviewer.publicKey.export({ type: 'spki', format: 'pem' }),
        roles: ['reviewer'],
      },
    ];
    writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: conflicting.record,
      trustRegistry: completeTrustRegistry,
    });
    writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: correction,
      trustRegistry: completeTrustRegistry,
    });
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: completeTrustRegistry },
    );
    const verification = await product.verify({ question });
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.equal(verification.answerable, true);
    assert.deepEqual(verification.context.map((row) => row.exactText), ['Ready']);
    assert.deepEqual(verification.verification.admissionIssuerIds,
      ['correcting-independent-reviewer', 'independent-reviewer']);
    assert.deepEqual(verification.verification.supersededAdmissionRecordSha256s,
      [conflicting.record.recordSha256]);
    assert.equal(verification.verification.rawSearchCalls, 0);

    const afterRevocation = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: completeTrustRegistry.filter((entry) =>
        entry.issuerId !== 'superseded-independent-reviewer') },
    );
    const verificationAfterRevocation = await afterRevocation.verify({ question });
    assert.equal(verificationAfterRevocation.state,
      'resolved-admitted-knowledge-proof-closure');
    assert.deepEqual(verificationAfterRevocation.verification.admissionIssuerIds,
      ['correcting-independent-reviewer', 'independent-reviewer']);
    assert.equal(afterRevocation.status().admittedKnowledge.invalidAdmissionRecordCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an untrusted Admission cannot suppress ordinary exact verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-revoked-trust-'));
  try {
    const { question, trustRegistry } = createAdmittedFixture(root);
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry: trustRegistry.filter((entry) =>
        entry.issuerId !== 'independent-reviewer') },
    );
    const verification = await product.verify({ question });
    assert.equal(verification.state, 'resolved-current-field');
    assert.equal(verification.answerable, true);
    assert.deepEqual(verification.context.map((row) => row.exactText), ['Ready']);
    assert.equal(verification.verification.navigationProposals.rawSearchExecuted, true);
    assert.equal(product.status().admittedKnowledge.state, 'degraded');
    assert.equal(product.status().admittedKnowledge.invalidAdmissionRecordCount, 1);
    assert.equal(product.status().admittedKnowledge.activeAdmissionRecordCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('default knowledge branches remain writable across source cuts on one backend', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-source-cut-'));
  try {
    const objectRoot = join(root, 'objects');
    const firstRoot = join(root, 'first');
    const secondRoot = join(root, 'second');
    mkdirSync(objectRoot);
    const objectBackendUri = pathToFileURL(objectRoot).href;
    const compileFor = (context, question, proposedBy) => {
      const prepared = context.prepareSearch({ question });
      const authorityProjection = authorityFor(context);
      return compileSourceNativeAdmittedKnowledgeBundle({
        proposedBy,
        proposedAt: '2026-09-05T08:00:00.000Z',
        ontId: context.descriptor.ontId,
        namespace: context.descriptor.namespace,
        artifactSha256: context.descriptor.artifactSha256,
        nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
        sourceCommitSha256: context.objectOnt.commitSha256,
        sourceReplaySha256: context.objectOnt.replaySha256,
        queryBinding: queryBindingFor(prepared),
        proofSufficiencyContract: contractFor(authorityProjection),
        proofAuthorityProjection: authorityProjection,
        propositions: [{ revisionId: 'status-current-r1', ...authorityProjection.items[0] }],
        relations: [],
      });
    };
    const question = 'What is the current issue status for issue-1?';
    buildSourceNativeProduct({ artifactRoot: firstRoot, objectBackendUri, input: buildInput() });
    let firstContext;
    openSourceNativeProductRuntime({ artifactRoot: firstRoot }, (value) => {
      firstContext = value;
      return null;
    });
    const first = admitBundle(compileFor(firstContext, question, 'first-investigator'));
    const firstWrite = writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: firstRoot },
      record: first.record,
      trustRegistry: first.trustRegistry,
    });

    const secondInput = buildInput();
    secondInput.sources[0] = {
      ...secondInput.sources[0],
      occurredAt: '2026-09-05T12:00:00.000Z',
      content: 'Done',
    };
    secondInput.nativeObjectInputs[0] = {
      ...secondInput.nativeObjectInputs[0],
      fields: [{ fieldPath: 'status', value: 'Done' }],
    };
    buildSourceNativeProduct({ artifactRoot: secondRoot, objectBackendUri, input: secondInput });
    let secondContext;
    openSourceNativeProductRuntime({ artifactRoot: secondRoot }, (value) => {
      secondContext = value;
      return null;
    });
    const second = admitBundle(compileFor(secondContext, question, 'second-investigator'));
    const secondWrite = writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: secondRoot },
      record: second.record,
      trustRegistry: second.trustRegistry,
    });
    assert.notEqual(secondWrite.branch, firstWrite.branch);
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: secondRoot },
      { trustRegistry: second.trustRegistry },
    );
    const verification = await product.verify({ question });
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.deepEqual(verification.context.map((row) => row.exactText), ['Done']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('semantically identical proposition Evidence order compiles to one bundle identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-canonical-bundle-'));
  try {
    const input = buildInput();
    input.sources.push({
      relativePath: 'linear/northwind/issue-2.txt',
      sourceType: 'linear',
      occurredAt: '2026-09-04T13:00:00.000Z',
      content: 'Blocked',
    });
    input.nativeObjectInputs.push({
      relativePath: 'linear/northwind/issue-2.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'linear', objectType: 'issue',
        namespace: 'northwind', externalId: 'issue-2',
      },
      fields: [{ fieldPath: 'status', value: 'Blocked' }],
    });
    buildSourceNativeProduct({ artifactRoot: root, input });
    let context;
    openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
      context = value;
      return null;
    });
    const prepared = context.prepareSearch({
      question: 'What is the current issue status for issue-1?',
    });
    const references = context.sources.map((source) => ({
      sourceRef: source.relativePath,
      sourceSha256: source.contentSha256,
      byteStart: 0,
      byteEnd: Buffer.byteLength(source.content),
      textSha256: objectBytesSha256(Buffer.from(source.content)),
    }));
    const authorityProjection = compileProofAuthorityProjection({
      sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
      sourceProjectionSha256: objectBytesSha256(Buffer.from('canonical-projection')),
      items: [{
        sourceProjectionItemId: 'status-current',
        familyId: 'issue-status',
        canonicalRoles: ['state'],
        modality: 'observed',
        polarity: 'positive',
        actorRef: 'linear:issue:northwind:issue-1',
        validAt: context.sources[0].occurredAt,
        knownAt: context.sources[0].occurredAt,
        exactEvidenceReferences: references,
      }],
      relations: [],
    });
    const item = authorityProjection.items[0];
    const compile = (exactEvidenceReferences) =>
      compileSourceNativeAdmittedKnowledgeBundle({
        proposedBy: 'investigator-agent',
        proposedAt: '2026-09-05T08:00:00.000Z',
        ontId: context.descriptor.ontId,
        namespace: context.descriptor.namespace,
        artifactSha256: context.descriptor.artifactSha256,
        nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
        sourceCommitSha256: context.objectOnt.commitSha256,
        sourceReplaySha256: context.objectOnt.replaySha256,
        queryBinding: queryBindingFor(prepared),
        proofSufficiencyContract: contractFor(authorityProjection),
        proofAuthorityProjection: authorityProjection,
        propositions: [{
          revisionId: 'status-current-r1',
          ...item,
          exactEvidenceReferences,
        }],
        relations: [],
      });
    const forward = compile([...item.exactEvidenceReferences]);
    const reversed = compile([...item.exactEvidenceReferences].reverse());
    assert.equal(reversed.bundleSha256, forward.bundleSha256);
    assert.deepEqual(reversed, forward);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cold verify returns one proof unit when many propositions cite the same exact Evidence',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'oont-admission-proof-unit-deduplication-'));
    try {
      const context = buildContext(root);
      const prepared = context.prepareSearch({
        question: 'What is the current issue status for issue-1?',
      });
      const base = authorityFor(context).items[0];
      const items = Array.from({ length: 64 }, (_, index) => ({
        ...base,
        sourceProjectionItemId: `status-current-${String(index).padStart(2, '0')}`,
      }));
      const authorityProjection = compileProofAuthorityProjection({
        sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
        sourceProjectionSha256: objectBytesSha256(Buffer.from('deduplicated-proof-units')),
        items,
        relations: [],
      });
      const contract = compileProofSufficiencyContract({
        questionKind: 'current-issue-status',
        sourceProjectionAuthority: proofAuthorityForProjection(authorityProjection),
        sufficiencyRule: 'Close state, exact support, and complete invalidator census.',
        stopWhen: 'Every required obligation and authoritative relation census is closed.',
        obligations: [{
          obligationId: 'state',
          propositionFamily: 'state',
          role: 'support',
          required: true,
          relationshipAnyOf: [],
          description: 'Current status state.',
          expectedSourceProjectionItemIds: items.map((item) =>
            item.sourceProjectionItemId),
          minimumCount: 1,
        }, {
          obligationId: 'exact-support',
          propositionFamily: 'exact-support',
          role: 'support',
          required: true,
          relationshipAnyOf: [],
          description: 'Exact source bytes for the state.',
          minimumCount: 1,
          sameFamilyAsObligationId: 'state',
        }, {
          obligationId: 'counterevidence',
          propositionFamily: 'counterevidence',
          role: 'invalidator',
          required: true,
          relationshipAnyOf: ['contradicts', 'qualifies'],
          description: 'Complete counterevidence census.',
          minimumCount: 0,
          relationshipDirection: 'outbound',
          relationshipTargetPropositionFamily: 'state',
        }],
      });
      const bundle = compileSourceNativeAdmittedKnowledgeBundle({
        proposedBy: 'deduplication-investigator',
        proposedAt: '2026-09-05T08:00:00.000Z',
        ontId: context.descriptor.ontId,
        namespace: context.descriptor.namespace,
        artifactSha256: context.descriptor.artifactSha256,
        nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
        sourceCommitSha256: context.objectOnt.commitSha256,
        sourceReplaySha256: context.objectOnt.replaySha256,
        queryBinding: queryBindingFor(prepared),
        proofSufficiencyContract: contract,
        proofAuthorityProjection: authorityProjection,
        propositions: items.map((item, index) => ({
          revisionId: `status-current-r${String(index).padStart(2, '0')}`,
          ...item,
        })),
        relations: [],
      });
      const admitted = admitBundle(bundle);
      writeSourceNativeAdmittedKnowledge({
        options: { artifactRoot: root },
        record: admitted.record,
        trustRegistry: admitted.trustRegistry,
      });
      const product = openSourceNativeProductWithAdmittedKnowledge(
        { artifactRoot: root },
        { trustRegistry: admitted.trustRegistry },
      );
      const verification = await product.verify({ question: prepared.question });
      assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
      assert.equal(verification.context.length, 1);
      assert.equal(verification.context[0].role, 'answer');
      assert.equal(verification.context[0].exactText, 'Ready');
      assert.match(verification.context[0].binding.proofUnitSha256,
        /^sha256:[0-9a-f]{64}$/u);
      assert.equal('propositionSha256' in verification.context[0].binding, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

test('durable Admission accepts 64 proof-context units and refuses 65', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-proof-unit-count-budget-'));
  try {
    const boundaryRoot = join(root, 'boundary');
    const boundary = createContextUnitDenseAdmission(boundaryRoot, 63);
    assert.doesNotThrow(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: boundaryRoot },
      record: boundary.record,
      trustRegistry: boundary.trustRegistry,
    }));
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: boundaryRoot },
      { trustRegistry: boundary.trustRegistry },
    );
    const verification = await product.verify({ question: boundary.question });
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.equal(verification.context.length, 64);

    const oversizedRoot = join(root, 'oversized');
    const admitted = createContextUnitDenseAdmission(oversizedRoot);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: oversizedRoot },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_CONTEXT_BUDGET' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission refuses more than 64 KiB of exact proof-context Evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-proof-byte-budget-'));
  try {
    const admitted = createOversizedEvidenceAdmission(root);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_CONTEXT_BUDGET' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cold open excludes an oversized planted Admission and preserves ordinary verification',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'oont-admission-planted-proof-budget-'));
    try {
      const { context, question, record, trustRegistry } =
        createOversizedEvidenceAdmission(root);
      plantAdmission(root, context, record);
      const product = openSourceNativeProductWithAdmittedKnowledge(
        { artifactRoot: root },
        { trustRegistry },
      );
      const verification = await product.verify({ question });
      assert.equal(verification.state, 'resolved-current-field');
      assert.equal(verification.answerable, true);
      assert.equal(verification.verification.navigationProposals.rawSearchExecuted, true);
      assert.equal(product.status().admittedKnowledge.state, 'degraded');
      assert.equal(product.status().admittedKnowledge.invalidAdmissionRecordCount, 1);
      assert.equal(product.status().admittedKnowledge.activeAdmissionRecordCount, 0);
      assert.ok(product.status().admittedKnowledge.diagnosticCodes
        .includes('SOURCE_NATIVE_ADMITTED_KNOWLEDGE_CONTEXT_BUDGET'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

test('a UTF-8-invalid Admission stays in history and can be superseded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-utf8-boundary-'));
  try {
    const input = buildInput();
    input.sources[0] = { ...input.sources[0], content: 'é' };
    input.nativeObjectInputs[0] = {
      ...input.nativeObjectInputs[0],
      fields: [{ fieldPath: 'status', value: 'é' }],
    };
    buildSourceNativeProduct({ artifactRoot: root, input });
    let context;
    openSourceNativeProductRuntime({ artifactRoot: root }, (value) => {
      context = value;
      return null;
    });
    const prepared = context.prepareSearch({
      question: 'What is the current issue status for issue-1?',
    });
    const source = context.sources[0];
    const sourceBytes = Buffer.from(source.content);
    const support = {
      sourceProjectionItemId: 'status-current',
      familyId: 'issue-status',
      canonicalRoles: ['state'],
      modality: 'observed',
      polarity: 'positive',
      actorRef: 'linear:issue:northwind:issue-1',
      validAt: source.occurredAt,
      knownAt: source.occurredAt,
      exactEvidenceReferences: [{
        sourceRef: source.relativePath,
        sourceSha256: source.contentSha256,
        byteStart: 0,
        byteEnd: sourceBytes.length,
        textSha256: objectBytesSha256(sourceBytes),
      }],
    };
    const counterevidence = {
      sourceProjectionItemId: 'counterevidence-split-byte',
      familyId: 'issue-status-counter',
      canonicalRoles: ['counterevidence'],
      modality: 'observed',
      polarity: 'negative',
      actorRef: 'linear:issue:northwind:issue-1',
      validAt: source.occurredAt,
      knownAt: source.occurredAt,
      exactEvidenceReferences: [{
        sourceRef: source.relativePath,
        sourceSha256: source.contentSha256,
        byteStart: 0,
        byteEnd: 1,
        textSha256: objectBytesSha256(sourceBytes.subarray(0, 1)),
      }],
    };
    const authorityProjection = compileProofAuthorityProjection({
      sourceProjectionKind: 'OpenOntologyTestSemanticProjectionV1',
      sourceProjectionSha256: objectBytesSha256(Buffer.from('utf8-boundary-projection')),
      items: [support, counterevidence],
      relations: [{
        type: 'qualifies',
        sourceProjectionItemId: counterevidence.sourceProjectionItemId,
        targetProjectionItemId: support.sourceProjectionItemId,
      }],
    });
    const authorityById = new Map(authorityProjection.items.map((item) =>
      [item.sourceProjectionItemId, item]));
    const bundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'utf8-boundary-investigator',
      proposedAt: '2026-09-05T08:00:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(authorityProjection),
      proofAuthorityProjection: authorityProjection,
      propositions: [{
        revisionId: 'status-current-r1',
        ...authorityById.get(support.sourceProjectionItemId),
      }, {
        revisionId: 'counterevidence-split-byte-r1',
        ...authorityById.get(counterevidence.sourceProjectionItemId),
      }],
      relations: [{
        type: 'qualifies',
        sourceRevisionId: 'counterevidence-split-byte-r1',
        targetRevisionId: 'status-current-r1',
      }],
    });
    const admitted = admitBundle(bundle);
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_EXACT_EVIDENCE' });
    plantAdmission(root, context, admitted.record);

    const correctionAuthority = authorityFor(context);
    const correctionBundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'utf8-correction-investigator',
      proposedAt: '2026-09-05T08:10:00.000Z',
      ontId: context.descriptor.ontId,
      namespace: context.descriptor.namespace,
      artifactSha256: context.descriptor.artifactSha256,
      nativeObjectMapSha256: context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: context.objectOnt.commitSha256,
      sourceReplaySha256: context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(correctionAuthority),
      proofAuthorityProjection: correctionAuthority,
      propositions: [{
        revisionId: 'utf8-correction-status-r1',
        ...correctionAuthority.items[0],
      }],
      relations: [],
    });
    const correction = admitBundle(correctionBundle, {
      issuerId: 'utf8-correction-reviewer',
      admittedAt: '2026-09-05T08:15:00.000Z',
      supersedesRecordSha256s: [admitted.record.recordSha256],
    });
    const trustRegistry = [...admitted.trustRegistry, ...correction.trustRegistry];
    assert.doesNotThrow(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: correction.record,
      trustRegistry,
    }));
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry },
    );
    const verification = await product.verify({ question: prepared.question });
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.deepEqual(verification.verification.supersededAdmissionRecordSha256s,
      [admitted.record.recordSha256]);
    assert.equal(product.status().admittedKnowledge.activeAdmissionRecordCount, 1);
    assert.equal(product.status().admittedKnowledge.invalidAdmissionRecordCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable Admission bounds JSON-encoded Evidence text without truncating it', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-encoded-evidence-budget-'));
  try {
    const asciiRoot = join(root, 'ascii');
    const ascii = createEvidenceAdmission(asciiRoot, {
      content: 'x'.repeat(64 * 1024),
      proposedBy: 'encoded-evidence-ascii-boundary-investigator',
    });
    assert.doesNotThrow(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: asciiRoot },
      record: ascii.record,
      trustRegistry: ascii.trustRegistry,
    }));
    const encodedRoot = join(root, 'encoded');
    const admitted = createEvidenceAdmission(encodedRoot, {
      content: '\u0001'.repeat(64 * 1024),
      proposedBy: 'encoded-evidence-budget-investigator',
    });
    assert.throws(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: encodedRoot },
      record: admitted.record,
      trustRegistry: admitted.trustRegistry,
    }), { code: 'SOURCE_NATIVE_ADMITTED_KNOWLEDGE_CONTEXT_BUDGET' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a bounded correction can supersede an oversized planted Admission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-admission-oversized-supersession-'));
  try {
    const oversized = createContextUnitDenseAdmission(root);
    plantAdmission(root, oversized.context, oversized.record);
    const prepared = oversized.context.prepareSearch({ question: oversized.question });
    const authorityProjection = authorityFor(oversized.context);
    const correctionBundle = compileSourceNativeAdmittedKnowledgeBundle({
      proposedBy: 'bounded-correction-investigator',
      proposedAt: '2026-09-05T08:10:00.000Z',
      ontId: oversized.context.descriptor.ontId,
      namespace: oversized.context.descriptor.namespace,
      artifactSha256: oversized.context.descriptor.artifactSha256,
      nativeObjectMapSha256: oversized.context.objectOnt.map.nativeObjectMapSha256,
      sourceCommitSha256: oversized.context.objectOnt.commitSha256,
      sourceReplaySha256: oversized.context.objectOnt.replaySha256,
      queryBinding: queryBindingFor(prepared),
      proofSufficiencyContract: contractFor(authorityProjection),
      proofAuthorityProjection: authorityProjection,
      propositions: [{
        revisionId: 'bounded-status-current-r1',
        ...authorityProjection.items[0],
      }],
      relations: [],
    });
    const correction = admitBundle(correctionBundle, {
      issuerId: 'bounded-correction-reviewer',
      admittedAt: '2026-09-05T08:15:00.000Z',
      supersedesRecordSha256s: [oversized.record.recordSha256],
    });
    const trustRegistry = [...oversized.trustRegistry, ...correction.trustRegistry];
    assert.doesNotThrow(() => writeSourceNativeAdmittedKnowledge({
      options: { artifactRoot: root },
      record: correction.record,
      trustRegistry,
    }));
    const product = openSourceNativeProductWithAdmittedKnowledge(
      { artifactRoot: root },
      { trustRegistry },
    );
    const verification = await product.verify({ question: oversized.question });
    assert.equal(verification.state, 'resolved-admitted-knowledge-proof-closure');
    assert.equal(verification.answerable, true);
    assert.deepEqual(verification.verification.supersededAdmissionRecordSha256s,
      [oversized.record.recordSha256]);
    assert.equal(product.status().admittedKnowledge.activeAdmissionRecordCount, 1);
    assert.equal(product.status().admittedKnowledge.supersededAdmissionRecordCount, 1);
    assert.equal(product.status().admittedKnowledge.invalidAdmissionRecordCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
