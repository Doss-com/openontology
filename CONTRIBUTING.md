# Contributing

Contributions should solve a specific bug, usability problem or missing behavior.
Include a reproduction or example that shows the change.

This repository is the source of the `oont` engine package. Managed applications
consume versioned releases through the exported package interfaces; their
runtime, deployment, account, billing and operational files stay in a separate
private repository.

## Setup

Requirements:

- Node.js 24 or newer
- npm 11 or newer

```bash
git clone https://github.com/Doss-com/openontology.git
cd openontology
npm ci
npm test
```

## Repository structure

| Location | Contents |
| --- | --- |
| [src/openontology.ts](src/openontology.ts), [src/kernel.ts](src/kernel.ts) | Public SDK and kernel exports. |
| [src/cli/](src/cli/) | CLI entrypoint and command handling. |
| [src/product/](src/product/) | Query runtime and MCP transport. |
| [src/source/](src/source/) | Source maps, identity census, publication and snapshot opening. |
| [src/query/](src/query/) | Planning, retrieval, field resolution and source-bound verification. |
| [src/proof/](src/proof/) | Proof contracts, authority projections and evaluation. |
| [src/ledger/](src/ledger/) | Admission authentication and reviewed knowledge reuse. |
| [src/construction/](src/construction/) | Concept construction, review, Admission, navigation and exploration. |
| [src/storage/](src/storage/) | Object store, history and backend Adapters. |
| [test/](test/) | Tests grouped by the source area they exercise. |
| [scripts/](scripts/) | Build, release and provider-qualification tools. |
| [examples/quickstart/](examples/quickstart/) | Runnable examples and synthetic source input. |
| [docs/](docs/) | Query, architecture, lifecycle and storage guides. |

All production source, including the CLI, uses `.ts`. `npm run build` compiles
`src/` to ESM `.js`, `.d.ts` declarations and source maps under `dist/`.
`package.json` declares `"type": "module"`; NodeNext keeps imports compatible
with Node. Tests and build tools use JavaScript; they are not duplicate runtime implementations.
`dist/`, `node_modules/` and package archives are generated and ignored.

Tests use `test/<area>/*.test.mjs`. Run one file after a build with
`node --test test/query/field-resolution.test.mjs`, or use `npm test` for the full suite.

Keep private corpora, credentials, model traces, research results and hosted
operations out of this repository. Reusable engine fixes belong here; a managed
consumer upgrades by pinning a new public release, not copying source.

## Working agreement

1. Start from an issue for behavior changes larger than a small bug fix.
2. Keep the public query vocabulary fixed: `verify`, `search`, `read`, `check`,
   and `status`.
3. Keep navigation separate from exact Evidence and proof.
4. Add or update a test at the same interface callers use.
5. Do not introduce an Adapter seam until at least two implementations vary.
6. Do not commit credentials, customer data, model traces, or generated results.
7. Keep pull requests small enough to review as one decision.

Prefer direct control flow and names that explain the operation. Comments should
explain a constraint or a surprising decision, not restate the next line. In
documentation, lead with a working example, keep paragraphs short, and describe
limitations in plain language without project-status labels.

## Tests

Type-check and build the canonical TypeScript source:

```bash
npm run typecheck
npm run build
```

Run the product and kernel tests:

```bash
npm test
```

Run the installed-package and release gates:

```bash
npm run release:check
```

TypeScript and Node type versions are pinned in `package.json`. When updating
them, keep the Node 24 runtime floor and Node 24/26 CI checks passing.

GCS qualification is optional and credentialed:

```bash
npm run qualify:gcs-object-storage
```

## Commit and pull request style

Use an imperative subject that states the outcome, for example:

```text
Refuse ambiguous source-native identities
```

The pull request should explain the decision, the tradeoff, the verification,
and any intentionally deferred work. Avoid generated summaries of every changed
line.

## Releases

After editing tracked source or documentation, refresh the source inventory
before running the release checks:

```bash
npm run manifest:update
npm run release:check
npm pack
```

Stage any new source files before updating the manifest. It records tracked
paths and hashes; generated packages and `dist/` must remain untracked. A local
pack uses the checkout's package version but is not a published release.

Published prereleases have a tag, package archive, `SHA256SUMS` and a GitHub
attestation. Download the archive and checksum file from the same release, then
verify them before installation:

```bash
shasum -a 256 -c SHA256SUMS
gh attestation verify ./oont-0.3.0-alpha.3.tgz --repo Doss-com/openontology
```

The source inventory, release checksums and attestation are release metadata,
not files inside the npm archive. A locally packed archive has no GitHub release
attestation; use `shasum -a 256 ./oont-0.3.0-alpha.3.tgz` to record its identity.
