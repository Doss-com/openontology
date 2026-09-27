import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openOntology } from 'oont';
import { buildSourceNativeProduct } from 'oont/kernel';

const RELATIONS = new Set(['qualifies', 'contradicts']);

function fail(message) {
  const error = new Error(message);
  error.code = message;
  throw error;
}

function claim({ propositionKey, family, predicate, state, role, polarity, relationType }) {
  return {
    kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
    propositionKey,
    actorHome: 'ObjectDef/InstanceRef',
    stateHome: 'Claim/PropositionRevision-payload',
    actorKind: 'ticket',
    predicate,
    state,
    dimension: family,
    canonicalRoles: [role],
    modality: 'observed',
    polarity,
    businessEntityKeys: ['ticket:task-1'],
    extractionAuthority: 'deterministic-source-adapter-v1',
    relations:
      relationType === undefined
        ? []
        : [
            {
              kind: 'OpenOntologySourceNativePropositionRelationV1',
              type: relationType,
              targetPropositionKey: 'ticket-1-status-open',
            },
          ],
  };
}

function inputFor(relationType) {
  const content = 'Ticket task-1 status: open. Review: closed.';
  const status = 'open';
  const review = 'closed';
  const relativePath = 'tracker/demo/task-1-status.txt';
  const commonTimes = {
    validAt: '2026-01-01T09:59:00.000Z',
    knownAt: '2026-01-01T10:00:00.000Z',
  };
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: `counterevidence-${relationType}`,
    namespace: 'demo',
    querySchemas: [
      {
        sourceSystem: 'tracker',
        objectType: 'ticket',
        aliases: ['ticket'],
        fields: [
          { fieldPath: 'status', aliases: ['status'] },
          { fieldPath: 'review', aliases: ['review'] },
        ],
      },
    ],
    sources: [
      {
        relativePath,
        sourceType: 'tracker',
        occurredAt: '2026-01-01T10:00:00.000Z',
        content,
      },
    ],
    nativeObjectInputs: [
      {
        relativePath,
        objectIdentity: {
          home: 'ObjectDef/InstanceRef',
          sourceSystem: 'tracker',
          objectType: 'ticket',
          namespace: 'demo',
          externalId: 'task-1',
        },
        businessEntityKeys: ['ticket:task-1'],
        fields: [
          {
            fieldPath: 'status',
            value: status,
            codeUnitStart: content.indexOf(status),
            propositionFamilyKey: 'ticket-status',
            businessEntityKeys: ['ticket:task-1'],
            ...commonTimes,
            canonicalProposition: claim({
              propositionKey: 'ticket-1-status-open',
              family: 'ticket-status',
              predicate: 'has-status',
              state: status,
              role: 'state',
              polarity: 'positive',
            }),
          },
        ],
        duplicateEvidenceFieldPaths: ['status'],
      },
      {
        relativePath,
        objectIdentity: {
          home: 'ObjectDef/InstanceRef',
          sourceSystem: 'tracker',
          objectType: 'ticket',
          namespace: 'demo',
          externalId: 'task-1-review',
        },
        businessEntityKeys: ['ticket:task-1'],
        fields: [
          {
            fieldPath: 'review',
            value: review,
            codeUnitStart: content.indexOf(review),
            propositionFamilyKey: 'ticket-review',
            businessEntityKeys: ['ticket:task-1'],
            ...commonTimes,
            canonicalProposition: claim({
              propositionKey: 'ticket-1-status-review-closed',
              family: 'ticket-review',
              predicate: 'has-review-status',
              state: review,
              role: 'counterevidence',
              polarity: 'negative',
              relationType,
            }),
          },
        ],
        duplicateEvidenceFieldPaths: ['review'],
      },
    ],
  };
}

async function runCase(outputRoot, relationType) {
  const artifactRoot = join(outputRoot, relationType, 'ont');
  buildSourceNativeProduct({ artifactRoot, input: inputFor(relationType) });
  const rawResponse = await openOntology({ artifactRoot }).verify(
    'What is the current status of ticket task-1?',
  );
  const expectedDisposition = relationType === 'qualifies' ? 'qualified' : 'contradicted';
  if (
    rawResponse.state !== 'resolved-current-field' ||
    rawResponse.answerable !== true ||
    rawResponse.proofDisposition !== expectedDisposition ||
    rawResponse.context.length !== 2 ||
    rawResponse.context[0].role !== 'answer' ||
    rawResponse.context[1].role !== 'counterevidence'
  ) {
    fail(`COUNTEREVIDENCE_${relationType.toUpperCase()}_ASSERTION`);
  }
  return { relationType, proofDisposition: rawResponse.proofDisposition, rawResponse };
}

async function run(outputRootArgument) {
  if (typeof outputRootArgument !== 'string' || !outputRootArgument) {
    fail('COUNTEREVIDENCE_OUTPUT_ROOT');
  }
  const outputRoot = resolve(outputRootArgument);
  try {
    mkdirSync(outputRoot);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('COUNTEREVIDENCE_OUTPUT_EXISTS');
    throw error;
  }
  const cases = [];
  for (const relationType of ['qualifies', 'contradicts'])
    cases.push(await runCase(outputRoot, relationType));
  process.stdout.write(
    `${JSON.stringify({ kind: 'OpenOntologyCounterevidenceWalkthroughV1', outputRoot, cases })}\n`,
  );
}

if (process.argv.length !== 3) {
  console.error('usage: node counterevidence.mjs <new-output-root>');
  process.exitCode = 1;
} else {
  run(process.argv[2]).catch((error) => {
    console.error(error?.code ?? error?.message ?? String(error));
    process.exitCode = 1;
  });
}
