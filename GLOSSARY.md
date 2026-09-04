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
- **Support** is an independently verified relationship between a material
  claim and inspected Exact Evidence.
- **Verification** is proof-complete context against one named Ont, source cut,
  scope, and authority contract. It is not universal truth.

SearchRoutes, SearchPaths, SearchEpisodes, SearchPolicyArtifacts, and retrieval
scores cannot provide Support by themselves.

## Product operations

- **`verify(query)`** composes search, internal Resolver work, exact reads, and
  ProofClosure. It returns a Verification or typed refusal.
- **`search(query)`** returns candidate References for navigation.
- **`read(ref)`** returns exact authorized Evidence for a Reference offered by
  the same open client.
- **`check(ont)`** actively validates Ont integrity and projection consistency.
- **`status(ont)`** reports recorded state without recomputation.

## Construction

- **Terrain** is an external source of authority.
- **Vacuum** reads, identifies, normalizes, and redacts source observations.
- **Corpus** stores immutable exact Evidence.
- **Resolver** is an internal Module that proposes candidate References or a
  typed refusal. It does not own truth.
- **Ledger** stores independently admitted semantic or procedural knowledge.
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
