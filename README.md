# OpenOntology

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

Start with [The life of context in an Ont](docs/CONTEXT-LIFECYCLE.md), a
`ClickupTask` walkthrough from source observation to verified context and reviewed reuse.

Technical references: [Architecture](docs/ARCHITECTURE.md),
[Storage](docs/STORAGE.md), and [Glossary](GLOSSARY.md).

## Install

Requires Node.js 24 or newer. Install the published package from your application
directory:

```bash
npm install https://github.com/Doss-com/openontology/releases/download/v0.3.0-alpha.3/oont-0.3.0-alpha.3.tgz
```

The package and command are both named `oont`. Distribution is through GitHub
release assets; plain `npm install oont` is not available yet. Each release
includes checksums and a package attestation. See [release
verification](CONTRIBUTING.md#releases) or [Develop](#develop) to build from source.

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

The root client exposes:

```ts
interface OpenOntologyProduct {
  verify(query: string | OpenOntologyQueryInput): Promise<OpenOntologyVerificationResult>
  search(query: string | OpenOntologyQueryInput): Promise<OpenOntologySearchResult>
  read(ref: string | { ref: string }): Promise<OpenOntologyReadResult>
  status(): OpenOntologyStatus
}
```

The engine and CLI are written in strict TypeScript (`.mts`). Builds produce
JavaScript ESM (`.mjs`), type declarations and source maps in `dist/`. That output
is packaged but not committed. There is one runtime implementation and one
`oont` package for both TypeScript and JavaScript users. CommonJS is not supported.

Tests, build scripts and examples still use JavaScript. They account for the
JavaScript shown in the repository, not a second engine or an unfinished
production-source migration.

`verify` is the ordinary path. It searches, runs internal Resolvers, performs
the required exact reads, and closes the proof obligations.

Results describe the bound source snapshot. A current-field result requires
complete, unambiguous recorded chronology. An exact typed identity absent from a
complete catalog can receive an absence receipt with `answerable: false` and no
context. Neither result claims knowledge beyond that source scope.

`verify` answers a question against one Ont. `check` validates the Ont itself.

`search` returns candidate References. Pass one to `read` on the same open
client to inspect its source text and receipt. Wait for search to return; do not
invent handles. Reads of already-issued References can run concurrently.

### Managed extension Interface

`oont/kernel` exposes the engine operations needed by storage Adapters and
managed applications: source publication, protected history, semantic
construction, independent Admission and reviewed knowledge reuse. These exports
ship in alpha.3. Ordinary applications should use the root `oont` client.

Managed applications own authentication, source scheduling, model workers,
billing and deployment in their own private repository and infrastructure.
They should import an exact published `oont` release, record its integrity, and
upgrade explicitly rather than copying engine source or following a moving Git
branch. `oont/kernel` provides reusable engine operations, not the hosted control
plane.

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

The stdio server writes its startup status JSON to stderr before serving
requests. Parse stdout for JSON-RPC protocol messages; treat stderr as
diagnostics.

Start a verification call with only `question`:

```json
{ "question": "What is the current title of task-1?" }
```

Optional `scope` uses the exact declared source-system, object-type and field
names. Results can return `availableFields` to help discover them.

Run `npx --no-install oont --help` or
`npx --no-install oont <command> --help` for options.

`check` and `status` reject corrupt storage or invalid descriptors. Neither
refreshes the original source or rebuilds the Ont.

## Typed scope

Natural language can be narrowed with an explicit source scope:

```bash
oont verify ./verified-context \
  'What is the current title?' \
  --source-system tracker \
  --object-type task \
  --external-id task-1 \
  --field title
```

Scope names are case-sensitive and must match the Adapter schema. An explicit
ID in the question must agree with `scope.externalId`. A conflicting profile,
field or ID returns a refusal. If an opaque ID does not reveal its object type,
include the type in the question or provide the scope shown above.

Identity comes from the complete scoped map, not the highest-ranked search hit.

### Declared titles

A source Adapter with complete `title` coverage can also identify an object by
a quoted name:

```js
await ont.verify('What is the current status of the task titled "Release review"?')
```

Use one `titled "..."` or `named "..."` clause. Matching normalizes Unicode,
case and whitespace, while preserving punctuation. Unknown or ambiguous names,
incomplete coverage and conflicting IDs return no context. Recorded titles can
identify an object across revisions; the requested value still follows chronology.

## Temporal intent

`current` is the default intent. OpenOntology does not silently infer a
historical operation from question wording. A question that asks about a prior
value, a date, a change, or relative ordering without a supported intent returns
`unavailable-native-temporal-intent-not-declared` with `answerable: false`.

`next` selects the field revision that immediately followed an exact anchor
value.

```bash
npx --no-install oont verify ./verified-context \
  'What title immediately followed Prepare launch for task-1?' \
  --intent next
```

For a point-in-time query:

```js
await ont.verify({
  question: 'What was the title of task-1?',
  at: '2026-01-15T00:00:00.000Z',
})
```

The CLI uses `--at`; MCP uses `at`. Supply a UTC ISO timestamp with milliseconds.
Do not combine `at` with `intent: next` or `anchorValue`. For `next`, the optional
`anchorValue` is the previous field value, not the object's ID. Omit both
selectors for current-value questions.

An `at` query selects what was valid within the source snapshot, including
later-learned corrections. It does not reconstruct what was known then. Missing
`validAt` falls back to observation time. Requests outside the recorded horizon
or with unresolved chronology return no context. See [Architecture](docs/ARCHITECTURE.md)
for temporal and counterevidence rules.

All result states are exported as `OpenOntologyResultState`. States beginning
with `unavailable-` are normal typed refusals, not transport failures.

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

See [Architecture](docs/ARCHITECTURE.md) and [Glossary](GLOSSARY.md).

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

See [Contributing](CONTRIBUTING.md) for setup, repository structure, tests and
release checks. Production source is TypeScript; JavaScript tests exercise the
compiled package. Keep generated output and private deployment code out of Git.

## Support

Use GitHub Issues for reproducible bugs and focused proposals. Include the
package version, Node.js version, failing command, typed error code, and a
minimal synthetic reproduction. Do not post credentials, private source bytes,
customer data, or real Ont artifacts.

## License

Apache-2.0. See [LICENSE](LICENSE).
