#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const sandbox = mkdtempSync(join(tmpdir(), 'oont-smoke-'));
const prefix = join(sandbox, 'prefix');
const project = join(sandbox, 'project');
const ont = join(project, 'verified-context');
mkdirSync(prefix, { recursive: true });
mkdirSync(project, { recursive: true });

let failures = 0;
let ordinal = 0;
const tail = (value, lines = 4) => String(value ?? '').trim().split('\n').slice(-lines).join('\n');
const check = (name, pass, detail = '') => {
  ordinal += 1;
  if (!pass) failures += 1;
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${String(ordinal).padStart(2)}. ${name}`
    + `${detail ? `\n        ${detail.replaceAll('\n', '\n        ')}` : ''}\n`);
};
const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: options.cwd ?? sandbox,
  encoding: 'utf8',
  env: { ...process.env, ...options.env },
  timeout: options.timeout ?? 300_000,
});

async function mcpTools(bin, artifactRoot, advanced = false) {
  return new Promise((done) => {
    const args = ['serve', artifactRoot, '--mcp'];
    if (advanced) args.push('--advanced');
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ ok: false, detail: 'MCP tools/list timed out' });
    }, 15_000);
    child.stdout.on('data', (bytes) => {
      pending += bytes;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch {
          clearTimeout(timer);
          child.kill('SIGKILL');
          done({ ok: false, detail: `non-JSON MCP output: ${line.slice(0, 120)}` });
          return;
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0', method: 'notifications/initialized', params: {},
          })}\n`);
          child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
          })}\n`);
        }
        if (message.id === 2) {
          clearTimeout(timer);
          child.kill('SIGKILL');
          const names = message.result?.tools?.map((tool) => tool.name) ?? [];
          done({ ok: true, names });
          return;
        }
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'oont-smoke', version: '1' },
      },
    })}\n`);
  });
}

process.stdout.write(`sandbox ${sandbox}\n\n`);

try {
  const packed = run('npm', ['pack', '--pack-destination', sandbox], { cwd: root });
  const tarball = tail(packed.stdout, 1);
  const tarballPath = tarball ? join(sandbox, tarball) : null;
  const packedOk = packed.status === 0 && tarballPath && existsSync(tarballPath);
  check('npm pack', packedOk, packedOk
    ? `${tarball} (${(statSync(tarballPath).size / 1024).toFixed(0)} KB)`
    : tail(packed.stderr));
  if (!packedOk) process.exit(1);

  const installed = run('npm', [
    'install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarballPath,
  ]);
  const bin = join(prefix, 'bin', 'oont');
  const packageRoot = join(prefix, 'lib', 'node_modules', 'oont');
  check('clean global install', installed.status === 0 && existsSync(bin), tail(installed.stderr));

  const help = run(bin, ['--help']);
  check('public CLI is compact', help.status === 0
    && /verify <ont>/.test(help.stderr)
    && /resolver build/.test(help.stderr)
    && !/admin|init|extract/.test(help.stderr), tail(help.stderr, 12));

  const inputPath = join(project, 'source-native-input.json');
  writeFileSync(inputPath, readFileSync(join(root, 'examples', 'quickstart',
    'source-native-input.json')));
  const build = run(bin, ['resolver', 'build', inputPath, '--out', ont]);
  check('deterministic Adapter build', build.status === 0
    && existsSync(join(ont, 'source-native.json')), tail(build.stderr));

  const integrity = run(bin, ['check', ont]);
  let integrityResult;
  try { integrityResult = JSON.parse(integrity.stdout); } catch { integrityResult = null; }
  check('Ont integrity check', integrity.status === 0
    && integrityResult?.kind === 'OpenOntologyCheckV1'
    && integrityResult?.ok === true, integrity.status === 0 ? integrity.stdout.trim() : tail(integrity.stderr));

  const verified = run(bin, ['verify', ont, 'What is the current title of task-1?']);
  let verification;
  try { verification = JSON.parse(verified.stdout); } catch { verification = null; }
  check('proof-complete verification', verified.status === 0
    && verification?.answerable === true
    && verification?.context?.[0]?.exactText === 'Ship verified context',
  verified.status === 0 ? `state ${verification?.state}; exact ${verification?.context?.[0]?.exactText}`
    : tail(verified.stderr));

  const refused = run(bin, ['verify', ont, 'Who owns task-1?']);
  let refusal;
  try { refusal = JSON.parse(refused.stdout); } catch { refusal = null; }
  check('typed refusal is a valid result', refused.status === 0
    && refusal?.answerable === false
    && typeof refusal?.state === 'string',
  refused.status === 0 ? refusal?.state : tail(refused.stderr));

  const navigation = run(bin, ['search', ont, 'What is the current title of task-1?']);
  const exact = run(bin, ['search', ont, 'What is the current title of task-1?',
    '--read']);
  let navigationResult;
  let exactResult;
  try { navigationResult = JSON.parse(navigation.stdout); } catch { navigationResult = null; }
  try { exactResult = JSON.parse(exact.stdout); } catch { exactResult = null; }
  check('search navigates before exact read', navigation.status === 0 && exact.status === 0
    && navigationResult?.matches?.length === 1
    && !navigation.stdout.includes('Ship verified context')
    && exactResult?.evidence?.[0]?.exactText === 'Ship verified context',
  `references ${navigationResult?.matches?.length ?? 0}; exact reads ${exactResult?.evidence?.length ?? 0}`);

  const sdkProgram = `globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
import { openOntology } from ${JSON.stringify(new URL(
    `file://${join(packageRoot, 'src', 'openontology.mjs')}`).href)};
const ont = openOntology({ artifactRoot: ${JSON.stringify(ont)} });
const keys = Object.keys(ont).sort();
const result = await ont.verify('What is the current title of task-1?');
if (JSON.stringify(keys) !== JSON.stringify(['kind','read','search','status','verify']) || !result.answerable) process.exit(1);`;
  const sdk = run(process.execPath, ['--input-type=module', '--eval', sdkProgram]);
  check('installed SDK verifies offline through one client', sdk.status === 0, tail(sdk.stderr));

  const ordinaryMcp = await mcpTools(bin, ont, false);
  check('default MCP exposes only verify', ordinaryMcp.ok
    && JSON.stringify(ordinaryMcp.names) === JSON.stringify(['verify']),
  ordinaryMcp.ok ? ordinaryMcp.names.join(',') : ordinaryMcp.detail);

  const advancedMcp = await mcpTools(bin, ont, true);
  check('advanced MCP exposes search and read', advancedMcp.ok
    && JSON.stringify(advancedMcp.names) === JSON.stringify(['search', 'read']),
  advancedMcp.ok ? advancedMcp.names.join(',') : advancedMcp.detail);

  const publish = run('npm', ['publish', '--dry-run', '--tag', 'next', '--access', 'public'], {
    cwd: root,
  });
  check('npm publish dry-run', publish.status === 0, tail(publish.stderr));
} finally {
  if (keep) process.stdout.write(`kept ${sandbox}\n`);
  else rmSync(sandbox, { recursive: true, force: true });
}

process.stdout.write(`\n${ordinal - failures}/${ordinal} checks passed.\n`);
process.exit(failures === 0 ? 0 : 1);
