#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const run = (args) => spawnSync(process.execPath, [resolve(repositoryRoot, 'dist/cli/oont.js'), ...args], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});

for (const args of [
  ['--help'],
  ['resolver', '--help'],
  ['resolver', 'search', '--help'],
  ['verify', '--help'],
  ['search', '--help'],
  ['status', '--help'],
  ['check', '--help'],
  ['serve', '--help'],
]) {
  const result = run(args);
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  assert.match(result.stderr, /usage: oont/u, args.join(' '));
  assert.doesNotMatch(result.stderr, /\n\s+at\s/u, args.join(' '));
}

const version = run(['--version']);
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), '0.3.0-alpha.3');
assert.equal(version.stderr, '');

const badIntent = run([
  'verify', './missing', 'What is current?', '--intent', 'previous',
]);
assert.equal(badIntent.status, 2);
assert.match(badIntent.stderr, /^usage: oont <command>/u);
assert.doesNotMatch(badIntent.stderr, /^usage: oont resolver <command>/u);
