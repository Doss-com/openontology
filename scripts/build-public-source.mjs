#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destinationArg = process.argv[2];
const update = process.argv.includes('--update');
if (!destinationArg) {
  process.stderr.write('usage: node scripts/build-public-source.mjs <empty-public-worktree>\n');
  process.exit(2);
}
const destination = resolve(destinationArg);
const fail = (message) => {
  process.stderr.write(`public source build failed: ${message}\n`);
  process.exit(1);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item);
const listFiles = (directory, prefix = '') => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    if (!prefix && entry.name === '.git') return [];
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`destination contains a symlink: ${path}`);
    if (entry.isDirectory()) return listFiles(absolute, path);
    if (!entry.isFile()) fail(`destination contains a non-file entry: ${path}`);
    return [path];
  });

if (!existsSync(destination) || !lstatSync(destination).isDirectory()
  || lstatSync(destination).isSymbolicLink()) fail('destination must be a real directory');
const existing = readdirSync(destination).filter((name) => name !== '.git');
if (existing.length && !update) fail(`destination is not empty: ${existing.join(', ')}`);

const sourceStatus = execFileSync('git', ['status', '--porcelain=v1'], {
  cwd: root, encoding: 'utf8',
});
if (sourceStatus) fail('source worktree must be clean and committed');

const packed = JSON.parse(execFileSync('npm', [
  'pack', '--dry-run', '--json', '--ignore-scripts',
], { cwd: root, encoding: 'utf8' }))[0];
const repositoryFiles = [
  '.editorconfig',
  '.npmignore',
  '.nvmrc',
  '.github/CODEOWNERS',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  'AGENTS.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'package-lock.json',
  'scripts/build-public-source.mjs',
  'scripts/check-package-import-closure.mjs',
  'scripts/check-public-release.mjs',
  'scripts/qualify-gcs-object-storage.mjs',
  'scripts/run-gcs-object-operation.mjs',
  'scripts/smoke-pack.mjs',
  'scripts/test-canonical-content.mjs',
  'scripts/test-canonical-object-backend.mjs',
  'scripts/test-gcs-object-storage-backend.mjs',
  'scripts/test-oont-cli-help.mjs',
  'scripts/test-product-surface-contract.mjs',
  'scripts/test-source-native-field-resolution.mjs',
  'scripts/test-source-native-object-map.mjs',
  'scripts/test-source-native-product.mjs',
  'scripts/test-source-native-query-planner.mjs',
];
const paths = [...new Set([
  ...packed.files.map((file) => file.path),
  ...repositoryFiles,
])].sort();
if (update) {
  const allowed = new Set([...paths, '.gitignore', 'SOURCE-PROVENANCE.json']);
  const unexpected = listFiles(destination).filter((path) => !allowed.has(path));
  if (unexpected.length) fail(`destination has unexpected entries: ${unexpected.join(', ')}`);
}

for (const path of paths) {
  const source = join(root, path);
  if (!existsSync(source)) fail(`missing source path ${path}`);
  const status = lstatSync(source);
  if (!status.isFile() || status.isSymbolicLink()) fail(`source path is not a regular file: ${path}`);
  const output = join(destination, path);
  mkdirSync(dirname(output), { recursive: true });
  cpSync(source, output, { preserveTimestamps: true });
}

const publicPackagePath = join(destination, 'package.json');
const publicPackage = JSON.parse(readFileSync(publicPackagePath, 'utf8'));
publicPackage.scripts.check =
  'npm run check:source-native-product && npm run check:canonical-object-backend';
delete publicPackage.scripts['check:learning-runtime'];
writeFileSync(publicPackagePath, `${JSON.stringify(publicPackage, null, 2)}\n`);

const gitignore = `node_modules/
coverage/
dist/
*.log
*.tgz
.env
.env.*
!.env.example
.DS_Store
`;
writeFileSync(join(destination, '.gitignore'), gitignore);
paths.push('.gitignore');
paths.sort();

const files = paths.map((path) => {
  const bytes = readFileSync(join(destination, path));
  return { path: path.split(sep).join('/'), bytes: bytes.length, sha256: sha256(bytes) };
});
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root, encoding: 'utf8',
}).trim();
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
  cwd: root, encoding: 'utf8',
}).trim();
const sourceRemote = execFileSync('git', ['remote', 'get-url', 'origin'], {
  cwd: root, encoding: 'utf8',
}).trim();
const core = {
  schemaVersion: 1,
  kind: 'OpenOntologyPublicSourceProvenanceV1',
  packageName: 'oont',
  packageVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  sourceRemote,
  sourceCommit,
  sourceTree,
  fileCount: files.length,
  files,
};
const provenance = { ...core, manifestSha256: `sha256:${sha256(Buffer.from(canonical(core)))}` };
writeFileSync(join(destination, 'SOURCE-PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  destination,
  sourceCommit,
  sourceTree,
  publicFiles: files.length + 1,
  packageFiles: packed.entryCount,
  manifestSha256: provenance.manifestSha256,
})}\n`);
