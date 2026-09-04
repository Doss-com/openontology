#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
}))[0];
const paths = new Set(packed.files.map((file) => file.path));
const modules = [...paths].filter((path) => /\.(?:mjs|js)$/u.test(path));
const missing = [];
const importsByModule = new Map(modules.map((path) => [path, new Set()]));

function packagePath(importer, specifier) {
  const absolute = resolve(root, dirname(importer), specifier);
  const relative = normalize(absolute.slice(root.length + 1)).split(sep).join('/');
  return relative;
}

function requirePacked(importer, specifier, kind = 'import') {
  if (!specifier.startsWith('.')) return;
  if (specifier.endsWith('/') || !/\.(?:mjs|js|json|node)$/u.test(specifier)) return;
  const target = packagePath(importer, specifier);
  if (!paths.has(target)) missing.push({ importer, kind, specifier, target });
  else if (importsByModule.has(target)) importsByModule.get(importer).add(target);
}

for (const importer of modules) {
  const source = readFileSync(join(root, importer), 'utf8');
  const patterns = [
    { kind: 'import', re: /(?:from\s+|import\s*\()(['"])(\.{1,2}\/[^'"]+)\1/gu },
    { kind: 'side-effect import', re: /import\s+(['"])(\.{1,2}\/[^'"]+)\1/gu },
    { kind: 'import.meta.url resource', re: /new URL\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*,\s*import\.meta\.url/gu },
  ];
  for (const { kind, re } of patterns) {
    for (const match of source.matchAll(re)) requirePacked(importer, match[2], kind);
  }

  if (importer === 'bin/oont.mjs') {
    for (const match of source.matchAll(/delegate\(\s*(['"])([^'"]+\.mjs)\1/gu)) {
      const target = `scripts/${match[2]}`;
      if (!paths.has(target)) missing.push({ importer, kind: 'CLI delegate', specifier: match[2], target });
    }
    for (const match of source.matchAll(/join\(ROOT,\s*(['"])(src|scripts)\1,\s*(['"])([^'"]+)\3\)/gu)) {
      const target = `${match[2]}/${match[4]}`;
      if (!paths.has(target)) missing.push({ importer, kind: 'CLI dynamic import', specifier: match[4], target });
    }
  }
}

const runtimeRoots = ['bin/oont.mjs', 'scripts/oont-resolver.mjs', 'src/openontology.mjs'];
for (const path of runtimeRoots) {
  if (!paths.has(path)) missing.push({
    importer: 'package.json', kind: 'runtime root', specifier: path, target: path,
  });
}

const reachable = new Set();
const pending = runtimeRoots.filter((path) => importsByModule.has(path));
while (pending.length) {
  const path = pending.pop();
  if (reachable.has(path)) continue;
  reachable.add(path);
  for (const imported of importsByModule.get(path)) pending.push(imported);
}
const unreachable = modules.filter((path) => !reachable.has(path));
if (unreachable.length) {
  process.stderr.write(`${unreachable.length} unreachable package module(s):\n`);
  for (const path of unreachable) process.stderr.write(`  ${path}\n`);
  process.exit(1);
}

if (missing.length) {
  process.stderr.write(`${missing.length} package import closure error(s):\n`);
  for (const item of missing) {
    process.stderr.write(`  ${item.importer}: ${item.kind} ${item.specifier} -> missing ${item.target}\n`);
  }
  process.exit(1);
}

process.stdout.write(`package import closure passed: ${reachable.size} reachable modules across ${packed.entryCount} files\n`);
