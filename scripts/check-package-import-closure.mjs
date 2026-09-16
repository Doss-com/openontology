#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = mkdtempSync(join(tmpdir(), 'oont-closure-'));
const fail = (message) => {
  process.stderr.write(`package import closure failed: ${message}\n`);
  process.exitCode = 1;
};

try {
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--ignore-scripts', '--pack-destination', sandbox, '--json',
  ], { cwd: root, encoding: 'utf8' }))[0];
  const tarball = join(sandbox, packed.filename);
  execFileSync('tar', ['-xzf', tarball, '-C', sandbox], { cwd: root });
  const packageRoot = join(sandbox, 'package');
  const paths = new Set(packed.files.map((file) => file.path));
  const modules = [...paths].filter((path) => /\.(?:js|mjs)$/u.test(path));
  const declarations = [...paths].filter((path) => path.endsWith('.d.ts'));
  const missing = [];
  const importsByModule = new Map([...modules, ...declarations].map((path) => [path, new Set()]));

  function packagePath(importer, specifier) {
    const absolute = resolve(packageRoot, dirname(importer), specifier);
    return normalize(absolute.slice(packageRoot.length + 1)).split(sep).join('/');
  }

  function requirePacked(importer, specifier, kind = 'import') {
    if (!specifier.startsWith('.') || specifier.endsWith('/') || !/\.(?:js|mjs)$/u.test(specifier)) return;
    const target = packagePath(importer, specifier);
    if (!paths.has(target)) missing.push({ importer, kind, specifier, target });
    else if (importsByModule.has(target)) importsByModule.get(importer).add(target);
  }

  for (const importer of modules) {
    const source = readFileSync(join(packageRoot, importer), 'utf8');
    const patterns = [
      { kind: 'import', re: /(?:from\s+|import\s*\()(['"])(\.{1,2}\/[^'"]+)\1/gu },
      { kind: 'side-effect import', re: /import\s+(['"])(\.{1,2}\/[^'"]+)\1/gu },
      { kind: 'import.meta.url resource', re: /new URL\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*,\s*import\.meta\.url/gu },
    ];
    for (const { kind, re } of patterns) {
      for (const match of source.matchAll(re)) requirePacked(importer, match[2], kind);
    }

    if (importer === 'dist/cli/oont.js') {
      for (const match of source.matchAll(/join\(distRoot,\s*(['"])cli\1,\s*(['"])([^'"]+\.js)\2\)/gu)) {
        const target = `dist/cli/${match[3]}`;
        if (!paths.has(target)) missing.push({
          importer, kind: 'CLI delegate', specifier: match[3], target,
        });
        else importsByModule.get(importer).add(target);
      }
    }
  }

  for (const importer of declarations) {
    const source = readFileSync(join(packageRoot, importer), 'utf8');
    const patterns = [
      { kind: 'declaration import', re: /(?:from\s+|import\s*\()(['"])(\.{1,2}\/[^'"]+)\1/gu },
      { kind: 'declaration import.meta.url resource', re: /new URL\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*,\s*import\.meta\.url/gu },
    ];
    for (const { kind, re } of patterns) {
      for (const match of source.matchAll(re)) requirePacked(importer, match[2], kind);
    }
  }

  const emittedRuntime = [...paths].filter((path) => /^dist\/.*\.js$/u.test(path));
  for (const runtime of emittedRuntime) {
    for (const generated of [
      `${runtime}.map`,
      runtime.replace(/\.js$/u, '.d.ts'),
      runtime.replace(/\.js$/u, '.d.ts.map'),
    ]) {
      if (!paths.has(generated)) missing.push({
        importer: runtime, kind: 'generated output', specifier: generated, target: generated,
      });
    }
  }

  const runtimeRoots = [
    'dist/cli/oont.js',
    'dist/cli/resolver.js',
    'dist/kernel.js',
    'dist/openontology.js',
    'examples/quickstart/source-lifecycle.mjs',
    'examples/quickstart/semantic-map.mjs',
  ];
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
    missing.push({
      importer: 'package.json', kind: 'unreachable modules',
      specifier: String(unreachable.length), target: unreachable.join(', '),
    });
  }
  if (missing.length) {
    fail(missing.map((item) =>
      `  ${item.importer}: ${item.kind} ${item.specifier} -> ${item.target}`).join('\n'));
  } else {
    process.stdout.write(`package import closure passed: ${reachable.size} reachable runtime/example modules across ${packed.entryCount} files\n`);
  }
} catch (error) {
  fail(error?.message ?? String(error));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
