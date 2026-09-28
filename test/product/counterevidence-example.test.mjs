import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const example = resolve(repositoryRoot, 'examples/quickstart/counterevidence.mjs');

function run(outputRoot) {
  return spawnSync(process.execPath, [example, outputRoot], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function snapshot(directory) {
  const rows = [];
  const visit = (current, relative = '') => {
    for (const name of readdirSync(current).sort()) {
      const child = join(current, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      if (statSync(child).isDirectory()) visit(child, childRelative);
      else
        rows.push([childRelative, createHash('sha256').update(readFileSync(child)).digest('hex')]);
    }
  };
  visit(directory);
  return JSON.stringify(rows);
}

test('packaged counterevidence example returns raw qualified and contradicted proof', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-counterevidence-example-'));
  const outputRoot = join(root, 'walkthrough');
  try {
    const first = run(outputRoot);
    assert.equal(first.status, 0, first.stderr);
    const summary = JSON.parse(first.stdout);
    assert.equal(summary.kind, 'OpenOntologyCounterevidenceWalkthroughV1');
    assert.deepEqual(
      summary.cases.map((item) => [item.relationType, item.proofDisposition]),
      [
        ['qualifies', 'qualified'],
        ['contradicts', 'contradicted'],
      ],
    );
    for (const item of summary.cases) {
      assert.equal(item.rawResponse.kind, 'OpenOntologySourceNativeVerificationV1');
      assert.equal(item.rawResponse.state, 'resolved-current-field');
      assert.equal(item.rawResponse.answerable, true);
      assert.deepEqual(
        item.rawResponse.context.map((row) => [row.role, row.exactText]),
        [
          ['answer', 'open'],
          ['counterevidence', 'closed'],
        ],
      );
      assert.equal(item.rawResponse.verification.semanticProof.proofClosed, true);
      assert.equal(item.rawResponse.verification.semanticProof.relationCount, 1);
    }

    const beforeRerun = snapshot(outputRoot);
    const rerun = run(outputRoot);
    assert.notEqual(rerun.status, 0);
    assert.match(rerun.stderr, /COUNTEREVIDENCE_OUTPUT_EXISTS/u);
    assert.equal(beforeRerun, snapshot(outputRoot));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
