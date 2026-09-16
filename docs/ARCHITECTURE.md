# Architecture

OpenOntology compiles source observations into a typed map, then uses that map
to return verified context. This guide describes `oont` 0.3.0-alpha.4.

- Root SDK, CLI and MCP queries are read-only.
- `oont/kernel` adds explicit source publication, semantic construction and
  reviewed knowledge reuse.
- Hosted connectors, workers, authentication and billing belong to the managed
  application.

```text
Adapter input -> immutable Corpus and Ont -> Resolver -> Verification
```

## Implemented modules

1. An Adapter supplies source observations, identities, fields, chronology and
   query schemas.
2. Corpus stores the immutable source bytes.
3. An Ont records the source cut and typed crosswalk over those bytes.
4. A Resolver proposes candidate References or a typed refusal.
5. Verification reads the Evidence and checks the proof obligations.
6. SDK, CLI and MCP expose the same query contract.

### Query scope and names

An ordinary query needs only `question`. Optional `scope` selects exact,
case-sensitive source-system, object-type and field names. An unavailable
result can include `availableFields` for discovery.

- Scope can fill missing selectors or disambiguate matching candidates. It
  cannot override a different recognized profile, field or explicit native ID
  in the question.
- Shared object aliases can be disambiguated by source system. Multiple aliases
  for one field remain one candidate. These checks use declared vocabulary,
  not inferred semantic equivalence.
- One quoted `titled` or `named` literal can select an identity through declared
  title fields. Matching includes source system, object type and namespace.
  Repeated observations of one identity are not name collisions.
- Literal contents do not supply IDs, field aliases or temporal intent.
  Recorded names are aliases across the source cut, not claims about a name
  at a requested time.
- Missing coverage, unknown names, collisions and explicit ID conflicts refuse
  before verification. A mismatched profile cannot prove object absence.

The planner preserves explicit IDs and temporal selectors while masking quoted
titles. A planner identity change also changes query-plan hashes; old Admissions
remain history but are not reused under the new plan.

### Current and historical fields

Current-field verification requires complete source coverage, zero Adapter
failures and one unambiguous latest recorded value.

- Its chronology receipt binds the source commit, replay, catalog, mapped source
  count, every identity observation, ordered field revisions and selected field.
- Incomplete chronology returns
  `unavailable-incomplete-recorded-field-chronology` without Evidence.
- The answer describes the latest observation in that source cut. It does not
  establish live external state.

Temporal selectors are explicit:

- `at` selects an as-of time. Do not combine it with `anchorValue` or
  `intent: next`.
- `anchorValue` is a previous field value for immediate-successor navigation,
  not an object ID. Current queries ignore it.
- Historical selection uses declared `validAt`, falling back to source
  `occurredAt`. It reports `knownAt` but does not use it to limit selection.
- The recorded horizon ends at the complete native catalog's last observation.
  Missing coverage, unresolved states or requests beyond that horizon refuse.

Historical selection reconstructs the full revision census and follows direct
edges whose endpoints are valid at the requested time. Consecutive equivalent
observations share a state; nonconsecutive equal states remain distinct.

Historical semantic verification also selects the active fields and their
inbound counterevidence. It cannot skip through an inactive intermediate
revision. Admission and cold reuse repeat this selection and bind the exact
timestamp, so the saved proof cannot answer `current` or another instant.

The planner recognizes several transition-time forms, including `When did ...
enter`, `change to`, `become`, and `At what time did ... transition`. These
return `unavailable-native-temporal-intent-not-declared` before Resolver work:
record-update time does not establish an exact transition time.

This is bounded phrase recognition, not general event-history inference.
Declared date fields and current, historical and successor value queries retain
their existing behavior.

### Catalog-scoped absence

Safe open builds an identity census when mapped coverage is complete and Adapter
failures are zero. With that complete census, exact typed identities are checked
before candidate retrieval.

- Zero occurrences return `verified-native-object-absent-from-bound-source-catalog`
  with no Evidence and `answerable: false`.
- The hashed receipt binds the identity, census, catalog, source-handle set and
  source count. It proves absence from that catalog, not worldwide nonexistence.
- An explicit scoped ID can bind the requested identity even when absent from
  the map. The census must still establish absence.
- Incomplete cuts use ordinary retrieval and cannot issue an absence receipt.
  Certified absence spends no seed-search call.

### Seed search accounting

A seed-search Adapter may declare up to 1,000 logical network operations per
search and no model calls. Hosted receipts must report actual operations within
that declaration.

Current and successor results expose the request-local count in
`verification.navigationProposals.seedSearchNetworkCalls`. A legacy receipt
without a count means zero only when its declaration is also zero.

This measures seed-search operations, excluding storage reads, SDK retries and
cost. Provider clients stay outside the kernel.

### Semantic proof

The kernel compiles a proof contract and a content-addressed
ProofAuthorityProjection. Its `proofCensusSha256` binds the item fields, Evidence
references and typed relations.

For `proofClosed` to be true:

- The projection must match the contract, and each proposition must match its
  authoritative item.
- Required roles, actor bindings, chronology, exact support and proposition-family
  constraints must hold.
- The complete relation census must close. A question-only contract cannot
  establish a complete invalidator census.
- Relation targets must satisfy every required modality and polarity constraint
  for their family. Optional obligations and obligation order cannot weaken them.
- Filtering candidate matches cannot shrink the authoritative invalidator or
  relation census.

Counterevidence uses outbound `qualifies` or `contradicts` relations. Closed
proof retains the corresponding `qualified` or `contradicted` disposition.

The evaluator checks structure over content-bound references. Verification must
still reopen the pinned source projection and inspect the Corpus bytes.

### Source-native semantic projection

Canonical proposition V2 records add identity, family, roles, modality, polarity,
valid time and known time to a native field and its Evidence span. The bridge
compiles them into a projection bound to the native object map and namespace.

- Safe open rejects semantic vocabulary outside the locked taxonomy, even when
  the record has been consistently rehashed.
- Relations live on their source proposition. `qualifies` and `contradicts`
  must originate from counterevidence and target the same namespace projection.
- For a selected current-field proposition with one action, change, outcome or
  state role, verification expands the complete inbound counterevidence closure.
- Search offers references. Verification reads every span and closes the
  authoritative relation census before returning a proof disposition.
- Delivery is limited to 64 Evidence units and 64 KiB of Evidence. An oversized
  closure returns its observed counts and a typed refusal, without partial context.

General semantic question planning and adaptive or paginated proof delivery are
not implemented. The current tradeoff is bounded, complete context rather than
partial answers for large proof closures.

### Reviewed knowledge reuse

The kernel provides an explicit admitted-knowledge client:

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

A bundle binds the Ont, source commit and replay, resolved query, question,
intent, proof contract, full authority projection, propositions, relations and
original evaluation. Ordinary semantic verification can compile this bundle;
compilation grants no reviewer authority.

Admission requires distinct Ed25519 proposer and reviewer keys with separate
trust roles. Before durable write:

- The writer resolves the current or successor answer revision. Every primary
  support reference must equal that revision, and every Evidence reference must
  match Corpus bytes.
- Every proposition must participate in a required proof obligation.
- Writer and cold reader reconstruct native semantic authority from the field
  and object map. It must equal the bundle's complete projection, including
  counterevidence, relations, actor, modality and polarity.
- A signed reduced census is ineligible, even with a different projection-kind
  label. Nonsemantic Adapter input does not acquire an invented semantic census.
- The source/query-derived minimum profile requires the answer family, exact
  support linked to required support for that family, and its canonical
  invalidator contract. Optional answer obligations do not satisfy it.
- IDs and descriptive text may differ. Compatible stricter requirements remain
  eligible when evaluation closes. A recorded plan need not claim an action
  actually occurred.

Compilation alone cannot establish reuse eligibility. Durable write is the first
step that binds the bundle to the concrete Corpus and, for `next` queries,
includes the resolved anchor.

### Returned context and corrections

The cold reader derives Evidence roles from evaluated obligations, not
proposer-authored labels. Returned proof bindings use fixed hashes rather than
semantic strings or the full evaluation payload.

- A `next` result returns the successor as `answer` and the earlier revision as
  `anchor`.
- Equal roles over the same span become one Proof unit. Its hash commits to the
  complete sorted set of proposition hashes.
- Context is limited to 64 Proof units, 64 KiB of raw Evidence and 64 KiB of
  JSON-encoded Evidence text, including the anchor. Receipts and identifiers are
  additional, so this is not a total response-size limit.
- Evidence must decode as UTF-8 and round-trip to the bytes bound by
  `textSha256`. A span splitting a multibyte code point is invalid.
- Writers reject oversized bundles without truncation. Cold readers mark
  oversized stored records as degraded and preserve ordinary verification.

Multiple reviewers of one bundle count as agreement. Distinct active bundles
for the same exact query produce ambiguity.

Corrections append signed Admissions naming the records they supersede.
Supersession is explicit and non-transitive: any remaining conflicting active
bundle keeps the result ambiguous.

Internally valid but ineligible records remain readable history, including
oversized records that a bounded correction can supersede. Active reuse also
requires current source binding, context limits and trusted signatures.

### Refresh and failure behavior

At cold open, the reader authenticates records and checks source/query binding.
Invalid, stale or untrusted records are excluded and reported as degraded;
ordinary verification remains available. A valid match still requires proof
re-evaluation and exact source reads.

The default knowledge branch includes the source commit. A source advance does
not silently reuse knowledge admitted for the previous cut.

Before each ordinary `verify`, an open admitted-knowledge client checks its
knowledge ref:

- Unchanged refs use bounded metadata reads, without history replay or Corpus
  reload. Protected profiles also check accepted history.
- Changed refs load a validated snapshot and recheck Admission and supersession.
  An independent Admission can therefore be used on the next query.
- Evidence is inspected on every reuse. Explicit investigations bypass reuse.
- Source and trust stay pinned at open. `status`, `search` and `read` do not
  refresh this client's admitted knowledge.

Missing, corrupt, unreadable or rewound knowledge disables cached reuse. A valid
repair can restore it. The running client requires new snapshots to descend from
its last accepted knowledge commit.

Legacy rollback protection is process-local. V2 protected history survives
restart and requires explicit recovery for pending or rewound refs. Trust
changes require reopening. Changed snapshots still replay metadata; there is
no incremental large-ledger refresh.

The root query runtime does not write learning state. Source-grounded capture
and Admission use explicit kernel calls. The operator lifecycle Adapter handles
SearchEpisode capture and reviewed SearchPolicy reuse. Managed consumers must
use the kernel rather than maintain a second Resolver implementation.

Tapestry's control plane belongs in a separate private repository and deployment,
consuming an exact published `oont` release with recorded integrity.

## Semantic construction proposals

Construction adds reviewed navigation concepts without changing the native proof
map.

- `ObjectDef` stores a local concept ID, preferred name and source-system-scoped
  aliases.
- `Claim` attaches an existing native-object observation and exact passage through
  `mentions` or `defines`.
- Domain `LinkDef` relationships and search `Reference` handles keep their
  separate meanings.

Compilation checks the bound source cut, object/namespace membership, containment
within declared field spans, UTF-8 bytes and literal name witnesses. It returns
an immutable, content-addressed proposal.

Every proposal has `navigationOnly: true` and `reviewRequired: true`. Literal
matching does not establish a correct definition or alias. Structural validation
and source rebinding are separate operations; neither grants review authority.

### Coverage and limits

Extraction coverage records examined, unsupported, failed and unexamined sources.
It does not prove that all concepts were found or that an unmentioned concept
is absent.

A proposal permits:

- 64 definitions and 16 aliases per definition.
- 256 Claims and 512 explicit source dispositions.
- 64 KiB per cited span and 1 MiB of serialized metadata.

Overflow refuses without truncation. These are proposal limits, not Corpus or
query-context budgets. Compilation checks the complete map and catalog, then
loads complete cited documents on demand. It is not an incremental or streaming
extractor, and alias scope is no narrower than source system.

### Independent review

`openSourceNativeConstructionReview({ options, construction })` rebinds the
proposal to one immutable cut and returns `packet` and `evaluate(response)`.

- The packet includes each preferred name, scoped alias and attachment, with
  its native identity, exact witness and complete cited documents.
- Reviewers need access to those whole documents, including text outside the
  witness. Uncited sources are not implicitly reviewed.
- Limits are 128 items, 32 documents, 256 KiB of source text and 1 MiB serialized.
  Source-text size is checked before payload reads. Overflow refuses the whole
  packet; a valid proposal may need a smaller review batch.

Responses name the exact packet and decide every item once with `accept`,
`reject` or `abstain`, a reason and exact source quotations.

- Missing or duplicate items, unknown sources and invented quotes are rejected.
  Evaluation uses the original immutable packet; responses are limited to 1 MiB.
- Any rejection rejects the batch. Otherwise an abstention yields `needs-review`;
  all accepts yield `accepted`.
- The result has `admissionGranted: false`. It checks protocol and quotations,
  not reasoning quality, and does not sign or write knowledge.
- An independent authorized signer decides whether to admit the unchanged
  proposal. Corrections require a new review.

Review distinguishes meaning from adoption: proposed or historical concepts can
be valid navigation targets. `defines` requires an affirmative source-local
meaning, not a mention or rejected draft. An old alias may remain valid;
mistaken equivalence and unsupported co-occurrence do not.

An automated production reviewer and held-out semantic-review qualification are
not implemented.

### Construction Admission and history

Construction Admission uses distinct proposer/reviewer keys and separately
versioned `admitted-for-navigation` statements. Signatures bind the complete
construction hash; they do not certify semantic judgment or substitute for
query-proof Admission.

- Writer and cold reader recheck source bytes and scoped native objects.
- Records use the same object store, source-cut knowledge branch, commits,
  protected history and compare-and-swap as query-proof Admission.
- Construction records use `blobs/knowledge-ledger/construction/`. Existing
  query-proof records retain their `admitted/` prefix and bytes. Readers select
  only their own record kind.
- Retrying the same record is idempotent. Concurrent writes retain CAS conflicts.
  Multiple signatures on the same construction count as agreement.

A correction replaces the same batch of ObjectDef IDs within the same source
binding. It can change aliases and Claims but cannot discard unrelated definitions
or cross source cuts.

Only authenticated, source-bound corrections supersede earlier records. Disjoint
batches compose; overlapping ObjectDef IDs quarantine every conflicting batch
until explicitly corrected. Equal names with different IDs do not merge.

`readSourceNativeConstructionLedger` returns an immutable snapshot with eligible
records and structural, invalid, superseded and conflict counts.

- An invalid record degrades the snapshot without hiding valid disjoint knowledge.
  Metadata or history failure returns no active records.
- Source opens once per call. Changed trust requires the new registry.
- Protected profiles retain accepted history across restart; legacy profiles do
  not. There is no warm cache or incremental ledger index.
- Signed records allow 2 MiB, including a 1 MiB proposal and at most 128
  supersession targets. This is not a serving budget.
- Atomic batch replacement is supported. Concept retirement, batch repartition
  and automatic merges are not.

### Historical construction reads

`readSourceNativeConstructionLedgerAtArtifact` opens retained protected V2
artifacts for historical navigation.

- It requires the expected seven-field source binding and a clean current source
  descendant before and after reading the latest protected knowledge head.
- Its records are candidates for reconstruction at that retained cut, not
  current-source authority. Compilation, review, writes and Admission stay
  current-bound.
- A stable missing knowledge branch is empty. Broken history, a non-ancestor or
  a changed selection refuses.
- This operation hydrates the full retained source cut and refuses V1 artifacts.
  Existing current readers and explorer profiles remain unchanged.

### Explorer

The kernel explorer opens one source-native state and construction snapshot.
`nodes`, `edges`, `records` and `status` return metadata pages.

- Nodes cover native objects, active ObjectDefs and passage witnesses. Claim
  edges run from a witness to its `about` ObjectDef. View-only name, alias and
  observation edges are separate.
- Reviewer agreement is deduplicated by construction hash. Edge identity does
  not depend on which agreement record represents it.
- Responses bind the artifact, source cut, native map, knowledge projection and
  non-secret reviewer configuration hash, including canonical public-key identities.
- Scope filters use actual native attachments. Aliases keep their source-system
  scope; object-type filters match any attached passage.
- Pages allow 64 nodes, 128 edges or 64 records, at most 128 session cursors and
  256 KiB serialized. Diagnostics include totals and truncation flags.

Passage nodes offer same-session read References. Current reads require active
construction. Explicit record selection can inspect authenticated superseded or
conflicting records with `currentNavigationEligible: false`.

Every operation rechecks source and knowledge state. Missing or rewound history
blocks cached access and clears cursors and read handles. Source-only Onts still
expose native identity nodes and coverage.

This is an operator primitive, not an HTTP authorization layer. Upstream
freshness is unknown; transport must authorize sources. Source text, trust keys
and new root query operations are not part of metadata pages.

### Concept search and read

`openSourceNativeProductWithConstruction` combines discovery with the
admitted-knowledge client. Its term search accepts
`search({ term, scope?, conceptId?, limit?, cursor? })`.

- Terms match a complete normalized preferred name or declared alias. This is
  vocabulary lookup, not fuzzy search or general question planning.
- Explicit source scope excludes aliases from other systems. Without it, all
  recorded scopes participate. Object type can further narrow the result.
- Different matching concept IDs remain ambiguous. The caller can inspect
  each passage, select `conceptId` or narrow scope.
- State and totals describe the full match set, even when one page shows one
  concept. No match is not absence proof; a degraded ledger with no eligible
  match returns unavailable.

Identical concept/object/span witnesses share one Reference with their attachment
roles. Reviewer agreement does not duplicate results.

- Pages default to 20 refs and allow 1..64. Concept summaries cover that page;
  `nextCursor` enumerates the rest.
- Ordering is by concept ID, then witness hash, not relevance or recency.
- Cursors bind the query, active projection and client. Limits are 128 cursors
  and 1,024 offered refs, with oldest-first eviction.
- Reads allow the compiler's 64 KiB passage limit. These limits make no total
  ledger-size or latency guarantee.

Construction refs have `requiredForProof: false`. Their reads return exact
UTF-8 passages and a construction-passage binding, not a verified-field
disposition.

The client refreshes eligible knowledge before term search and construction
read. Corrections invalidate prior refs. It shares one source opening and trust
snapshot, rechecking records without reloading the entire Corpus.

Missing or non-descendant knowledge disables reuse until a valid descendant
returns. Legacy protection is process-local; protected profiles use durable
history. Source or trust changes require reopening.

### Factual queries and MCP

Concept lookup does not choose the factual subject. The caller inspects a
candidate, selects its native identity and field, then verifies through the
existing chronology and proof checks.

Ordinary question search, factual verification, query-proof reuse and lifecycle
hooks keep their existing behavior. Root SDK and CLI do not enable construction
implicitly.

An explicitly opened construction client can use
`createSourceNativeProductMcpHandler(client, { profile: 'advanced' })`:

- `search` accepts either a question or a term, never both.
- `read` accepts the corresponding reference format.
- Default MCP still exposes only `verify`; ordinary clients retain their schemas.
- No MCP operation reviews or admits construction.

See the [semantic-map example](CONTEXT-LIFECYCLE.md#executable-concept-map).

## Query path

`verify` combines navigation, exact reads and deterministic proof checks.

```text
question
  -> qualify one Ont and source cut
  -> compile proof obligations
  -> search for candidate References
  -> read exact authorized Evidence
  -> verify identity, chronology, and proof closure
  -> return context or a typed refusal
```

Advanced callers can separate `search` and `read`. References are readable only
by the client that offered them; search output alone is not Evidence.

Each result reports whether navigation used raw retrieval, raw fallback, a
contributing learned SearchRoute or a route rejected by typed identity resolution.
Candidate presence alone does not count as reuse.

An admitted SearchPolicyArtifact can skip raw lookup only when its route exactly
matches source, object type, namespace, external identity, field and intent.
The Ont still checks identity and chronology, and `read` still inspects Evidence.
An unbound query cannot take its identity from route memory.

## Storage seam

Canonical objects are immutable; branch refs use compare-and-swap. Local file,
GCS and S3-compatible Adapters share the same query semantics.

- Stable resources bind a source cut, history ancestry and declared query profile.
- Validated replay checkpoints reduce history reads. New materialization writes
  the checkpoint before publishing its ref.
- Full product opening validates all source bytes and field spans.
- Construction validates the complete index but reads selected documents.
  Uncited corruption may leave construction usable while a whole-Ont check fails.
- Protected construction Admission also checks all parent object descriptors.

See [Storage](STORAGE.md#kernel-resources-and-replay-checkpoints) for configuration,
recovery and read limits.

## Invariants

- Terrain remains authoritative.
- Ont and Resolver output guide navigation; authorized Corpus bytes provide Evidence.
- A Resolver cannot certify its own proposal.
- Currentness and coverage require explicit authority.
- Corrections append revisions and relations without rewriting history.
- Incomplete proof returns a typed refusal.

See the [Glossary](../GLOSSARY.md) for canonical terms.
