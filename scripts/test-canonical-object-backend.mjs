#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCanonicalObjectBackendUri,
  openCanonicalObjectBackend,
} from '../dist/src/canonical-object-backend.mjs';

test('canonical backend syntax is normalized once for every consumer', () => {
  assert.equal(normalizeCanonicalObjectBackendUri('gs://customer-ontology/'), 'gs://customer-ontology');
  assert.equal(
    normalizeCanonicalObjectBackendUri('gs://customer-ontology/tenant-a/ont-a'),
    'gs://customer-ontology/tenant-a/ont-a',
  );
  assert.equal(normalizeCanonicalObjectBackendUri('s3://customer-ontology/'), 's3://customer-ontology');
  assert.throws(() => normalizeCanonicalObjectBackendUri('s3://customer-ontology/prefix'), {
    code: 'CANONICAL_OBJECT_BACKEND_URI',
  });
});

test('canonical GCS prefixes reject aliases, traversal, and encoded separators', () => {
  for (const uri of [
    'gs://customer-ontology/tenant-a/',
    'gs://customer-ontology/tenant-a//ont-a',
    'gs://customer-ontology/tenant-a/./ont-a',
    'gs://customer-ontology/tenant-a/../ont-a',
    'gs://customer-ontology/tenant-a%2Font-a',
    'gs://customer-ontology/tenant-a%2Font-a/child',
  ]) {
    assert.throws(() => normalizeCanonicalObjectBackendUri(uri), {
      code: 'CANONICAL_OBJECT_BACKEND_URI',
    });
  }
});

test('s3 URI selects the distributed Adapter without opening the network', () => {
  const selected = openCanonicalObjectBackend({
    uri: 's3://customer-ontology',
    env: {
      OONT_S3_ENDPOINT: 'https://objects.example.test',
      OONT_S3_REGION: 'us-west-2',
      OONT_S3_ACCESS_KEY_ID: 'fixture-access',
      OONT_S3_SECRET_ACCESS_KEY: 'fixture-secret',
      OONT_S3_SESSION_TOKEN: 'fixture-session',
      OONT_S3_CONDITIONAL_WRITE_POLICY: 'enforced',
    },
  });
  assert.equal(selected.uri, 's3://customer-ontology');
  assert.equal(selected.capabilities.backend, 's3-compatible');
  assert.equal(selected.capabilities.bucket, 'customer-ontology');
  assert.equal(selected.capabilities.endpointOrigin, 'https://objects.example.test');
  assert.equal(selected.capabilities.region, 'us-west-2');
  assert.equal(selected.capabilities.distributedObjectStore, true);
  assert.equal(selected.capabilities.providerConditionalWritePolicy, true);
});

test('gs URI selects the native GCS Adapter without opening the network', () => {
  const selected = openCanonicalObjectBackend({
    uri: 'gs://customer-ontology',
    env: { OONT_GCS_ACCESS_TOKEN: 'fixture-token' },
  });
  assert.equal(selected.uri, 'gs://customer-ontology');
  assert.equal(selected.capabilities.backend, 'gcs');
  assert.equal(selected.capabilities.bucket, 'customer-ontology');
  assert.equal(selected.capabilities.endpointOrigin, 'https://storage.googleapis.com');
  assert.equal(selected.capabilities.distributedObjectStore, true);
  assert.equal(selected.capabilities.providerConditionalWritePolicy, true);
  assert.equal(selected.capabilities.nativeGenerationPreconditions, true);
});

test('gs URI preserves a scoped prefix and accepts a renewable token provider', () => {
  const selected = openCanonicalObjectBackend({
    uri: 'gs://customer-ontology/tenant-a/ont-a',
    env: { OONT_GCS_ACCESS_TOKEN_PROVIDER: () => 'fixture-token' },
  });
  assert.equal(selected.uri, 'gs://customer-ontology/tenant-a/ont-a');
  assert.equal(selected.capabilities.backend, 'gcs');
  assert.equal(selected.capabilities.keyPrefix, 'tenant-a/ont-a');
  assert.equal('accessToken' in selected.capabilities, false);
  assert.equal('accessTokenProvider' in selected.capabilities, false);
});

test('canonical backend URI never accepts embedded credentials or configuration query text', () => {
  for (const uri of [
    's3://access:secret@customer-ontology',
    's3://customer-ontology?endpoint=https://objects.example.test',
    'gs://token@customer-ontology',
    'gs://customer-ontology?token=secret',
    'file:///tmp/objects?token=secret',
  ]) {
    assert.throws(() => openCanonicalObjectBackend({ uri, env: {} }), {
      code: 'CANONICAL_OBJECT_BACKEND_URI',
    });
  }
});
