#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { encodeEntry, entry } from '../dist/storage/assertion-envelope.js';
import { openGcsObjectBackend } from '../dist/storage/gcs-backend.js';
import { openObjectOntStore } from '../dist/storage/ont-store.js';

const backend = openGcsObjectBackend({
  bucket: process.env.OONT_GCS_BUCKET,
  accessToken: process.env.OONT_GCS_ACCESS_TOKEN,
  endpoint: process.env.OONT_GCS_ENDPOINT ?? 'https://storage.googleapis.com',
});
backend.ensureBucket();

const qualificationRoot = process.env.OONT_GCS_QUALIFICATION_PREFIX ?? 'qualification/gcs-v1';
const runId = process.env.OONT_GCS_QUALIFICATION_RUN_ID ?? randomUUID();
if (
  !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u.test(qualificationRoot) ||
  qualificationRoot.includes('//') ||
  qualificationRoot.endsWith('/') ||
  qualificationRoot.split('/').some((part) => ['.', '..'].includes(part)) ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)
) {
  throw new TypeError('OONT_GCS_QUALIFICATION_PREFIX');
}
const prefix = `${qualificationRoot}/${runId}`;

function worker(operation) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(import.meta.dirname, 'run-gcs-object-operation.mjs')],
      {
        env: {
          ...process.env,
          OONT_GCS_OPERATION_BASE64: Buffer.from(JSON.stringify(operation)).toString('base64'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`worker exit ${code}: ${stderr}`));
      try {
        return resolvePromise(JSON.parse(stdout));
      } catch {
        return reject(new Error(`worker output: ${stdout} ${stderr}`));
      }
    });
  });
}

async function casRace(writerCount) {
  const key = `${prefix}/cas-race-${writerCount}`;
  const initial = backend.compareAndSwap(key, {
    expectedVersion: null,
    bytes: Buffer.from('initial'),
  });
  const results = await Promise.all(
    Array.from({ length: writerCount }, (_unused, index) =>
      worker({
        mode: 'cas',
        workerId: `cas-${writerCount}-${index}`,
        key,
        expectedVersion: initial.version,
        bytesBase64: Buffer.from(`winner-${index}`).toString('base64'),
      }),
    ),
  );
  const passed = results.filter((row) => row.status === 'PASS');
  const rejected = results.filter((row) => row.code === 'OBJECT_BACKEND_PRECONDITION');
  assert.equal(passed.length, 1);
  assert.equal(rejected.length, writerCount - 1);
  assert.equal(
    backend.get(key).bytes.toString(),
    passed[0].workerId.replace(`cas-${writerCount}-`, 'winner-'),
  );
  return { writerCount, winner: passed[0].workerId, rejected: rejected.length };
}

const immutableBytes = Buffer.from('zero\none\ntwo\n');
const immutableKey = `${prefix}/immutable`;
const immutable = backend.putIfAbsent(immutableKey, immutableBytes);
const immutableReplay = backend.putIfAbsent(immutableKey, immutableBytes);
assert.equal(immutable.created, true);
assert.equal(immutableReplay.replayed, true);
assert.equal(immutableReplay.version, immutable.version);
assert.throws(() => backend.putIfAbsent(immutableKey, Buffer.from('different')), {
  code: 'OBJECT_BACKEND_PRECONDITION',
});
assert.deepEqual(backend.get(immutableKey).bytes, immutableBytes);
assert.equal(backend.get(immutableKey, { start: 5, end: 8 }).bytes.toString(), 'one');

const refKey = `${prefix}/ref`;
const refOne = backend.compareAndSwap(refKey, { expectedVersion: null, bytes: Buffer.from('one') });
const refTwo = backend.compareAndSwap(refKey, {
  expectedVersion: refOne.version,
  bytes: Buffer.from('two'),
});
const refThree = backend.compareAndSwap(refKey, {
  expectedVersion: refTwo.version,
  bytes: Buffer.from('one'),
});
assert.notEqual(refThree.version, refOne.version);
assert.throws(
  () =>
    backend.compareAndSwap(refKey, {
      expectedVersion: refOne.version,
      bytes: Buffer.from('stale'),
    }),
  { code: 'OBJECT_BACKEND_PRECONDITION' },
);

const store = openObjectOntStore({ backend });
const ontId = `gcs-qualification-${runId}`;
const manifest = store.putBlob({
  logicalPath: 'oont.json',
  bytes: Buffer.from(`{"v":"oont.ont/v1","org":${JSON.stringify(ontId)},"layout":"log/v1"}\n`),
  mediaType: 'application/json',
});
const rootEntry = entry({
  kind: 'element',
  about: ontId,
  body: { value: 'root' },
  provenance: 'authored',
  producer: 'gcs-qualification',
  recordedAt: '2026-09-03T00:00:00.000Z',
});
const rootSegment = store.putAssertionSegment({
  logicalPath: 'ledger/root.jsonl',
  jsonlBytes: Buffer.from(`${encodeEntry(rootEntry)}\n`),
});
const rootCommit = store.writeCommit({ ontId, ontManifest: manifest, segments: [rootSegment] });
const rootRef = store.compareAndSwapRef({
  ontId,
  branch: 'main',
  expectedVersion: null,
  commitSha256: rootCommit.commitSha256,
});
assert.equal(store.replay(rootCommit.commitSha256).entries[0].id, rootEntry.id);

const orphanEntry = entry({
  kind: 'element',
  about: `${ontId}:orphan`,
  body: { value: 'durable-before-ref' },
  provenance: 'authored',
  producer: 'gcs-qualification',
  recordedAt: '2026-09-03T00:00:01.000Z',
});
const orphanSegment = store.putAssertionSegment({
  logicalPath: 'ledger/orphan.jsonl',
  jsonlBytes: Buffer.from(`${encodeEntry(orphanEntry)}\n`),
});
const durableCommit = store.writeCommit({
  ontId,
  parents: [rootCommit.commitSha256],
  ontManifest: manifest,
  segments: [orphanSegment],
});
assert.equal(store.readRef({ ontId, branch: 'crash-boundary' }), null);
const recoveredRef = store.compareAndSwapRef({
  ontId,
  branch: 'crash-boundary',
  expectedVersion: null,
  commitSha256: durableCommit.commitSha256,
});
assert.equal(store.readRef({ ontId, branch: 'crash-boundary' }).version, recoveredRef.version);

const races = [];
for (const writerCount of [4, 16, 64]) races.push(await casRace(writerCount));
const union = await Promise.all(
  Array.from({ length: 64 }, (_unused, index) =>
    worker({
      mode: 'put',
      workerId: `put-64-${index}`,
      key: `${prefix}/union/${String(index).padStart(2, '0')}`,
      bytesBase64: Buffer.from(`value-${index}`).toString('base64'),
    }),
  ),
);
assert.equal(union.filter((row) => row.status === 'PASS').length, 64);

process.stdout.write(
  `${JSON.stringify({
    status: 'PASS',
    cases: 22,
    backendCapabilitiesSha256: backend.capabilities.capabilitiesSha256,
    bucket: backend.capabilities.bucket,
    qualificationPrefix: prefix,
    immutableReplay: true,
    exactRangeRead: true,
    abaSafeVersions: [refOne.version, refTwo.version, refThree.version],
    commitSha256: rootCommit.commitSha256,
    replaySha256: rootRef.ref.replaySha256,
    crashBeforeRefLeavesBranchAbsent: true,
    durableCommitRecoveredByCas: true,
    writerRaces: races,
    uniqueWriterUnion: union.length,
  })}\n`,
);
