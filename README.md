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
  <a href="#documentation">Documentation</a> ·
  <a href="https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md">Contributing</a>
</p>

OpenOntology builds a typed map of source material and uses it to return
verified context to agents. It resolves identities, checks recorded chronology
and counterevidence, and returns the supporting source text. Questions without
sufficient evidence receive a structured refusal.

```text
source observations -> Ont -> search, inspect and verify -> agent context
```

The current release is [0.3.0-alpha.3](https://github.com/Doss-com/openontology/releases/tag/v0.3.0-alpha.3).
This repository contains the open-source engine, CLI, SDK and MCP server.
Hosted deployment and operation belong in a separate managed application.

## Install

Requires Node.js 24 or newer. Install the published package from your application
directory:

```bash
npm install https://github.com/Doss-com/openontology/releases/download/v0.3.0-alpha.3/oont-0.3.0-alpha.3.tgz
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

To supply data or publish an update, use [Source input and updates](docs/SOURCE-LIFECYCLE.md)
and its [Adapter input reference](docs/SOURCE-LIFECYCLE.md#authoring-adapter-input).

## TypeScript and JavaScript

```js
import { openOntology } from 'oont'

const ont = openOntology({ artifactRoot: './verified-context' })
const result = await ont.verify('What is the current title of task-1?')

if (result.answerable) {
  console.log(result.context)
} else {
  console.log(result.state)
}
```

| Method | Use it to |
| --- | --- |
| `verify(query)` | Get verified source context or a reason it cannot be returned. |
| `search(query)` | Find candidate source References. |
| `read(ref)` | Inspect a Reference returned by the same client. |
| `status()` | Check the opened Ont's metadata and integrity. |

Start with `verify`; use `search` and `read` when you want to inspect candidates
yourself. Results describe the recorded source snapshot, not the live source
system. See [Queries and results](docs/QUERIES.md) for scope, time selectors and
refusal handling.

The package includes TypeScript declarations and has no runtime dependencies.
It uses ESM; CommonJS is not supported. See [Repository structure](https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md#repository-structure)
for the TypeScript source and JavaScript build output.

### Managed extension Interface

`oont/kernel` exposes source publication, protected history, semantic construction
and reviewed knowledge reuse for Adapters and managed applications. These exports
ship in alpha.3; the root `oont` client is read-only.

Managed applications consume pinned package releases and own authentication,
source scheduling, model workers, billing and deployment outside this repository.

See [Architecture](docs/ARCHITECTURE.md) for the contracts and
[the semantic-map example](docs/CONTEXT-LIFECYCLE.md#executable-concept-map) for
construction and reviewed reuse.

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

## Architecture

Adapters describe source observations. The Ont records identities, chronology
and typed relationships. Retrieval proposes candidates; verification checks
their source evidence before returning context.

```text
Adapter input -> immutable Corpus and Ont -> Resolver -> Verification
```

## Documentation

| I want to... | Start here |
| --- | --- |
| Query an Ont and handle the result | [Queries and results](docs/QUERIES.md) |
| Bring in data and publish updates | [Source input and updates](docs/SOURCE-LIFECYCLE.md) |
| Follow one object through the whole system | [The life of context in an Ont](docs/CONTEXT-LIFECYCLE.md) |
| Understand the engine | [Architecture](docs/ARCHITECTURE.md) and [Glossary](GLOSSARY.md) |
| Configure storage or recover a snapshot | [Storage](docs/STORAGE.md) |
| Change the code | [Contributing](https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md) |

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
  is not part of alpha.3.
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
