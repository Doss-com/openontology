#!/usr/bin/env node
/** CLI for the read-only source-native Resolver. */
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openOntology } from '../src/openontology.mjs';
import { buildSourceNativeProduct, openSourceNativeProduct } from '../src/source-native-product.mjs';
import { runSourceNativeProductMcp } from '../src/source-native-product-mcp.mjs';
import { stableObjectText } from '../src/canonical-content.mjs';

const argv = process.argv.slice(2);
const command = argv[0];
const tokens = argv.slice(1);

function usage(code = 2): never {
  process.stderr.write(`usage: oont <command>

  resolver build <input.json> --out <artifact-dir> [--backend <file-gs-or-s3-uri>]
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
         [--at <UTC-millisecond-ISO>]
      Find candidate References for a source-bound current field or immediate
      next field revision. Search output is navigation only. --read returns
      the exact cited Evidence in the same process.

  verify <artifact-dir> <question> [--intent current|next]
          [--source-system <name> --object-type <name> --field <path>]
          [--external-id <id>] [--anchor-value <exact-value>]
          [--at <UTC-millisecond-ISO>]
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

function options(input: string[], allowedFlags: string[] = []): {
  values: Map<string, string>;
  flags: Set<string>;
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
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

function exactJson(pathInput: string): unknown {
  const path = resolve(pathInput);
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) {
    throw Object.assign(new TypeError('OONT_RESOLVER_INPUT'), { code: 'OONT_RESOLVER_INPUT' });
  }
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch {
    throw Object.assign(new TypeError('OONT_RESOLVER_INPUT'), { code: 'OONT_RESOLVER_INPUT' });
  }
}

function print(value: object): void {
  process.stdout.write(`${stableObjectText(value)}\n`);
}

const queryOptionNames = new Set(['--intent', '--source-system', '--object-type',
  '--external-id', '--field', '--anchor-value', '--at']);
const EXACT_UTC_MILLISECOND_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function queryInput(question: string, values: Map<string, string>): {
  question: string;
  intent: 'current' | 'next';
  at?: string;
  anchorValue: string | null;
  scope?: { sourceSystem: string; objectType: string; field: string; externalId?: string };
} {
  if (typeof question !== 'string' || !question.trim()
    || [...values.keys()].some((key) => !queryOptionNames.has(key))) usage();
  const typedNames = ['--source-system', '--object-type', '--field'];
  const typedCount = typedNames.filter((name) => values.has(name)).length;
  if (![0, typedNames.length].includes(typedCount)
    || values.has('--external-id') && typedCount !== typedNames.length) usage();
  const intentValue = values.get('--intent') ?? 'current';
  const intent: 'current' | 'next' = intentValue === 'next'
    ? 'next' : intentValue === 'current' ? 'current' : usage();
  const atValue = values.get('--at');
  const at = atValue === undefined ? undefined : exactUtcMillisecondIso(atValue) ? atValue : usage();
  const sourceSystem = values.get('--source-system');
  const objectType = values.get('--object-type');
  const field = values.get('--field');
  if (typedCount === typedNames.length
    && (sourceSystem === undefined || objectType === undefined || field === undefined)) usage();
  const anchorValue = values.get('--anchor-value') ?? null;
  if (at !== undefined && (intent === 'next' || anchorValue !== null && anchorValue.trim())) usage();
  const scope = sourceSystem !== undefined && objectType !== undefined && field !== undefined
    ? {
      sourceSystem,
      objectType,
      field,
      ...(values.has('--external-id') ? { externalId: values.get('--external-id') } : {}),
    }
    : undefined;
  return {
    question,
    intent,
    ...(at === undefined ? {} : { at }),
    anchorValue,
    ...(scope === undefined ? {} : { scope }),
  };
}

function exactUtcMillisecondIso(value: unknown): value is string {
  if (typeof value !== 'string' || !EXACT_UTC_MILLISECOND_ISO.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
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
      sourceCommitSha256: status.sourceCommitSha256,
      sourceReplaySha256: status.sourceReplaySha256,
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
      for (const match of search.matches) {
        const ref = typeof match.ref === 'string' ? match.ref : usage();
        evidence.push(await product.read({ ref }));
      }
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
} catch (error: unknown) {
  const failure = error instanceof Error ? error : new Error('OONT_RESOLVER_ERROR');
  const code = 'code' in failure && typeof failure.code === 'string' ? failure.code : failure.message;
  process.stderr.write(`error: ${code}\n`);
  process.exit(1);
}
