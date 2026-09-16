#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import * as publicSdk from '../../dist/openontology.js';
import { buildSourceNativeProduct } from '../../dist/product/runtime.js';
import { SOURCE_NATIVE_PRODUCT_TOOLS } from '../../dist/product/mcp.js';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const bin = resolve(repositoryRoot, 'dist/cli/oont.js');
const { openOntology } = publicSdk;

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function buildInput() {
  return {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'product-surface-contract',
    namespace: 'contract',
    querySchemas: [
      {
        sourceSystem: 'linear',
        objectType: 'issue',
        aliases: ['issue'],
        fields: [{ fieldPath: 'status', aliases: ['status'] }],
      },
    ],
    sources: [
      {
        relativePath: 'linear/contract/issue-1.txt',
        sourceType: 'linear',
        occurredAt: '2026-09-03T12:00:00.000Z',
        content: 'Ready',
      },
    ],
    nativeObjectInputs: [
      {
        relativePath: 'linear/contract/issue-1.txt',
        objectIdentity: {
          home: 'ObjectDef/InstanceRef',
          sourceSystem: 'linear',
          objectType: 'issue',
          namespace: 'contract',
          externalId: 'issue-1',
        },
        fields: [{ fieldPath: 'status', value: 'Ready' }],
      },
    ],
  };
}

test('top-level help exposes only the public product and deterministic builder', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /verify <ont> <question>/u);
  assert.match(result.stderr, /search <ont> <question>/u);
  assert.match(result.stderr, /status <ont>/u);
  assert.match(result.stderr, /check <ont>/u);
  assert.match(result.stderr, /serve <ont> --mcp/u);
  assert.match(result.stderr, /resolver build <input\.json>/u);
  assert.doesNotMatch(result.stderr, /\bask\b|\bresolve\b|\binspect\b/u);
  assert.doesNotMatch(result.stderr, /admin|agent-loop|study build|storage import/u);
});

test('package root exposes one deep client constructor', () => {
  assert.deepEqual(Object.keys(publicSdk), ['openOntology']);
});

test('SDK distinguishes invalid options from an invalid Ont', () => {
  assert.throws(
    () => openOntology({}),
    (error) => error instanceof TypeError && error.code === 'OPENONTOLOGY_OPTIONS',
  );

  const root = mkdtempSync(join(tmpdir(), 'oont-invalid-artifact-contract-'));
  try {
    assert.throws(
      () => openOntology({ artifactRoot: root }),
      (error) => error instanceof TypeError && error.code === 'OPENONTOLOGY_ARTIFACT',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('top-level product help is command-specific', () => {
  const expected = {
    verify: /usage: oont verify <ont> <question>/u,
    search: /usage: oont search <ont> <question>/u,
    status: /usage: oont status <ont>/u,
    check: /usage: oont check <ont>/u,
    serve: /usage: oont serve <ont> --mcp/u,
  };
  for (const [command, usagePattern] of Object.entries(expected)) {
    const result = run([command, '--help']);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stderr, usagePattern, command);
    assert.doesNotMatch(result.stderr, /usage: oont resolver/u, command);
    if (command === 'verify' || command === 'search') {
      assert.doesNotMatch(result.stderr, /--no-learning|--search-policy-channel/u, command);
      assert.match(result.stderr, /--source-system <name>/u, command);
      assert.match(result.stderr, /--external-id <id>/u, command);
    }
  }
});

test('private workbench and classic compatibility commands do not ship', () => {
  for (const command of ['admin', 'init', 'extract', 'storage', 'show']) {
    const result = run([command, '--help']);
    assert.equal(result.status, 2, command);
    assert.match(result.stderr, new RegExp(`unknown command '${command}'`, 'u'), command);
  }
});

test('retired query verbs are not compatibility aliases', () => {
  const ask = run(['ask', './missing', 'question']);
  assert.equal(ask.status, 2);
  assert.match(ask.stderr, /unknown command 'ask'/u);

  const resolveCommand = run(['resolver', 'resolve', './missing', 'question']);
  assert.equal(resolveCommand.status, 2);
  assert.match(resolveCommand.stderr, /usage: oont <command>/u);
});

test('SDK exposes only the locked query interface and preserves navigation before Evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-product-surface-contract-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    const ont = openOntology({ artifactRoot: root });
    assert.deepEqual(Object.keys(ont).sort(), ['kind', 'read', 'search', 'status', 'verify']);
    assert.equal(ont.kind, 'OpenOntologyClientV2');
    assert.equal('resolve' in ont, false);
    assert.equal('inspect' in ont, false);

    const query = {
      question: 'What is the current issue status?',
      scope: {
        sourceSystem: 'linear',
        objectType: 'issue',
        externalId: 'issue-1',
        field: 'status',
      },
    };
    const search = await ont.search(query);
    assert.equal(search.policy.navigationOnly, true);
    assert.equal(search.policy.exactReadRequired, true);
    assert.equal(JSON.stringify(search).includes('Ready'), false);
    assert.equal(search.matches.length, 1);

    const nullAnchorSearch = await ont.search({ ...query, anchorValue: null });
    assert.equal(
      nullAnchorSearch.verification.queryPlanSha256,
      search.verification.queryPlanSha256,
    );
    assert.throws(
      () => ont.search({ ...query, anchorValue: 7 }),
      (error) => error instanceof TypeError && error.code === 'OPENONTOLOGY_QUERY',
    );
    assert.throws(
      () => ont.search({ ...query, typedQuery: null }),
      (error) => error instanceof TypeError && error.code === 'OPENONTOLOGY_QUERY',
    );

    const evidence = await ont.read(search.matches[0].ref);
    assert.equal(evidence.exactText, 'Ready');
    assert.equal(evidence.binding.externalId, 'issue-1');

    const verification = await ont.verify(query);
    assert.equal(verification.answerable, true);
    assert.equal(verification.context[0].exactText, 'Ready');
    assert.equal(verification.context[0].binding.sourceSystem, 'linear');
    assert.equal(verification.context[0].binding.objectType, 'issue');
    assert.equal(verification.context[0].binding.namespace, 'contract');
    assert.equal(verification.context[0].binding.externalId, 'issue-1');
    assert.equal(verification.context[0].binding.fieldPath, 'status');
    assert.equal(verification.query.externalId, verification.context[0].binding.externalId);
    assert.equal(verification.verification.navigationProposals.state, 'raw-only');
    assert.match(verification.verificationSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.hasOwn(verification, 'learning'), false);
    assert.equal(ont.status().readOnly, true);
    assert.equal(Object.hasOwn(ont.status(), 'learningSidecarWrites'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('top-level search and status delegate to the read-only product surface', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-product-surface-cli-'));
  const inputPath = join(root, 'input.json');
  try {
    writeFileSync(inputPath, JSON.stringify(buildInput()));
    const build = run(['resolver', 'build', inputPath, '--out', root]);
    assert.equal(build.status, 0, build.stderr);

    const search = run(['search', root, 'What is the current issue status?']);
    assert.equal(search.status, 0, search.stderr);
    const searchResult = JSON.parse(search.stdout);
    assert.equal(searchResult.policy.navigationOnly, true);
    assert.equal(searchResult.matches.length, 1);
    assert.doesNotMatch(search.stdout, /Ready/u);

    const searchWithRead = run(['search', root, 'What is the current issue status?', '--read']);
    assert.equal(searchWithRead.status, 0, searchWithRead.stderr);
    const searchWithReadResult = JSON.parse(searchWithRead.stdout);
    assert.equal(searchWithReadResult.evidence.length, 1);
    assert.equal(searchWithReadResult.evidence[0].exactText, 'Ready');

    const status = run(['status', root]);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).readOnly, true);

    const check = run(['check', root]);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).kind, 'OpenOntologyCheckV1');
    assert.equal(JSON.parse(check.stdout).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public SDK rejects control-plane and unknown options', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-product-options-contract-'));
  try {
    buildSourceNativeProduct({ artifactRoot: root, input: buildInput() });
    for (const extra of [
      { knowledgeProposalCapture: true },
      { investigationRecording: {} },
      { activeSearchPolicyChannelId: 'untrusted-channel' },
      { unexpected: true },
    ]) {
      assert.throws(
        () => openOntology({ artifactRoot: root, ...extra }),
        (error) => error instanceof TypeError && error.code === 'OPENONTOLOGY_OPTIONS',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP profiles expose one ordinary path or one advanced path, never both', () => {
  assert.deepEqual(
    SOURCE_NATIVE_PRODUCT_TOOLS.verify.map((tool) => tool.name),
    ['verify'],
  );
  assert.deepEqual(
    SOURCE_NATIVE_PRODUCT_TOOLS.advanced.map((tool) => tool.name),
    ['search', 'read'],
  );
  assert.deepEqual(
    Object.keys(SOURCE_NATIVE_PRODUCT_TOOLS.verify[0].inputSchema.properties).sort(),
    ['anchorValue', 'at', 'intent', 'question', 'scope'],
  );
  assert.deepEqual(SOURCE_NATIVE_PRODUCT_TOOLS.verify[0].inputSchema.properties.scope.required, [
    'sourceSystem',
    'objectType',
    'field',
  ]);
});
