import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openOntology } from 'oont';
import { buildSourceNativeProduct } from 'oont/kernel';

const inputPath = fileURLToPath(new URL('./source-native-input.json', import.meta.url));

function fail(message) {
  const error = new Error(message);
  error.code = message;
  throw error;
}

function claimOutputRoot(outputRoot) {
  try {
    mkdirSync(outputRoot);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('SOURCE_LIFECYCLE_OUTPUT_EXISTS');
    throw error;
  }
}

function readInput() {
  return JSON.parse(readFileSync(inputPath, 'utf8'));
}

function successorInput() {
  const input = readInput();
  const relativePath = 'tracker/demo/task-1-v3.txt';
  input.sources.push({
    relativePath,
    sourceType: 'tracker',
    occurredAt: '2026-03-01T00:00:00.000Z',
    content: 'Task task-1 title: Keep context current',
  });
  input.nativeObjectInputs.push({
    relativePath,
    objectIdentity: {
      home: 'ObjectDef/InstanceRef',
      sourceSystem: 'tracker',
      objectType: 'task',
      namespace: 'demo',
      externalId: 'task-1',
    },
    fields: [{ fieldPath: 'title', value: 'Keep context current' }],
  });
  return input;
}

async function run(outputRootArgument) {
  if (typeof outputRootArgument !== 'string' || !outputRootArgument) {
    fail('SOURCE_LIFECYCLE_OUTPUT_ROOT');
  }
  const outputRoot = resolve(outputRootArgument);
  claimOutputRoot(outputRoot);

  const initialRoot = join(outputRoot, 'initial');
  const successorRoot = join(outputRoot, 'successor');
  const initialBuild = buildSourceNativeProduct({
    artifactRoot: initialRoot,
    input: readInput(),
  });
  const initialClient = openOntology({ artifactRoot: initialRoot });
  const initialVerification = await initialClient.verify(
    'What is the current title of task-1?',
  );
  const unsupported = await initialClient.verify('Who owns task-1?');
  const searched = await initialClient.search('What is the current title of task-1?');
  const firstMatch = searched.matches[0] ?? fail('SOURCE_LIFECYCLE_SEARCH');
  const searchRead = await initialClient.read({ ref: firstMatch.ref });
  if (!initialVerification.answerable
    || initialVerification.context[0]?.exactText !== 'Ship verified context'
    || unsupported.answerable
    || unsupported.state !== 'unavailable-native-field-not-declared'
    || unsupported.context.length !== 0
    || searchRead.exactText !== 'Ship verified context') {
    fail('SOURCE_LIFECYCLE_INITIAL_ASSERTION');
  }

  const backendUri = pathToFileURL(join(initialRoot, 'objects')).href;
  const successorBuild = buildSourceNativeProduct({
    artifactRoot: successorRoot,
    input: successorInput(),
    objectBackendUri: backendUri,
  });
  const successorClient = openOntology({
    artifactRoot: successorRoot,
    objectBackendUri: backendUri,
  });
  const successorVerification = await successorClient.verify(
    'What is the current title of task-1?',
  );
  if (!successorVerification.answerable
    || successorVerification.context[0]?.exactText !== 'Keep context current') {
    fail('SOURCE_LIFECYCLE_SUCCESSOR_ASSERTION');
  }

  let staleOpen = null;
  try {
    openOntology({ artifactRoot: initialRoot, objectBackendUri: backendUri });
  } catch (error) {
    staleOpen = error;
  }
  if (staleOpen?.code !== 'SOURCE_NATIVE_PRODUCT_REF') {
    fail('SOURCE_LIFECYCLE_STALE_OPEN');
  }

  const summary = {
    kind: 'OpenOntologySourceLifecycleWalkthroughV1',
    outputRoot,
    initial: {
      sourceCommitSha256: initialBuild.receipt.commitSha256,
      value: initialVerification.context[0]?.exactText ?? null,
    },
    updated: {
      sourceCommitSha256: successorBuild.receipt.commitSha256,
      value: successorVerification.context[0]?.exactText ?? null,
    },
    searchRead: { value: searchRead.exactText },
    refusal: {
      state: unsupported.state,
      contextCount: unsupported.context.length,
    },
    staleOpen: { code: staleOpen.code },
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const outputRootArgument = process.argv[2];
if (process.argv.length !== 3) {
  console.error('usage: node source-lifecycle.mjs <new-output-root>');
  process.exitCode = 1;
} else {
  run(outputRootArgument).catch((error) => {
    console.error(error?.code ?? error?.message ?? String(error));
    process.exitCode = 1;
  });
}
