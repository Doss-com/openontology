import assert from 'node:assert/strict';
import test from 'node:test';

import {
  objectBytesSha256,
  stableObjectSha256,
  stableObjectText,
} from '../src/canonical-content.mjs';

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
