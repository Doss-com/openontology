#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(compiler)) {
  throw new Error('TypeScript is not installed. Run npm ci before building.');
}

execFileSync(process.execPath, [join(root, 'scripts', 'clean.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync(process.execPath, [compiler, '--project', join(root, 'tsconfig.json')], {
  cwd: root,
  stdio: 'inherit',
});
