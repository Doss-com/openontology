import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { openOntology } from '../../dist/openontology.js';
import {
  buildSourceNativeProduct,
  compileSourceNativeSemanticConstruction,
  objectBytesSha256,
  openProductState,
  rebindSourceNativeSemanticConstruction,
  stableObjectSha256,
  stableObjectText,
  validateSourceNativeSemanticConstruction,
} from '../../dist/kernel.js';

const GUIDE =
  'AllocationException means inventory was allocated inconsistently. ' +
  'In clickup, allocation mismatch names this concept. UTF-8: café.';
const clone = structuredClone;
const digest = objectBytesSha256(Buffer.from('unrelated'));

function fixture(t, { namespace = 'example', guide = GUIDE, splitGuide = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oont-semantic-construction-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { artifactRoot: join(root, 'ont') };
  const sources = [
    { relativePath: 'docs/guide.txt', sourceType: 'docs', content: guide },
    {
      relativePath: 'clickup/CT-17.txt',
      sourceType: 'clickup',
      content: 'ClickupTask CT-17: allocation mismatch. Status: open.',
    },
    {
      relativePath: 'docs/note.txt',
      sourceType: 'docs',
      content: 'The allocation mismatch label was discussed.',
    },
  ].map((source) => ({ ...source, occurredAt: '2026-09-01T00:00:00.000Z' }));
  const nativeObjectInputs = sources.map((source, index) => ({
    relativePath: source.relativePath,
    objectIdentity: {
      home: 'ObjectDef/InstanceRef',
      sourceSystem: source.sourceType,
      objectType: index === 1 ? 'ClickupTask' : 'Document',
      namespace,
      externalId: index === 1 ? 'CT-17' : `doc-${index}`,
    },
    fields: [
      { fieldPath: 'body', value: source.content, codeUnitStart: 0 },
      ...(index === 1 ? [{ fieldPath: 'status', value: 'open' }] : []),
    ],
  }));
  if (splitGuide)
    nativeObjectInputs.push({
      relativePath: 'docs/guide.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'docs',
        objectType: 'Document',
        namespace,
        externalId: 'doc-tail',
      },
      fields: [{ fieldPath: 'body', value: 'UTF-8: café.' }],
    });
  const buildInput = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'construction-example',
    namespace,
    querySchemas: [
      {
        sourceSystem: 'docs',
        objectType: 'Document',
        aliases: ['document'],
        fields: [{ fieldPath: 'body', aliases: ['body'] }],
      },
      {
        sourceSystem: 'clickup',
        objectType: 'ClickupTask',
        aliases: ['ClickupTask'],
        fields: [
          { fieldPath: 'body', aliases: ['body'] },
          { fieldPath: 'status', aliases: ['status'] },
        ],
      },
    ],
    sources,
    nativeObjectInputs,
  };
  buildSourceNativeProduct({ ...options, input: buildInput });
  const state = openProductState(options);
  function witness(path, quote) {
    const object = state.objectOnt.map.nativeObjects.find((item) => item.relativePath === path);
    const source = sources.find((item) => item.relativePath === path);
    const value = quote ?? source.content;
    const start = source.content.indexOf(value);
    assert(start >= 0);
    const byteStart = Buffer.byteLength(source.content.slice(0, start));
    return {
      nativeObjectSha256: object.nativeObjectSha256,
      evidence: {
        sourceRef: path,
        sourceSha256: object.sourceSha256,
        byteStart,
        byteEnd: byteStart + Buffer.byteLength(value),
        textSha256: objectBytesSha256(Buffer.from(value)),
      },
    };
  }
  const input = {
    proposedBy: 'fixture-constructor',
    proposedAt: '2026-09-02T00:00:00.000Z',
    method: 'authored',
    objectDefs: [
      {
        kind: 'ObjectDef',
        id: 'allocation-exception',
        name: 'AllocationException',
        source: witness('docs/guide.txt'),
        aliases: [
          {
            value: 'allocation mismatch',
            sourceSystem: 'clickup',
            source: witness('docs/guide.txt'),
          },
        ],
      },
    ],
    claims: [
      {
        kind: 'Claim',
        id: 'definition',
        about: 'allocation-exception',
        predicate: 'defines',
        source: witness('docs/guide.txt'),
      },
      {
        kind: 'Claim',
        id: 'task-mention',
        about: 'allocation-exception',
        predicate: 'mentions',
        source: witness('clickup/CT-17.txt'),
      },
    ],
    coverage: state.objectOnt.sources.map((source) => ({
      sourceRef: source.relativePath,
      sourceSha256: source.sourceSha256,
      disposition: 'examined',
    })),
  };
  return {
    root,
    options,
    state,
    input,
    witness,
    buildInput,
    compile: (value = input) => compileSourceNativeSemanticConstruction({ options, input: value }),
  };
}

function rehash(record) {
  const { constructionSha256: _hash, ...core } = record;
  record.constructionSha256 = stableObjectSha256(core);
  return record;
}

test('compiles scoped ObjectDefs and source attachments without granting semantic authority', (t) => {
  const f = fixture(t);
  const before = stableObjectText(f.state.objectOnt.map);
  const record = f.compile();
  assert.equal(record.kind, 'OpenOntologySourceNativeSemanticConstructionV1');
  assert.equal(record.sourceBinding.namespace, 'example');
  assert.equal(record.sourceBinding.sourceCommitSha256, f.state.objectOnt.commitSha256);
  assert.deepEqual(
    record.claims.map((claim) => claim.predicate),
    ['defines', 'mentions'],
  );
  assert.equal(record.objectDefs[0].kind, 'ObjectDef');
  assert.equal(record.objectDefs[0].aliases[0].sourceSystem, 'clickup');
  assert.equal(record.coverage.sourceCount, 3);
  assert.equal(record.coverage.examinedSourceCount, 3);
  assert.equal(record.navigationOnly, true);
  assert.equal(record.reviewRequired, true);
  for (const field of [
    'answerable',
    'proofClosed',
    'proofDisposition',
    'queryBinding',
    'proofAuthorityProjection',
    'proofSufficiencyContract',
  ])
    assert.equal(field in record, false);
  assert.equal(stableObjectText(openProductState(f.options).objectOnt.map), before);
  assert.equal(Object.isFrozen(record.objectDefs[0].aliases[0].source.evidence), true);
  assert.throws(() => {
    record.claims[0].predicate = 'qualifies';
  }, TypeError);
  f.input.objectDefs[0].name = 'mutated caller input';
  assert.equal(record.objectDefs[0].name, 'AllocationException');
});

test('canonical ordering and cold structural/source validation preserve the proposal identity', (t) => {
  const f = fixture(t);
  f.input.objectDefs.push({ ...clone(f.input.objectDefs[0]), id: 'another-concept' });
  const record = f.compile();
  const reordered = clone(f.input);
  reordered.objectDefs.reverse();
  reordered.claims.reverse();
  reordered.coverage.reverse();
  assert.deepEqual(f.compile(reordered), record);
  const cold = JSON.parse(stableObjectText(record));
  assert.deepEqual(validateSourceNativeSemanticConstruction(cold), record);
  assert.deepEqual(
    rebindSourceNativeSemanticConstruction({ options: f.options, construction: cold }),
    record,
  );
  // Equal names and aliases do not merge distinct ObjectDefs.
  assert.equal(record.objectDefs.length, 2);
});

test('a proposal round-trips as an immutable blob without advancing source or knowledge refs', (t) => {
  const f = fixture(t);
  const record = f.compile();
  const refBefore = f.state.store.readRefMetadata({
    ontId: 'construction-example',
    branch: 'main',
  });
  const blob = f.state.store.putBlob({
    logicalPath: 'blobs/proposals/construction.json',
    bytes: Buffer.from(stableObjectText(record)),
    mediaType: 'application/json',
  });
  const cold = openProductState(f.options);
  assert.deepEqual(
    validateSourceNativeSemanticConstruction(
      JSON.parse(cold.store.readBlob(blob).bytes.toString('utf8')),
    ),
    record,
  );
  assert.deepEqual(
    cold.store.readRefMetadata({ ontId: 'construction-example', branch: 'main' }),
    refBefore,
  );
  assert.equal(cold.objectOnt.commitSha256, f.state.objectOnt.commitSha256);
});

test('unexamined, unsupported and failed source dispositions stay distinct', (t) => {
  const f = fixture(t);
  const input = clone(f.input);
  input.objectDefs = [];
  input.claims = [];
  input.coverage = [
    { ...input.coverage[0], disposition: 'unsupported' },
    { ...input.coverage[1], disposition: 'failed' },
  ];
  const record = f.compile(input);
  assert.deepEqual(
    [
      record.coverage.examinedSourceCount,
      record.coverage.unsupportedSourceCount,
      record.coverage.failedSourceCount,
      record.coverage.unexaminedSourceCount,
    ],
    [0, 1, 1, 1],
  );
  assert.equal(record.reviewRequired, true);
  assert.equal('complete' in record.coverage, false);
});

const inputFailures = [
  [
    'invented question',
    (x) => {
      x.question = 'What should the answer be?';
    },
    'SHAPE',
  ],
  [
    'caller source binding',
    (x) => {
      x.sourceBinding = {};
    },
    'SHAPE',
  ],
  [
    'new Concept kind',
    (x) => {
      x.objectDefs[0].kind = 'Concept';
    },
    'KIND',
  ],
  [
    'new attachment kind',
    (x) => {
      x.claims[0].kind = 'LinkDef';
    },
    'KIND',
  ],
  [
    'proof predicate',
    (x) => {
      x.claims[0].predicate = 'qualifies';
    },
    'PREDICATE',
  ],
  [
    'missing endpoint',
    (x) => {
      x.claims[0].about = 'absent';
    },
    'ENDPOINT',
  ],
  [
    'duplicate element ID',
    (x) => {
      x.objectDefs.push(clone(x.objectDefs[0]));
    },
    'DUPLICATE',
  ],
  [
    'duplicate claim ID',
    (x) => {
      x.claims.push(clone(x.claims[0]));
    },
    'DUPLICATE',
  ],
  [
    'claim/type ID collision',
    (x) => {
      x.claims[0].id = x.objectDefs[0].id;
    },
    'DUPLICATE',
  ],
  [
    'duplicate alias',
    (x) => {
      x.objectDefs[0].aliases.push(clone(x.objectDefs[0].aliases[0]));
    },
    'DUPLICATE',
  ],
  [
    'duplicate source disposition',
    (x) => {
      x.coverage.push(clone(x.coverage[0]));
    },
    'DUPLICATE',
  ],
  [
    'unexamined evidence',
    (x) => {
      x.coverage = [];
    },
    'COVERAGE',
  ],
  [
    'failed evidence',
    (x) => {
      x.coverage.forEach((r) => {
        r.disposition = 'failed';
      });
    },
    'COVERAGE',
  ],
  [
    'false source disposition',
    (x) => {
      x.coverage[0].sourceSha256 = digest;
    },
    'COVERAGE',
  ],
  [
    'unknown disposition',
    (x) => {
      x.coverage[0].disposition = 'complete';
    },
    'COVERAGE',
  ],
  [
    'unsupported alias',
    (x) => {
      x.objectDefs[0].aliases[0].value = 'invented synonym';
    },
    'NAME',
  ],
  [
    'unknown alias system',
    (x) => {
      x.objectDefs[0].aliases[0].sourceSystem = 'unmapped';
    },
    'SCOPE',
  ],
  [
    'wrong alias system',
    (x) => {
      x.objectDefs[0].aliases[0].sourceSystem = 'docs';
    },
    'ATTACHMENT',
  ],
  [
    'unsupported preferred name',
    (x) => {
      x.objectDefs[0].name = 'DifferentConcept';
    },
    'NAME',
  ],
  [
    'unknown native object',
    (x) => {
      x.claims[0].source.nativeObjectSha256 = digest;
    },
    'SOURCE',
  ],
  [
    'different native object',
    (x) => {
      x.claims[0].source.nativeObjectSha256 = x.claims[1].source.nativeObjectSha256;
    },
    'SOURCE',
  ],
  [
    'wrong source path',
    (x) => {
      x.claims[0].source.evidence.sourceRef = 'unknown.txt';
    },
    'SOURCE',
  ],
  [
    'wrong source hash',
    (x) => {
      x.claims[0].source.evidence.sourceSha256 = digest;
    },
    'SOURCE',
  ],
  [
    'wrong text hash',
    (x) => {
      x.claims[0].source.evidence.textSha256 = digest;
    },
    'EVIDENCE',
  ],
  [
    'negative offset',
    (x) => {
      x.claims[0].source.evidence.byteStart = -1;
    },
    'COUNT',
  ],
  [
    'empty span',
    (x) => {
      x.claims[0].source.evidence.byteEnd = 0;
    },
    'SPAN',
  ],
  [
    'oversized span',
    (x) => {
      x.claims[0].source.evidence.byteEnd = 65537;
    },
    'SPAN',
  ],
  [
    'out-of-source span',
    (x) => {
      x.claims[0].source.evidence.byteEnd = 1000;
    },
    'SOURCE',
  ],
  [
    'noncanonical timestamp',
    (x) => {
      x.proposedAt = '2026-09-02';
    },
    'TIME',
  ],
  [
    'unknown method',
    (x) => {
      x.method = 'inferred-by-magic';
    },
    'METHOD',
  ],
  [
    'lone surrogate label',
    (x) => {
      x.objectDefs[0].name = '\ud800';
    },
    'TEXT',
  ],
  [
    'sparse definitions',
    (x) => {
      x.objectDefs = Array(1);
    },
    'SHAPE',
  ],
];

test('compiler rejects malformed or unsupported inputs instead of repairing their meaning', async (t) => {
  const f = fixture(t);
  for (const [name, change, code] of inputFailures)
    await t.test(name, () => {
      const input = clone(f.input);
      change(input);
      assert.throws(() => f.compile(input), { code: `SEMANTIC_CONSTRUCTION_${code}` });
    });
});

test('a UTF-8-split span is invalid even with the exact partial-byte hash', (t) => {
  const f = fixture(t);
  const source = f.witness('docs/guide.txt', 'é');
  source.evidence.byteEnd -= 1;
  source.evidence.textSha256 = objectBytesSha256(Buffer.from('é').subarray(0, 1));
  f.input.claims[0].source = source;
  assert.throws(() => f.compile(), { code: 'SEMANTIC_CONSTRUCTION_EVIDENCE' });
});

test("one native object cannot borrow another object's span from the same source file", (t) => {
  const f = fixture(t, { splitGuide: true });
  const owner = f.state.objectOnt.map.nativeObjects.find(
    (object) => object.objectIdentity.externalId === 'doc-tail',
  );
  f.input.claims[0].source.nativeObjectSha256 = owner.nativeObjectSha256;
  assert.throws(() => f.compile(), { code: 'SEMANTIC_CONSTRUCTION_SOURCE' });
});

test('scope and every cut identity are rebound, not trusted from a rehashed record', (t) => {
  const f = fixture(t);
  const record = f.compile();
  for (const key of Object.keys(record.sourceBinding)) {
    const changed = clone(record);
    changed.sourceBinding[key] = key.endsWith('Sha256') ? digest : 'other';
    rehash(changed);
    assert.throws(
      () => rebindSourceNativeSemanticConstruction({ options: f.options, construction: changed }),
      { code: 'SEMANTIC_CONSTRUCTION_BINDING' },
      key,
    );
  }
  const changed = clone(record);
  changed.coverage.sourceCount += 1;
  changed.coverage.unexaminedSourceCount += 1;
  assert.throws(
    () =>
      rebindSourceNativeSemanticConstruction({ options: f.options, construction: rehash(changed) }),
    { code: 'SEMANTIC_CONSTRUCTION_BINDING' },
  );
});

test('even identical source text in another namespace cannot receive an old construction', (t) => {
  const f = fixture(t);
  const other = fixture(t, { namespace: 'other' });
  assert.throws(
    () =>
      rebindSourceNativeSemanticConstruction({ options: other.options, construction: f.compile() }),
    { code: 'SEMANTIC_CONSTRUCTION_BINDING' },
  );
});

test('a real source advance preserves proposal bytes but invalidates their current-cut binding', (t) => {
  const f = fixture(t);
  const record = f.compile();
  const bytes = stableObjectText(record);
  const nextInput = clone(f.buildInput);
  nextInput.sources.forEach((source) => {
    source.occurredAt = '2026-09-03T00:00:00.000Z';
  });
  const nextOptions = {
    artifactRoot: join(f.root, 'next'),
    objectBackendUri: pathToFileURL(join(f.options.artifactRoot, 'objects')).href,
  };
  buildSourceNativeProduct({ ...nextOptions, input: nextInput });
  assert.notEqual(
    openProductState(nextOptions).objectOnt.commitSha256,
    record.sourceBinding.sourceCommitSha256,
  );
  assert.throws(
    () => rebindSourceNativeSemanticConstruction({ options: nextOptions, construction: record }),
    { code: 'SEMANTIC_CONSTRUCTION_BINDING' },
  );
  assert.throws(
    () => rebindSourceNativeSemanticConstruction({ options: f.options, construction: record }),
    { code: 'SOURCE_NATIVE_PRODUCT_REF' },
  );
  assert.equal(
    stableObjectText(validateSourceNativeSemanticConstruction(JSON.parse(bytes))),
    bytes,
  );
});

test('structural validation rejects altered flags, counts, hashes and hidden fields', (t) => {
  const record = fixture(t).compile();
  for (const mutate of [
    (x) => {
      x.reviewRequired = false;
    },
    (x) => {
      x.navigationOnly = false;
    },
    (x) => {
      x.exactSourcesRemainAuthority = false;
    },
    (x) => {
      x.schemaVersion = 2;
    },
    (x) => {
      x.coverage.examinedSourceCount = 0;
    },
    (x) => {
      x.kind = 'Claim';
    },
  ]) {
    const changed = clone(record);
    mutate(changed);
    assert.throws(() => validateSourceNativeSemanticConstruction(rehash(changed)), {
      code: 'SEMANTIC_CONSTRUCTION_RECORD',
    });
  }
  assert.throws(() => validateSourceNativeSemanticConstruction({ ...record, proofClosed: true }), {
    code: 'SEMANTIC_CONSTRUCTION_SHAPE',
  });
  assert.throws(
    () => validateSourceNativeSemanticConstruction({ ...record, constructionSha256: digest }),
    { code: 'SEMANTIC_CONSTRUCTION_RECORD' },
  );
});

test('record collection and passage limits refuse overflow without truncating', (t) => {
  const f = fixture(t);
  const many = clone(f.input);
  many.objectDefs = Array.from({ length: 64 }, (_, i) => ({
    ...clone(many.objectDefs[0]),
    id: `concept-${i}`,
  }));
  many.claims = Array.from({ length: 256 }, (_, i) => ({
    ...clone(many.claims[0]),
    id: `claim-${i}`,
    about: 'concept-0',
  }));
  assert.equal(f.compile(many).claims.length, 256);
  assert.throws(
    () => f.compile({ ...many, objectDefs: [...many.objectDefs, clone(many.objectDefs[0])] }),
    { code: 'SEMANTIC_CONSTRUCTION_LIMIT' },
  );
  assert.throws(() => f.compile({ ...many, claims: [...many.claims, clone(many.claims[0])] }), {
    code: 'SEMANTIC_CONSTRUCTION_LIMIT',
  });
  const aliases = clone(f.input);
  aliases.objectDefs[0].aliases = Array.from({ length: 17 }, () =>
    clone(f.input.objectDefs[0].aliases[0]),
  );
  assert.throws(() => f.compile(aliases), { code: 'SEMANTIC_CONSTRUCTION_LIMIT' });
  assert.throws(() => f.compile({ ...f.input, coverage: Array(513).fill(f.input.coverage[0]) }), {
    code: 'SEMANTIC_CONSTRUCTION_LIMIT',
  });
  const exact = fixture(t, { guide: GUIDE + 'x'.repeat(65536 - Buffer.byteLength(GUIDE)) });
  assert.equal(exact.compile().objectDefs[0].source.evidence.byteEnd, 65536);
});

test('a structurally valid record accepts exactly 1 MiB and refuses one byte more', (t) => {
  const record = clone(fixture(t).compile());
  record.objectDefs = Array.from({ length: 64 }, (_, i) => ({
    ...clone(record.objectDefs[0]),
    id: `concept-${String(i).padStart(3, '0')}`,
    aliases: Array.from({ length: 16 }, (_, j) => ({
      ...clone(record.objectDefs[0].aliases[0]),
      value: `alias-${String(j).padStart(3, '0')}`,
    })),
  }));
  record.claims = [];
  const witnesses = record.objectDefs.flatMap((object) => [
    object.source,
    ...object.aliases.map((alias) => alias.source),
  ]);
  let remaining = 1024 * 1024 - Buffer.byteLength(stableObjectText(rehash(record)));
  assert(remaining > 0);
  for (const source of witnesses) {
    const added = Math.min(remaining, 2048 - source.evidence.sourceRef.length);
    source.evidence.sourceRef += 'x'.repeat(added);
    remaining -= added;
  }
  assert.equal(remaining, 0);
  rehash(record);
  assert.equal(Buffer.byteLength(stableObjectText(record)), 1024 * 1024);
  assert.deepEqual(validateSourceNativeSemanticConstruction(record), record);
  witnesses.at(-1).evidence.sourceRef += 'x';
  assert.throws(() => validateSourceNativeSemanticConstruction(rehash(record)), {
    code: 'SEMANTIC_CONSTRUCTION_LIMIT',
  });
});

test('512 source dispositions are structurally allowed but cannot invent source-catalog coverage', (t) => {
  const f = fixture(t);
  const record = clone(f.compile());
  record.objectDefs = [];
  record.claims = [];
  record.coverage = {
    sourceCount: 512,
    examinedSourceCount: 0,
    failedSourceCount: 0,
    unsupportedSourceCount: 512,
    unexaminedSourceCount: 0,
    sourceResults: Array.from({ length: 512 }, (_, i) => ({
      sourceRef: `source-${String(i).padStart(3, '0')}`,
      sourceSha256: digest,
      disposition: 'unsupported',
    })),
  };
  assert.equal(
    validateSourceNativeSemanticConstruction(rehash(record)).coverage.sourceResults.length,
    512,
  );
  assert.throws(
    () => rebindSourceNativeSemanticConstruction({ options: f.options, construction: record }),
    { code: 'SEMANTIC_CONSTRUCTION_BINDING' },
  );
});

test('literal bytes do not establish definition quality or alter ordinary verification', async (t) => {
  const f = fixture(t);
  const ont = openOntology(f.options);
  const before = await ont.verify('What is the current status of ClickupTask CT-17?');
  assert.equal(before.answerable, true);
  const input = clone(f.input);
  // This task mentions the alias but does not define the concept. A reviewer must reject it.
  input.claims[1].predicate = 'defines';
  const proposal = f.compile(input);
  assert.equal(proposal.reviewRequired, true);
  assert.equal(proposal.navigationOnly, true);
  assert.deepEqual(await ont.verify('What is the current status of ClickupTask CT-17?'), before);
});
