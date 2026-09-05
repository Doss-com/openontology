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

`[ACTIVE-WORK]` This branch does not yet contain a generic admitted-knowledge
reader or a validated pre-verification reuse path. The ordinary `verify` path
does not exit early from kernel evaluation. That connection belongs only after
the reader can reopen Admission, revalidate projection authority, and reinspect
the exact Corpus bytes bound by the result.

The ordinary query runtime does not write learning state. Source-grounded
capture, independent review, and later policy reuse are developed in a separate
operator control plane. That control plane does not ship in this public alpha.

Both modes execute the same search, read, and verification Module.
The operator control plane attaches one internal lifecycle Adapter for durable
SearchEpisode capture and reviewed SearchPolicy reuse. It does not fork query
semantics or create a second Resolver implementation.

The broader Terrain, Vacuum, Ledger, and Materialization lifecycle remains the
target architecture. Automatic production connectors and hosted lifecycle
management are not part of this alpha.

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
