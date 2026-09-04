# Contributing

OpenOntology welcomes focused bug fixes, tests, documentation improvements, and
Adapters that preserve the product invariants.

Starting with `0.3.0-alpha.2`, this public repository is the canonical source
for product code. Internal research can propose changes through the same review
path, but it does not overwrite public contributions or release history.

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

```text
bin/       CLI entrypoint
src/       product Modules and storage Adapters
scripts/   CLI implementations and executable tests
examples/  deterministic public fixtures
docs/      current public architecture and provider guides
```

Historical research, model traces, private corpora, and generated evaluation
results do not belong in this repository.

## Working agreement

1. Start from an issue for behavior changes larger than a small bug fix.
2. Keep the public query vocabulary fixed: `verify`, `search`, `read`, `check`,
   and `status`.
3. Keep navigation separate from exact Evidence and proof.
4. Add or update a test at the same interface callers use.
5. Do not introduce an Adapter seam until at least two implementations vary.
6. Do not commit credentials, customer data, model traces, or generated results.
7. Keep pull requests small enough to review as one decision.

## Tests

Run the focused product suite:

```bash
npm test
```

Run the installed-package and release gates:

```bash
npm run release:check
```

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

Maintainers cut prereleases from a clean public source commit. The Git tag,
source commit, package file inventory, package SHA-256, and GitHub release asset
must correspond exactly.
