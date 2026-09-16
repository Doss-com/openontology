# Installed source lifecycle walkthrough

For the conceptual walkthrough and diagrams, read [The life of context in an Ont](CONTEXT-LIFECYCLE.md).

Build a source cut, query it, then publish an update using the installed `oont`
package. The example uses explicit Adapter input and local storage. It does not
connect to a provider or enable automatic knowledge reuse.

## Run it from an installed package

The package requires Node.js 24 or newer. From an application directory that
already contains the package:

```bash
node ./node_modules/oont/examples/quickstart/source-lifecycle.mjs \
  ./source-lifecycle-run
```

Use a new output directory inside an existing parent. The script reserves it
before building.

For a single source cut, the ordinary CLI build route remains available:

```bash
npx --no-install oont resolver build \
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

The JSON summary goes to stdout; diagnostics go to stderr. It includes:

- Both source commits and their returned field values.
- The value returned by `search` followed by `read`.
- Unsupported-query and stale-descriptor refusals.

For another run, choose a different output directory. An existing path returns
`SOURCE_LIFECYCLE_OUTPUT_EXISTS` without changing it. If a later build step fails,
partial output remains for inspection; it is not automatically resumed or removed.

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

The update preserves the identity, query schema and Ont identifier:

1. Append `Keep context current` at `2026-03-01T00:00:00.000Z`.
2. Build a new descriptor against the same object backend.
3. Open the new descriptor and verify the updated value.
4. Try opening the old descriptor. It returns `SOURCE_NATIVE_PRODUCT_REF`
   because the source branch has advanced beyond its recorded commit.

Source updates and time queries are separate:

- `occurredAt` orders source observations. An Adapter can also supply `validAt`
  and `knownAt` on fields or propositions.
- Publishing a new cut does not transfer knowledge admitted for the old cut.
- `at` selects valid time within the client's bound cut, not another historical
  source commit. Exact historical opening is a separate kernel operation.

See [temporal intent](../README.md#temporal-intent).

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
      "fields": [{ "fieldPath": "status", "aliases": ["status"] }]
    }
  ],
  "sources": [
    {
      "sourceType": "tracker",
      "relativePath": "tracker/demo/t-1.txt",
      "occurredAt": "2026-01-01T00:00:00.000Z",
      "content": "Ticket T-1 status: open",
      "sourceSha256": "sha256:a1aefc2657e92b4f9740cd2d0a395d12a91cdd34e34517c78b48455cfb91ee62"
    }
  ],
  "nativeObjectInputs": [
    {
      "relativePath": "tracker/demo/t-1.txt",
      "objectIdentity": {
        "home": "ObjectDef/InstanceRef",
        "sourceSystem": "tracker",
        "objectType": "ticket",
        "namespace": "demo",
        "externalId": "T-1"
      },
      "fields": [{ "fieldPath": "status", "value": "open", "codeUnitStart": 19 }]
    }
  ]
}
```

Input requirements:

- Required top-level fields: `schemaVersion`, `kind`, `ontId`, `namespace`,
  `querySchemas`, `sources` and `nativeObjectInputs`. `branch` defaults to `main`.
- Each source needs nonempty `sourceType` and `content`, a logical `relativePath`
  and canonical UTC `occurredAt`. The path must start with its type, such as `tracker/`.
- Optional `sourceSha256` is `sha256:` plus 64 lowercase hexadecimal digits over
  the UTF-8 content. The builder computes it when omitted.

Each native object maps one source path:

- Its `ObjectDef/InstanceRef` identity includes `sourceSystem`, `objectType`,
  `externalId` and the build `namespace`.
- Each field needs a `fieldPath` and nonempty `value` found exactly in the source.
  Supply `codeUnitStart` if that value appears more than once.
- The compiler emits a half-open UTF-8 byte span and `textSha256`.
- Optional `canonicalValue` groups equivalent revisions. Reads and verification
  still return the source-exact `value`.

`occurredAt` must use a canonical UTC timestamp
such as `2026-01-01T00:00:00.000Z`; use the same form for optional `validAt`
or `knownAt`. Repeated observations use separate source and object rows with
the same identity. A changed canonical value at the same `occurredAt` refuses
the build, because chronology is ambiguous. Changing only exact presentation
while retaining the same `canonicalValue` does not create a revision.

The query schema's source system, object type, aliases, and field paths must
agree with the native object inputs. The builder validates the two declarations
independently, so a mismatched profile can build but cannot answer the missing
field. Keep the declarations aligned.

Map every supplied source path to at least one native object. A nonempty
`adapterDiagnostics` array records conversion problems and disables complete
chronology and absence proof. Completeness and absence apply only to the supplied
catalog, not all upstream records.

TypeScript authors can check the input shape with `satisfies`:

```ts
import { buildSourceNativeProduct } from 'oont/kernel';
import type { SourceNativeBuildInput } from 'oont/kernel';

const authoringInput = {
  schemaVersion: 1,
  kind: 'OpenOntologySourceNativeBuildInputV1',
  ontId: 'status-demo',
  namespace: 'demo',
  querySchemas: [
    {
      sourceSystem: 'tracker',
      objectType: 'ticket',
      aliases: ['ticket'],
      fields: [{ fieldPath: 'status', aliases: ['status'] }],
    },
  ],
  sources: [
    {
      sourceType: 'tracker',
      relativePath: 'tracker/demo/t-1.txt',
      occurredAt: '2026-01-01T00:00:00.000Z',
      content: 'Ticket T-1 status: open',
    },
  ],
  nativeObjectInputs: [
    {
      relativePath: 'tracker/demo/t-1.txt',
      objectIdentity: {
        home: 'ObjectDef/InstanceRef',
        sourceSystem: 'tracker',
        objectType: 'ticket',
        namespace: 'demo',
        externalId: 'T-1',
      },
      fields: [{ fieldPath: 'status', value: 'open' }],
    },
  ],
} satisfies SourceNativeBuildInput;

buildSourceNativeProduct({ artifactRoot: './new-cut', input: authoringInput });
```

Types check structure. The builder still validates timestamps, namespaces,
hashes, spans, coverage and propositions at runtime. Its `input` parameter is
`unknown`, so parsed JSON receives the same checks.

## Query schemas and stored source shape

`querySchemas` is the declared query surface. It is not a complete inventory of
source witnesses, and adding a witness such as `sourceText` to a native object
does not make that field queryable. Ordinary `verify` and `search` continue to
use only the declared source system, object type, aliases, and fields.

For a read-only resource, allowed stored shapes come from its fixed
`querySchemas` and the native map at `sourceHistoryAnchorCommitSha256`.

- Later cuts may add declared query fields and retain, remove or reintroduce
  witness fields present in that anchor.
- They cannot add a field or object profile absent from both declarations.
- Validation always opens the original anchor from the configured backend,
  not a mutable successor or a previously failed bind.

Binding compares anchor and successor indexes, maps and catalogs without loading
source packs. Invalid anchor data, unrelated or broken protected history, and
namespace/profile drift refuse before writing a descriptor. V1 and protected V2
retain their existing formats and history rules.
