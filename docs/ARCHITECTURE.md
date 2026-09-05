# Architecture

OpenOntology separates navigation from proof. Alpha.3 implements the compact
path below.

```text
Adapter input -> immutable Corpus and Ont -> Resolver -> Verification
```

## Implemented modules

1. An Adapter supplies exact source observations, native identities, fields,
   chronology, and query schemas.
2. The Corpus stores immutable exact Evidence in canonical object storage.
3. An Ont records the source cut and typed cross-walk over that Evidence.
4. A Resolver proposes candidate References or a typed refusal.
5. Verification reads exact Evidence and closes the declared proof obligations.
6. The SDK, CLI, and MCP surfaces expose the same query contract.

`[EXISTS]` Current-field Verification compiles a content-addressed chronology
receipt over one stable native identity and field. The receipt binds the source
commit, replay, catalog, complete mapped source count, every identity
observation, the ordered field-revision closure, and the selected exact field.
It is sufficient only when source coverage is complete, adapter failures are
zero, and the latest recorded value is unambiguous. Otherwise the Resolver
returns `unavailable-incomplete-recorded-field-chronology` without Evidence.
The scope is deliberately limited to the latest recorded value in the bound
source cut. It does not claim universal current state.

`[EXISTS]` Safe open also compiles a complete native-object identity census over
the bound source catalog when mapped coverage is complete and adapter failures
are zero. An exact typed identity with zero census occurrences returns
`verified-native-object-absent-from-bound-source-catalog`, no Evidence, and a
hashed absence receipt binding the identity, census, catalog, source-handle
set, and source count. The result remains `answerable: false` because it proves
catalog-scoped absence, not a positive field value. Any incomplete Adapter cut
falls back to the ordinary retrieval path and cannot issue this receipt. The
complete census runs before candidate retrieval for exact typed identities, so
a certified absence does not spend a search call or create misleading
candidate References.

Managed and research runtimes attach through the bounded `oont/kernel` package
subpath. That Interface exposes the product lifecycle hook and exact object
primitives required by extensions, while control-plane policy remains outside
the public package.

`[EXISTS]` The same kernel subpath exposes a source-agnostic proof-contract
compiler, content-addressed ProofAuthorityProjection, and evaluator. The
projection binds every proof-relevant item field, exact Evidence reference, and
typed relation into `proofCensusSha256`. Evaluation requires that binding to
match the contract, requires each proposition to match its authoritative item,
and closes the whole relation census before `proofClosed` can be true. A
question-only contract cannot claim a complete invalidator census. These checks
cover canonical proposition roles, relation direction and targets, actor
binding, chronology, exact support, and proposition-family coherence.
Canonical counterevidence must relate outbound through `qualifies` or
`contradicts`. A closed proof reports `qualified` or `contradicted` accordingly;
closure never converts counterevidence into positive support.

The evaluator proves structural closure over content-bound Evidence references.
It does not turn those references into Evidence. A product reader must still
reopen the pinned source projection and inspect the exact Corpus bytes before a
Verification can use the result.

`[EXISTS]` The post-alpha kernel now has the generic source-native bridge into
that evaluator. A canonical proposition V2 record adds explicit proposition
identity, family, roles, modality, polarity, valid time, and known time to the
existing source-native field and exact Evidence span. The bridge compiles those
records into one ProofAuthorityProjection bound to the native object map and
namespace. Safe-open validation rejects a self-consistently rehashed record
whose semantic vocabulary leaves the locked taxonomy. Typed proposition
relations and ordinary root Verification wiring are not implemented yet.

`[ACTIVE-WORK]` The post-alpha kernel branch contains a bounded source-native
admitted-knowledge loop. It is not a generic early-exit hook and it does not
change the root client. The loop is:

```text
investigation proof
  -> content-bound bundle
  -> proposer signature
  -> independent reviewer Admission
  -> immutable knowledge branch
  -> cold query-bound replay
  -> deterministic proof re-evaluation
  -> exact Corpus reinspection
  -> compact verified context
```

The bundle binds one Ont, immutable source commit and replay, resolved query,
question, intent, proof contract, complete ProofAuthorityProjection,
propositions, relations, and the original deterministic evaluation. Admission
requires distinct Ed25519 proposer and reviewer keys with separate trust roles.
The writer deterministically resolves the exact current or successor answer
revision, requires every primary support reference to equal that revision, and
checks every bundle Evidence reference against Corpus bytes. It rejects any
proposition that does not participate in a required proof obligation. The cold
reader derives each returned role from the evaluated obligation instead of a
proposition label. Returned proof bindings expose fixed content hashes, not
proposer-authored semantic strings or the full proof-evaluation payload. A
`next` result reinspects and returns the successor as `answer` and the historical
revision as `anchor`. Multiple reviewers of the same bundle count as agreement.
Distinct active bundles for the same exact query refuse as ambiguous.
Corrections append a signed Admission that names the older Admission records it
supersedes; history remains immutable.

Equal proof roles over the same Exact Evidence span compile into one returned
Proof unit. Its fixed hash commits to the complete sorted proposition-hash set.
The reusable context path admits at most 64 Proof units and 64 KiB of Exact
Evidence, including a `next` anchor. It separately limits the JSON-encoded
Evidence text to 64 KiB, so control characters cannot expand the text payload
without bound. The complete Verification also contains fixed proof receipts and
source identifiers; 64 KiB is not a total-JSON-size claim. The writer refuses
larger bundles without truncation. A cold reader applies the same limits to
existing or directly planted records, marks violations as degraded Ledger
state, and preserves the ordinary verification path. Oversized records remain
available as structural history, so a later bounded correction can supersede
them without making their context reusable. Structural history requires an
internally valid immutable record, not current source or delivery eligibility.
Only records that also pass current source binding, context budgets, and trust
authentication can enter active reuse. Supersession is explicit and
non-transitive. A correction that leaves two distinct active bundles preserves
the disagreement as a typed ambiguity. This optimizes for bounded verified agent
context. It gives up fast-path reuse for sprawling proofs until adaptive or
paginated proof delivery is implemented.

Exact Evidence spans must decode as UTF-8 and round-trip to the same bytes bound
by `textSha256`. A span that splits a multi-byte code point is invalid Evidence,
not lossy `exactText`.

Bundle compilation remains source-context-neutral. Durable write is the reuse
eligibility gate because it is the first operation that can rebind the proof to
the concrete Corpus and, for `next`, include the resolved anchor. A compiled or
signed bundle that has not passed that gate is not active admitted knowledge.

At cold open, the reader authenticates each record and rechecks source and query
binding. Untrusted, malformed, stale, or invalid records are excluded and
reported as degraded ledger state, so they cannot suppress ordinary exact
verification. A matching valid record still has to pass deterministic proof
evaluation and reopen the exact Corpus bytes. The learned bundle routes proof;
it never becomes Evidence authority.

The default knowledge branch includes the immutable source-commit identity.
Advancing an Ont on a shared backend creates a new knowledge branch for the new
source cut instead of wedging or silently reusing prior-cut knowledge.

The ordinary query runtime does not write learning state. Source-grounded
capture and Admission use explicit kernel control-plane calls. The root SDK,
CLI, and MCP remain read-only. This post-alpha kernel work has not been
published as an alpha.3 capability.

Both modes execute the same search, read, and verification Module.
The operator control plane attaches one internal lifecycle Adapter for durable
SearchEpisode capture and reviewed SearchPolicy reuse. It does not fork query
semantics or create a second Resolver implementation.

The broader Terrain, Vacuum, Ledger, and Materialization lifecycle remains the
target architecture. Automatic production connectors and hosted lifecycle
management are not part of this alpha.

`[FUTURE]` Adaptive or paginated proof delivery can extend the bounded reuse
path without silently dropping Evidence. The current implementation refuses a
proof that cannot be returned completely within one bounded Verification.

## Query path

The ordinary query interface is `verify`. It composes navigation, exact reads,
and deterministic proof closure.

```text
question
  -> qualify one Ont and source cut
  -> compile proof obligations
  -> search for candidate References
  -> read exact authorized Evidence
  -> verify identity, chronology, and proof closure
  -> return context or a typed refusal
```

The advanced interface separates `search` from `read`. Search output is never
Evidence. A read is valid only for a Reference offered by the same open client.

Each result includes a content-bound navigation summary. It distinguishes raw
retrieval, raw fallback, a learned SearchRoute that contributed to the resolved
identity, and a learned SearchRoute rejected by typed identity resolution.
Candidate presence alone is not reported as reuse. These fields measure Resolver
behavior only; they cannot provide Support or change Evidence authority.

An active SearchPolicyArtifact may bypass raw candidate lookup only when its
admitted SearchRoute exactly matches the deterministic query binding for source,
object type, namespace, external identity, field, and intent. The Ont still
revalidates identity and chronology, and `read` still reinspects Exact Evidence.
An absent or different binding uses raw retrieval; an unbound query cannot gain
an identity from route memory.

## Storage seam

Canonical objects are immutable. Mutable branch refs advance with
compare-and-swap. The same storage interface has local file, GCS, and
S3-compatible Adapters. Query semantics do not depend on the selected Adapter.

## Invariants

- Terrain remains authoritative.
- An Ont routes. Exact Corpus bytes support.
- A Resolver cannot certify its own proposal.
- Currentness and coverage require explicit authority.
- Corrections append revisions and typed relations. They do not rewrite history.
- A refusal is preferable to context that cannot close the proof obligations.

See [GLOSSARY.md](../GLOSSARY.md) for canonical terms.
