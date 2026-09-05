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

## Managed storage

Named hosted Onts, tenant isolation, API keys, IAM automation, interrupted-write
recovery, garbage collection, quotas, and managed Turbopuffer projections are
not part of `0.3.0-alpha.3`.
