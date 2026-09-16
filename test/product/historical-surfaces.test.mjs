import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import * as kernel from '../../dist/kernel.js';

import { openOntology } from '../../dist/openontology.js';
import {
  buildSourceNativeProduct,
  openSourceNativeProduct,
} from '../../dist/product/runtime.js';
import { runSourceNativeProductMcp } from '../../dist/product/mcp.js';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const publicCli = join(repositoryRoot, 'dist', 'cli', 'oont.js');
const AT = '2026-02-15T00:00:00.000Z';
const TITLE_AT = '2026-01-15T00:00:00.000Z';
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

function titleParityRow({ relativePath, occurredAt, externalId, title, status, body = '' }) {
  const content = `Title: ${title}\nStatus: ${status}. ${body}`;
  return {
    source: { relativePath, sourceType: 'clickup', occurredAt, content },
    nativeObjectInput: {
      relativePath,
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'task',
        namespace: 'acme',
        externalId,
      },
      fields: [
        { fieldPath: 'title', value: title, codeUnitStart: content.indexOf(title) },
        { fieldPath: 'status', value: status, codeUnitStart: content.indexOf(status),
          validAt: occurredAt, knownAt: occurredAt },
      ],
    },
  };
}

function buildTitleParityInput() {
  const rows = [
    titleParityRow({
      relativePath: 'clickup/acme/task-1-r1.md',
      occurredAt: '2026-01-01T00:00:00.000Z',
      externalId: 'task-1', title: 'Legacy review', status: 'Ready',
    }),
    titleParityRow({
      relativePath: 'clickup/acme/task-1-r2.md',
      occurredAt: '2026-02-01T00:00:00.000Z',
      externalId: 'task-1', title: 'Renamed review', status: 'Done',
    }),
    titleParityRow({
      relativePath: 'clickup/acme/task-2.md',
      occurredAt: '2026-02-02T00:00:00.000Z',
      externalId: 'task-2', title: 'Dependency cleanup', status: 'Blocked',
      body: 'Legacy review appears in this dependency note.',
    }),
  ];
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'historical-title-surfaces',
    namespace: 'acme',
    querySchemas: [{
      sourceSystem: 'clickup',
      objectType: 'task',
      aliases: ['task'],
      fields: [
        { fieldPath: 'title', aliases: ['title'] },
        { fieldPath: 'status', aliases: ['status'] },
      ],
    }],
    sources: rows.map(({ source }) => source),
    nativeObjectInputs: rows.map(({ nativeObjectInput }) => nativeObjectInput),
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

function buildFixture(input = buildInput(), prefix = 'oont-historical-surfaces-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input });
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

test('kernel MCP handler exposes and verifies canonical point-in-time queries', async () => {
  const root = buildFixture();
  try {
    assert.equal(typeof kernel.createSourceNativeProductMcpHandler, 'function');
    const handler = kernel.createSourceNativeProductMcpHandler(
      openSourceNativeProduct({ artifactRoot: root }),
    );
    const listed = await handler.handle({ id: 1, method: 'tools/list' });
    assert.ok(listed.result.tools[0].inputSchema.properties.at);
    assert.equal(await handler.handle(null), null);
    const response = await handler.handle({ id: 2, method: 'tools/call',
      params: { name: 'verify', arguments: query({ at: AT, intent: 'current' }) } });
    assert.equal(response.result.isError, undefined);
    const verified = JSON.parse(response.result.content[0].text);
    assert.equal(verified.at, AT);
    assert.deepEqual(verified.context.map((row) => row.exactText), ['Beta']);
    const invalid = await handler.handle({ id: 3, method: 'tools/call',
      params: { name: 'verify', arguments: query({ at: AT, intent: 'next' }) } });
    assert.equal(invalid.result.isError, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

test('title-only current and historical queries keep SDK, CLI and MCP on one identity', async () => {
  const root = buildFixture(buildTitleParityInput(), 'oont-historical-title-surfaces-');
  const currentQuestion = 'What is the current status of the task titled "Legacy review"?';
  const historicalQuestion = 'What was the status of the task titled "Legacy review"?';
  try {
    const client = openOntology({ artifactRoot: root });
    const sdkCurrent = await client.verify(currentQuestion);
    assert.equal(sdkCurrent.state, 'resolved-current-field');
    assert.equal(sdkCurrent.answerable, true);
    assert.equal(sdkCurrent.query.externalId, 'task-1');
    assert.equal(sdkCurrent.context[0].exactText, 'Done');
    assert.equal(sdkCurrent.context[0].binding.externalId, 'task-1');

    const sdkHistorical = await client.verify({ question: historicalQuestion, at: TITLE_AT });
    assert.equal(sdkHistorical.state, 'resolved-historical-field');
    assert.equal(sdkHistorical.answerable, true);
    assert.equal(sdkHistorical.query.externalId, 'task-1');
    assert.equal(sdkHistorical.context[0].exactText, 'Ready');
    assert.equal(sdkHistorical.context[0].binding.externalId, 'task-1');

    const renamedHistorical = await client.verify({
      question: 'What was the status of the task titled "Renamed review"?', at: TITLE_AT,
    });
    assert.equal(renamedHistorical.state, 'resolved-historical-field');
    assert.equal(renamedHistorical.answerable, true);
    assert.equal(renamedHistorical.context[0].exactText, 'Ready');
    assert.equal(renamedHistorical.context[0].binding.externalId, 'task-1');

    const cliCurrent = runCli(['verify', root, currentQuestion]);
    assert.equal(cliCurrent.status, 0, cliCurrent.stderr);
    const cliCurrentResult = JSON.parse(cliCurrent.stdout);
    assert.equal(cliCurrentResult.state, 'resolved-current-field');
    assert.equal(cliCurrentResult.answerable, true);
    assert.equal(cliCurrentResult.query.externalId, 'task-1');
    assert.equal(cliCurrentResult.context[0].exactText, 'Done');
    assert.equal(cliCurrentResult.context[0].binding.externalId, 'task-1');

    const cliHistorical = runCli(['verify', root, historicalQuestion, '--at', TITLE_AT]);
    assert.equal(cliHistorical.status, 0, cliHistorical.stderr);
    const cliHistoricalResult = JSON.parse(cliHistorical.stdout);
    assert.equal(cliHistoricalResult.state, 'resolved-historical-field');
    assert.equal(cliHistoricalResult.answerable, true);
    assert.equal(cliHistoricalResult.query.externalId, 'task-1');
    assert.equal(cliHistoricalResult.context[0].exactText, 'Ready');
    assert.equal(cliHistoricalResult.context[0].binding.externalId, 'task-1');

    const input = new PassThrough();
    const output = new PassThrough();
    const outputLines = createInterface({ input: output });
    const server = runSourceNativeProductMcp(openSourceNativeProduct({ artifactRoot: root }), {
      input, output, profile: 'advanced',
    });
    try {
      await mcpCall(input, outputLines, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      });
      const mcpCurrentResponse = await mcpCall(input, outputLines, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'search', arguments: { question: currentQuestion } },
      });
      const mcpCurrent = JSON.parse(mcpCurrentResponse.result.content[0].text);
      assert.equal(mcpCurrent.state, 'resolved-current-field');
      assert.equal(mcpCurrent.query.externalId, 'task-1');
      assert.equal(mcpCurrent.matches.length, 1);
      const mcpCurrentReadResponse = await mcpCall(input, outputLines, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'read', arguments: { ref: mcpCurrent.matches[0].ref } },
      });
      const mcpCurrentRead = JSON.parse(mcpCurrentReadResponse.result.content[0].text);
      assert.equal(mcpCurrentRead.exactText, 'Done');
      assert.equal(mcpCurrentRead.binding.externalId, 'task-1');

      const mcpHistoricalResponse = await mcpCall(input, outputLines, {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'search', arguments: { question: historicalQuestion, at: TITLE_AT } },
      });
      const mcpHistorical = JSON.parse(mcpHistoricalResponse.result.content[0].text);
      assert.equal(mcpHistorical.state, 'resolved-historical-field');
      assert.equal(mcpHistorical.query.externalId, 'task-1');
      assert.equal(mcpHistorical.at, TITLE_AT);
      assert.equal(mcpHistorical.matches.length, 1);
      const mcpHistoricalReadResponse = await mcpCall(input, outputLines, {
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'read', arguments: { ref: mcpHistorical.matches[0].ref } },
      });
      const mcpHistoricalRead = JSON.parse(mcpHistoricalReadResponse.result.content[0].text);
      assert.equal(mcpHistoricalRead.exactText, 'Ready');
      assert.equal(mcpHistoricalRead.binding.externalId, 'task-1');
    } finally {
      server.close();
      outputLines.close();
      input.end();
      output.end();
    }

    const verifyInput = new PassThrough();
    const verifyOutput = new PassThrough();
    const verifyOutputLines = createInterface({ input: verifyOutput });
    const verifyServer = runSourceNativeProductMcp(
      openSourceNativeProduct({ artifactRoot: root }),
      { input: verifyInput, output: verifyOutput },
    );
    try {
      await mcpCall(verifyInput, verifyOutputLines, {
        jsonrpc: '2.0', id: 6, method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      });
      const verifiedCurrentResponse = await mcpCall(verifyInput, verifyOutputLines, {
        jsonrpc: '2.0', id: 7, method: 'tools/call',
        params: { name: 'verify', arguments: { question: currentQuestion } },
      });
      const verifiedCurrent = JSON.parse(verifiedCurrentResponse.result.content[0].text);
      assert.equal(verifiedCurrent.state, 'resolved-current-field');
      assert.equal(verifiedCurrent.answerable, true);
      assert.equal(verifiedCurrent.query.externalId, 'task-1');
      assert.equal(verifiedCurrent.context[0].exactText, 'Done');
      assert.equal(verifiedCurrent.context[0].binding.externalId, 'task-1');

      const verifiedHistoricalResponse = await mcpCall(verifyInput, verifyOutputLines, {
        jsonrpc: '2.0', id: 8, method: 'tools/call',
        params: {
          name: 'verify', arguments: { question: historicalQuestion, at: TITLE_AT },
        },
      });
      const verifiedHistorical = JSON.parse(verifiedHistoricalResponse.result.content[0].text);
      assert.equal(verifiedHistorical.state, 'resolved-historical-field');
      assert.equal(verifiedHistorical.answerable, true);
      assert.equal(verifiedHistorical.at, TITLE_AT);
      assert.equal(verifiedHistorical.query.externalId, 'task-1');
      assert.equal(verifiedHistorical.context[0].exactText, 'Ready');
      assert.equal(verifiedHistorical.context[0].binding.externalId, 'task-1');
    } finally {
      verifyServer.close();
      verifyOutputLines.close();
      verifyInput.end();
      verifyOutput.end();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('title-only unknown and wrong-namespace refusals match across SDK, CLI and MCP', async () => {
  const root = buildFixture(buildTitleParityInput(), 'oont-historical-title-refusal-');
  const questions = [
    'For other, what is the current status of the task titled "Legacy review"?',
    'What is the current status of the task titled "No such task"?',
  ];
  try {
    const client = openOntology({ artifactRoot: root });
    const sdkResults = await Promise.all(questions.map((question) => client.verify(question)));
    assert.deepEqual(sdkResults.map((result) => result.state), [
      'unavailable-native-object-identifier-not-declared',
      'unavailable-native-object-identifier-not-declared',
    ]);
    for (const result of sdkResults) {
      assert.equal(result.answerable, false);
      assert.deepEqual(result.context, []);
    }

    const cliResults = questions.map((question) => {
      const result = runCli(['verify', root, question]);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    });
    assert.deepEqual(cliResults.map((result) => result.state), sdkResults.map((result) => result.state));
    for (const result of cliResults) {
      assert.equal(result.answerable, false);
      assert.deepEqual(result.context, []);
    }

    const input = new PassThrough();
    const output = new PassThrough();
    const outputLines = createInterface({ input: output });
    const server = runSourceNativeProductMcp(openSourceNativeProduct({ artifactRoot: root }), {
      input, output, profile: 'advanced',
    });
    try {
      await mcpCall(input, outputLines, {
        jsonrpc: '2.0', id: 10, method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      });
      for (const [index, question] of questions.entries()) {
        const response = await mcpCall(input, outputLines, {
          jsonrpc: '2.0', id: 11 + index, method: 'tools/call',
          params: { name: 'search', arguments: { question } },
        });
        const result = JSON.parse(response.result.content[0].text);
        assert.equal(result.state, sdkResults[index].state);
        assert.equal(result.matches.length, 0);
      }
    } finally {
      server.close();
      outputLines.close();
      input.end();
      output.end();
    }

    const verifyInput = new PassThrough();
    const verifyOutput = new PassThrough();
    const verifyOutputLines = createInterface({ input: verifyOutput });
    const verifyServer = runSourceNativeProductMcp(
      openSourceNativeProduct({ artifactRoot: root }),
      { input: verifyInput, output: verifyOutput },
    );
    try {
      await mcpCall(verifyInput, verifyOutputLines, {
        jsonrpc: '2.0', id: 20, method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      });
      for (const [index, question] of questions.entries()) {
        const response = await mcpCall(verifyInput, verifyOutputLines, {
          jsonrpc: '2.0', id: 21 + index, method: 'tools/call',
          params: { name: 'verify', arguments: { question } },
        });
        const result = JSON.parse(response.result.content[0].text);
        assert.equal(result.state, sdkResults[index].state);
        assert.equal(result.answerable, false);
        assert.deepEqual(result.context, []);
      }
    } finally {
      verifyServer.close();
      verifyOutputLines.close();
      verifyInput.end();
      verifyOutput.end();
    }
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
