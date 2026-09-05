#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item);

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);
if (untracked.length > 0) {
  throw new Error(`Stage intended source files before updating the manifest: ${untracked.join(', ')}`);
}
const paths = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter((path) => path && path !== 'SOURCE-MANIFEST.json');
const files = paths.map((path) => {
  const bytes = readFileSync(join(root, path));
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
});
const core = {
  schemaVersion: 1,
  kind: 'OpenOntologyPublicSourceManifestV1',
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  fileCount: files.length,
  files,
};
const manifest = {
  ...core,
  manifestSha256: `sha256:${sha256(Buffer.from(canonical(core)))}`,
};

writeFileSync(join(root, 'SOURCE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`updated SOURCE-MANIFEST.json for ${files.length} files\n`);
