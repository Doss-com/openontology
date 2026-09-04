#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);

function usage(code = 2) {
  process.stderr.write(`usage: oont <command>

  verify <ont> <question>       return verified context or a typed refusal
  search <ont> <question>       return candidate References
  status <ont>                  report recorded Ont state
  check <ont>                   validate the Ont and its pinned source cut
  serve <ont> --mcp             expose verify over MCP

  resolver build <input.json> --out <ont>
                                compile deterministic Adapter input

Search accepts --read to return exact Evidence in the same process.
Serve accepts --advanced to expose search and read instead of verify.
`);
  process.exit(code);
}

function runResolver(resolverArgs) {
  const child = spawn(process.execPath, [
    join(root, 'scripts', 'oont-resolver.mjs'),
    ...resolverArgs,
  ], { stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}

function commandHelp(name) {
  const lines = {
    verify: 'usage: oont verify <ont> <question> [--intent current|next]\n       [--source-system <name> --object-type <name> --field <path>]\n       [--external-id <id>] [--anchor-value <exact-value>]',
    search: 'usage: oont search <ont> <question> [--read] [--intent current|next]\n       [--source-system <name> --object-type <name> --field <path>]\n       [--external-id <id>] [--anchor-value <exact-value>]',
    status: 'usage: oont status <ont>',
    check: 'usage: oont check <ont>',
    serve: 'usage: oont serve <ont> --mcp [--advanced]',
  };
  process.stderr.write(`${lines[name]}\n\nRun oont --help for the complete surface.\n`);
  process.exit(0);
}

if (command === undefined) usage();
if (command === '--help' || command === '-h') usage(0);

const productCommands = new Set(['verify', 'search', 'status', 'check', 'serve']);
if (productCommands.has(command)) {
  if (args.some((token) => token === '--help' || token === '-h')) commandHelp(command);
  runResolver([command, ...args]);
} else if (command === 'resolver') {
  runResolver(args);
} else {
  process.stderr.write(`error: unknown command '${command}'.\n`);
  usage();
}
