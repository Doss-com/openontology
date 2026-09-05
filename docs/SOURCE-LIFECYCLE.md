# Installed source lifecycle walkthrough

This walkthrough uses the installed `oont` package to build one deterministic
source cut, query its exact context, publish an immutable successor cut, and
show why a root client refuses to open the stale descriptor. It is an operator
workflow for explicit Adapter output. It does not ingest arbitrary documents,
connect to a provider, or claim automatic knowledge reuse.

## Run it from an installed package

The package requires Node.js 24 or newer. From an application directory that
already contains the package:

```bash
node ./node_modules/oont/examples/quickstart/source-lifecycle.mjs \
  ./source-lifecycle-run
```

The parent directory must already exist. The script claims the new output root
with a non-recursive directory create before building any child artifacts.

For a single source cut, the ordinary CLI build route remains available:

```bash
npx oont resolver build \
  ./node_modules/oont/examples/quickstart/source-native-input.json \
  --out ./verified-context
```

The lifecycle example uses the equivalent `oont/kernel` operator function so
it can build the initial cut and its successor in one explicit walkthrough.

The final argument must not exist. The script refuses an existing path before
writing anything. On success, it creates:

```text
source-lifecycle-run/
  initial/
    source-native.json
    objects/
  successor/
    source-native.json
```

The `objects/` directory is the local canonical object backend. Both
descriptors point at it. The initial descriptor remains unchanged while the
successor advances the same `quickstart` source branch to a new source cut.

The program prints one JSON summary to stdout. Diagnostics and failures go to
stderr. The summary includes the two source commit identities, the exact values
observed by both cuts, the value returned by a search followed by a
request-local `read`, the unsupported-query refusal, and the stale-open refusal.

Run it again with a different new output root to create another independent
walkthrough. Running it against the first output root fails with
`SOURCE_LIFECYCLE_OUTPUT_EXISTS` and does not remove or alter that directory.
The early existing-path check is the no-write guarantee. If a later build step
fails after reservation, any partial synthetic output is retained for
inspection and is not automatically resumed or removed.

## What the example does

The source input is the packaged
`examples/quickstart/source-native-input.json`. It is deterministic Adapter
output, not an arbitrary document import. It declares:

- source observations with `relativePath`, `sourceType`, `occurredAt`, and
  exact source text;
- one stable native identity, `tracker` task `task-1` in namespace `demo`;
- a query schema that declares the `title` field and its aliases;
- native field values whose exact spans are selected by the Ont.

The initial cut verifies the current title, verifies an unsupported owner
question as a typed refusal with no context, and runs `search` followed by
`read`. Search returns a navigation Reference. Only the request-local `read`
returns exact authorized bytes.

The successor input preserves the identity, query schema, and Ont identifier,
then appends the dated observation `Keep context current` at
`2026-03-01T00:00:00.000Z`. It is built in a different descriptor directory
against the same local object backend. The updated client verifies the new
source cut and value. A new root client opened against the old descriptor then refuses with
`SOURCE_NATIVE_PRODUCT_REF`, because its descriptor still names the earlier
commit while the mutable source branch now names the successor.

`occurredAt` orders source observations in the source cut. It is not the same
as semantic `validAt` or `knownAt` time, which belong to field or proposition
inputs when an Adapter supplies them. A new source cut is also not an
Admission. Publishing the successor does not transfer old-cut knowledge
eligibility. The unreleased root client's explicit `at` query selects valid
time within its bound cut; it does not reopen a different historical source
commit. Exact historical opening remains an operator capability outside this
root walkthrough. See [temporal intent](../README.md#temporal-intent).

The root client remains read-only. Building and advancing a cut use the
explicit extension functions from `oont/kernel`; ordinary agents need only the
root `verify` path.
