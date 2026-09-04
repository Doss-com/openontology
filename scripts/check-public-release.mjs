#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
  process.stderr.write(`public release check failed: ${message}\n`);
  process.exit(1);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item);

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const allowedRoots = new Set([
  '.editorconfig', '.github', '.gitignore', '.npmignore', '.nvmrc',
  'AGENTS.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md',
  'GLOSSARY.md', 'LICENSE', 'README.md', 'SECURITY.md', 'bin', 'docs',
  'examples',
  'package-lock.json', 'package.json', 'scripts', 'SOURCE-MANIFEST.json', 'src',
]);

const unexpectedRoots = [...new Set(tracked.map((path) => path.split('/')[0]))]
  .filter((name) => !allowedRoots.has(name));
if (unexpectedRoots.length) fail(`unexpected root entries: ${unexpectedRoots.join(', ')}`);

const forbiddenPaths = tracked.filter((path) =>
  /^(eval|evidence|customers|design|eng|specs|harness|asks|studio|tooling)\//u.test(path)
  || /(^|\/)(?:\.env(?:\.|$)|stdout\.raw$|stderr\.raw$)/u.test(path));
if (forbiddenPaths.length) fail(`forbidden paths: ${forbiddenPaths.slice(0, 10).join(', ')}`);

const symlinks = tracked.filter((path) => lstatSync(join(root, path)).isSymbolicLink());
if (symlinks.length) fail(`symlinks are not allowed in the public source: ${symlinks.join(', ')}`);

for (const path of tracked.filter((name) => /^\.github\/workflows\/.*\.ya?ml$/u.test(name))) {
  const workflow = readFileSync(join(root, path), 'utf8');
  for (const match of workflow.matchAll(/^\s*-?\s*uses:\s*([^@\s]+)@([^\s#]+)/gmu)) {
    if (!match[1].startsWith('./') && !/^[0-9a-f]{40}$/u.test(match[2])) {
      fail(`GitHub Action is not pinned to a full commit in ${path}: ${match[0].trim()}`);
    }
  }
}

const manifestPath = join(root, 'SOURCE-MANIFEST.json');
if (!tracked.includes('SOURCE-MANIFEST.json')) fail('SOURCE-MANIFEST.json is required');
let sourceManifest;
try { sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch {
  fail('SOURCE-MANIFEST.json is not valid JSON');
}
const manifestKeys = [
  'fileCount', 'files', 'kind', 'manifestSha256', 'packageName', 'packageVersion',
  'schemaVersion',
];
if (JSON.stringify(Object.keys(sourceManifest).sort()) !== JSON.stringify(manifestKeys)) {
  fail('source manifest has unexpected fields');
}
const { manifestSha256, ...manifestCore } = sourceManifest;
if (sourceManifest.kind !== 'OpenOntologyPublicSourceManifestV1'
  || manifestSha256 !== `sha256:${sha256(Buffer.from(canonical(manifestCore)))}`) {
  fail('source manifest identity is invalid');
}
const manifestPaths = sourceManifest.files?.map((file) => file.path) ?? [];
const expectedManifestPaths = tracked.filter((path) => path !== 'SOURCE-MANIFEST.json');
if (sourceManifest.fileCount !== manifestPaths.length
  || JSON.stringify(manifestPaths) !== JSON.stringify(expectedManifestPaths)) {
  fail('source manifest file inventory does not match Git');
}
for (const file of sourceManifest.files) {
  const bytes = readFileSync(join(root, file.path));
  if (file.bytes !== bytes.length || file.sha256 !== sha256(bytes)) {
    fail(`source manifest mismatch in ${file.path}`);
  }
}

for (const path of tracked) {
  const fullPath = join(root, path);
  const status = lstatSync(fullPath);
  if (!status.isFile() || status.size > 2_000_000) continue;
  const bytes = readFileSync(fullPath);
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  if (/\/(?:Users|home)\/[^\s/]+\//u.test(text) || /[A-Za-z]:\\Users\\[^\s\\]+\\/u.test(text)) {
    fail(`local machine path in ${path}`);
  }
  const secretPatterns = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE K[E]Y-----/u],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{32,}\b/u],
    ['OpenAI token', /\bsk[-](?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/u],
    ['Anthropic token', /\bsk[-]ant-[A-Za-z0-9_-]{20,}\b/u],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/u],
    ['credential-bearing URL', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^/\s:@]+:[^@\s/]+@/u],
  ];
  for (const [kind, pattern] of secretPatterns) {
    if (pattern.test(text)) fail(`${kind} pattern in ${path}`);
  }
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'oont') fail('package name must be oont');
if (packageJson.version !== '0.3.0-alpha.2') fail('package version must be 0.3.0-alpha.2');
if (sourceManifest.packageName !== packageJson.name
  || sourceManifest.packageVersion !== packageJson.version) {
  fail('source manifest package identity does not match package.json');
}
if (JSON.stringify(packageJson.exports) !== JSON.stringify({
  '.': './src/openontology.mjs',
  './package.json': './package.json',
})) {
  fail('package exports must expose only the public root Module and package metadata');
}
if (Object.keys(packageJson.scripts ?? {}).length > 16) fail('package script surface is too broad');

const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
}))[0];
const packedPaths = packed.files.map((file) => file.path);
const required = [
  'README.md', 'LICENSE', 'package.json', 'bin/oont.mjs',
  'src/openontology.mjs', 'examples/quickstart/source-native-input.json',
];
for (const path of required) {
  if (!packedPaths.includes(path)) fail(`package is missing ${path}`);
}
const forbiddenPacked = packedPaths.filter((path) =>
  /^(eval|evidence|design|site|test|tests)\//u.test(path)
  || path === 'PASTE-PROMPT.md'
  || /(?:RESULT|REPORT|private|\.raw)/iu.test(path));
if (forbiddenPacked.length) fail(`forbidden package files: ${forbiddenPacked.join(', ')}`);
if (packed.entryCount > 64) fail(`package contains ${packed.entryCount} files, expected at most 64`);

process.stdout.write(`public release check passed: ${tracked.length} tracked files, ${packed.entryCount} package files\n`);
