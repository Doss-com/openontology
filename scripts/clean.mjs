#!/usr/bin/env node

import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
if (dirname(output) !== root || output === root) {
  throw new Error(`refusing to clean outside the repository dist directory: ${output}`);
}

rmSync(output, { recursive: true, force: true });
