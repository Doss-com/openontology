#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const run = (args) => spawnSync(process.execPath, [resolve(repositoryRoot, 'dist/bin/oont.mjs'), ...args], {
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
