import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { openOntology } from '../../dist/openontology.js';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const bin = resolve(repositoryRoot, 'dist/cli/oont.js');
const input = resolve(repositoryRoot, 'examples/quickstart/source-native-input.json');
const lifecycle = resolve(repositoryRoot, 'examples/quickstart/source-lifecycle.mjs');

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options,
  });
}

function runExample(script, outputRoot) {
  return spawnSync(process.execPath, [script, outputRoot], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

test('quickstart CLI, SDK, MCP, and lifecycle recipes remain executable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-quickstart-examples-'));
  try {
    const artifactRoot = join(root, 'verified-context');
    const build = runCli([
      'resolver', 'build', input, '--out', artifactRoot,
    ]);
    assert.equal(build.status, 0, build.stderr);

    const cliVerification = runCli([
      'verify', artifactRoot, 'What is the current title of task-1?',
    ]);
    assert.equal(cliVerification.status, 0, cliVerification.stderr);
    const cliResult = JSON.parse(cliVerification.stdout);
    assert.equal(cliResult.answerable, true);
    assert.equal(cliResult.state, 'resolved-current-field');
    assert.equal(cliResult.context[0].exactText, 'Ship verified context');
    assert.equal(cliResult.context[0].evidence.relativePath,
      'tracker/demo/task-1-v2.txt');

    const cliRefusal = runCli([
      'verify', artifactRoot, 'Who owns task-1?',
    ]);
    assert.equal(cliRefusal.status, 0, cliRefusal.stderr);
    const refusal = JSON.parse(cliRefusal.stdout);
    assert.equal(refusal.answerable, false);
    assert.equal(refusal.state, 'unavailable-native-field-not-declared');
    assert.deepEqual(refusal.context, []);
    assert.deepEqual(refusal.availableFields, [{
      sourceSystem: 'tracker', objectType: 'task', fieldPath: 'title',
      aliases: ['task title', 'title'],
    }]);

    const ont = openOntology({ artifactRoot });
    const sdkResult = await ont.verify({
      question: 'What is the current title?',
      scope: {
        sourceSystem: 'tracker',
        objectType: 'task',
        externalId: 'task-1',
        field: 'title',
      },
    });
    assert.equal(sdkResult.answerable, true);
    assert.equal(sdkResult.context[0].exactText, 'Ship verified context');

    const mcp = runCli(['serve', artifactRoot, '--mcp'], {
      input: [
        JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05' },
        }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: {
            name: 'verify',
            arguments: { question: 'What is the current title of task-1?' },
          },
        }),
        '',
      ].join('\n'),
    });
    assert.equal(mcp.status, 0, mcp.stderr);
    const mcpResponses = mcp.stdout.trim().split('\n').map((line) => JSON.parse(line));
    const mcpCall = mcpResponses.find((response) => response.id === 2);
    assert.ok(mcpCall);
    const mcpResult = JSON.parse(mcpCall.result.content[0].text);
    assert.equal(mcpResult.answerable, true);
    assert.equal(mcpResult.context[0].exactText, 'Ship verified context');

    const lifecycleResult = runExample(lifecycle, join(root, 'source-lifecycle-run'));
    assert.equal(lifecycleResult.status, 0, lifecycleResult.stderr);
    const lifecycleSummary = JSON.parse(lifecycleResult.stdout);
    assert.equal(lifecycleSummary.initial.value, 'Ship verified context');
    assert.equal(lifecycleSummary.updated.value, 'Keep context current');
    assert.equal(lifecycleSummary.searchRead.value, 'Ship verified context');
    assert.deepEqual(lifecycleSummary.refusal, {
      state: 'unavailable-native-field-not-declared',
      contextCount: 0,
    });
    assert.deepEqual(lifecycleSummary.staleOpen, {
      code: 'SOURCE_NATIVE_PRODUCT_REF',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
