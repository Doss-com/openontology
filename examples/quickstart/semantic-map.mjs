// Synthetic local example. Ephemeral signers demonstrate mechanics, not semantic review quality.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildSourceNativeProduct, compileSourceNativeConstructionAdmissionRecord,
  compileSourceNativeSemanticConstruction, openProductState,
  openSourceNativeProductWithConstruction, sourceNativeConstructionAdmissionStatement,
  sourceNativeConstructionProposalStatement, stableObjectText, writeSourceNativeConstructionAdmission,
} from 'oont/kernel';

async function run(outputRoot) {
  // Claim a new directory only. Rerunning must not modify an existing Ont.
  try { mkdirSync(outputRoot); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('SEMANTIC_MAP_OUTPUT_EXISTS');
    throw error;
  }
  const options = { artifactRoot: join(outputRoot, 'ont') };
  const sources = [
    { relativePath: 'docs/allocation.txt', sourceType: 'docs',
      content: 'AllocationException means inventory allocation mismatch. ClickUp calls it allocation mismatch.' },
    { relativePath: 'clickup/CT-17.txt', sourceType: 'clickup',
      content: 'ClickupTask CT-17: allocation mismatch. Status: open.' },
    { relativePath: 'clickup/CT-18.txt', sourceType: 'clickup',
      content: 'ClickupTask CT-18: allocation mismatch. Status: closed.' },
  ].map(source => ({ ...source, occurredAt: '2026-09-01T00:00:00.000Z' }));
  buildSourceNativeProduct({ ...options, historyBackendUri: pathToFileURL(join(outputRoot, 'history')).href,
    input: { schemaVersion: 1, kind: 'OpenOntologySourceNativeBuildInputV1',
      ontId: 'semantic-map-example', namespace: 'example', sources,
      querySchemas: [
        { sourceSystem: 'docs', objectType: 'Document', aliases: ['document'], fields: [{ fieldPath: 'body', aliases: ['body'] }] },
        { sourceSystem: 'clickup', objectType: 'ClickupTask', aliases: ['ClickupTask'],
          fields: [{ fieldPath: 'body', aliases: ['body'] }, { fieldPath: 'status', aliases: ['status'] }] },
      ],
      nativeObjectInputs: sources.map((source, index) => ({ relativePath: source.relativePath,
        objectIdentity: { home: 'ObjectDef/InstanceRef', sourceSystem: source.sourceType, namespace: 'example',
          objectType: index ? 'ClickupTask' : 'Document', externalId: index ? `CT-${16 + index}` : 'allocation-guide' },
        fields: [{ fieldPath: 'body', value: source.content },
          ...(index ? [{ fieldPath: 'status', value: index === 1 ? 'open' : 'closed' }] : [])],
      })),
    } });
  const state = openProductState(options);
  const witness = relativePath => {
    const object = state.objectOnt.map.nativeObjects.find(object => object.relativePath === relativePath);
    const body = object.fields.find(field => field.fieldPath === 'body');
    const { relativePath: sourceRef, ...span } = body.evidence;
    return { nativeObjectSha256: object.nativeObjectSha256, evidence: { sourceRef, ...span } };
  };
  const input = { proposedBy: 'constructor', proposedAt: '2026-09-02T00:00:00.000Z', method: 'authored',
    objectDefs: [{ kind: 'ObjectDef', id: 'allocation-exception', name: 'AllocationException',
      source: witness(sources[0].relativePath), aliases: [{ value: 'allocation mismatch', sourceSystem: 'clickup', source: witness(sources[0].relativePath) }] }],
    claims: sources.map((source, index) => ({ kind: 'Claim', id: `attachment-${index}`, about: 'allocation-exception',
      predicate: index ? 'mentions' : 'defines', source: witness(source.relativePath) })),
    coverage: state.objectOnt.sources.map(source => ({ sourceRef: source.relativePath, sourceSha256: source.sourceSha256, disposition: 'examined' })),
  };
  const constructor = generateKeyPairSync('ed25519');
  const reviewer = generateKeyPairSync('ed25519');
  const trustRegistry = [['constructor', constructor, 'proposer'], ['reviewer', reviewer, 'reviewer']]
    .map(([issuerId, pair, role]) => ({ issuerId, roles: [role], publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }) }));
  const signature = (statement, pair) => sign(null, Buffer.from(stableObjectText(statement)), pair.privateKey).toString('base64');
  function admit(input, supersedesRecordSha256s = []) {
    const construction = compileSourceNativeSemanticConstruction({ options, input });
    const proposalStatement = sourceNativeConstructionProposalStatement({ construction });
    // In a real application an independent reviewer inspects these sources before signing.
    const statement = sourceNativeConstructionAdmissionStatement({ construction, issuerId: 'reviewer',
      admittedAt: supersedesRecordSha256s.length ? '2026-09-04T00:00:00.000Z' : '2026-09-03T00:00:00.000Z', supersedesRecordSha256s });
    const record = compileSourceNativeConstructionAdmissionRecord({ construction, proposalStatement, statement,
      proposalSignatureBase64: signature(proposalStatement, constructor), signatureBase64: signature(statement, reviewer) });
    writeSourceNativeConstructionAdmission({ options, trustRegistry, record });
    return record;
  }
  const original = admit(input);
  // This is a new client, not an in-memory projection handed over by the constructor.
  const ont = openSourceNativeProductWithConstruction(options, { trustRegistry });
  const search = await ont.search({ term: 'allocation mismatch', scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' }, limit: 1 });
  assert.equal(search.totalMatches, 2);
  assert.equal(search.matches.length, 1);
  assert(search.nextCursor);
  const second = await ont.search({ term: 'allocation mismatch', scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' }, cursor: search.nextCursor });
  const selected = [...search.matches, ...second.matches].find(match => match.nativeObject.externalId === 'CT-17');
  const passage = await ont.read({ ref: selected.ref });
  assert(passage.exactText.includes('allocation mismatch'));
  const query = { question: 'What is the current status?', typedQuery: { sourceSystem: 'clickup', objectType: 'ClickupTask', fieldPath: 'status' } };
  assert.equal((await ont.verify(query)).answerable, false);
  const verified = await ont.verify({ ...query, typedQuery: { ...query.typedQuery, externalId: passage.binding.nativeObject.externalId } });
  assert.equal(verified.context[0].exactText, 'open');
  const correction = admit({ ...input, claims: input.claims.filter(claim => claim.id !== 'attachment-2') }, [original.recordSha256]);
  await assert.rejects(ont.read({ ref: selected.ref }), { code: 'CONSTRUCTION_NAVIGATION_REFERENCE_INELIGIBLE' });
  const after = await ont.search({ term: 'allocation mismatch', scope: { sourceSystem: 'clickup' } });
  assert.equal(after.totalMatches, 1);
  const cold = openSourceNativeProductWithConstruction(options, { trustRegistry });
  assert.equal((await cold.search({ term: 'allocation mismatch', scope: { sourceSystem: 'clickup' } })).totalMatches, 1);
  const revoked = openSourceNativeProductWithConstruction(options, { trustRegistry: trustRegistry.slice(0, 1) });
  assert.equal((await revoked.search({ term: 'AllocationException' })).matches.length, 0);
  process.stdout.write(`${JSON.stringify({ kind: 'OpenOntologySemanticMapWalkthroughV1',
    outputRoot, initialMatches: search.totalMatches, correctedMatches: after.totalMatches,
    selectedObject: passage.binding.nativeObject.externalId, exactStatus: verified.context[0].exactText,
    correctionRecordSha256: correction.recordSha256, semanticReviewQualified: false })}\n`);
}

if (process.argv.length !== 3 || !process.argv[2]) {
  console.error('usage: node semantic-map.mjs <new-output-root>');
  process.exitCode = 1;
} else {
  run(resolve(process.argv[2])).catch(error => {
    console.error(error.code ?? error.message);
    process.exitCode = 1;
  });
}
