# OpenOntology

OpenOntology is a factual context compiler for agents. Retrieval finds plausible
material. An Ont resolves identity, chronology, authority, and required proof.
The Corpus supplies exact bytes. OpenOntology returns compact verified context
or a typed refusal.

```text
retrieval proposes -> Ont cross-walks and verifies -> exact Evidence supports
```

[ACTIVE-WORK] This is an unpublished development checkout targeting the next
release. Its package metadata still reads `0.3.0-alpha.3`; use the source revision
and tarball checksum to identify a development build. It is suitable for local
experimentation with explicit Adapter input, not a managed hosted service.

Start with [The life of context in an Ont](docs/CONTEXT-LIFECYCLE.md), a
`ClickupTask` walkthrough from source observation to verified context and reviewed reuse.

Technical references: [Architecture](docs/ARCHITECTURE.md),
[Storage](docs/STORAGE.md), and [Glossary](GLOSSARY.md).

## Install

OpenOntology requires Node.js 24 or newer.

Build and check this development checkout before packing it:

```bash
npm ci
npm run release:check
npm pack
```

Then install the resulting tarball from your application's directory:

```bash
npm install /path/to/openontology/oont-0.3.0-alpha.3.tgz
```

The package and command are both named `oont`.
The GitHub release workflow attaches a provenance attestation to its packages.
`SOURCE-MANIFEST.json` binds the complete public file inventory. The release tag
and GitHub attestation bind that source state to the package tarball.

For a downloaded, published prerelease, verify its checksum and attestation
before installation. A locally packed development build has no GitHub release
attestation:

```bash
sha256sum -c SHA256SUMS
gh attestation verify ./downloaded-package.tgz \
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

For an executable walkthrough that publishes a successor source cut and handles
stale opening, see [Source input and updates](docs/SOURCE-LIFECYCLE.md), including
the [Authoring Adapter input reference](docs/SOURCE-LIFECYCLE.md#authoring-adapter-input).
It uses the installed package offline and leaves its synthetic Onts in a new
directory for inspection. Input remains explicit Adapter output, not automatic
ingestion.

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
not Evidence. Read accepts a Reference offered by the same open client and
returns exact authorized bytes with a receipt. Wait for the search response
before passing one of its References to `read`. This applies to advanced MCP
too: do not guess a Reference or send a dependent read before search returns.
Independent reads of already-issued References can run concurrently.

### Managed extension Interface

`oont/kernel` is the bounded extension subpath for managed and research runtimes
that attach a governed lifecycle Adapter. Ordinary applications should use the
root `oont` client. TypeScript extension authors compile against the supported
Node 24 type surface.

This checkout's kernel exposes product opening, exact source inspection,
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
compiler is implemented and tamper-tested. Counterevidence can carry typed
`qualifies` and `contradicts` relations to proposition identities in the same
namespace; the proof evaluator closes the exact relation census before it
returns a qualified or contradicted disposition. Ordinary root `verify` uses a
selected current field as the proof root, expands its inbound counterevidence
closure, reopens every exact Corpus span, and exposes the resulting proof
disposition. Action, change, outcome, and state roots are supported. Broader
semantic question planning remains active work. Ordinary semantic closure is
bounded to 64 exact Evidence references and 64 KiB of exact Evidence. A larger
closure returns `unavailable-semantic-proof-context-budget` with observed and
allowed counts. It never returns a partial proof.

`[ACTIVE-WORK]` The post-alpha kernel branch also contains a source-native
admitted-knowledge path. A proposer and an independent reviewer sign one
content-bound proof bundle using role-scoped Ed25519 keys. A cold reader accepts
it only for the identical Ont, source cut, resolved query and answer revision,
proof contract, and authority census. For native semantic queries, the writer
and cold reader reconstruct that census from the selected source field; valid
signatures cannot authorize removing counterevidence or changing its semantics.
The contract must also retain the selected family's required answer obligation,
linked exact support, and complete invalidator coverage. Renamed obligation IDs
and compatible stricter requirements are allowed; an optional answer is not.
Every Evidence reference is checked
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
One successful ordinary semantic Verification can compile its exact query
binding, proof contract, authority census, propositions, relations, and
evaluation into the bundle this path accepts. Independent review and Admission
remain separate steps.
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

Start a verification call with only `question`:

```json
{ "question": "What is the current title of task-1?" }
```

Optional selectors narrow the request; they are not fields to fill by guessing.
Use `scope` only with exact declared source-system, object-type and field names.
If a result returns `availableFields`, it lists those names for the bound Ont.
A scope mismatch is not proof that the object is absent.

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

Scope narrows authority. It cannot make missing proof answerable. Its names are
case-sensitive, so `clickup` and `ClickUp` are not interchangeable. Omit scope
when you do not know the declared profile. If the question names a native object
ID, it must agree with `scope.externalId`; a different known ID returns
`unavailable-native-multiple-object-identifiers` with no context. Scope can fill
in an unspecified object profile or field, or select among matching declared
aliases. It cannot override a recognized different profile or field. Those
conflicts return the corresponding object-type or field ambiguity refusal.
This agreement check uses your declared aliases, not general language reasoning.

An opaque ID alone may not identify an object type. If your Adapter declares
`task` objects with IDs such as `W-17`, ask for "the current title of task W-17"
or provide the exact scope:

```js
await ont.verify({
  question: 'What is the current title of W-17?',
  scope: {
    sourceSystem: 'tracker',
    objectType: 'task',
    externalId: 'W-17',
    field: 'title',
  },
})
```

Without a declared object type, this request returns
`unavailable-native-object-type-not-declared`, not an absence finding.

### Declared titles

`[ACTIVE-WORK]` In the unreleased checkout, a source Adapter that declares
complete `title` coverage can also identify an object by a quoted name:

```js
await ont.verify('What is the current status of the task titled "Release review"?')
```

Use one `titled "..."` or `named "..."` clause. Matching normalizes Unicode,
case and whitespace, but preserves punctuation. Body mentions do not count.
Unknown names, duplicate names on different identities, incomplete title
coverage and conflicting explicit IDs return no context. An optional leading
`For <namespace>,` must match the opened Ont's namespace.

Recorded titles are aliases over the bound source snapshot. An earlier name
can identify the same object; the requested field still follows current or
explicit historical chronology. Name matching never replaces exact Evidence.

## Temporal intent

`current` is the default intent. OpenOntology does not silently infer a
historical operation from question wording. A question that asks about a prior
value, a date, a change, or relative ordering without a supported intent returns
`unavailable-native-temporal-intent-not-declared` with `answerable: false`.

`next` selects the field revision that immediately followed an exact anchor
value.

```bash
npx oont verify ./verified-context \
  'What title immediately followed Prepare launch for task-1?' \
  --intent next
```

`[ACTIVE-WORK]` The unreleased checkout also supports a point-in-time query:

```js
await ont.verify({
  question: 'What was the title of task-1?',
  at: '2026-01-15T00:00:00.000Z',
})
```

The CLI takes the same timestamp with `--at`; MCP takes `at` on `verify` or the
ordinary-question form of advanced `search`. Use an exact UTC ISO timestamp with milliseconds. Do not
combine it with `intent: next` or an anchor value.

For `intent: next`, optional `anchorValue` is the previous recorded field value,
such as `Prepare launch`, not the object's ID. It can be omitted when that
value is already in the question. Current queries ignore `anchorValue`.
Omit both temporal selectors for an ordinary
current-value query; never substitute an invented timestamp.

An `at` query selects what was valid at that instant within the bound source snapshot,
including later-learned corrections. It does not reconstruct what was known
then. Missing `validAt` falls back to the source observation time. Requests
beyond the snapshot's observation horizon, before the first valid value, or
with unresolved chronology return no context. Semantic counterevidence and
admitted reuse are bound to the same requested time. The chronology receipt
reports the source horizon, selected valid and known times, and fallback count.

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
- The canonical hash wire-parity correction may change identifiers for persisted
  JSON objects with integer-index keys. An old artifact may refuse with
  `SOURCE_NATIVE_MAP`; preserve its old runtime, storage, and Adapter input,
  then rebuild into a new target directory. There is no in-place migration or
  signed-knowledge transfer.
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

Read [CONTRIBUTING.md](https://github.com/Doss-com/openontology/blob/main/CONTRIBUTING.md) for repository structure, tests, and
review expectations. Security issues belong in a private GitHub security
advisory, not a public issue. See [SECURITY.md](https://github.com/Doss-com/openontology/blob/main/SECURITY.md).

## Support

Use GitHub Issues for reproducible bugs and focused proposals. Include the
package version, Node.js version, failing command, typed error code, and a
minimal synthetic reproduction. Do not post credentials, private source bytes,
customer data, or real Ont artifacts.

## License

Apache-2.0. See [LICENSE](LICENSE).
