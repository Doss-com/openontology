# OpenOntology

OpenOntology is a factual context compiler for agents. Retrieval finds plausible
material. An Ont resolves identity, chronology, authority, and required proof.
The Corpus supplies exact bytes. OpenOntology returns compact verified context
or a typed refusal.

```text
retrieval proposes -> Ont cross-walks and verifies -> exact Evidence supports
```

Status: `0.3.0-alpha.2` is a developer alpha. It is suitable for local
experimentation with explicit Adapter input. It is not a managed hosted service.

Technical references: [Architecture](docs/ARCHITECTURE.md),
[Storage](docs/STORAGE.md), and [Glossary](GLOSSARY.md).

## Install

OpenOntology requires Node.js 24 or newer.

```bash
npm install --global \
  https://github.com/Doss-com/openontology/releases/download/v0.3.0-alpha.2/oont-0.3.0-alpha.2.tgz
```

The package and command are both named `oont`.
GitHub prerelease packages are built with an attached provenance attestation.
`SOURCE-MANIFEST.json` binds the complete public file inventory. The release tag
and GitHub attestation bind that source state to the package tarball.

To verify a downloaded prerelease before installing it:

```bash
sha256sum -c SHA256SUMS
gh attestation verify oont-0.3.0-alpha.2.tgz \
  --repo Doss-com/openontology
```

## Two-minute quickstart

Build a small Ont from the included deterministic Adapter input:

```bash
oont resolver build examples/quickstart/source-native-input.json \
  --out ./verified-context
```

Verify a question against it:

```bash
oont verify ./verified-context \
  'What is the current title of task-1?'
```

OpenOntology returns a JSON Verification. A successful result contains exact
context and proof receipts. An ambiguous, unsupported, or incomplete question
returns a typed refusal instead of a guessed answer.

## JavaScript

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

The public client has four methods:

```ts
interface OpenOntologyClientV2 {
  verify(query: string | VerifyInput): Promise<Verification>
  search(query: string | SearchInput): Promise<SearchResult>
  read(ref: string | { ref: string }): Promise<ReadResult>
  status(): OntStatus
}
```

`verify` is the ordinary path. It searches, runs internal Resolvers, performs
the required exact reads, and closes the proof obligations.

`verify` answers a question against one Ont. `check` validates the Ont itself.

`search` and `read` are the advanced path. Search returns navigation References,
not Evidence. Read accepts a request-local Reference and returns exact authorized
bytes with a receipt.

## CLI

The public query and integrity operations are:

```text
oont verify <ont> <question>        proof-complete context or typed refusal
oont search <ont> <question>        candidate navigation References
oont search <ont> <question> --read navigation plus exact request-local reads
oont check <ont>                    active Ont integrity validation
oont status <ont>                   recorded state without recomputation
oont serve <ont> --mcp              one-tool MCP server exposing verify
```

Advanced MCP exposes exactly `search` and `read`:

```bash
oont serve ./verified-context --mcp --advanced
```

Run `oont --help` for the complete public CLI. The private research compiler
and its customer-specific compatibility commands are intentionally absent from
this package.

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

Scope narrows authority. It cannot make missing proof answerable.

## Storage

The local canonical object backend is the default and works offline. GCS is the
first distributed backend:

```bash
export OONT_GCS_ACCESS_TOKEN="$(gcloud auth application-default print-access-token)"

oont resolver build examples/quickstart/source-native-input.json \
  --out ./verified-context \
  --backend gs://your-ontology-bucket
```

GCS uses native object generations for immutable writes, range reads, and
compare-and-swap refs. Credentials are read from the environment and are never
embedded in backend URIs.

S3-compatible storage is available as an experimental Adapter. Hosted accounts,
tenant isolation, IAM policy, lifecycle management, garbage collection, and a
managed Turbopuffer projection are not part of this alpha.

See [Storage](docs/STORAGE.md) for the provider contract and qualification path.

## Architecture

OpenOntology keeps four roles separate:

1. Terrain remains authoritative.
2. Resolvers propose candidate References or typed refusals.
3. An Ont cross-walks identity, chronology, and typed relationships.
4. Only exact authorized Corpus bytes can support a material claim.

The implemented alpha path is:

```text
Adapter input -> immutable Corpus and Ont -> Resolver -> Verification
```

See [Architecture](docs/ARCHITECTURE.md) and [Glossary](GLOSSARY.md).

## Alpha limitations

- Build input is explicit deterministic Adapter output. Automatic production
  connectors do not ship yet.
- The source-native preview verifies declared fields, identity, chronology, and
  exact Evidence. It is not a general answer generator.
- Persisted alpha artifacts are not an in-place upgrade contract. Keep the
  Adapter input and rebuild into a new target directory after an upgrade.
- Canonical source state and the ordinary SDK, CLI, and MCP query paths are
  read-only. Learning capture, independent review, and policy activation belong
  to a separately developed operator control plane. Its source and API are not
  part of this public alpha.
- The earlier research compiler and classic Ont server do not ship in this
  public alpha. They remain in the private evidence workbench until their
  customer-derived annotations and assumptions are removed.
- A typed refusal is a valid integrity result, not a transport failure.

## Develop

```bash
git clone https://github.com/Doss-com/openontology.git
cd openontology
npm ci
npm test
```

Before opening a pull request:

```bash
npm run release:check
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) for repository structure, tests, and
review expectations. Security issues belong in a private GitHub security
advisory, not a public issue. See [SECURITY.md](SECURITY.md).

## Support

Use GitHub Issues for reproducible bugs and focused proposals. Include the
package version, Node.js version, failing command, typed error code, and a
minimal synthetic reproduction. Do not post credentials, private source bytes,
customer data, or real Ont artifacts.

## License

Apache-2.0. See [LICENSE](LICENSE).
