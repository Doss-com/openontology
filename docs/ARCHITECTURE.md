# Architecture

OpenOntology separates navigation from proof. This unpublished development
checkout implements the compact path below.

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

An ordinary MCP query needs only `question`. Optional `scope` uses exact,
case-sensitive declared source-system, object-type and field names; an
unavailable result can return `availableFields` for discovery. A mismatched
profile does not prove an absent object. Temporal selectors express a request,
not a default: `at` is an explicit as-of time, while `anchorValue` is a previous
field value for immediate-successor navigation. It is not an object ID and
current queries ignore it.
`at` cannot be combined with `anchorValue` or `intent: next`. These meanings
are also included in the tool parameter descriptions.

`[EXISTS]` Current-field Verification compiles a content-addressed chronology
receipt over one stable native identity and field. The receipt binds the source
commit, replay, catalog, complete mapped source count, every identity
observation, the ordered field-revision closure, and the selected exact field.
It is sufficient only when source coverage is complete, adapter failures are
zero, and the latest recorded value is unambiguous. Otherwise the Resolver
returns `unavailable-incomplete-recorded-field-chronology` without Evidence.
The scope is deliberately limited to the latest recorded value in the bound
source cut. It does not claim universal current state.

`[ACTIVE-WORK]` Point-in-time queries add an explicit `at` binding to the same
Resolver and exact-read path. The native retrospective profile uses declared
`validAt`, or source `occurredAt` when omitted. `knownAt` is reported but does
not limit selection. The source horizon is the complete native catalog's last
observation, not a guarantee about the external world. Selection reconstructs
the full revision census and follows only direct edges whose endpoints are
valid at the requested time. Consecutive equivalent observations share a state;
nonconsecutive equal states stay distinct. Missing coverage, unresolved states,
and requests outside the recorded horizon refuse without Evidence.

Historical semantic projection validates the full immutable proposition and
relation census, then selects active fields and their inbound counterevidence
closure for that same time. An inactive intermediate revision is not a shortcut
to an earlier state. Historical Admission and cold reuse independently repeat
this selection and bind the exact timestamp. They cannot answer `current` or a
different instant using the saved proof.

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

The bounded `oont/kernel` package subpath is the extension Interface for managed
and research runtimes. It exposes the product lifecycle hook and exact object
primitives, while control-plane policy remains outside the public package.
The Interface's availability does not establish that every managed consumer
already uses the same pinned package.

`[EXISTS]` The unpublished planner binds one quoted `titled` or `named` literal
against declared title fields in the complete native map. Names select one
identity within source system, object type and namespace; repeated observations
of one identity are not collisions. Missing coverage, unknown names, collisions
and explicit ID conflicts refuse. Literal contents do not supply field aliases,
IDs or temporal intent. Recorded names are aliases across the source cut, not
assertions about the name at a requested time. Existing chronology, semantic
proof, Admission and exact reads still apply. The changed planner identity
changes query-plan hashes; prior-plan Admissions are not silently reused under
the new planner. Their signed bytes remain history and ordinary verification
remains available.

Seed-search Adapters may declare up to 1,000 logical network operations per
search, with zero model calls. Hosted receipts must report actual operations
within that declaration. Current and immediate-successor results expose the
request-local count as `verification.navigationProposals.seedSearchNetworkCalls`.
Local legacy receipts without a count mean zero only for a zero declaration.
This counts seed-search operations, not storage reads, SDK retries, total HTTP
traffic, or monetary cost. Provider clients remain outside the public kernel.

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

Relation targets must satisfy every declared modality and polarity constraint
from required support obligations for their target family. Obligation order
does not change that requirement, and optional obligations cannot weaken it.
Filtering candidate matches does not shrink the authoritative invalidator item
census or the whole-projection relation census.

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
relations live on the source proposition inside that same immutable map.
`qualifies` and `contradicts` are implemented, must originate from
counterevidence, and must target a proposition in the same namespace
projection. For current-field queries whose selected proposition has one
action, change, outcome, or state role, ordinary root Verification expands the
inbound counterevidence closure. Search returns references only. Verification
reopens every exact Corpus span and closes the authoritative relation census
before exposing `supported`, `qualified`, or `contradicted`. Broader semantic
question planning is not implemented yet. The ordinary path applies the same
64-unit and 64-KiB Exact Evidence envelope used by durable reuse before it
offers any semantic References. An over-budget closure returns a typed refusal
with its observed counts and no partial context. This optimizes for complete,
bounded proof. It gives up immediate answers for high-degree proof roots until
adaptive or paginated proof delivery exists.

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
The ordinary semantic Verification path can compile these exact materials into
the bundle, removing manual translation without granting reviewer authority.
The writer deterministically resolves the exact current or successor answer
revision, requires every primary support reference to equal that revision, and
checks every bundle Evidence reference against Corpus bytes. It rejects any
proposition that does not participate in a required proof obligation. The cold
reader and writer also reconstruct native semantic authority from the selected
field and immutable object map. The complete reconstructed projection must
equal the bundle's projection, including counterevidence, relations, actor,
modality, and polarity. A signed, internally consistent reduced census is not
eligible for reuse, even if it calls itself a different projection kind. This
check applies when the selected field has native semantic authority; it does
not invent a semantic census for nonsemantic Adapter input. Native Admission
also requires the source/query-derived minimum proof profile: the selected
answer family is required, exact support links to required support for that
family, and the canonical invalidator contract targets it. Optional answer
obligations cannot satisfy that profile. IDs and descriptive prose can differ,
and compatible stricter requirements remain eligible when evaluation closes.
The profile does not force observed-positive modality for all recorded-field
queries; inspecting a recorded plan is distinct from proving an action occurred.
The cold
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

`[EXISTS]` An open admitted-knowledge client checks its knowledge ref before each
ordinary `verify`. An unchanged ref uses bounded ref metadata reads; it does not
replay history or reload the source corpus. Protected profiles also validate the
accepted-history record around that observation. A changed ref loads a validated snapshot,
rechecks Admission and supersession, then selects that snapshot for the request.
Independent Admission can therefore help the same running client on its next
verification. Exact Evidence is still inspected on every reuse. Source and trust
remain pinned at open; `status`, `search`, and `read` do not refresh knowledge.
An explicit investigation continues to bypass reuse.

Missing, unreadable, corrupt or rewound knowledge disables cached reuse and
reports degraded state while ordinary exact verification remains available.
A repaired snapshot can recover. The running reader remembers its last accepted
knowledge commit and requires later snapshots to contain that ancestry, so a
rewound ref cannot silently restore a superseded Admission. This floor is
process-local for legacy profiles. The unpublished V2 protected profile also
checks independently stored accepted history across restarts, and requires
explicit exact-target recovery for a pending or rewound ref. Trust changes
require reopening the client. Changed snapshots still replay metadata and
validate records; incremental large-ledger refresh is not implemented.

The ordinary query runtime does not write learning state. Source-grounded
capture and Admission use explicit kernel control-plane calls. The root SDK,
CLI, and MCP remain read-only. This post-alpha kernel work has not been
published as an alpha.3 capability.

The operator lifecycle Adapter is the boundary for durable SearchEpisode capture
and reviewed SearchPolicy reuse. Managed integration must consume this kernel
without forking query semantics or maintaining a second Resolver implementation.

The broader Terrain, Vacuum, Ledger, and Materialization lifecycle remains the
target architecture. Automatic production connectors and hosted lifecycle
management are not part of this alpha.

`[FUTURE]` Adaptive or paginated proof delivery can extend the bounded reuse
path without silently dropping Evidence. The current implementation refuses a
proof that cannot be returned completely within one bounded Verification.

## Semantic construction proposals

`[ACTIVE-WORK]` The unpublished kernel exposes a bounded query-independent
semantic-construction compiler. A minimal `ObjectDef` profile holds a stable
local concept ID, a preferred name and source-system-scoped aliases. `Claim`
records attach source passages to those definitions through `mentions` or
`defines`. Each witness points to an existing native-object observation and an
exact Corpus span. It does not synthesize a native identity or change the
source-native proof map. Domain `LinkDef` relationships and public search
`Reference` handles retain their separate meanings.

Compilation safely opens the bound source cut, checks source/object/namespace
membership, containment within the native object's declared field spans,
exact UTF-8 bytes and literal name witnesses, and returns an
immutable, content-addressed proposal. Extraction coverage distinguishes
examined, unsupported, failed and unexamined sources. Coverage is a declared
extraction inventory, not proof that every concept was found or that a missing
concept is absent. Structural validation and source rebinding are separate
kernel operations; neither grants review authority.

Every proposal has `navigationOnly: true` and `reviewRequired: true`. A valid
literal witness can still be a false definition or alias. The compiler does not
perform semantic review. The root SDK, CLI and MCP do not consume these proposals.

The record limits are 64 definitions, 16 aliases per definition, 256 claims,
512 explicit source dispositions, 64 KiB per cited span and 1 MiB serialized
metadata. Overflow refuses rather than truncating. These limits do not bound
corpus size or grant a query-context budget. Compilation opens the current
source artifact and can read the full source cut; it is not an incremental or
streaming extractor. This profile favors bounded, inspectable proposals over
general semantic extraction and narrower-than-source-system alias scope.

`[ACTIVE-WORK]` A separate kernel construction Admission profile records a
proposer signature and an independent reviewer's `admitted-for-navigation`
decision. It shares Ed25519 trust-role validation with query-proof Admission,
including the distinct-actual-key requirement. Its versioned statements bind
the complete construction hash and cannot substitute for query-proof
statements. Signature authentication proves authority and integrity, not the
quality of semantic judgment. Semantic judgment is externally supplied; the
bounded review session below prepares source context and validates responses.
An automated production reviewer and held-out quality qualification remain
unimplemented.

`openSourceNativeConstructionReview({ options, construction })` safely rebinds
the proposal and opens one immutable source cut. It returns a `packet` and an
`evaluate(response)` method. The packet contains a content-bound item for each
preferred name, scoped alias and `mentions` / `defines` attachment, its native
identity and exact witness, and the complete cited source documents. Full
documents let reviewers see negation or rejected proposals outside the chosen
witness. Reviewers must be authorized to read those whole documents; this is
not a field-limited access API. Uncited sources are not implicitly reviewed.

The review profile permits at most 128 items, 32 cited documents, 256 KiB of raw
source text and 1 MiB of serialized packet. Larger input refuses without a
cropped or partial packet. A structurally valid construction can exceed this
review profile and require a smaller authored batch or another explicitly
configured review process. These bounds do not establish a latency SLO.

Every response must name the exact packet and decide every item once with
`accept`, `reject` or `abstain`, a reason, and exact source quotations. The
evaluator rejects missing/duplicate items, unknown sources and invented quotes.
It evaluates against its original immutable packet, not a caller-replaced
packet. The response is bounded to 1 MiB. One rejection rejects the batch;
otherwise an abstention yields `needs-review`; all accepts yield `accepted`.
The immutable result has `admissionGranted: false`. This checks protocol and
quotation integrity, not whether the reviewer's reasoning is correct. It does
not sign, write knowledge, edit a proposal, select a model or answer a question.
An independent authorized signer still owns the decision to admit the unchanged
construction. A corrected proposal requires a new review.

Semantic reviewers must distinguish a named concept from its adoption or
instantiation. Proposed and historical concepts can be valid navigation targets.
`defines` preserves an affirmative source-local meaning, including a documented
historical definition. A mention or expressly rejected draft is not that
definition. An old recorded alias is not invalid just because it is old;
explicitly mistaken equivalence and unsupported co-occurrence are different.
Review does not turn any of these attachments into current factual authority.

The writer and cold ledger reader rebind exact source bytes and scoped native
objects. They use the same object store, source-cut knowledge branch, metadata
commits, protected history and compare-and-swap as query-proof Admission. New
records occupy `blobs/knowledge-ledger/construction/`; old signed query-proof
records retain their original `admitted/` prefix and bytes. Each reader consumes
only its own record kind. Retry of the same record is idempotent. Concurrent
writes retain the store's CAS failure behavior. New signatures of the same
construction are agreement, not conflicting interpretations.

Corrections explicitly name older Admission records and replace the same batch
of ObjectDef IDs within exactly the same source binding. They may change
aliases and Claims but cannot silently discard unrelated definitions or cross
source cuts. Structural history remains readable even when trust or current
source binding makes a record ineligible. Only a currently authenticated,
source-bound correction can suppress an earlier record. Disjoint batches
compose. Distinct active constructions sharing any ObjectDef ID quarantine
every overlapping batch until the conflicting records are explicitly corrected.
Equal names with distinct IDs do not automatically merge.

`readSourceNativeConstructionLedger` returns a fresh immutable snapshot of
eligible, unambiguous records with structural, invalid, superseded and conflict
counts. Individual invalid records degrade the snapshot without hiding valid
disjoint knowledge; metadata/history failure returns no active records. The
source opens once per call; changed trust requires passing the new registry.
Protected profiles retain accepted history across restart. Legacy profiles do
not gain that rollback protection implicitly. This first cold path has no warm
cache or incremental ledger index. Atomic batch correction favors auditable
replacement over concept retirement, batch repartition and automatic merges,
which remain unimplemented. The 2 MiB signed-record envelope includes a bounded
1 MiB proposal and at most 128 supersession targets; it is not a serving budget.

These are navigation-eligible records, not a new proof authority.

`[ACTIVE-WORK]` The unpublished kernel now composes construction discovery with
the existing admitted-knowledge client through
`openSourceNativeProductWithConstruction`. `search({ term, scope?, conceptId?,
limit?, cursor? })` matches a complete normalized name or explicit alias.
Optional scope selects a source system and object type. With an explicit source
system, aliases from other systems cannot match. Without one, all recorded
alias scopes participate and equal-name concept IDs remain ambiguous. This is
declared vocabulary lookup, not fuzzy matching or arbitrary semantic question
planning.

Search returns metadata-only passage references, page-local concept summaries,
full concept and match counts, and opaque page cursors. Identical concept/native-object/span witnesses
share one reference with their attachment roles. Multiple reviewer signatures
on the same construction do not duplicate the projection. Different matching
concept IDs remain ambiguous but expose their individual passage references
for inspection. Browsing alternatives does not merge their identities or
select a factual subject. `conceptId` or narrower scope can still restrict the
result. State depends on the full match set, even when a page shows one concept.
No match is not absence proof. A degraded ledger with no eligible matches is
reported as unavailable rather than ordinary no-match.

Construction references have `requiredForProof: false`. Their `read` returns
exact UTF-8 source bytes and a distinct construction-passage binding, not a
verified-field binding or proof disposition. The client refreshes eligible
knowledge before term search and construction read, so a superseding correction
invalidates previous refs. It shares one pinned source opening and one trust
snapshot; the internal reader rechecks records without reloading the whole
corpus. Missing or non-descendant knowledge disables reuse until a valid
descendant returns, with a process-local floor in legacy profiles and durable
history protection in protected profiles. Source and trust changes require a
new opening. Existing pinned readers disclose their original source cut.

Pages default to 20 passage refs and permit 1..64. Concept summaries contain
only the ID/name pairs represented on that page. Follow `nextCursor` to enumerate
the complete match set, including when more than 64 concepts share a name.
Metadata is ordered by concept ID and then witness hash, not relevance or
recency. Cursors bind the query and active construction projection, and
cannot cross clients. The client retains at most 128 cursors and 1,024 offered
refs with oldest-first eviction. Reads remain bounded to the compiler's 64 KiB
passage limit. These limits do not establish a total ledger-size or latency SLO.

Ordinary `search({ question, ... })`, factual `verify`, existing query-proof
reuse and lifecycle hooks retain their original implementation. Concept lookup
does not select the authoritative subject of a factual query. The caller reads
the candidate, selects its native identity and field, then verifies through
the existing chronology and proof closure. The root SDK and CLI still do not
enable construction implicitly. An explicitly opened construction client can
use `createSourceNativeProductMcpHandler(client, { profile: 'advanced' })`.
It advertises the same `search` and `read` tools, with mutually exclusive
question/term search schemas and both reference formats. Ordinary clients keep
their existing schemas. The default MCP profile still exposes only `verify`.
No MCP operation reviews or admits construction. See the
[executable semantic-map example](CONTEXT-LIFECYCLE.md#executable-concept-map).

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

`[ACTIVE-WORK]` Unpublished kernel resource primitives bind a stable source
resource to one immutable cut, checking history ancestry and declared query
profile. Ref-index opening can reuse a validated, ref-bound replay checkpoint.
Ordinary and exact product opening now use validated checkpoints when present,
and new source materialization publishes the checkpoint before its ref CAS.
Opening still validates all source bytes and field spans. Current query
operations are unchanged. See
[Storage](STORAGE.md#kernel-resources-and-replay-checkpoints) for the implemented
boundary and limits.

## Invariants

- Terrain remains authoritative.
- An Ont routes. Exact Corpus bytes support.
- A Resolver cannot certify its own proposal.
- Currentness and coverage require explicit authority.
- Corrections append revisions and typed relations. They do not rewrite history.
- A refusal is preferable to context that cannot close the proof obligations.

See [GLOSSARY.md](../GLOSSARY.md) for canonical terms.
