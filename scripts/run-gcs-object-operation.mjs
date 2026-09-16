#!/usr/bin/env node

import { openGcsObjectBackend } from '../dist/storage/gcs-backend.js';

let operation;
try {
  operation = JSON.parse(Buffer.from(process.env.OONT_GCS_OPERATION_BASE64 ?? '', 'base64').toString('utf8'));
} catch {
  process.stderr.write('invalid OONT_GCS_OPERATION_BASE64\n');
  process.exit(2);
}

const backend = openGcsObjectBackend({
  bucket: process.env.OONT_GCS_BUCKET,
  accessToken: process.env.OONT_GCS_ACCESS_TOKEN,
  endpoint: process.env.OONT_GCS_ENDPOINT ?? 'https://storage.googleapis.com',
});

try {
  let receipt;
  if (operation.mode === 'cas') {
    receipt = backend.compareAndSwap(operation.key, {
      expectedVersion: operation.expectedVersion,
      bytes: Buffer.from(operation.bytesBase64, 'base64'),
    });
  } else if (operation.mode === 'put') {
    receipt = backend.putIfAbsent(operation.key, Buffer.from(operation.bytesBase64, 'base64'));
  } else throw new Error('OPERATION_MODE');
  process.stdout.write(`${JSON.stringify({ status: 'PASS', workerId: operation.workerId, receipt })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: 'ERROR',
    workerId: operation.workerId,
    code: error?.code ?? error?.message,
  })}\n`);
}
