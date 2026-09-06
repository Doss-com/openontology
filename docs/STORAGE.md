# Storage

OpenOntology stores immutable objects and advances named refs with
compare-and-swap. Storage Adapters do not decide truth, ranking, or proof.

Normal ObjectOnt ref publication is forward-only. An existing branch accepts
its current commit or a descendant, and rejects an ancestor or unrelated fork
with `OBJECT_ONT_REF_ROLLBACK`. Backend version conflicts still govern concurrent
writes. Historical snapshots remain readable without changing current refs.
This rule covers source and admitted-knowledge publication; it does not detect
a direct backend rewrite or restoration of older storage after process restart.

## Local file

The local backend is the default and requires no credentials. Use it for local
development, tests, and offline operation.

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
Source hydration remains corpus-sized. The complete managed update loop and
provider operating limits require further qualification.

## Managed storage

Named hosted Onts, tenant isolation, API keys, IAM automation, interrupted-write
recovery, garbage collection, quotas, and managed Turbopuffer projections are
not part of `0.3.0-alpha.3`.
