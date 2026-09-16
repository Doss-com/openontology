#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let packageSandbox = null;
process.on('exit', () => {
  if (packageSandbox) rmSync(packageSandbox, { recursive: true, force: true });
});
const fail = (message) => {
  process.stderr.write(`public release check failed: ${message}\n`);
  if (packageSandbox) rmSync(packageSandbox, { recursive: true, force: true });
  process.exit(1);
};
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const allowedRoots = new Set([
  '.editorconfig', '.github', '.gitignore', '.npmignore', '.nvmrc',
  '.prettierignore', '.prettierrc.json',
  'AGENTS.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md',
  'GLOSSARY.md', 'LICENSE', 'README.md', 'SECURITY.md', 'docs',
  'examples',
  'package-lock.json', 'package.json', 'scripts', 'src', 'test',
  'tsconfig.json',
]);

const unexpectedRoots = [...new Set(tracked.map((path) => path.split('/')[0]))]
  .filter((name) => !allowedRoots.has(name));
if (unexpectedRoots.length) fail(`unexpected root entries: ${unexpectedRoots.join(', ')}`);

const forbiddenPaths = tracked.filter((path) =>
  /^(eval|evidence|customers|design|eng|specs|harness|asks|studio|tooling)\//u.test(path)
  || /(^|\/)(?:\.env(?:\.|$)|stdout\.raw$|stderr\.raw$)/u.test(path));
if (forbiddenPaths.length) fail(`forbidden paths: ${forbiddenPaths.slice(0, 10).join(', ')}`);

const missingTracked = tracked.filter((path) => !existsSync(join(root, path)));
if (missingTracked.length) fail(`tracked paths missing from checkout: ${missingTracked.slice(0, 10).join(', ')}`);
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
  if (path.endsWith('.svg') && /<script\b|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?:https?:|data:)/iu.test(text)) {
    fail(`unsafe external or executable SVG content in ${path}`);
  }
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'oont') fail('package name must be oont');
if (typeof packageJson.version !== 'string' || !semverPattern.test(packageJson.version)) {
  fail(`package version is not valid SemVer: ${packageJson.version}`);
}
const expectedTag = `v${packageJson.version}`;
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== expectedTag) {
  fail(`release tag ${process.env.GITHUB_REF_NAME} does not match ${expectedTag}`);
}
const releaseNotesPath = `.github/release-notes/${expectedTag}.md`;
if (!tracked.includes(releaseNotesPath)) fail(`release notes are required at ${releaseNotesPath}`);
if (JSON.stringify(packageJson.exports) !== JSON.stringify({
  '.': {
    types: './dist/openontology.d.ts',
    import: './dist/openontology.js',
  },
  './kernel': {
    types: './dist/kernel.d.ts',
    import: './dist/kernel.js',
  },
  './package.json': './package.json',
})) {
  fail('package exports must expose only the generated public root Module and package metadata');
}
if (Object.keys(packageJson.dependencies ?? {}).length !== 0) {
  fail('runtime dependencies must remain empty');
}

packageSandbox = mkdtempSync(join(tmpdir(), 'oont-release-'));
let packed;
try {
  packed = JSON.parse(execFileSync('npm', [
    'pack', '--ignore-scripts', '--pack-destination', packageSandbox, '--json',
  ], { cwd: root, encoding: 'utf8' }))[0];
  execFileSync('tar', ['-xzf', join(packageSandbox, packed.filename), '-C', packageSandbox], { cwd: root });
} catch (error) {
  fail(`could not inspect the exact packed tarball: ${error?.message ?? String(error)}`);
}
const packedPaths = packed.files.map((file) => file.path);
const generatedResultState = /^dist\/product\/result-state\.(?:js|d\.ts)(?:\.map)?$/u;
const required = [
  'README.md', 'LICENSE', 'package.json', 'dist/cli/oont.js',
  'dist/cli/oont.d.ts', 'dist/cli/resolver.js', 'dist/cli/resolver.d.ts',
  'dist/kernel.js', 'dist/kernel.d.ts', 'dist/openontology.js',
  'dist/openontology.d.ts', 'examples/quickstart/source-native-input.json',
  'examples/quickstart/source-lifecycle.mjs', 'docs/SOURCE-LIFECYCLE.md',
  'docs/QUERIES.md',
  'examples/quickstart/semantic-map.mjs',
];
for (const path of required) {
  if (!packedPaths.includes(path)) fail(`package is missing ${path}`);
}
const forbiddenPacked = packedPaths.filter((path) =>
  /^(eval|evidence|design|site|test|tests|src|bin|scripts)\//u.test(path)
  || path === 'PASTE-PROMPT.md'
  || (!generatedResultState.test(path) && /(?:^|\/)(?:RESULT|REPORT)(?:[._-]|$)/iu.test(path))
  || /(?:^|[._/-])private(?:[._/-]|$)|\.raw$/iu.test(path));
if (forbiddenPacked.length) fail(`forbidden package files: ${forbiddenPacked.join(', ')}`);
const invalidGenerated = packedPaths.filter((path) => path.startsWith('dist/')
  && !/\.(?:js|d\.ts)(?:\.map)?$/u.test(path));
if (invalidGenerated.length) fail(`unexpected generated package files: ${invalidGenerated.join(', ')}`);
const packageJsonInTarball = JSON.parse(readFileSync(join(packageSandbox, 'package', 'package.json'), 'utf8'));
if (JSON.stringify(packageJsonInTarball) !== JSON.stringify(packageJson)) {
  fail('packed package.json differs from the release checkout');
}
if (packedPaths.some((path) => /(?:^|\/)SOURCE-MANIFEST\.json$/u.test(path))) {
  fail('source inventory must remain outside the npm archive');
}
for (const path of packedPaths.filter((name) => name.endsWith('.map'))) {
  let map;
  try { map = JSON.parse(readFileSync(join(packageSandbox, 'package', path), 'utf8')); } catch {
    fail(`invalid source map in packed package: ${path}`);
  }
  const hasInlineSources = path.endsWith('.js.map');
  if (!Array.isArray(map.sources)
    || hasInlineSources && (!Array.isArray(map.sourcesContent)
      || map.sources.length !== map.sourcesContent.length)
    || map.sources.some((source) => typeof source !== 'string'
      || source.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(source))) {
    fail(`packed source map is not valid for the generated output contract: ${path}`);
  }
}
process.stdout.write(`public release check passed: ${tracked.length} tracked files, ${packed.entryCount} package files\n`);
rmSync(packageSandbox, { recursive: true, force: true });
packageSandbox = null;
