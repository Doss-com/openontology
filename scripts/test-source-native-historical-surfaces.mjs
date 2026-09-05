import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

import { openOntology } from '../dist/src/openontology.mjs';
import {
  buildSourceNativeProduct,
  openSourceNativeProduct,
} from '../dist/src/source-native-product.mjs';
import { runSourceNativeProductMcp } from '../dist/src/source-native-product-mcp.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const publicCli = join(repositoryRoot, 'dist', 'bin', 'oont.mjs');
const AT = '2026-02-15T00:00:00.000Z';
const CLI_SCOPE = [
  '--source-system', 'clickup',
  '--object-type', 'task',
  '--external-id', 'task-1',
  '--field', 'title',
];

function buildInput() {
  const revisions = [
    ['clickup/acme/rev-1.md', '2026-01-01T00:00:00.000Z', 'Alpha'],
    ['clickup/acme/rev-2.md', '2026-02-01T00:00:00.000Z', 'Beta'],
    ['clickup/acme/rev-3.md', '2026-03-01T00:00:00.000Z', 'Gamma'],
  ];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'historical-surfaces',
    namespace: 'acme',
    querySchemas: [{
      sourceSystem: 'clickup',
      objectType: 'task',
      aliases: ['task'],
      fields: [{ fieldPath: 'title', aliases: ['title'] }],
    }],
    sources: revisions.map(([relativePath, occurredAt, content]) => ({
      relativePath,
      sourceType: 'clickup',
      occurredAt,
      content,
    })),
    nativeObjectInputs: revisions.map(([relativePath, occurredAt, content]) => ({
      relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'task',
        namespace: 'acme',
        externalId: 'task-1',
      },
      fields: [{
        fieldPath: 'title',
        value: content,
        validAt: occurredAt,
        knownAt: occurredAt,
      }],
    })),
  };
}

function query(overrides = {}) {
  return {
    question: 'What is the task title for task-1?',
    scope: {
      sourceSystem: 'clickup',
      objectType: 'task',
      externalId: 'task-1',
      field: 'title',
    },
    ...overrides,
  };
}

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'oont-historical-surfaces-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [publicCli, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function mcpCall(input, outputLines, request) {
  return new Promise((resolveResponse, reject) => {
    const onLine = (line) => {
      try {
        resolveResponse(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    };
    outputLines.once('line', onLine);
    input.write(`${JSON.stringify(request)}\n`);
  });
}

test('SDK historical selection returns the earlier exact value while current stays latest', async () => {
  const root = buildFixture();
  try {
    const client = openOntology({ artifactRoot: root });
    const latest = await client.verify(query());
    assert.equal(latest.context[0].exactText, 'Gamma');
    const cliLatest = runCli([
      'verify', root, 'What is the task title for task-1?', ...CLI_SCOPE,
    ]);
    assert.equal(cliLatest.status, 0, cliLatest.stderr);
    assert.equal(JSON.parse(cliLatest.stdout).context[0].exactText, 'Gamma');

    const historical = await client.verify(query({ at: AT }));
    assert.equal(historical.at, AT);
    assert.equal(historical.context[0].exactText, 'Beta');
    assert.equal(historical.intent, 'at');
    assert.ok(historical.verification.historicalFieldChronology);
    const cliHistorical = runCli([
      'verify', root, 'What is the task title for task-1?', ...CLI_SCOPE, '--at', AT,
    ]);
    assert.equal(cliHistorical.status, 0, cliHistorical.stderr);
    assert.equal(JSON.parse(cliHistorical.stdout).context[0].exactText, 'Beta');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SDK and CLI reject malformed point-in-time combinations', () => {
  const root = buildFixture();
  try {
    const client = openOntology({ artifactRoot: root });
    for (const invalid of [
      query({ at: '2026-02-15T00:00:00Z' }),
      query({ at: '2026-02-30T00:00:00.000Z' }),
      query({ at: '2026-13-01T00:00:00.000Z' }),
      query({ at: '+010000-02-15T00:00:00.000Z' }),
      query({ at: AT, intent: 'next' }),
      query({ at: AT, anchorValue: 'Alpha' }),
    ]) {
      assert.throws(() => client.search(invalid), {
        code: 'OPENONTOLOGY_QUERY',
      });
    }

    const help = runCli(['verify', '--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stderr, /--at <UTC-millisecond-ISO>/u);
    for (const suffix of [
      ['--at', '2026-02-15T00:00:00Z'],
      ['--at', '2026-02-30T00:00:00.000Z'],
      ['--at', '2026-13-01T00:00:00.000Z'],
      ['--at', '+010000-02-15T00:00:00.000Z'],
      ['--intent', 'next', '--at', AT],
      ['--anchor-value', 'Alpha', '--at', AT],
    ]) {
      const result = runCli(['verify', root, 'What is the task title?', ...suffix]);
      assert.equal(result.status, 2, `${suffix.join(' ')}\n${result.stderr}`);
      assert.match(result.stderr, /^usage: oont <command>/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('advanced MCP search and read carry the historical query', async () => {
  const root = buildFixture();
  const input = new PassThrough();
  const output = new PassThrough();
  const outputLines = createInterface({ input: output });
  const product = openSourceNativeProduct({ artifactRoot: root });
  const server = runSourceNativeProductMcp(product, {
    input,
    output,
    profile: 'advanced',
  });
  try {
    const initialized = await mcpCall(input, outputLines, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });
    assert.equal(initialized.result.serverInfo.name, 'openontology-source-native');
    const listed = await mcpCall(input, outputLines, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['search', 'read']);
    assert.ok(listed.result.tools[0].inputSchema.properties.at);

    for (const argumentsValue of [
      { question: 'What is the task title?', at: '2026-02-15T00:00:00Z' },
      { question: 'What is the task title?', at: '2026-02-30T00:00:00.000Z' },
      { question: 'What is the task title?', at: '2026-13-01T00:00:00.000Z' },
      { question: 'What is the task title?', at: '+010000-02-15T00:00:00.000Z' },
      { question: 'What is the task title?', intent: 'next', at: AT },
      { question: 'What is the task title?', anchorValue: 'Alpha', at: AT },
    ]) {
      const invalid = await mcpCall(input, outputLines, {
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: { name: 'search', arguments: argumentsValue },
      });
      assert.equal(invalid.result.isError, true);
      assert.equal(invalid.result.content[0].text, 'SOURCE_NATIVE_PRODUCT_QUERY');
    }

    const searched = await mcpCall(input, outputLines, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: {
          question: 'What is the task title for task-1?',
          at: AT,
          scope: query().scope,
        },
      },
    });
    const searchResult = JSON.parse(searched.result.content[0].text);
    assert.equal(searchResult.at, AT);
    assert.equal(searchResult.matches.length, 1);

    const read = await mcpCall(input, outputLines, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'read', arguments: { ref: searchResult.matches[0].ref } },
    });
    const readResult = JSON.parse(read.result.content[0].text);
    assert.equal(readResult.exactText, 'Beta');
  } finally {
    server.close();
    outputLines.close();
    input.end();
    output.end();
    rmSync(root, { recursive: true, force: true });
  }
});
