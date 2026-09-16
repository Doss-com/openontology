# Storage

OpenOntology stores immutable objects and advances named refs with
compare-and-swap. This guide covers the storage operations in `oont` 0.3.0-alpha.3;
query and proof semantics stay in the engine.

Source and knowledge branches advance by commit ancestry:

- Publishing the current commit or a descendant is allowed. An ancestor or
  unrelated fork returns `OBJECT_ONT_REF_ROLLBACK`.
- Concurrent writes still use backend version checks. Historical reads do not
  change current refs.
- Republishing older content can create a new descendant. That is a new
  publication, not a restore, and can make existing descriptors stale.
- To inspect old state, use historical opening or a separate branch.

Legacy profiles cannot detect a direct backend rewind after restart. Protected
history adds an independently stored record of accepted refs.

## Protected history

A kernel build with explicit `historyBackendUri` produces a V2
source descriptor. Its stable resource preserves the same required history URI
and binds it into its content hash. Existing V1 descriptors and resources remain
legacy; opening cannot implicitly enroll them or substitute a different history
backend. Data and history cannot use the identical canonical URI.

```js
import { buildSourceNativeProduct } from 'oont/kernel';

buildSourceNativeProduct({
  artifactRoot: './compiled-cut',
  input: sourceAdapterOutput,
  objectBackendUri: 'gs://example-ont-data/project',
  historyBackendUri: 'gs://example-ont-history/project',
});
```

These are storage settings for the operator. The root query surface stays
`verify`, `search`, `read`, `check`, and `status`. Every successor build must use
the same protected profile. Ordinary query operations never repair storage.

Protected publication has three steps:

1. Reserve the target in accepted history.
2. Conditionally update the data ref.
3. Finalize acceptance.

A lost response leaves a target that can be recovered forward. Pending, missing,
corrupt or mismatched history blocks current reads and cached Admission reuse.
Unavailable knowledge falls back to ordinary source verification.

Explicit operator recovery uses the history-aware store returned by
`openExactProductArtifactState`. `store.recoverRefHistory({ ontId, branch })`
restores only the protected accepted or reserved target. It refuses unrelated
refs and unavailable required objects; it cannot recreate lost Corpus bytes.
Exact historical source opening remains independent of current-ref eligibility,
but its returned store still guards current source and knowledge refs.

Existing unprotected branches need explicit receipt-bound enrollment through
`initializeRefHistory`, with old writers quiesced. A current read never creates
trusted history from the ref it is supposed to check. Enrollment and migration
remain operator work, not automatic onboarding.

Protection depends on deployment configuration:

- Data and history need separately controlled restoration. Different bucket or
  prefix names alone are insufficient.
- Rewinding both stores is undetectable without an independently retained receipt.
- IAM, retention and recovery must be checked for the deployment.

The tradeoff is extra conditional writes and object-metadata checks for rollback
detection across restarts.

## Conditional source publication

The kernel builder accepts optional
`expectedSourceVersion`. A delayed worker can bind a changed publication to the
source ref it previously observed, instead of treating the newest ref as its
base when it eventually finishes.

- Omitted or `undefined` preserves manual-build behavior: the builder reads
  the latest ref version before materialization.
- A nonempty string is an opaque backend version from `receipt.refVersion` or
  a history-aware store's `readRefMetadata`, not a source commit hash or numeric
  generation. A changed target requires that exact current version.
- `null` permits an initial publication only when no source ref exists.
- An identical current map and source catalog always retain the existing
  idempotent replay behavior, including with a stale string or `null`. No new
  commit or ref version is published in that case.

Publication errors:

- A stale changed target returns `SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT`.
  Reconcile the input and source base before retrying; do not simply substitute
  the latest version.
- Invalid version values return `SOURCE_NATIVE_PRODUCT_SOURCE_VERSION` before
  creating an output directory.
- Protected-history checks apply even to identical-content replay.

Use a separate descriptor directory for each changed cut. A rejected
publication may leave that directory and unreferenced immutable blobs or
metadata, but cannot publish its descriptor or advance the winning source head.
The precondition is not stored in the descriptor and is not a root query option.
It does not prove the input is a fresh or complete observation of Terrain;
source-checkpoint ordering and background reconciliation remain operator work.

## Local file

The local backend is the default and requires no credentials. Use it for local
development, tests, and offline operation.

The kernel exposes the same URI normalizer and backend opener used by the
builder, for managed or research operators that need to select a backend
before opening a store:

```js
import {
  normalizeCanonicalObjectBackendUri,
  openCanonicalObjectBackend,
  openObjectOntStore,
} from 'oont/kernel';

const uri = normalizeCanonicalObjectBackendUri('file:///tmp/ont-objects');
const selected = openCanonicalObjectBackend({ uri, env: process.env });
const store = openObjectOntStore({ backend: selected.backend });
```

These are storage primitives, not a new query or credential surface. Invalid
URI syntax is refused before a backend is opened, and provider credentials stay
in the supplied environment or callback configuration.

## GCS

Select GCS with a canonical backend URI:

```bash
export OONT_GCS_ACCESS_TOKEN="$(gcloud auth application-default print-access-token)"

oont resolver build input.json \
  --out ./verified-context \
  --backend gs://your-ontology-bucket
```

The GCS Adapter uses object generations as opaque versions. Immutable writes
use generation preconditions. Refs use generation-bound compare-and-swap.
Full reads verify byte length and SHA-256. Range reads validate generation,
length and returned range metadata; the caller still verifies the exact Evidence
span against its bound hash.

An optional prefix, such as `gs://your-ontology-bucket/project/ont`, scopes all
physical object keys while receipts retain logical keys. Prefixes reject
traversal, encoded aliases and trailing separators. A prefix is organization,
not an IAM boundary. S3 prefix configuration is not supported.

For programmatic use, `objectBackendEnv` accepts either:

- `OONT_GCS_ACCESS_TOKEN`, a token string.
- `OONT_GCS_ACCESS_TOKEN_PROVIDER`, a synchronous function returning a current
  token on each request attempt. It cannot be supplied as a shell string.

Do not supply both. Ordinary nonempty reads use one media request, with up to
three attempts for transient failures. Writes are not automatically retried.

To run the confined provider qualification:

```bash
export OONT_GCS_BUCKET=your-ontology-bucket
npm run qualify:gcs-object-storage
```

The qualification writes beneath a fresh
`qualification/gcs-v1/<random-id>` prefix. It does not delete bucket data.

## S3-compatible storage

An S3-compatible Adapter is included for experimentation. Configuration is read
from `OONT_S3_*` environment variables. Embedded credentials and configuration
query strings are rejected in backend URIs.

S3 is not qualified for this alpha. Conditional write policy, retention, and
garbage collection remain provider responsibilities.

## Kernel resources and replay checkpoints

The kernel extension can create a stable source
resource with `createSourceNativeProductResource`, then bind its current branch
cut into an immutable local descriptor with `bindSourceNativeProductResource`.
The resource fixes its Ont identity, namespace, query profile, backend, and
source-history anchor. A later binding must descend from that anchor and fit
the profile. Binding never overwrites an existing descriptor with different
bytes. Ordinary query operations do not gain a source-update or Admission step.

`openExactProductArtifactState` can reopen a previously bound cut after its
branch advances. It still validates descriptor and replay hashes and exact
stored sources. Ordinary opening retains its current-ref check. These are
kernel operator primitives, not an automatic refresh or hosted ingestion API.

New materialization writes an immutable replay checkpoint before the ref CAS,
through `compareAndSwapRefMetadataCheckpointed`.

- Checkpoints apply to clean blob-only history. Assertion-bearing Ledger
  history requires full replay.
- Missing checkpoints fall back to graph replay. Invalid checkpoints refuse.
- Ref-index opening, resource binding and product opening use valid checkpoints
  without skipping map or catalog validation.
- Ordinary opening checks the descriptor against the current ref before reading
  payloads. Exact opening uses the descriptor's cut without following the ref.
- Both product openings inspect every source hash and field Evidence span.

Checkpoints exchange one extra publication object for fewer startup history
reads. Publication still reads the current ref to check ancestry; a rejected
write may leave an unreferenced checkpoint.

They limit metadata request count, not bytes, memory or query cost. Full product
hydration remains corpus-sized. Managed update behavior and provider limits
require separate qualification.

### Selected construction sources

`openProductSourceContext(options)` checks the artifact binding, protected
history, map and complete catalog without hydrating every source pack.

Its `readSource(sourceRef)`:

- Resolves a member of that catalog.
- Reads the whole document and verifies its hash and UTF-8.
- Checks every attached native field against those bytes.

The context describes one immutable cut; it does not follow source updates.

Construction compile/rebind, review, construction Admission and standalone
construction-ledger reads open this context internally. Their public inputs
remain artifact options, not caller-supplied validation receipts. Review checks
its source-text budget before reading payload and includes complete cited
documents. Source-reading failures fail the entire ledger operation.

Read scope matters:

- Construction validates selected documents. Full product opening and whole-Ont
  checks validate all source bytes.
- Protected Admission also checks every parent object's availability and metadata.
- File storage validates the entire JSON/base64 envelope even for range or head
  operations. GCS ranges can read selected bytes, so unrelated pack damage can
  affect the two Adapters differently.
- Map and catalog checks remain whole-index; the map may contain large fields.
  A small range read does not bound total memory, latency or cost.

## Managed storage

Hosted accounts, tenant isolation, application credentials, IAM automation,
quotas, garbage collection and operational recovery belong to the managed
application. The engine supplies storage and protected-history primitives;
a separate private deployment configures and operates them.
