#!/usr/bin/env node
/** CLI for the read-only source-native Resolver. */
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openOntology } from '../src/openontology.mjs';
import { buildSourceNativeProduct, openSourceNativeProduct } from '../src/source-native-product.mjs';
import { runSourceNativeProductMcp } from '../src/source-native-product-mcp.mjs';
import { stableObjectText } from '../src/canonical-content.mjs';

const [command, ...tokens] = process.argv.slice(2);

function usage(code = 2) {
  process.stderr.write(`usage: oont resolver <command>

  build <input.json> --out <artifact-dir> [--backend <file-gs-or-s3-uri>]
      Compile exact sources and Adapter-declared native objects into an
      immutable, object-storage-native Ont.

  status <artifact-dir>
      Print the current map, source commit, and revision counts.

  check <artifact-dir>
      Reopen and validate the descriptor, canonical object commit, source cut,
      replay identity, and compiled map without writing learning state.

  search <artifact-dir> <question> [--intent current|next] [--read]
         [--source-system <name> --object-type <name> --field <path>]
         [--external-id <id>] [--anchor-value <exact-value>]
      Find candidate References for a source-bound current field or immediate
      next field revision. Search output is navigation only. --read returns
      the exact cited Evidence in the same process.

  verify <artifact-dir> <question> [--intent current|next]
          [--source-system <name> --object-type <name> --field <path>]
          [--external-id <id>] [--anchor-value <exact-value>]
      Close the proof in one call by reading every required Reference. Returns
      a Verification or typed refusal, never a generated prose answer.

  serve <artifact-dir> --mcp [--advanced]
      Start the one-tool verify MCP server over stdio. --advanced exposes only
      search and read for callers that need explicit context-depth control.

  Query commands are read-only. Learning runs outside the request process.
`);
  process.exit(code);
}

if (['--help', '-h'].includes(tokens[0])
  && ['build', 'status', 'check', 'search', 'verify', 'serve'].includes(command)) {
  usage(0);
}

function options(input, allowedFlags = []) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < input.length;) {
    const name = input[index];
    if (allowedFlags.includes(name)) {
      if (flags.has(name)) throw Object.assign(new TypeError('OONT_RESOLVER_USAGE'), { code: 'OONT_RESOLVER_USAGE' });
      flags.add(name);
      index += 1;
      continue;
    }
    const value = input[index + 1];
    if (!name?.startsWith('--') || typeof value !== 'string' || value.startsWith('--') || values.has(name)) {
      throw Object.assign(new TypeError('OONT_RESOLVER_USAGE'), { code: 'OONT_RESOLVER_USAGE' });
    }
    values.set(name, value);
    index += 2;
  }
  return { values, flags };
}

function exactJson(pathInput) {
  const path = resolve(pathInput);
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) {
    throw Object.assign(new TypeError('OONT_RESOLVER_INPUT'), { code: 'OONT_RESOLVER_INPUT' });
  }
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch {
    throw Object.assign(new TypeError('OONT_RESOLVER_INPUT'), { code: 'OONT_RESOLVER_INPUT' });
  }
}

function print(value) {
  process.stdout.write(`${stableObjectText(value)}\n`);
}

const queryOptionNames = new Set(['--intent', '--source-system', '--object-type',
  '--external-id', '--field', '--anchor-value']);

function queryInput(question, values) {
  if (typeof question !== 'string' || !question.trim()
    || [...values.keys()].some((key) => !queryOptionNames.has(key))) usage();
  const typedNames = ['--source-system', '--object-type', '--field'];
  const typedCount = typedNames.filter((name) => values.has(name)).length;
  if (![0, typedNames.length].includes(typedCount)
    || values.has('--external-id') && typedCount !== typedNames.length) usage();
  const scope = typedCount === 0 ? undefined : {
    sourceSystem: values.get('--source-system'),
    objectType: values.get('--object-type'),
    field: values.get('--field'),
    ...(values.has('--external-id') ? { externalId: values.get('--external-id') } : {}),
  };
  return {
    question,
    intent: values.get('--intent') ?? 'current',
    anchorValue: values.get('--anchor-value') ?? null,
    ...(scope === undefined ? {} : { scope }),
  };
}

try {
  if (command === 'build') {
    const [inputPath, ...rest] = tokens;
    if (!inputPath || inputPath.startsWith('--')) usage();
    const { values, flags } = options(rest);
    const allowed = new Set(['--out', '--backend']);
    if (flags.size !== 0 || !values.has('--out')
      || [...values.keys()].some((key) => !allowed.has(key))) usage();
    print(buildSourceNativeProduct({
      artifactRoot: values.get('--out'),
      input: exactJson(inputPath),
      objectBackendUri: values.get('--backend') ?? null,
    }));
  } else if (command === 'status') {
    const [artifactRoot, ...rest] = tokens;
    if (!artifactRoot || artifactRoot.startsWith('--')) usage();
    const { values, flags } = options(rest);
    if (flags.size !== 0 || values.size !== 0) usage();
    print(openOntology({ artifactRoot }).status());
  } else if (command === 'check') {
    const [artifactRoot, ...rest] = tokens;
    if (!artifactRoot || artifactRoot.startsWith('--') || rest.length !== 0) usage();
    const status = openOntology({ artifactRoot }).status();
    print({
      schemaVersion: 1,
      kind: 'OpenOntologyCheckV1',
      ok: true,
      ontId: status.ontId,
      artifactSha256: status.artifactSha256,
      sourceCommitSha256: status.sourceCommitSha256 ?? status.commitSha256,
      sourceReplaySha256: status.sourceReplaySha256 ?? status.replaySha256,
    });
  } else if (command === 'verify' || command === 'search') {
    const [artifactRoot, question, ...rest] = tokens;
    if (!artifactRoot || artifactRoot.startsWith('--') || !question || question.startsWith('--')) usage();
    const { values, flags } = options(rest, ['--read']);
    if (command === 'verify' && flags.has('--read')) usage();
    const input = queryInput(question, values);
    const product = openOntology({ artifactRoot });
    if (command === 'verify') {
      print(await product.verify(input));
      process.exit(0);
    }
    const search = await product.search(input);
    const evidence = [];
    if (flags.has('--read')) {
      for (const match of search.matches) evidence.push(await product.read({ ref: match.ref }));
    }
    print({ ...search, ...(flags.has('--read') ? { evidence } : {}) });
  } else if (command === 'serve') {
    const [artifactRoot, ...rest] = tokens;
    if (!artifactRoot || artifactRoot.startsWith('--')) usage();
    const { values, flags } = options(rest, ['--mcp', '--advanced']);
    if (values.size !== 0 || !flags.has('--mcp')) usage();
    const product = openSourceNativeProduct({
      artifactRoot,
    });
    process.stderr.write(`${stableObjectText(product.status())}\n`);
    runSourceNativeProductMcp(product, {
      profile: flags.has('--advanced') ? 'advanced' : 'verify',
    });
  } else if (command === '--help' || command === '-h') {
    usage(0);
  } else {
    usage();
  }
} catch (error) {
  process.stderr.write(`error: ${error?.code ?? error?.message ?? 'OONT_RESOLVER_ERROR'}\n`);
  process.exit(1);
}
