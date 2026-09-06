# Installed source lifecycle walkthrough

For the conceptual walkthrough and diagrams, read [The life of context in an Ont](CONTEXT-LIFECYCLE.md).

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

## Authoring Adapter input

`buildSourceNativeProduct` accepts one JSON-compatible Adapter envelope. The
following is a complete minimal input. The supplied source hash is the SHA-256
of the exact UTF-8 bytes of `content`, and `codeUnitStart` is the JavaScript
UTF-16 index of the exact field value.

```json
{
  "schemaVersion": 1,
  "kind": "OpenOntologySourceNativeBuildInputV1",
  "ontId": "status-demo",
  "namespace": "demo",
  "querySchemas": [
    {
      "sourceSystem": "tracker",
      "objectType": "ticket",
      "aliases": ["ticket"],
      "fields": [{"fieldPath": "status", "aliases": ["status"]}]
    }
  ],
  "sources": [{
    "sourceType": "tracker",
    "relativePath": "tracker/demo/t-1.txt",
    "occurredAt": "2026-01-01T00:00:00.000Z",
    "content": "Ticket T-1 status: open",
    "sourceSha256": "sha256:a1aefc2657e92b4f9740cd2d0a395d12a91cdd34e34517c78b48455cfb91ee62"
  }],
  "nativeObjectInputs": [{
    "relativePath": "tracker/demo/t-1.txt",
    "objectIdentity": {
      "home": "ObjectDef/InstanceRef",
      "sourceSystem": "tracker",
      "objectType": "ticket",
      "namespace": "demo",
      "externalId": "T-1"
    },
    "fields": [{"fieldPath": "status", "value": "open", "codeUnitStart": 19}]
  }]
}
```

Top-level `schemaVersion`, `kind`, `ontId`, `namespace`, `querySchemas`,
`sources`, and `nativeObjectInputs` are required. `branch` is optional and
defaults to `main`. Each source requires a nonempty `sourceType`, logical
`relativePath`, parseable `occurredAt`, and nonempty exact `content`. The first
path segment must equal `sourceType`, for example `tracker/...`. A supplied
`sourceSha256` must be `sha256:` followed by 64 lowercase hexadecimal digits
over the source's UTF-8 bytes; the builder computes it when omitted.

Each native object maps one source path and requires an
`ObjectDef/InstanceRef` identity, with `sourceSystem`, `objectType`,
`externalId`, and the build `namespace`. Each field requires a `fieldPath` and
nonempty source-exact `value`. Use `codeUnitStart` when the value can repeat;
omitting it is only safe when the value occurs once. The compiler emits the
corresponding half-open UTF-8 byte span and `textSha256`. `canonicalValue` is
optional comparison metadata for revision grouping. It never replaces the
source-exact `value` returned by `read` or verification.

Use canonical UTC timestamps such as
`2026-01-01T00:00:00.000Z` for `occurredAt`, and the same form for optional
`validAt` or `knownAt`. Repeated observations use separate source and object
rows with the same identity. A changed exact value at the same `occurredAt`
refuses the build, because chronology is ambiguous.

The query schema's source system, object type, aliases, and field paths must
agree with the native object inputs. The builder validates the two declarations
independently, so a mismatched profile can build but cannot answer the missing
field. Keep the declarations aligned. Unknown optional properties are retained
only where the runtime contract accepts them; they are not validation helpers.

Every supplied source path must be mapped by at least one native object. This
is completeness of the supplied corpus, not proof that an upstream system had
no other records. An explicit nonempty `adapterDiagnostics` array records
conversion problems and disables complete chronology and absence proof. An
absence receipt is therefore only scoped to the complete, supplied source
catalog, and never authorizes world absence.

The lifecycle example claims a new output root before writing child artifacts.
An existing root fails with `SOURCE_LIFECYCLE_OUTPUT_EXISTS` and is not removed
or altered. TypeScript authoring types for this envelope are not currently a
supported package export. Treat this JSON contract and runtime diagnostics as
the authoring boundary until that separate type-surface follow-up is complete.
