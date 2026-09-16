#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputFlag = process.argv[2];
const outputArgument = process.argv[3];
if (outputFlag !== '--output' || !outputArgument) {
  throw new Error('Usage: node scripts/update-source-manifest.mjs --output <release-output-path>');
}
const outputPath = resolve(root, outputArgument);
const relativeOutput = relative(root, outputPath);
const normalizedOutput = relativeOutput.split(sep).join('/');
if (!/^(?:release|\.release)\/SOURCE-MANIFEST\.json$/u.test(normalizedOutput)) {
  throw new Error(`Source inventory output must be release/SOURCE-MANIFEST.json: ${outputPath}`);
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const paths = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
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

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`generated ${normalizedOutput} for ${files.length} tracked files\n`);
