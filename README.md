# OpenOntology

OpenOntology is a factual context compiler for agents. Retrieval finds plausible
material. An Ont resolves identity, chronology, authority, and required proof.
The Corpus supplies exact bytes. OpenOntology returns compact verified context
or a typed refusal.

```text
retrieval proposes -> Ont cross-walks and verifies -> exact Evidence supports
```

Status: `0.3.0-alpha.3` is a developer alpha. It is suitable for local
experimentation with explicit Adapter input. It is not a managed hosted service.

Technical references: [Architecture](docs/ARCHITECTURE.md),
[Storage](docs/STORAGE.md), and [Glossary](GLOSSARY.md).

## Install

OpenOntology requires Node.js 24 or newer.

```bash
npm install \
  https://github.com/Doss-com/openontology/releases/download/v0.3.0-alpha.3/oont-0.3.0-alpha.3.tgz
```

The package and command are both named `oont`.
GitHub prerelease packages are built with an attached provenance attestation.
`SOURCE-MANIFEST.json` binds the complete public file inventory. The release tag
and GitHub attestation bind that source state to the package tarball.

To verify a downloaded prerelease before installing it:

```bash
sha256sum -c SHA256SUMS
gh attestation verify oont-0.3.0-alpha.3.tgz \
  --repo Doss-com/openontology
```

## Two-minute quickstart

Build a small Ont from the included deterministic Adapter input:

```bash
npx oont resolver build ./node_modules/oont/examples/quickstart/source-native-input.json \
  --out ./verified-context
```

Verify a question against it:

```bash
npx oont verify ./verified-context \
  'What is the current title of task-1?'
```

OpenOntology returns a JSON Verification. A successful result contains exact
context and proof receipts. An ambiguous, unsupported, or incomplete question
returns a typed refusal instead of a guessed answer.

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

The public client and result types are exported under these names:

```ts
interface OpenOntologyProduct {
  verify(query: string | OpenOntologyQueryInput): Promise<OpenOntologyVerificationResult>
  search(query: string | OpenOntologyQueryInput): Promise<OpenOntologySearchResult>
  read(ref: string | { ref: string }): Promise<OpenOntologyReadResult>
  status(): OpenOntologyStatus
}
```

The canonical package source is strict TypeScript. The package ships
dependency-free ESM, declarations, declaration maps, and source maps, so both
TypeScript and JavaScript consumers use the same runtime implementation.
CommonJS `require('oont')` is not supported.

`verify` is the ordinary path. It searches, runs internal Resolvers, performs
the required exact reads, and closes the proof obligations.

`[ACTIVE-WORK]` For a current-field result, Verification also binds the stable identity's
complete recorded chronology to the source commit, replay, catalog, and mapped
source count. A missing source, adapter failure, or ambiguous latest value
returns `unavailable-incomplete-recorded-field-chronology`. This proves the
latest recorded value in the named source cut, not universal current state.

`[ACTIVE-WORK]` An exact typed identity that does not occur in a complete,
failure-free source catalog returns
`verified-native-object-absent-from-bound-source-catalog`. The Verification is
not answerable and contains no Evidence. Its hashed absence receipt binds the
identity, complete identity census, source catalog, source-handle set, and
source count. The receipt explicitly does not authorize a claim of world-wide
absence. The complete census resolves this case before retrieval. Any adapter
failure disables the certification and preserves the ordinary retrieval path.

`verify` answers a question against one Ont. `check` validates the Ont itself.

`search` and `read` are the advanced path. Search returns navigation References,
not Evidence. Read accepts a request-local Reference and returns exact authorized
bytes with a receipt.

### Managed extension Interface

`oont/kernel` is the bounded extension subpath for managed and research runtimes
that attach a governed lifecycle Adapter. Ordinary applications should use the
root `oont` client. TypeScript extension authors compile against the supported
Node 24 type surface.

The published alpha.3 kernel exposes product opening, exact source inspection,
canonical object replay, hashing, and deterministic proof-sufficiency
evaluation.

`[ACTIVE-WORK]` The post-alpha kernel adds the source-agnostic current-field
chronology compiler used by the ordinary Verification path.

`[ACTIVE-WORK]` The same ordinary path now compiles a complete, query-independent
native-object identity census at safe open. The current-field Resolver can use
that census to distinguish a proven catalog-scoped absence from an ordinary
retrieval miss.

`[ACTIVE-WORK]` The post-alpha kernel also compiles deterministic source-native
canonical proposition V2 records into the existing ProofAuthorityProjection.
The record keeps canonical roles, modality, polarity, actor identity, valid and
known time, and its exact source span in one source-native map. This projection
compiler is implemented and tamper-tested. Typed relations and ordinary root
`verify` integration remain active work.

`[ACTIVE-WORK]` The post-alpha kernel branch also contains a source-native
admitted-knowledge path. A proposer and an independent reviewer sign one
content-bound proof bundle using role-scoped Ed25519 keys. A cold reader accepts
it only for the identical Ont, source cut, resolved query and answer revision,
proof contract, and authority census. Every Evidence reference is checked
against Corpus bytes when admitted, every included proposition must participate
in a required proof obligation, and every returned role is derived from that
obligation. Exact bytes are reopened before reuse. Returned bindings contain
fixed content hashes instead of proposer-authored semantic labels. Repeated
proposition citations over the same role and Evidence span return one bound
Proof unit. Reusable context is limited to 64 Proof units and 64 KiB of Exact
Evidence, plus 64 KiB of JSON-encoded Evidence text, including a `next` anchor.
Larger proofs are refused without truncation. Exact Evidence spans must also
round-trip through UTF-8 without changing their bound bytes. A `next`
Verification returns the successor as `answer` and its inspected historical
revision as `anchor`.
Untrusted or invalid records are skipped in favor of ordinary verification.
Conflicting valid bundles produce a typed refusal. Default knowledge branches
are isolated by immutable source commit. This kernel-only path is not exposed
by the root client and has not been published as an alpha.3 capability.

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

Run `npx oont --help` for the command list and
`npx oont <command> --help` for command-specific options. The private research
compiler and its customer-specific compatibility commands are intentionally
absent from this package.

Both `check` and `status` fail closed if safe opening detects corrupt storage or
an invalid artifact. `check` emits a compact assertion-shaped receipt for
automation. `status` emits the recorded diagnostic metadata. Neither operation
rereads Terrain or rebuilds the Ont.

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

## Temporal intent

`current` is the default intent. OpenOntology does not silently infer a
historical operation from question wording. A question that asks about a prior
value, a date, a change, or relative ordering without a supported intent returns
`unavailable-native-temporal-intent-not-declared` with `answerable: false`.

The alpha supports one explicit historical operation: the field revision that
immediately followed an exact anchor value.

```bash
npx oont verify ./verified-context \
  'What title immediately followed Prepare launch for task-1?' \
  --intent next
```

All result states are exported as `OpenOntologyResultState`. States beginning
with `unavailable-` are normal typed refusals, not transport failures.

## Storage

The local canonical object backend is the default and works offline. GCS is the
first distributed backend:

```bash
export OONT_GCS_ACCESS_TOKEN="$(gcloud auth application-default print-access-token)"

npx oont resolver build ./node_modules/oont/examples/quickstart/source-native-input.json \
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
npm run typecheck
npm test
```

Before opening a pull request:

```bash
npm run release:check
```

Read [CONTRIBUTING.md](https://github.com/Doss-com/openontology/blob/v0.3.0-alpha.3/CONTRIBUTING.md) for repository structure, tests, and
review expectations. Security issues belong in a private GitHub security
advisory, not a public issue. See [SECURITY.md](https://github.com/Doss-com/openontology/blob/v0.3.0-alpha.3/SECURITY.md).

## Support

Use GitHub Issues for reproducible bugs and focused proposals. Include the
package version, Node.js version, failing command, typed error code, and a
minimal synthetic reproduction. Do not post credentials, private source bytes,
customer data, or real Ont artifacts.

## License

Apache-2.0. See [LICENSE](LICENSE).
