# Glossary

## Product names

- **OpenOntology** is the system and product.
- **`oont`** is the CLI command and npm package.
- **Ont** is one compiled, addressable ontology resource.
- Lowercase `ont` is reserved for code, identifiers, paths, and command
  placeholders.

## Query and proof

- **SearchRoute** is a question-independent Ont navigation unit joining one
  canonical proposition-family member to an exact-source handle and structural
  neighbors.
- **SearchPath** is a query-specific ordered traversal of one or more
  SearchRoutes.
- **SearchEpisode** is an immutable Ledger record of candidate routes,
  traversal, exact reads, dispositions, and an authenticated outcome.
- **SearchPolicyArtifact** is a versioned Adapter that ranks SearchRoutes. It is
  navigation, not Evidence authority.
- **Reference** is an opaque, request-local navigation handle offered by
  `search`.
- **Exact Evidence** is authorized Corpus bytes returned by `read` and eligible
  to support a material claim.
- **ProofClosure** is the complete exact Evidence needed to satisfy the current
  proof obligations.
- **ProofSufficiencyContract** is a content-bound list of proposition, relation,
  completeness, and coherence obligations that must close for one question.
- **ProofDisposition** is `supported`, `qualified`, `contradicted`, or
  `unresolved` after every required obligation and authoritative census is
  evaluated. A complete contradiction is answerable as `contradicted`; it is
  not converted into positive support.
- **Proof unit** is one returned proof role joined to one Exact Evidence span.
  Its fixed hash commits to every proposition that cites that same role and
  span, so repeated citations do not repeat Evidence in agent context.
- **ProofAuthorityProjection** is the canonical item, exact Evidence-reference,
  and relation census derived from one immutable semantic projection.
- **Canonical proposition V2** is the deterministic Adapter record that binds a
  proposition identity, family, canonical roles, modality, polarity, actor,
  valid time, known time, and one exact source span. It is compiled into a
  ProofAuthorityProjection; it is not Evidence by itself.
- **Canonical proposition relation** is an Adapter-declared `qualifies` or
  `contradicts` edge from one counterevidence proposition to another canonical
  proposition in the same namespace projection. The edge is navigation and
  proof-census data; its endpoint source spans remain Evidence.
- **SourceProjectionAuthority** binds a proof contract to the source projection
  identity and the ProofAuthorityProjection's `proofCensusSha256`.
- **Support** is an independently verified relationship between a material
  claim and inspected Exact Evidence.
- **Verification** is proof-complete context against one named Ont, source cut,
  scope, and authority contract. It is not universal truth.
- **Recorded field chronology** is the complete ordered set of
  Adapter-declared observations for one stable native identity and field over a
  bound source cut. Its sufficient receipt proves the latest recorded value in
  that cut. It does not prove universal current state.
- **Object identity census** is the complete, query-independent inventory of
  Adapter-declared native object identities over one bound source catalog. It
  can authorize catalog-scoped absence only when source coverage is complete
  and adapter failures are zero.
- **Absence receipt** is a content-addressed proof that one exact typed identity
  has zero occurrences in a bound object identity census. It contains no
  Evidence and cannot authorize a claim of world-wide nonexistence.

SearchRoutes, SearchPaths, SearchEpisodes, SearchPolicyArtifacts, and retrieval
scores cannot provide Support by themselves.

An invalidator obligation is the complete counterevidence census. Canonical
`qualifies` and `contradicts` relations determine ProofDisposition. A
counterevidence item without one of those outbound relations keeps proof
unresolved.

## Product operations

- **`verify(query)`** composes search, internal Resolver work, exact reads, and
  ProofClosure. It returns a Verification or typed refusal.
- **`search(query)`** returns candidate References for navigation.
- **`read(ref)`** returns exact authorized Evidence for a Reference offered by
  the same open client.
- **`check(ont)`** emits a compact integrity assertion after safe-open
  validation.
- **`status(ont)`** emits recorded diagnostic state from the same validated
  open. It does not reread Terrain or rebuild the Ont.

## Construction

- **Terrain** is an external source of authority.
- **Vacuum** reads, identifies, normalizes, and redacts source observations.
- **Corpus** stores immutable exact Evidence.
- **Resolver** is an internal Module that proposes candidate References or a
  typed refusal. It does not own truth.
- **Ledger** stores independently admitted semantic or procedural knowledge.
- **Admission** is an authenticated, independently reviewed decision to make one
  content-bound knowledge bundle eligible for later reuse. Admission does not
  replace Terrain authority. Proposer and reviewer authority are separate trust
  roles. Every admitted proposition must participate in a required proof
  obligation; returned Evidence roles come from that obligation, and returned
  provenance uses fixed content hashes rather than proposer-authored labels.
  Reusable context is bounded to 64 Proof units, 64 KiB of raw Exact Evidence,
  and 64 KiB of JSON-encoded Evidence text, including a `next` anchor.
  Oversized Admissions are refused, never truncated. Internally valid but
  ineligible records remain addressable structural history so a bounded
  correction can supersede them. Supersession is explicit and non-transitive;
  a correction must name every active conflicting Admission it displaces.
  Corrections append a signed superseding Admission; they do not delete prior
  records.
- **Materialization** is a disposable derived index or projection.
- **Adapter** is a concrete implementation of a storage, source, or Resolver
  interface.

## Canonical record homes

- Actor: `ObjectDef` or `InstanceRef`, with provenance.
- Action: `ActionDef` or a proposition predicate.
- State and outcome: Claim or proposition-revision payload.
- Change: typed relation between proposition revisions.
- Counterevidence: `contradicts` or `qualifies` relation.
- Chronology: `validAt`, `knownAt`, and ordered events.
- Exact support: Evidence references and dependencies.

## One invariant

Terrain remains authoritative. Resolvers propose. An Ont routes and verifies.
Only exact authorized Corpus bytes can support a material claim.
