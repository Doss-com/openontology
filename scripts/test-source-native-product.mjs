import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { openOntology } from '../dist/src/openontology.mjs';
import { buildSourceNativeProduct, openSourceNativeProduct } from '../dist/src/source-native-product.mjs';

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
    assert.equal(resolvedContext.verification.navigationProposals.state, 'raw-only');
    assert.equal(resolvedContext.verification.navigationProposals.learnedRouteUsed, false);
    assert.equal(resolvedContext.verification.navigationProposals.rawSearchExecuted, true);
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
