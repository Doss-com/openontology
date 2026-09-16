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

For an iterative source and test loop, run `npm run dev` once or
`npm run dev:watch` to rebuild and run the Node test suite after changes. The
watch loop cleans and rebuilds `dist/` before every test run, so a failed
compile never executes stale generated output. Stop it with Ctrl-C.

Pass a test file to keep the loop focused:

```bash
npm run dev -- test/query/field-resolution.test.mjs
npm run dev:watch -- test/query/field-resolution.test.mjs
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

Formatting is development-only and does not add runtime dependencies:

```bash
npm run format
npm run format:check
```

The repository uses Prettier with the existing two-space, single-quote and
semicolon style. Do not commit `dist/`, package archives or release output.

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

The release workflow generates a source inventory into the release output and
attaches it beside the package archive and `SHA256SUMS`. It is release
metadata, not a committed source file or npm package entry. A local check is:

```bash
mkdir -p release
node scripts/update-source-manifest.mjs --output release/SOURCE-MANIFEST.json
npm run release:check
npm pack
```

Published releases have an immutable version tag, package archive, `SHA256SUMS`,
source inventory and a GitHub attestation. Download the archive and metadata
from the same release, then verify them before installation:

```bash
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")
shasum -a 256 -c SHA256SUMS
gh attestation verify "./oont-${VERSION}.tgz" --repo Doss-com/openontology
```

The manual `npm-publish.yml` workflow publishes only a reviewed immutable tag.
It requires the `PUBLISH` confirmation, an `npm-release` environment that
repository administrators must configure with the intended reviewers, and npm
trusted-publisher configuration for this repository. It downloads the exact
attested GitHub release archive, then selects the `next` dist-tag for
prereleases and `latest` for stable versions. The archival GitHub release
workflow does not publish to npm.

The first npm publication requires an authorized npm account. Once the package
exists, configure its trusted publisher to use `Doss-com/openontology`, the
`npm-publish.yml` workflow and the `npm-release` environment. Later publications
use GitHub's short-lived identity, not a stored npm token.

A locally packed archive has no GitHub release attestation; use
`shasum -a 256 ./oont-${VERSION}.tgz` to record its identity.
