<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Doss-com/openontology/main/docs/assets/header-dark.svg">
    <img src="https://raw.githubusercontent.com/Doss-com/openontology/main/docs/assets/header.svg" alt="OpenOntology. Verified context for agents." width="960">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/Doss-com/openontology/actions/workflows/ci.yml"><img src="https://github.com/Doss-com/openontology/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="https://github.com/Doss-com/openontology/releases"><img src="https://img.shields.io/github/v/release/Doss-com/openontology?include_prereleases&amp;label=release&amp;color=4d4d4d" alt="Latest release, including prereleases"></a>
  <a href="https://github.com/Doss-com/openontology/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Doss-com/openontology?color=4d4d4d" alt="Apache-2.0 license"></a>
</p>

<p align="center">
  <a href="#two-minute-quickstart">Quickstart</a> ·
  <a href="#architecture">How it works</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md">Contributing</a>
</p>

OpenOntology builds a typed map of source material and uses it to return
verified context to agents. It resolves identities, checks recorded chronology
and counterevidence, and returns the supporting source text. Questions without
sufficient evidence receive a structured refusal.

```text
source observations → Ont → search, read and verify → agent context
```

The current release is [0.3.0-alpha.4](https://github.com/Doss-com/openontology/releases/tag/v0.3.0-alpha.4).
This repository contains the open-source engine, CLI, SDK and MCP server.
Hosted deployment and operation belong in a separate managed application.

## Install

Requires Node.js 24 or newer. Install the published package from your application
directory:

```bash
npm install https://github.com/Doss-com/openontology/releases/download/v0.3.0-alpha.4/oont-0.3.0-alpha.4.tgz
```

The package and command are both named `oont`. Distribution is through GitHub
release assets; plain `npm install oont` is not available yet. Each release
includes checksums and a package attestation. See [release
verification](https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md#releases)
or [Develop](#develop) to build from source.

## Two-minute quickstart

Build a small Ont from the included deterministic Adapter input:

```bash
npx --no-install oont resolver build ./node_modules/oont/examples/quickstart/source-native-input.json \
  --out ./verified-context
```

Verify a question against it:

```bash
npx --no-install oont verify ./verified-context \
  'What is the current title of task-1?'
```

OpenOntology returns a JSON Verification. A successful result contains exact
context and proof receipts. An ambiguous, unsupported, or incomplete question
returns a typed refusal instead of a guessed answer.

Selected fields from the actual command responses are shown below. Complete
responses include hashes and receipts.

```json
{
  "answerable": true,
  "state": "resolved-current-field",
  "context": [
    {
      "exactText": "Ship verified context",
      "evidence": { "relativePath": "tracker/demo/task-1-v2.txt" }
    }
  ]
}
```

An unsupported question returns a typed refusal:

```bash
npx --no-install oont verify ./verified-context 'Who owns task-1?'
```

```json
{
  "answerable": false,
  "state": "unavailable-native-field-not-declared",
  "availableFields": [{ "sourceSystem": "tracker", "objectType": "task", "fieldPath": "title" }],
  "context": []
}
```

Next step: ask for the declared `title` field, or add and rebuild an `owner`
field in the Adapter input. Do not treat a refusal as a guessed or partial
answer.

## Architecture

The compiler builds a typed crosswalk over source material. Resolvers use it to
find the right identity, follow revisions and check what the sources establish.

```text
Your source Adapter
        │ observations + identities + fields + time
        ↓
Published source cut
        ├── Corpus: preserved source documents
        └── Ont: identities, revisions, relations and source links

Agent question
        │
        ↓
Resolver → Ont traversal → Corpus reads → Verification
                                            ├── context + receipts
                                            └── typed refusal
```

### Map and verify

- The source system (Terrain) remains authoritative. Your Adapter supplies
  captured observations, their identity, declared fields and source locations.
- Corpus preserves those observations. The Ont groups records by their complete
  source-native identity, orders field revisions and links them to source text.
- BM25 finds candidate material. Ont traversal checks it against the complete
  scoped identity map, recorded chronology and declared counterevidence.
- `verify` reads the supporting Corpus spans and checks the proof obligations
  before returning context. A highly ranked search hit is not enough on its own.

In the quickstart, `Prepare launch` and `Ship verified context` are observations
of the same `task-1`. The Ont connects them as field revisions, so a current-title
query selects the latter while a historical query can recover the earlier value.
Both remain linked to their original source text.

### Maps of concepts and reviewed memory

Applications using `oont/kernel` can add concept definitions (`ObjectDef`), scoped
aliases and `mentions` / `defines` Claims that connect source passages. Independent review
and Admission make these maps available for navigation; factual verification
still checks the underlying sources.
See the [semantic-map example](docs/CONTEXT-LIFECYCLE.md#executable-concept-map).

The Ledger stores independently admitted query proofs and construction history.
A later agent with reviewed reuse configured can skip raw retrieval for an
eligible proof, while still rechecking that proof and reading its source Evidence.

Eligibility includes the exact question, typed query and source cut. Corrections
supersede earlier records without erasing their history.

### Updates and storage

A source cut is a fixed version of the observations and their map.
Publication writes immutable objects before the shared head advances with
compare-and-swap, so competing writers cannot silently overwrite one another.

Current queries through an old local descriptor refuse after the source advances;
opening the updated Ont uses the new cut. Prior knowledge does not automatically
become proof for the new sources.

Root SDK, CLI and MCP queries are read-only. The kernel supplies publication,
construction and reviewed-reuse APIs; your application owns source capture,
scheduling and reviewers. See [Storage](#storage) for backend options.

Follow [one object through the lifecycle](docs/CONTEXT-LIFECYCLE.md), or read the
[architecture reference](docs/ARCHITECTURE.md) and [Glossary](GLOSSARY.md).

## First-use recipes

### SDK

```js
import { openOntology } from 'oont';

const ont = openOntology({ artifactRoot: './verified-context' });
const result = await ont.verify('What is the current title of task-1?');

if (result.answerable) {
  console.log(result.context);
} else {
  console.log(result.state);
}
```

### MCP

Start the default stdio server to expose one `verify` tool:

```bash
npx --no-install oont serve ./verified-context --mcp
```

Send `{ "question": "What is the current title of task-1?" }` as the
`verify` tool arguments. See [MCP usage](docs/QUERIES.md#mcp).

### Publish an update

Run the packaged lifecycle example with a new output directory:

```bash
node ./node_modules/oont/examples/quickstart/source-lifecycle.mjs \
  ./source-lifecycle-run
```

The fixture records `Prepare launch` first and `Ship verified context` second,
so the current query returns the second revision. It then publishes
`Keep context current` and reports the old descriptor as
`SOURCE_NATIVE_PRODUCT_REF`. See [Source input and updates](docs/SOURCE-LIFECYCLE.md).

## TypeScript and JavaScript

The [SDK recipe](#sdk) is standard ESM JavaScript and can be saved as an
`.mjs` file and run with Node.js 24 or newer. TypeScript uses the same API.

| Method          | Use it to                                                      |
| --------------- | -------------------------------------------------------------- |
| `verify(query)` | Get verified source context or a reason it cannot be returned. |
| `search(query)` | Find candidate source References.                              |
| `read(ref)`     | Inspect a Reference returned by the same client.               |
| `status()`      | Check the opened Ont's metadata and integrity.                 |

Start with `verify`; use `search` and `read` when you want to inspect candidates
yourself. Results describe the recorded source snapshot, not the live source
system. See [Queries and results](docs/QUERIES.md) for scope, time selectors and
refusal handling.

The package includes TypeScript declarations and has no runtime dependencies.
It uses ESM; CommonJS is not supported. See [Repository structure](https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md#repository-structure)
for the TypeScript source and JavaScript build output.

## CLI

The public query and integrity operations are:

```text
oont verify <ont> <question>        proof-complete context or typed refusal
oont search <ont> <question>        candidate navigation References
oont search <ont> <question> --read navigation plus exact request-local reads
oont check <ont>                    compact integrity assertion for automation
oont status <ont>                   diagnostic snapshot of the validated Ont
oont serve <ont> --mcp              one-tool MCP server exposing verify
```

Advanced MCP exposes exactly `search` and `read`:

```bash
oont serve ./verified-context --mcp --advanced
```

Start a verification call with only `question`:

```json
{ "question": "What is the current title of task-1?" }
```

See [MCP usage](docs/QUERIES.md#mcp) for request options and transport details.

Run `npx --no-install oont --help` or
`npx --no-install oont <command> --help` for options.

`check` and `status` reject corrupt storage or invalid descriptors. Neither
refreshes the original source or rebuilds the Ont.

## Typed scope

Narrow a question with a source system, object type, field and optional native ID.
Scope names must match the Adapter schema. Identity comes from the complete
scoped map, not the highest-ranked search hit. See [Typed scope](docs/QUERIES.md#typed-scope)
for SDK and CLI examples.

### Declared titles

With complete `title` coverage, a question can identify an object using
`titled "..."` or `named "..."`. Ambiguous names return no context.
See [Declared titles](docs/QUERIES.md#declared-titles) for matching rules.

## Temporal intent

Queries use the latest recorded value by default. Use `at` for a point in time
or `intent: next` for the revision after an anchor value. Historical wording
alone does not select a historical operation. See [Temporal intent](docs/QUERIES.md#temporal-intent)
for examples and the recorded-time limits.

## Storage

Local object storage is the default and works offline. GCS is the supported
remote Adapter; S3-compatible storage is experimental. Both use the same
immutable-object and conditional-ref model.

See [Storage](docs/STORAGE.md) for configuration, credentials, protected history
and recovery. Hosted accounts, quotas and deployment policy belong to the
managed application.

## Documentation

| I want to...                               | Start here                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Query an Ont and handle the result         | [Queries and results](docs/QUERIES.md)                                             |
| Bring in data and publish updates          | [Source input and updates](docs/SOURCE-LIFECYCLE.md)                               |
| Follow one object through the whole system | [The life of context in an Ont](docs/CONTEXT-LIFECYCLE.md)                         |
| Understand the engine                      | [Architecture](docs/ARCHITECTURE.md) and [Glossary](GLOSSARY.md)                   |
| Configure storage or recover a snapshot    | [Storage](docs/STORAGE.md)                                                         |
| Change the code                            | [Contributing](https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md) |

## Alpha limitations

- Build input is explicit deterministic Adapter output. Automatic production
  connectors do not ship yet.
- Verification supports declared fields, identities, chronology and typed
  counterevidence. General semantic question planning is not implemented.
- Persisted alpha artifacts are not an in-place upgrade contract. Keep the
  Adapter input and rebuild into a new target directory after an upgrade.
- The canonical hash wire-parity correction may change identifiers for persisted
  JSON objects with integer-index keys. An old artifact may refuse with
  `SOURCE_NATIVE_MAP`; preserve its old runtime, storage, and Adapter input,
  then rebuild into a new target directory. There is no in-place migration or
  signed-knowledge transfer.
- The root SDK, CLI and MCP query paths are read-only. Kernel operations for
  source publication and Admission require explicit operator configuration;
  hosted source refresh and review workers are not included.
- The published root client opens local Ont descriptors. Remote SDK/CLI access
  is not included yet.
- A typed refusal is a valid integrity result, not a transport failure.

## Develop

See [Contributing](https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md) for setup, repository structure, tests and
release checks. Production source is TypeScript; JavaScript tests exercise the
compiled package. Keep generated output and private deployment code out of Git.

## Support

Use GitHub Issues for reproducible bugs and focused proposals. Include the
package version, Node.js version, failing command, typed error code, and a
minimal synthetic reproduction. Do not post credentials, private source bytes,
customer data, or real Ont artifacts.

## License

Apache-2.0. See [LICENSE](LICENSE).
