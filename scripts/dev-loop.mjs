#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argumentsList = process.argv.slice(2);
const watchMode = argumentsList.includes('--watch');
const testArguments = argumentsList.filter((argument) => argument !== '--watch' && argument !== '--');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const watchedRoots = ['src', 'test'].map((path) => join(root, path));
let child = null;
let rerun = false;
let timer = null;
let stopping = false;

const run = (command, args) => spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  }).status ?? 1;

const runOnce = () => {
  if (!testArguments.length) return run(npmCommand, ['run', 'check']);
  const buildStatus = run(npmCommand, ['run', 'build']);
  return buildStatus === 0 ? run(process.execPath, ['--test', ...testArguments]) : buildStatus;
};

if (!watchMode) process.exit(runOnce());

const directories = [];
const collectDirectories = (directory) => {
  directories.push(directory);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) collectDirectories(join(directory, entry.name));
  }
};
const finishCheck = (code, signal) => {
  child = null;
  process.stdout.write(`\nBuild and tests ${code === 0 ? 'passed' : `failed (${signal ?? code})`}.\n`);
  if (stopping) process.exit(0);
  if (rerun) startCheck();
};

const startCheck = () => {
  if (child || stopping) {
    rerun = true;
    return;
  }
  rerun = false;
  process.stdout.write('\nRunning build and tests...\n');
  const command = npmCommand;
  const args = ['run', testArguments.length ? 'build' : 'check'];
  child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', (error) => process.stderr.write(`dev loop could not start: ${error.message}\n`));
  child.once('close', (code, signal) => {
    if (testArguments.length && code === 0 && !stopping) {
      child = spawn(process.execPath, ['--test', ...testArguments], {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
      });
      child.once('error', (error) => process.stderr.write(`dev loop could not start tests: ${error.message}\n`));
      child.once('close', finishCheck);
      return;
    }
    finishCheck(code, signal);
  });
};

const scheduleCheck = () => {
  rerun = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    startCheck();
  }, 150);
};

const watchers = [];
for (const directory of watchedRoots) {
  if (!existsSync(directory)) continue;
  try {
    watchers.push(watch(directory, { recursive: true }, scheduleCheck));
  } catch {
    collectDirectories(directory);
  }
}
for (const directory of directories) watchers.push(watch(directory, scheduleCheck));
const close = (signal) => {
  if (stopping) return;
  stopping = true;
  for (const watcher of watchers) watcher.close();
  clearTimeout(timer);
  if (child) child.kill(signal);
  else process.exit(0);
};
process.once('SIGINT', () => close('SIGINT'));
process.once('SIGTERM', () => close('SIGTERM'));
process.stdout.write('Watching src/ and test/. Press Ctrl-C to stop.\n');
startCheck();
