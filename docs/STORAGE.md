# Storage

OpenOntology stores immutable objects and advances named refs with
compare-and-swap. Storage Adapters do not decide truth, ranking, or proof.

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
Exact reads verify byte length and SHA-256 metadata.

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

The object store offers opt-in checkpoint publication through
`compareAndSwapRefMetadataCheckpointed`. The immutable checkpoint is written
before the ref CAS, and applies only to clean blob-only history. Assertion-bearing
Ledger history still requires full replay. A missing checkpoint falls back to
graph replay; a present invalid checkpoint refuses. Ref-index opening and
resource binding use the checkpoint when present, without treating it as
Evidence or skipping map and catalog validation.

The checkpoint bounds metadata request count as commit history grows, not
checkpoint bytes, memory, query work, or total cost. Ordinary and exact product
opening still use full replay in this implementation. Checkpoint-aware serving
startup and the complete managed update loop require further integration.

## Managed storage

Named hosted Onts, tenant isolation, API keys, IAM automation, interrupted-write
recovery, garbage collection, quotas, and managed Turbopuffer projections are
not part of `0.3.0-alpha.3`.
