import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  objectBytesSha256,
  stableObjectSha256,
  stableObjectText,
} from '../dist/src/canonical-content.mjs';
import {
  buildSourceNativeProduct,
  openSourceNativeProduct,
} from '../dist/src/source-native-product.mjs';
import { compileSourceNativeObjectMap } from '../dist/src/source-native-object-map.mjs';

test('canonical content is order-independent and byte-addressed', () => {
  const left = { z: [3, { b: true, a: null }], a: 'value' };
  const right = { a: 'value', z: [3, { a: null, b: true }] };
  const text = '{"a":"value","z":[3,{"a":null,"b":true}]}';

  assert.equal(stableObjectText(left), text);
  assert.equal(stableObjectText(right), text);
  assert.equal(stableObjectSha256(left), stableObjectSha256(right));
  assert.equal(stableObjectSha256(left), objectBytesSha256(Buffer.from(text)));
});

test('canonical content preserves JSON array omission semantics', () => {
  const value = [undefined, () => null, Symbol('omitted'), 'kept'];
  assert.equal(stableObjectText(value), '[null,null,null,"kept"]');
  assert.equal(stableObjectSha256(value), objectBytesSha256(Buffer.from(stableObjectText(value))));
});

test('stream hashing follows stable JSON wire order for integer-index keys', () => {
  const values = [
    { '10': 'ten', '2': 'two' },
    { '4294967295': 'not-an-index', '4294967294': 'max-index', '01': 'leading-zero', '0': 'zero' },
    { nested: { '10': 'ten', '2': 'two' }, list: [{ '3': 'three', '1': 'one' }] },
    { toJSON: () => ({ '10': 'ten', '2': 'two' }) },
  ];
  for (const value of values) {
    const text = stableObjectText(value);
    assert.equal(stableObjectSha256(value), objectBytesSha256(Buffer.from(text)), text);
  }
});

test('key-shape matrix distinguishes array indexes, non-index forms, Unicode, and insertion order', () => {
  const cases = [
    {
      name: 'index boundaries and numeric-like non-index names',
      value: Object.fromEntries([
        ['1e2', 'one-e-two'], ['4294967295', 'not-an-index'], ['-0', 'minus-zero'],
        ['4294967294', 'max-index'], ['1.5', 'one-point-five'], ['0', 'zero'], ['01', 'leading-zero'],
      ]),
      text: '{"0":"zero","4294967294":"max-index","-0":"minus-zero","01":"leading-zero","1.5":"one-point-five","1e2":"one-e-two","4294967295":"not-an-index"}',
    },
    {
      name: 'mixed Unicode keys',
      value: Object.fromEntries([['\u{1F600}', 'emoji'], ['e\u0301', 'combining'], ['é', 'composed'], ['alpha', 'ascii']]),
    },
  ];
  for (const row of cases) {
    const text = stableObjectText(row.value);
    if (row.text) assert.equal(text, row.text, row.name);
    assert.equal(stableObjectSha256(row.value), objectBytesSha256(Buffer.from(text)), row.name);
  }

  const first = Object.fromEntries([['beta', 'b'], ['10', 'ten'], ['alpha', 'a'], ['2', 'two']]);
  const second = Object.fromEntries([['2', 'two'], ['alpha', 'a'], ['10', 'ten'], ['beta', 'b']]);
  assert.equal(stableObjectText(first), stableObjectText(second));
  assert.equal(stableObjectSha256(first), stableObjectSha256(second));
});

test('stream hashing retains omission, null-prototype, date, toJSON, fallback, and error semantics', () => {
  const nullPrototype = Object.create(null);
  nullPrototype['10'] = 'ten';
  nullPrototype['2'] = 'two';
  const unsupported = new (class Unsupported {
    constructor() {
      this['10'] = 'ten';
      this['2'] = 'two';
    }
  })();
  const error = new Error('synthetic diagnostic');
  error['2'] = 'two';
  const values = [
    { omitted: undefined, callable: () => null, symbolic: Symbol('omitted'), kept: 'kept' },
    nullPrototype,
    new Date('2026-01-02T03:04:05.000Z'),
    { toJSON: () => ({ '10': 'ten', '2': 'two' }) },
    unsupported,
    error,
  ];
  for (const value of values) {
    const text = stableObjectText(value);
    assert.equal(stableObjectSha256(value), objectBytesSha256(Buffer.from(text)));
  }

  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => stableObjectText(cycle), /circular structure|Maximum call stack size exceeded/u);
  assert.throws(() => stableObjectSha256(cycle), /circular structure|Maximum call stack size exceeded/u);
});

test('stream hashing preserves serializer getter-read order while emitting numeric keys', () => {
  const makeFixture = () => {
    const reads = [];
    const value = {};
    for (const key of ['10', '2', 'alpha']) {
      Object.defineProperty(value, key, {
        enumerable: true,
        get() {
          reads.push(key);
          return `${key}-value`;
        },
      });
    }
    return { reads, value };
  };
  const textFixture = makeFixture();
  const text = stableObjectText(textFixture.value);
  const hashFixture = makeFixture();
  const hash = stableObjectSha256(hashFixture.value);
  assert.deepEqual(textFixture.reads, ['10', '2', 'alpha']);
  assert.deepEqual(hashFixture.reads, ['10', '2', 'alpha']);
  assert.equal(text, '{"2":"2-value","10":"10-value","alpha":"alpha-value"}');
  assert.equal(hash, objectBytesSha256(Buffer.from(text)));
});

test('source-native products with numeric canonical keys build and reopen', () => {
  const root = mkdtempSync(join(tmpdir(), 'oont-canonical-hash-parity-'));
  const content = '# Numeric canonical value\nMetadata: metadata\n';
  const input = {
    schemaVersion: 1,
    kind: 'OpenOntologySourceNativeBuildInputV1',
    ontId: 'canonical-hash-parity-product',
    namespace: 'acme',
    querySchemas: [{
      sourceSystem: 'clickup',
      objectType: 'task',
      aliases: ['task'],
      fields: [{ fieldPath: 'metadata', aliases: ['metadata'] }],
    }],
    sources: [{
      relativePath: 'clickup/acme/numeric.md',
      sourceType: 'clickup',
      occurredAt: '2026-01-01T00:00:00.000Z',
      content,
      sourceSha256: objectBytesSha256(Buffer.from(content)),
    }],
    nativeObjectInputs: [{
      relativePath: 'clickup/acme/numeric.md',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'clickup',
        objectType: 'task',
        namespace: 'acme',
        externalId: 'numeric-task',
      },
      fields: [{
        fieldPath: 'metadata',
        value: 'metadata',
        codeUnitStart: content.indexOf('metadata'),
        canonicalValue: { '10': 'ten', '2': 'two' },
      }],
    }],
  };
  try {
    const map = compileSourceNativeObjectMap({
      sources: input.sources,
      nativeObjectInputs: input.nativeObjectInputs,
    });
    const { fieldSha256, ...fieldCore } = map.nativeObjects[0].fields[0];
    assert.equal(fieldSha256, objectBytesSha256(Buffer.from(stableObjectText(fieldCore))));
    const { nativeObjectMapSha256, ...mapCore } = map;
    assert.equal(nativeObjectMapSha256, objectBytesSha256(Buffer.from(stableObjectText(mapCore))));
    const built = buildSourceNativeProduct({ artifactRoot: root, input });
    assert.match(built.artifactSha256, /^sha256:[0-9a-f]{64}$/u);
    const product = openSourceNativeProduct({ artifactRoot: root });
    assert.equal(product.status().ontId, input.ontId);
    assert.equal(product.status().nativeObjectCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
