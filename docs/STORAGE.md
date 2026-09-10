# Storage

OpenOntology stores immutable objects and advances named refs with
compare-and-swap. Storage Adapters do not decide truth, ranking, or proof.

Normal ObjectOnt ref publication is forward-only. An existing branch accepts
its current commit or a descendant, and rejects an ancestor or unrelated fork
with `OBJECT_ONT_REF_ROLLBACK`. Backend version conflicts still govern concurrent
writes. Historical snapshots remain readable without changing current refs.
This is commit ancestry, not content rollback: republishing older bytes can
create a new descendant commit, advance the branch, and make descriptors bound
to a prior descendant stale. Treat that as a new publication, not restoration;
use exact historical opening or a separate branch or cut when preserving old
state.
This rule covers source and admitted-knowledge publication. The legacy profile
does not detect a direct backend rewrite after process restart. The unpublished
protected profile below adds independently stored accepted history.

## Protected history

`[ACTIVE-WORK]` A kernel build with explicit `historyBackendUri` produces a V2
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

The protected store reserves an exact target in accepted history, conditionally
updates the data ref, then finalizes acceptance. A lost response leaves a target
that can be recovered forward, never an instruction to reset to an older cut.
Current readers refuse pending, missing, corrupt or mismatched history. Warm
knowledge refresh uses the same check before reusing a cached Admission.
Unavailable knowledge falls back to ordinary exact source verification.

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

Protection requires a separately controlled restore domain. Different bucket or
prefix strings alone do not establish that boundary. A restore that rewinds both
data and protected history remains indistinguishable without an independently
retained receipt. IAM, backup retention and deployment-specific recovery still
require operational qualification. Protected publication adds conditional writes
and reachable-object metadata checks in exchange for cold-start continuity.

## Conditional source publication

`[ACTIVE-WORK]` The unpublished kernel builder accepts optional
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

A stale changed target returns `SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT`. The
caller must reconcile its intended input and source base before trying again;
blindly substituting the latest version defeats the precondition. Empty strings
and non-string/non-null values return `SOURCE_NATIVE_PRODUCT_SOURCE_VERSION`
before an output directory is created. Protected-history pending, corruption
and rewind checks still apply, even to identical-content replay.

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

Programmatic `objectBackendEnv` accepts either `OONT_GCS_ACCESS_TOKEN` or a
synchronous `OONT_GCS_ACCESS_TOKEN_PROVIDER` function that returns a current
token, not both. The function is called for each request attempt. It cannot be
supplied as a shell environment string. Ordinary nonempty reads use one media
request. Transient read failures receive up to three attempts by default;
writes are not automatically retried. This reduces metadata round trips but
does not establish a total query-latency or operating-cost bound.

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

`[ACTIVE-WORK]` The unpublished kernel extension can create a stable source
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

New source-native materialization publishes a replay checkpoint through
`compareAndSwapRefMetadataCheckpointed`. The immutable checkpoint is written
before the ref CAS, and applies only to clean blob-only history. Assertion-bearing
Ledger history still requires full replay. A missing checkpoint falls back to
graph replay; a present invalid checkpoint refuses. Ref-index opening,
resource binding, ordinary opening and exact opening use the checkpoint when
present, without treating it as Evidence or skipping map and catalog validation.
Ordinary opening checks the descriptor against the ref before loading source
payloads. Exact opening uses the immutable descriptor's cut without following
the ref. Both still inspect every source hash and field Evidence span.

The checkpoint bounds metadata request count as commit history grows, not
checkpoint bytes, memory, query work, or total cost. It adds one immutable
metadata object at publication in exchange for fewer history reads at startup.
Ref publication also reads the current ref to check ancestry. A rejected
checkpointed write can leave an immutable checkpoint without advancing the ref.
Full product hydration remains corpus-sized. The complete managed update loop and
provider operating limits require further qualification.

### Selected construction sources

`[ACTIVE-WORK]` The unpublished kernel exports
`openProductSourceContext(options)`. It checks the current artifact binding,
protected history, map and complete catalog without hydrating every source
pack. Its `readSource(sourceRef)` resolves only a catalog member, reads that
whole document, verifies its hash and UTF-8, and checks every attached native
field against those bytes. A context describes one checked immutable cut;
it does not keep a mutable branch current after opening.

Construction compile/rebind, review, construction Admission and standalone
construction-ledger reads open this context internally. Their public inputs
remain artifact options, not caller-supplied validation receipts. Review checks
its source-text budget before reading payload and includes complete cited
documents. Source-reading failures fail the entire ledger operation.

This is selected-document validation, not a whole-Corpus audit. Full product
opening and whole-Ont checks still validate all source bytes. Protected
Admission still checks every parent object's availability and metadata.
The file Adapter validates an entire JSON/base64 envelope even for a range or
head operation; native GCS ranges need only return the selected bytes. Thus
unrelated pack damage can affect these operations differently. Map and catalog
work remains whole-index, and the map can itself contain large source fields.
No total memory, latency or hosted-cost bound follows from a small range read.

## Managed storage

Named hosted Onts, tenant isolation, API keys, IAM automation, interrupted-write
recovery, garbage collection, quotas, and managed Turbopuffer projections are
not part of `0.3.0-alpha.3`.
