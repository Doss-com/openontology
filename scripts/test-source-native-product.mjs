import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { openOntology } from '../dist/src/openontology.mjs';
import {
  buildSourceNativeProduct,
  openSourceNativeProduct,
  openSourceNativeProductRuntime,
} from '../dist/src/source-native-product.mjs';
import { stableObjectSha256 } from '../dist/src/canonical-content.mjs';
import {
  openExactProductArtifactState,
  openProductState,
} from '../dist/src/source-native-artifact.mjs';

const resolverCli = join(import.meta.dirname, '..', 'dist', 'scripts', 'oont-resolver.mjs');
const publicCli = join(import.meta.dirname, '..', 'dist', 'bin', 'oont.mjs');

function buildInput() {
  const revisions = [
    ['clickup/acme/rev-1.md', '2026-01-01T00:00:00.000Z', 'Alpha'],
    ['clickup/acme/rev-2.md', '2026-02-01T00:00:00.000Z', 'Beta'],
    ['clickup/acme/rev-3.md', '2026-03-01T00:00:00.000Z', 'Gamma'],
  ];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'preview-acme',
    namespace: 'acme',
    querySchemas: [{
      sourceSystem: 'clickup',
      objectType: 'task',
      aliases: ['task', 'task record'],
      fields: [{ fieldPath: 'title', aliases: ['title', 'task title'] }],
    }],
    sources: revisions.map(([relativePath, occurredAt, content]) => ({
      relativePath,
      sourceType: 'clickup',
      occurredAt,
      content,
    })),
    nativeObjectInputs: revisions.map(([relativePath, _occurredAt, content]) => ({
      relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'task',
        namespace: 'acme',
        externalId: 'task-1',
      },
      fields: [{ fieldPath: 'title', value: content }],
    })),
  };
}

function buildAdversarialChronologyInput() {
  const revisions = [
    ['linear/northwind/nwd-418-r1.txt', '2026-01-04T09:00:00.000Z',
      'Issue NWD-418 redwood migration checkpoint. Status: In Progress.', 'NWD-418', 'In Progress'],
    ['linear/northwind/nwd-418-r2.txt', '2026-01-11T09:00:00.000Z',
      'Status: Blocked.', 'NWD-418', 'Blocked'],
    ['linear/northwind/nwd-418-r3.txt', '2026-01-18T09:00:00.000Z',
      'Status: Done.', 'NWD-418', 'Done'],
  ];
  const decoys = [
    ['In Progress', 'D-001'], ['In Progress', 'D-002'], ['Blocked', 'D-003'], ['Done', 'D-004'],
    ['In Progress', 'D-005'], ['Blocked', 'D-006'], ['Done', 'D-007'], ['In Progress', 'D-008'],
  ].map(([status, externalId], index) => [
    `linear/northwind/decoy-${String(index + 1).padStart(3, '0')}.txt`,
    `2026-02-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
    `Issue ${externalId}. Status: ${status}. NWD-418 redwood migration appeared in a dependency note.`,
    externalId,
    status,
  ]);
  const rows = [...revisions, ...decoys];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'northwind-adversarial-chronology',
    namespace: 'northwind',
    querySchemas: [{
      sourceSystem: 'linear',
      objectType: 'issue',
      aliases: ['issue', 'work item'],
      fields: [{ fieldPath: 'status', aliases: ['status', 'issue status', 'state'] }],
    }],
    sources: rows.map(([relativePath, occurredAt, content]) => ({
      relativePath, sourceType: 'linear', occurredAt, content,
    })),
    nativeObjectInputs: rows.map(([relativePath, _occurredAt, _content, externalId, status]) => ({
      relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'linear', objectType: 'issue',
        namespace: 'northwind', externalId,
      },
      fields: [{ fieldPath: 'status', value: status }],
    })),
  };
}

function buildSemanticVerificationInput() {
  const status = 'passed';
  const exception = 'payment evidence remained unreviewed';
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'northwind-semantic-verification',
    namespace: 'northwind',
    querySchemas: [{
      sourceSystem: 'linear', objectType: 'issue', aliases: ['issue'],
      fields: [
        { fieldPath: 'validationStatus', aliases: ['validation status'] },
        { fieldPath: 'validationException', aliases: ['validation exception'] },
      ],
    }],
    sources: [{
      relativePath: 'linear/northwind/issue-1-status.txt', sourceType: 'linear',
      occurredAt: '2026-09-01T10:00:00.000Z', content: `Validation status: ${status}.`,
    }, {
      relativePath: 'linear/northwind/issue-1-exception.txt', sourceType: 'linear',
      occurredAt: '2026-09-01T10:01:00.000Z', content: `Exception: ${exception}.`,
    }],
    nativeObjectInputs: [{
      relativePath: 'linear/northwind/issue-1-status.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'linear', objectType: 'issue',
        namespace: 'northwind', externalId: 'issue-1',
      },
      businessEntityKeys: ['issue:issue-1'],
      fields: [{
        fieldPath: 'validationStatus', propositionFamilyKey: 'issue-validation',
        businessEntityKeys: ['issue:issue-1'], value: status,
        validAt: '2026-09-01T09:59:00.000Z', knownAt: '2026-09-01T10:00:00.000Z',
        canonicalProposition: {
          kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
          propositionKey: 'issue-1-validation-passed',
          actorHome: 'ObjectDef/InstanceRef',
          stateHome: 'Claim/PropositionRevision-payload',
          actorKind: 'issue', predicate: 'has-validation-status', state: status,
          dimension: 'issue-validation', canonicalRoles: ['state'],
          modality: 'observed', polarity: 'positive',
          businessEntityKeys: ['issue:issue-1'],
          extractionAuthority: 'deterministic-source-adapter-v1', relations: [],
        },
      }],
    }, {
      relativePath: 'linear/northwind/issue-1-exception.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef', sourceSystem: 'linear', objectType: 'issue',
        namespace: 'northwind', externalId: 'issue-1',
      },
      businessEntityKeys: ['issue:issue-1'],
      fields: [{
        fieldPath: 'validationException',
        propositionFamilyKey: 'issue-validation-exception',
        businessEntityKeys: ['issue:issue-1'], value: exception,
        validAt: '2026-09-01T09:58:00.000Z', knownAt: '2026-09-01T10:01:00.000Z',
        canonicalProposition: {
          kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
          propositionKey: 'issue-1-payment-unreviewed',
          actorHome: 'ObjectDef/InstanceRef',
          stateHome: 'Claim/PropositionRevision-payload',
          actorKind: 'issue', predicate: 'has-validation-exception', state: exception,
          dimension: 'issue-validation-exception', canonicalRoles: ['counterevidence'],
          modality: 'observed', polarity: 'negative',
          businessEntityKeys: ['issue:issue-1'],
          extractionAuthority: 'deterministic-source-adapter-v1',
          relations: [{
            kind: 'OpenOntologySourceNativePropositionRelationV1', type: 'qualifies',
            targetPropositionKey: 'issue-1-validation-passed',
          }],
        },
      }],
    }],
  };
}

function buildSemanticContextBudgetInput({ counterevidenceCount = 64,
  counterevidenceValue = null } = {}) {
  const rootValue = 'passed';
  const businessEntityKeys = ['issue:issue-budget'];
  const objectIdentity = {
    home: 'ObjectDef/InstanceRef', sourceSystem: 'linear', objectType: 'issue',
    namespace: 'northwind', externalId: 'issue-budget',
  };
  const root = {
    relativePath: 'linear/northwind/issue-budget-status.txt',
    occurredAt: '2026-09-01T10:00:00.000Z',
    value: rootValue,
  };
  const exceptions = Array.from({ length: counterevidenceCount }, (_, index) => ({
    relativePath: `linear/northwind/issue-budget-exception-${String(index).padStart(3, '0')}.txt`,
    occurredAt: new Date(Date.parse('2026-09-01T10:01:00.000Z') + index * 1000).toISOString(),
    value: counterevidenceValue ?? `qualification-${String(index).padStart(3, '0')}`,
    propositionKey: `issue-budget-qualification-${String(index).padStart(3, '0')}`,
  }));
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'northwind-semantic-context-budget',
    namespace: 'northwind',
    querySchemas: [{
      sourceSystem: 'linear', objectType: 'issue', aliases: ['issue'],
      fields: [
        { fieldPath: 'validationStatus', aliases: ['validation status'] },
        { fieldPath: 'validationException', aliases: ['validation exception'] },
      ],
    }],
    sources: [root, ...exceptions].map(row => ({
      relativePath: row.relativePath,
      sourceType: 'linear',
      occurredAt: row.occurredAt,
      content: row.value,
    })),
    nativeObjectInputs: [{
      relativePath: root.relativePath,
      objectIdentity,
      businessEntityKeys,
      fields: [{
        fieldPath: 'validationStatus', propositionFamilyKey: 'issue-validation',
        businessEntityKeys, value: root.value,
        validAt: root.occurredAt, knownAt: root.occurredAt,
        canonicalProposition: {
          kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
          propositionKey: 'issue-budget-validation-passed',
          actorHome: 'ObjectDef/InstanceRef',
          stateHome: 'Claim/PropositionRevision-payload',
          actorKind: 'issue', predicate: 'has-validation-status', state: root.value,
          dimension: 'issue-validation', canonicalRoles: ['state'],
          modality: 'observed', polarity: 'positive', businessEntityKeys,
          extractionAuthority: 'deterministic-source-adapter-v1', relations: [],
        },
      }],
    }, ...exceptions.map(row => ({
      relativePath: row.relativePath,
      objectIdentity,
      businessEntityKeys,
      fields: [{
        fieldPath: 'validationException',
        propositionFamilyKey: 'issue-validation-exception',
        businessEntityKeys, value: row.value,
        validAt: row.occurredAt, knownAt: row.occurredAt,
        canonicalProposition: {
          kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
          propositionKey: row.propositionKey,
          actorHome: 'ObjectDef/InstanceRef',
          stateHome: 'Claim/PropositionRevision-payload',
          actorKind: 'issue', predicate: 'has-validation-exception', state: row.value,
          dimension: 'issue-validation-exception', canonicalRoles: ['counterevidence'],
          modality: 'observed', polarity: 'negative', businessEntityKeys,
          extractionAuthority: 'deterministic-source-adapter-v1',
          relations: [{
            kind: 'OpenOntologySourceNativePropositionRelationV1', type: 'qualifies',
            targetPropositionKey: 'issue-budget-validation-passed',
          }],
        },
      }],
    }))],
  };
}

function hostedSeedSearchAdapter(context, {
  declaration = 8,
  networkCalls = 2,
  receiptNetworkCalls = networkCalls,
  networkCallsForQuestion = null,
  omitReceiptNetworkCalls = false,
  mutateReceiptHash = false,
  delayMs = 0,
  beforeResponse = null,
} = {}) {
  const { session } = context;
  const responseFor = (question) => {
    const observedNetworkCalls = typeof networkCallsForQuestion === 'function'
      ? networkCallsForQuestion(question) : receiptNetworkCalls;
    const rows = session.sourceHandles.map((handle, index) => ({
      rank: index + 1,
      sourceMessageId: handle.sourceMessageId,
      relativePath: handle.relativePath,
    }));
    const responseCore = {
      kind: 'OpenOntologySourceNativeSeedSearchResultV1',
      sourceCommitSha256: session.sourceCommitSha256,
      sourceReplaySha256: session.sourceReplaySha256,
      sourceSearchRouteMapSha256: session.sourceSearchRouteMapSha256,
      sourceHandleSetSha256: session.sourceHandleSetSha256,
      query: question,
      rows,
    };
    const response = { ...responseCore, resultSha256: stableObjectSha256(responseCore) };
    const receiptCore = {
      commitSha256: session.sourceCommitSha256,
      replaySha256: session.sourceReplaySha256,
      ...(omitReceiptNetworkCalls ? {} : { networkCalls: observedNetworkCalls }),
    };
    const receipt = {
      ...receiptCore,
      receiptSha256: mutateReceiptHash
        ? stableObjectSha256({ ...receiptCore, networkCalls: observedNetworkCalls + 1 })
        : stableObjectSha256(receiptCore),
    };
    return { response, receipt };
  };
  return {
    kind: 'OpenOntologySourceNativeSeedSearchAdapterV1',
    sourceCommitSha256: session.sourceCommitSha256,
    sourceReplaySha256: session.sourceReplaySha256,
    sourceSearchRouteMapSha256: session.sourceSearchRouteMapSha256,
    sourceHandleSetSha256: session.sourceHandleSetSha256,
    modelCalls: 0,
    networkCalls: declaration,
    search: async ({ query }) => {
      if (typeof beforeResponse === 'function') await beforeResponse(query);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return responseFor(query);
    },
  };
}

test('accounts hosted seed-search calls in current and immediate successor Resolver results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-hosted-accounting-'));
  const resolutions = [];
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    let runtimeContext;
    const product = openSourceNativeProductRuntime({ artifactRoot: root }, (context) => {
      runtimeContext = context;
      return {
        seedSearchAdapter: hostedSeedSearchAdapter(context, { declaration: 8, networkCalls: 2 }),
        recordSearch: ({ resolution }) => { if (resolution) resolutions.push(resolution); },
      };
    });
    assert.ok(runtimeContext);

    const current = await product.search({
      question: 'What is the current task title for task-1?',
    });
    assert.equal(current.state, 'resolved-current-field');
    assert.equal(resolutions[0].networkCalls, 2);
    assert.equal(current.verification.navigationProposals.seedSearchNetworkCalls, 2);

    const next = await product.search({
      question: 'What task title immediately followed Alpha for task-1?',
      intent: 'next',
    });
    assert.equal(next.state, 'resolved-next-field-revision');
    assert.equal(resolutions[1].networkCalls, 2);
    assert.equal(next.verification.navigationProposals.seedSearchNetworkCalls, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed or over-declared hosted seed-search network counts', async () => {
  const cases = [
    { declaration: -1, networkCalls: 0, expectedCode: 'SOURCE_NATIVE_SEED_SEARCH_ADAPTER' },
    { declaration: 1.5, networkCalls: 0, expectedCode: 'SOURCE_NATIVE_SEED_SEARCH_ADAPTER' },
    { declaration: '1', networkCalls: 0, expectedCode: 'SOURCE_NATIVE_SEED_SEARCH_ADAPTER' },
    { declaration: 1001, networkCalls: 0, expectedCode: 'SOURCE_NATIVE_SEED_SEARCH_ADAPTER' },
    { declaration: 4, receiptNetworkCalls: -1, expectedCode: 'SOURCE_NATIVE_SEED_SEARCH_RESULT' },
    { declaration: 4, receiptNetworkCalls: 1.5, expectedCode: 'SOURCE_NATIVE_SEED_SEARCH_RESULT' },
    { declaration: 4, receiptNetworkCalls: '1', expectedCode: 'SOURCE_NATIVE_SEED_SEARCH_RESULT' },
    { declaration: 4, receiptNetworkCalls: 5, expectedCode: 'SOURCE_NATIVE_SEED_SEARCH_RESULT' },
  ];
  for (const adapterOptions of cases) {
    const root = mkdtempSync(join(tmpdir(), 'oont-source-native-hosted-accounting-invalid-'));
    try {
      buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
      const product = openSourceNativeProductRuntime({ artifactRoot: root }, (context) => ({
        seedSearchAdapter: hostedSeedSearchAdapter(context, adapterOptions),
      }));
      await assert.rejects(product.search({
        question: 'What is the current task title for task-1?',
      }), { code: adapterOptions.expectedCode });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('requires an explicit receipt count for a hosted seed-search declaration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-hosted-accounting-missing-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const product = openSourceNativeProductRuntime({ artifactRoot: root }, (context) => ({
      seedSearchAdapter: hostedSeedSearchAdapter(context, {
        declaration: 4,
        networkCalls: 2,
        omitReceiptNetworkCalls: true,
      }),
    }));
    await assert.rejects(product.search({
      question: 'What is the current task title for task-1?',
    }), { code: 'SOURCE_NATIVE_SEED_SEARCH_RESULT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps overlapping hosted seed-search counts request-local', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-hosted-accounting-overlap-'));
  const records = [];
  let entered = 0;
  let release;
  const bothSearchesEntered = new Promise((resolve) => { release = resolve; });
  const beforeResponse = async () => {
    entered += 1;
    if (entered === 2) release();
    await bothSearchesEntered;
  };
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const product = openSourceNativeProductRuntime({ artifactRoot: root }, (context) => ({
      seedSearchAdapter: hostedSeedSearchAdapter(context, {
        declaration: 8,
        networkCallsForQuestion: (question) => question.includes('Alpha') ? 5 : 2,
        beforeResponse,
      }),
      recordSearch: ({ question, resolution }) => {
        if (resolution) records.push({ question, resolution });
      },
    }));
    const [current, next] = await Promise.all([
      product.search({ question: 'What is the current task title for task-1?' }),
      product.search({
        question: 'What task title immediately followed Alpha for task-1?',
        intent: 'next',
      }),
    ]);
    assert.equal(current.verification.navigationProposals.seedSearchNetworkCalls, 2);
    assert.equal(next.verification.navigationProposals.seedSearchNetworkCalls, 5);
    assert.equal(records.find((row) => row.question.includes('current')).resolution.networkCalls, 2);
    assert.equal(records.find((row) => row.question.includes('Alpha')).resolution.networkCalls, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('builds, reopens, searches, reads, and verifies an immutable source-native product artifact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-'));
  try {
    const first = buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    assert.equal(first.receipt.status, 'SOURCE_NATIVE_OBJECT_ONT_DURABLE');
    assert.equal(first.receipt.replayed, false);
    const replay = buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    assert.equal(replay.receipt.replayed, true);

    const product = openSourceNativeProduct({ artifactRoot: root });
    assert.equal(product.status().sourceCount, 3);
    assert.equal(product.status().fieldRevisionCount, 2);
    for (const controlPlaneOptions of [
      { knowledgeProposalCapture: true },
      { investigationRecording: {} },
      { activeSearchPolicyChannelId: 'untrusted-channel' },
    ]) {
      assert.throws(() => openSourceNativeProduct({
        artifactRoot: root,
        ...controlPlaneOptions,
      }), (error) => error?.code === 'SOURCE_NATIVE_PRODUCT_OPTIONS');
    }

    const current = await product.search({
      question: 'After Alpha, what is the current task title for task-1?',
    });
    assert.equal(current.state, 'resolved-current-field');
    assert.equal(current.matches.length, 1);
    assert.equal(JSON.stringify(current).includes('Gamma'), false);
    const currentEvidence = await product.read({ ref: current.matches[0].ref });
    assert.equal(currentEvidence.exactText, 'Gamma');
    assert.equal(currentEvidence.binding.externalId, 'task-1');
    assert.equal(currentEvidence.binding.fieldPath, 'title');

    const resolvedContext = await product.verify({
      question: 'What is the current task title for task-1?',
    });
    assert.equal(resolvedContext.kind, 'OpenOntologySourceNativeVerificationV1');
    assert.equal(resolvedContext.state, 'resolved-current-field');
    assert.equal(resolvedContext.answerable, true);
    assert.equal(resolvedContext.context.length, 1);
    assert.equal(resolvedContext.context[0].exactText, 'Gamma');
    assert.equal(resolvedContext.context[0].binding.externalId, 'task-1');
    assert.equal(resolvedContext.verification.currentFieldChronology.proofDisposition,
      'sufficient');
    assert.equal(resolvedContext.verification.currentFieldChronology.scope,
      'latest-recorded-field-over-bound-source-cut');
    assert.equal(resolvedContext.verification.currentFieldChronology.identityObservationCount, 3);
    assert.equal(resolvedContext.verification.currentFieldChronology.fieldObservationCount, 3);
    assert.equal(resolvedContext.verification.currentFieldChronology.fieldRevisionCount, 2);
    assert.equal(resolvedContext.verification.navigationProposals.state, 'raw-only');
    assert.equal(resolvedContext.verification.navigationProposals.learnedRouteUsed, false);
    assert.equal(resolvedContext.verification.navigationProposals.rawSearchExecuted, true);
    assert.equal(resolvedContext.verification.navigationProposals.seedSearchNetworkCalls, 0);
    assert.equal(Object.hasOwn(resolvedContext, 'proofDisposition'), false);
    assert.equal(Object.hasOwn(resolvedContext, 'learning'), false);
    assert.match(resolvedContext.verificationSha256, /^sha256:[0-9a-f]{64}$/u);

    const client = openOntology({ artifactRoot: root });
    const clientContext = await client.verify('What is the current task title for task-1?');
    assert.equal(client.kind, 'OpenOntologyClientV2');
    assert.equal(clientContext.context[0].exactText, 'Gamma');
    assert.equal(Object.hasOwn(clientContext, 'learning'), false);
    assert.equal((await client.search('What is the current task title for task-1?')).matches.length,
      1);

    const currentWithUnusedAnchor = await product.search({
      question: 'What is the current task title for task-1?',
      intent: 'current',
      anchorValue: 'task-1',
    });
    assert.equal(currentWithUnusedAnchor.state, 'resolved-current-field');
    const currentWithBlankAnchor = await product.search({
      question: 'What is the current task title for task-1?',
      intent: 'current',
      anchorValue: ' ',
    });
    assert.equal(currentWithBlankAnchor.state, 'resolved-current-field');

    const currentWithoutLexicalHit = await product.search({
      question: 'What is the current value?',
      typedQuery: {
        sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title',
      },
    });
    assert.equal(currentWithoutLexicalHit.state, 'resolved-current-field');
    assert.equal((await product.read({ ref: currentWithoutLexicalHit.matches[0].ref })).exactText, 'Gamma');

    const next = await product.search({
      question: 'What task title immediately followed Alpha for task-1?',
      intent: 'next',
    });
    assert.equal(next.state, 'resolved-next-field-revision');
    assert.equal(next.verification.navigationProposals.seedSearchNetworkCalls, 0);
    assert.equal(next.matches.length, 2);
    assert.ok(next.verification.searchPathSha256);
    assert.equal(JSON.stringify(next).includes('Beta'), false);
    const nextEvidence = await product.read({ ref: next.matches.find((match) => match.role === 'answer').ref });
    assert.equal(nextEvidence.exactText, 'Beta');
    assert.equal(nextEvidence.binding.role, 'answer');
    assert.equal(nextEvidence.binding.selectionMode, 'next-recorded-field-revision');
    assert.equal(nextEvidence.binding.searchPathSha256, next.verification.searchPathSha256);
    const anchorEvidence = await product.read({ ref: next.matches.find((match) => match.role === 'anchor').ref });
    assert.equal(anchorEvidence.exactText, 'Alpha');
    assert.equal(anchorEvidence.binding.role, 'anchor');

    const nextWithoutLexicalHit = await product.search({
      question: 'What immediately followed?',
      intent: 'next',
      typedQuery: {
        sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title',
      },
    });
    assert.equal(nextWithoutLexicalHit.state, 'unavailable-native-field-anchor-not-matched');
    assert.deepEqual(nextWithoutLexicalHit.matches, []);

    const unavailable = await product.search({
      question: 'What is the deployment score for this task?',
    });
    assert.equal(unavailable.state, 'unavailable-native-field-not-declared');
    assert.deepEqual(unavailable.matches, []);
    assert.deepEqual(unavailable.availableFields.map((field) => field.fieldPath), ['title']);
    const typedUnavailable = await product.search({
      question: 'Who owns task-1?',
      typedQuery: {
        sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'owner',
      },
    });
    assert.equal(typedUnavailable.state, 'unavailable-native-field-not-declared');

    const unresolvedContext = await product.verify({
      question: 'Who owns task-1?',
      typedQuery: {
        sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'owner',
      },
    });
    assert.equal(unresolvedContext.answerable, false);
    assert.deepEqual(unresolvedContext.context, []);
    assert.equal(Object.hasOwn(unresolvedContext, 'learning'), false);

    const reopened = openSourceNativeProduct({ artifactRoot: root });
    await assert.rejects(reopened.read({ ref: current.matches[0].ref }), {
      code: 'SOURCE_NATIVE_PRODUCT_READ',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('materialization checkpoints the source ref before product opens', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-checkpoint-'));
  try {
    const built = buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const ordinary = openProductState({ artifactRoot: root });
    const exact = openExactProductArtifactState({ artifactRoot: root });
    assert.equal(ordinary.replayMetadataSource, 'checkpoint');
    assert.equal(exact.replayMetadataSource, 'checkpoint');
    assert.match(ordinary.replayIndexCheckpointSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(exact.replayIndexCheckpointSha256, ordinary.replayIndexCheckpointSha256);
    assert.equal(ordinary.objectOnt.commitSha256, built.receipt.commitSha256);
    assert.equal(exact.objectOnt.commitSha256, built.receipt.commitSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('product opens fall back to graph replay when its checkpoint is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-graph-fallback-'));
  try {
    const built = buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const key = `replay-indexes/sha256/${built.receipt.replaySha256.slice(7)}.json`;
    const keyHash = createHash('sha256').update(key).digest('hex');
    const checkpointPath = join(
      root, 'objects', 'objects', keyHash.slice(0, 2), `${keyHash.slice(2)}.json`,
    );
    assert.equal(existsSync(checkpointPath), true);
    rmSync(checkpointPath);
    assert.equal(openProductState({ artifactRoot: root }).replayMetadataSource, 'graph');
    assert.equal(openExactProductArtifactState({ artifactRoot: root }).replayMetadataSource, 'graph');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary verify closes source-native counterevidence over exact Corpus spans', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-verify-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticVerificationInput() });
    const product = openOntology({ artifactRoot: root });
    const query = {
      question: 'What is the current validation status for issue-1?',
      scope: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-1',
        field: 'validationStatus',
      },
    };
    const search = await product.search(query);
    assert.deepEqual(search.matches.map((match) => match.role), ['answer', 'counterevidence']);
    assert.equal(JSON.stringify(search).includes('payment evidence remained unreviewed'), false);
    assert.equal(search.verification.semanticProofAuthority.propositionCount, 2);
    assert.equal(search.verification.semanticProofAuthority.relationCount, 1);
    assert.equal(Object.hasOwn(search.verification, 'semanticProof'), false);

    const verified = await product.verify(query);
    assert.equal(verified.answerable, true);
    assert.equal(verified.proofDisposition, 'qualified');
    assert.deepEqual(verified.context.map((row) => [row.role, row.exactText]), [
      ['answer', 'passed'],
      ['counterevidence', 'payment evidence remained unreviewed'],
    ]);
    assert.equal(verified.verification.semanticProof.proofClosed, true);
    assert.equal(verified.verification.semanticProof.propositionCount, 2);
    assert.equal(verified.verification.semanticProof.relationCount, 1);
    assert.equal(verified.verification.semanticProof.exactEvidenceReferenceCount, 2);
    assert.match(verified.verification.semanticProof.proofCensusSha256,
      /^sha256:[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary verify refuses a semantic closure above 64 exact Evidence units', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-unit-budget-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildSemanticContextBudgetInput() });
    const product = openOntology({ artifactRoot: root });
    const query = {
      question: 'What is the current validation status for issue-budget?',
      scope: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-budget',
        field: 'validationStatus',
      },
    };
    const search = await product.search(query);
    assert.equal(search.state, 'unavailable-semantic-proof-context-budget');
    assert.deepEqual(search.matches, []);
    assert.equal(search.verification.semanticProofAuthority, undefined);
    assert.equal(search.verification.semanticProofRefusal.kind,
      'OpenOntologySourceNativeSemanticProofRefusalV1');
    assert.equal(search.verification.semanticProofRefusal.code,
      'semantic-proof-context-budget-exceeded');
    assert.equal(search.verification.semanticProofRefusal.observedEvidenceReferenceCount, 65);
    assert.equal(search.verification.semanticProofRefusal.maximumEvidenceReferenceCount, 64);

    const verified = await product.verify(query);
    assert.equal(verified.answerable, false);
    assert.deepEqual(verified.context, []);
    assert.equal(verified.proofDisposition, undefined);
    assert.deepEqual(verified.verification.semanticProofRefusal,
      search.verification.semanticProofRefusal);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary verify accepts exactly 64 semantic exact Evidence units', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-unit-boundary-'));
  try {
    buildSourceNativeProduct({
      artifactRoot: root,
      input: buildSemanticContextBudgetInput({ counterevidenceCount: 63 }),
    });
    const product = openOntology({ artifactRoot: root });
    const verified = await product.verify({
      question: 'What is the current validation status for issue-budget?',
      scope: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-budget',
        field: 'validationStatus',
      },
    });
    assert.equal(verified.state, 'resolved-current-field');
    assert.equal(verified.answerable, true);
    assert.equal(verified.proofDisposition, 'qualified');
    assert.equal(verified.context.length, 64);
    assert.equal(verified.verification.semanticProof.exactEvidenceReferenceCount, 64);
    assert.equal(verified.verification.semanticProofRefusal, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary verify refuses semantic exact Evidence above 64 KiB without truncation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-semantic-byte-budget-'));
  try {
    const oversizedEvidence = 'x'.repeat(64 * 1024);
    buildSourceNativeProduct({
      artifactRoot: root,
      input: buildSemanticContextBudgetInput({
        counterevidenceCount: 1,
        counterevidenceValue: oversizedEvidence,
      }),
    });
    const product = openOntology({ artifactRoot: root });
    const verified = await product.verify({
      question: 'What is the current validation status for issue-budget?',
      scope: {
        sourceSystem: 'linear', objectType: 'issue', externalId: 'issue-budget',
        field: 'validationStatus',
      },
    });
    assert.equal(verified.state, 'unavailable-semantic-proof-context-budget');
    assert.equal(verified.answerable, false);
    assert.deepEqual(verified.context, []);
    assert.equal(verified.verification.semanticProofRefusal.observedExactEvidenceBytes,
      Buffer.byteLength('passed') + Buffer.byteLength(oversizedEvidence));
    assert.equal(verified.verification.semanticProofRefusal.maximumExactEvidenceBytes,
      64 * 1024);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('certifies a typed object identity as absent only from the complete bound source catalog', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-absence-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const product = openOntology({ artifactRoot: root });
    const absent = await product.verify({
      question: 'What is the current task title?',
      scope: {
        sourceSystem: 'clickup', objectType: 'task', externalId: 'task-999', field: 'title',
      },
    });

    assert.equal(absent.state, 'verified-native-object-absent-from-bound-source-catalog');
    assert.equal(absent.answerable, false);
    assert.deepEqual(absent.context, []);
    assert.equal(absent.verification.currentFieldChronology, null);
    assert.equal(absent.verification.absenceReceipt.kind,
      'OpenOntologySourceNativeObjectIdentityAbsenceReceiptV1');
    assert.deepEqual(absent.verification.absenceReceipt.objectIdentity, {
      sourceSystem: 'clickup', objectType: 'task', externalId: 'task-999',
    });
    assert.equal(absent.verification.absenceReceipt.sourceCount, 3);
    assert.equal(absent.verification.absenceReceipt.exactOccurrenceCount, 0);
    assert.equal(absent.verification.absenceReceipt.worldAbsenceAuthorized, false);
    assert.equal(absent.verification.absenceReceipt.modelCalls, 0);
    assert.equal(absent.verification.absenceReceipt.networkCalls, 0);
    assert.equal(absent.verification.navigationProposals.state, 'not-run');
    assert.equal(absent.verification.navigationProposals.rawSearchExecuted, false);
    assert.equal(absent.verification.navigationProposals.rawProposalCount, 0);
    assert.equal(absent.verification.navigationProposals.seedSearchNetworkCalls, 0);
    assert.match(absent.verification.absenceReceipt.censusSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.match(absent.verification.absenceReceipt.sourceCatalogSha256,
      /^sha256:[0-9a-f]{64}$/u);
    assert.match(absent.verification.absenceReceipt.sourceHandleSetSha256,
      /^sha256:[0-9a-f]{64}$/u);
    assert.match(absent.verification.absenceReceipt.receiptSha256, /^sha256:[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses current-field proof when the bound source cut has adapter failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-incomplete-chronology-'));
  try {
    const input = {
      ...buildInput(),
      adapterDiagnostics: [{ code: 'SOURCE_RECORD_NOT_PARSED', relativePath: 'clickup/acme/rev-2.md' }],
    };
    buildSourceNativeProduct({ artifactRoot: root, input });
    const verification = await openSourceNativeProduct({ artifactRoot: root }).verify({
      question: 'What is the current task title for task-1?',
    });
    assert.equal(verification.state, 'unavailable-incomplete-recorded-field-chronology');
    assert.equal(verification.answerable, false);
    assert.deepEqual(verification.context, []);
    assert.equal(verification.verification.currentFieldChronology.proofDisposition,
      'insufficient');
    assert.deepEqual(verification.verification.currentFieldChronology.unmetRequirements,
      ['zero-adapter-failures']);

    const unprovableAbsence = await openSourceNativeProduct({ artifactRoot: root }).verify({
      question: 'What is the current task title?',
      typedQuery: {
        sourceSystem: 'clickup', objectType: 'task', externalId: 'task-999', fieldPath: 'title',
      },
    });
    assert.equal(unprovableAbsence.state, 'unavailable-native-object-not-seeded');
    assert.equal(unprovableAbsence.answerable, false);
    assert.equal(unprovableAbsence.verification.absenceReceipt, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses temporal questions that do not declare a supported intent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-temporal-intent-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const product = openOntology({ artifactRoot: root });
    const temporalQuestions = [
      'What was the previous title of task-1?',
      'What was the original title of task-1?',
      'What was the title of task-1 on 2026-01-15?',
      'What was the title of task-1 in January 2026?',
      'Has the title of task-1 changed?',
      'How many times has the title of task-1 changed?',
      'What title followed Alpha for task-1?',
    ];
    for (const question of temporalQuestions) {
      const result = await product.verify(question);
      assert.equal(result.state, 'unavailable-native-temporal-intent-not-declared', question);
      assert.equal(result.answerable, false, question);
      assert.deepEqual(result.context, [], question);
    }

    const current = await product.verify(
      'After Alpha, what is the current task title for task-1?',
    );
    assert.equal(current.state, 'resolved-current-field');
    assert.equal(current.answerable, true);

    const next = await product.verify({
      question: 'What title immediately followed Alpha for task-1?',
      intent: 'next',
    });
    assert.equal(next.state, 'resolved-next-field-revision');
    assert.equal(next.answerable, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('selects an explicit canonical object backend and binds it to the artifact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-artifact-'));
  const backendRoot = mkdtempSync(join(tmpdir(), 'oont-source-native-product-backend-'));
  const conflictingRoot = mkdtempSync(join(tmpdir(), 'oont-source-native-product-conflict-'));
  try {
    const objectBackendUri = pathToFileURL(backendRoot).href;
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput(), objectBackendUri });
    assert.equal(existsSync(join(root, 'objects')), false);
    const product = openSourceNativeProduct({ artifactRoot: root });
    assert.equal(product.status().objectBackend, objectBackendUri);
    assert.equal(product.status().objectBackendCapabilities.backend, 'file');
    assert.equal(product.status().objectBackendCapabilities.distributedObjectStore, false);
    const current = await product.search({
      question: 'What is the current task title for task-1?',
    });
    assert.equal((await product.read({ ref: current.matches[0].ref })).exactText, 'Gamma');
    assert.throws(() => openSourceNativeProduct({
      artifactRoot: root,
      objectBackendUri: pathToFileURL(conflictingRoot).href,
    }), { code: 'SOURCE_NATIVE_PRODUCT_BACKEND_CONFLICT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(backendRoot, { recursive: true, force: true });
    rmSync(conflictingRoot, { recursive: true, force: true });
  }
});

test('accepts a canonical backend URI through the Resolver CLI', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-cli-'));
  const artifactRoot = join(root, 'artifact');
  const backendRoot = join(root, 'backend');
  const inputPath = join(root, 'input.json');
  try {
    writeFileSync(inputPath, JSON.stringify(buildInput()));
    const objectBackendUri = pathToFileURL(backendRoot).href;
    const run = spawnSync(process.execPath, [
      resolverCli,
      'build', inputPath, '--out', artifactRoot, '--backend', objectBackendUri,
    ], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.kind, 'OpenOntologySourceNativeProductBuildResultV1');
    assert.equal(openSourceNativeProduct({ artifactRoot }).status().objectBackend, objectBackendUri);
    const verified = spawnSync(process.execPath, [
      resolverCli,
      'verify', artifactRoot, 'What is the current task title for task-1?',
    ], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    const context = JSON.parse(verified.stdout);
    assert.equal(context.kind, 'OpenOntologySourceNativeVerificationV1');
    assert.equal(context.context[0].exactText, 'Gamma');
    assert.equal(Object.hasOwn(context, 'learning'), false);
    const publicVerification = spawnSync(process.execPath, [
      publicCli,
      'verify', artifactRoot, 'What is the current task title for task-1?',
    ], { encoding: 'utf8' });
    assert.equal(publicVerification.status, 0, publicVerification.stderr);
    assert.equal(JSON.parse(publicVerification.stdout).context[0].exactText, 'Gamma');
    const disabled = spawnSync(process.execPath, [
      resolverCli,
      'status', artifactRoot,
    ], { encoding: 'utf8' });
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).readOnly, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds historical successor resolution to the requested anchor across the full revision chain', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-anchor-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const product = openSourceNativeProduct({ artifactRoot: root });

    const secondTransition = await product.search({
      question: 'What task title immediately followed Beta for task-1?',
      intent: 'next',
    });
    assert.equal(secondTransition.state, 'resolved-next-field-revision');
    const secondAnchor = await product.read({
      ref: secondTransition.matches.find((match) => match.role === 'anchor').ref,
    });
    const secondAnswer = await product.read({
      ref: secondTransition.matches.find((match) => match.role === 'answer').ref,
    });
    assert.equal(secondAnchor.exactText, 'Beta');
    assert.equal(secondAnswer.exactText, 'Gamma');

    const terminal = await product.search({
      question: 'What task title immediately followed Gamma for task-1?',
      intent: 'next',
    });
    assert.equal(terminal.state, 'unavailable-native-field-successor-not-present');
    assert.deepEqual(terminal.matches, []);

    const unknown = await product.search({
      question: 'What task title immediately followed Delta for task-1?',
      intent: 'next',
    });
    assert.equal(unknown.state, 'unavailable-native-field-anchor-not-matched');
    assert.deepEqual(unknown.matches, []);

    const anchorless = await product.search({
      question: 'What task title comes next for task-1?',
      intent: 'next',
    });
    assert.equal(anchorless.state, 'unavailable-native-field-anchor-not-matched');
    assert.deepEqual(anchorless.matches, []);

    const explicit = await product.search({
      question: 'Find the following revision.',
      intent: 'next',
      anchorValue: 'Beta',
      typedQuery: {
        sourceSystem: 'clickup', objectType: 'task', externalId: 'task-1', fieldPath: 'title',
      },
    });
    assert.equal(explicit.state, 'resolved-next-field-revision');
    assert.equal((await product.read({
      ref: explicit.matches.find((match) => match.role === 'anchor').ref,
    })).exactText, 'Beta');
    assert.equal((await product.read({
      ref: explicit.matches.find((match) => match.role === 'answer').ref,
    })).exactText, 'Gamma');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not let adversarial BM25 decoys choose a historical anchor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-decoys-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildAdversarialChronologyInput() });
    const product = openSourceNativeProduct({ artifactRoot: root });

    const current = await product.verify({
      question: 'What is the current issue status for NWD-418?',
    });
    assert.equal(current.answerable, true);
    assert.equal(current.context[0].exactText, 'Done');
    assert.equal(current.verification.currentFieldChronology.sourceCount, 11);
    assert.equal(current.verification.currentFieldChronology.identityObservationCount, 3);
    assert.equal(current.verification.currentFieldChronology.fieldObservationCount, 3);
    assert.equal(current.verification.currentFieldChronology.proofDisposition, 'sufficient');

    const secondTransition = await product.search({
      question: 'What issue status immediately followed Blocked for NWD-418?',
      intent: 'next',
    });
    assert.equal(secondTransition.state, 'resolved-next-field-revision');
    assert.equal((await product.read({
      ref: secondTransition.matches.find((match) => match.role === 'anchor').ref,
    })).exactText, 'Blocked');
    assert.equal((await product.read({
      ref: secondTransition.matches.find((match) => match.role === 'answer').ref,
    })).exactText, 'Done');

    const terminal = await product.search({
      question: 'What issue status immediately followed Done for NWD-418?',
      intent: 'next',
    });
    assert.equal(terminal.state, 'unavailable-native-field-successor-not-present');
    assert.deepEqual(terminal.matches, []);

    const unknown = await product.search({
      question: 'What issue status immediately followed Cancelled for NWD-418?',
      intent: 'next',
    });
    assert.equal(unknown.state, 'unavailable-native-field-anchor-not-matched');
    assert.deepEqual(unknown.matches, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed on ambiguous inferred field spans and conflicting artifact configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-'));
  try {
    const ambiguous = buildInput();
    ambiguous.sources[0].content = 'Alpha and Alpha';
    assert.throws(() => buildSourceNativeProduct({ artifactRoot: root, input: ambiguous }), {
      code: 'SOURCE_NATIVE_PRODUCT_FIELD_AMBIGUOUS',
    });

    const cleanRoot = mkdtempSync(join(tmpdir(), 'oont-source-native-product-clean-'));
    try {
      buildSourceNativeProduct({ artifactRoot: cleanRoot, input: buildInput() });
      const conflict = buildInput();
      conflict.querySchemas[0].aliases.push('work item');
      assert.throws(() => buildSourceNativeProduct({ artifactRoot: cleanRoot, input: conflict }), {
        code: 'SOURCE_NATIVE_PRODUCT_ARTIFACT_CONFLICT',
      });
      const changedSource = buildInput();
      changedSource.sources[2].content = 'Changed current';
      changedSource.nativeObjectInputs[2].fields[0].value = 'Changed current';
      assert.throws(() => buildSourceNativeProduct({ artifactRoot: cleanRoot, input: changedSource }), {
        code: 'SOURCE_NATIVE_PRODUCT_ARTIFACT_CONFLICT',
      });
      assert.equal(openSourceNativeProduct({ artifactRoot: cleanRoot }).status().sourceCommitSha256,
        buildSourceNativeProduct({ artifactRoot: cleanRoot, input: buildInput() }).receipt.commitSha256);
    } finally {
      rmSync(cleanRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects incomplete Adapter coverage and does not infer prefix-colliding external IDs', async () => {
  const incompleteRoot = mkdtempSync(join(tmpdir(), 'oont-source-native-product-incomplete-'));
  try {
    const incomplete = buildInput();
    incomplete.nativeObjectInputs.pop();
    assert.throws(() => buildSourceNativeProduct({ artifactRoot: incompleteRoot, input: incomplete }), {
      code: 'SOURCE_NATIVE_PRODUCT_INCOMPLETE_ADAPTER_COVERAGE',
    });
  } finally {
    rmSync(incompleteRoot, { recursive: true, force: true });
  }

  const collisionRoot = mkdtempSync(join(tmpdir(), 'oont-source-native-product-collision-'));
  try {
    buildSourceNativeProduct({ artifactRoot: collisionRoot, input: buildInput() });
    const collision = await openSourceNativeProduct({ artifactRoot: collisionRoot }).search({
      question: 'What is the current task title for task-10?',
    });
    assert.equal(collision.state, 'unavailable-native-object-identifier-not-declared');
    assert.deepEqual(collision.matches, []);
    const sameShapeCollision = await openSourceNativeProduct({ artifactRoot: collisionRoot }).search({
      question: 'What is the current task title for task-999?',
    });
    assert.equal(sameShapeCollision.state, 'unavailable-native-object-identifier-not-declared');
    assert.deepEqual(sameShapeCollision.matches, []);
    const mixedIdentifiers = await openSourceNativeProduct({ artifactRoot: collisionRoot }).search({
      question: 'What is the current task title for task-999 and task-1?',
    });
    assert.equal(mixedIdentifiers.state, 'unavailable-native-multiple-object-identifiers');
    assert.deepEqual(mixedIdentifiers.matches, []);
    assert.deepEqual(mixedIdentifiers.mentionedExternalIds, ['task-1']);
    assert.deepEqual(mixedIdentifiers.unresolvedExternalIds, ['task-999']);
  } finally {
    rmSync(collisionRoot, { recursive: true, force: true });
  }
});

test('serves only verify over the default MCP surface', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-source-native-product-mcp-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const observed = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [publicCli,
        'serve', root, '--mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let pending = '';
      let tools = [];
      let verifyProperties = [];
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('SOURCE_NATIVE_PRODUCT_MCP_TIMEOUT'));
      }, 10_000);
      child.stdout.on('data', (data) => {
        pending += data;
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.id === 1) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
          } else if (message.id === 2) {
            tools = message.result.tools.map((tool) => tool.name);
            verifyProperties = Object.keys(message.result.tools[0].inputSchema.properties).sort();
            child.stdin.write(`${JSON.stringify({
              jsonrpc: '2.0', id: 3, method: 'tools/call',
              params: {
                name: 'verify',
                arguments: {
                  question: 'What task title immediately followed Alpha for task-1?',
                  intent: 'next',
                },
              },
            })}\n`);
          } else if (message.id === 3) {
            clearTimeout(timer);
            child.kill('SIGKILL');
            done({ tools, verifyProperties, verification: JSON.parse(message.result.content[0].text) });
          }
        }
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      })}\n`);
    });
    assert.deepEqual(observed.tools, ['verify']);
    assert.deepEqual(observed.verifyProperties, ['anchorValue', 'intent', 'question', 'scope']);
    assert.equal(observed.verification.state, 'resolved-next-field-revision');
    assert.equal(observed.verification.answerable, true);
    assert.deepEqual(observed.verification.context.map((row) => row.exactText).sort(),
      ['Alpha', 'Beta']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
