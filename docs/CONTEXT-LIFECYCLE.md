# The life of context in an Ont

An Ont gives an agent three things: a map of its sources, a way to verify what
those sources establish, and a memory of reviewed work it can safely reuse.

Follow one `ClickupTask` from its original system, through construction and
verification, into reviewed knowledge that a later agent can reuse.

This walkthrough uses a synthetic `ClickupTask`. It contains no customer data
and makes no benchmark claim.

- The status example uses `sourceSystem: clickup` and `objectType: task`.
- The executable concept-map example declares `objectType: ClickupTask` in its
  Adapter schema. Neither example introduces a kernel class.
- Namespace and native ID complete the identity in both examples.

Construction, verification and reviewed reuse ship in the kernel.
Source capture, model workers and scheduled review require a managed application;
the ordinary `verify` call does not start them. Later sections describe possible
extensions separately from the working examples.

## The two loops

Source updates and reviewed agent work have separate lifecycles.

```text
Source loop
===========
Terrain -> Vacuum / source Adapter -> Corpus + Ont
    ^                                      |
    |                                      v
new observations                    published source cut

Agent loop
==========
Agent question -> Resolver + Verification -> verified context
                         ^                         |
                         |                         v
                       Ledger <- Admission <- proposed knowledge
```

The source loop updates the available observations. The agent loop preserves
reviewed work so a later agent can use it without repeating the entire
investigation. Neither loop makes the Ont more authoritative than the underlying
sources.

## 1. Terrain: something happens in the original system

Imagine a `ClickupTask`, native ID `CT-17`, in the synthetic namespace
`example-workspace`. One captured observation says `to do`. A later observation
says `in progress`.

```text
ClickUp
  ClickupTask CT-17
        |
        +---- April 6 observation ----- status: to do
        |
        +---- May 19 observation ------ status: in progress
```

ClickUp owns the operational object. Tapestry Bronze holds captured observations
of that object. OpenOntology does not create the original work item, change its
status or replace ClickUp as its authority.

This distinction affects the answer: the evidence can establish what the latest
captured observation records. It does not, by itself, establish what the live
system says right now.

## 2. Vacuum: bring observations in without losing their origin

Vacuum is the ingestion faculty. A source Adapter is the implementation that
understands the incoming representation.

For this source-native path, the Adapter preserves the complete document and
declares the parts it knows how to interpret. It does not ask a model to guess
what every sentence means.

```text
Bronze source document
        |
        +--> preserve full bytes
        +--> identify source + type + namespace + native ID
        +--> map declared fields: title, ID, status
        +--> bind each field to its exact byte range
        +--> record validAt and knownAt
        |
        v
Canonical construction input
```

For our `ClickupTask`, the mapping looks like this:

```text
ClickupTask CT-17
  identity
    sourceSystem: clickup
    objectType:   task
    namespace:    example-workspace
    externalId:   CT-17

  status observation
    value:        in progress
    predicate:    has-status
    modality:     reported
    polarity:     positive
    validAt:      observation time
    knownAt:      ingestion cut

  canonical homes
    actor:        ObjectDef / InstanceRef
    state:        Claim / PropositionRevision payload
    support:      exact Evidence reference
```

The public representation carries identity and proposition records. It does not
expose a general ObjectDef or LinkDef authoring API.

- `validAt` describes when the observation is valid under the Adapter's time contract.
- `knownAt` describes when it became known to this construction input.
- A capture timestamp does not establish the exact moment a status changed.

The Tapestry Adapter's mapped `ClickupTask` status is a reported state. The rest
of the document remains in Corpus, but preserving its bytes is not the same as
extracting every requirement, blocker or causal assertion from its prose.

## 3. Construction: build a map over the preserved sources

Corpus, Ont and Ledger have different jobs.

```text
Corpus                         Ont
======                         ===
April source bytes ---------> ClickupTask CT-17
May source bytes ----------->   |
                                +--> source observations
                                +--> declared fields
                                +--> revision chronology
                                +--> proposition bindings
                                +--> exact source locations

Ledger
======
reviewed investigations, Admissions and corrections
```

Corpus preserves the exact observations. Ont supplies the typed crosswalk that
lets an agent navigate and check them. Ledger holds the reviewed knowledge and
its history.

The compiler groups the two observations because their complete source-native
identity matches, not because their titles sound similar. It compares the same
field on that same identity across ordered observations.

```text
ClickupTask CT-17
        |
        +--> status, April 6: to do
        |       |
        |       +--> exact bytes in April document
        |
        +--> status, May 19: in progress
                |
                +--> exact bytes in May document
                |
                +--> supersedes the earlier status observation
```

That `supersedes` relation is navigation derived from identity, field value and
chronology. It is not permission to delete the older source or assume the latest
document wins every kind of disagreement.

BM25 is a rebuildable search Materialization for finding candidates. The Ont adds
identity, chronology, declared semantic relations and source bindings to check
those candidates.

The normal query-time Resolver uses this constructed map. It does not
automatically run an ontology-learning model over the whole Corpus whenever an
agent asks a question.

## 4. Publication: give agents a stable source cut

A source cut is the specific published version of the source collection and its
map. It lets two agents know whether they are reasoning over the same
observations.

```text
Stable Ont address
        |
        v
      head -----> Commit A
                    |
                    +--> source catalog
                    +--> Corpus objects
                    +--> identity and field map
                    +--> chronology and proof bindings
```

The object-storage pattern writes immutable content before advancing the mutable
head with compare-and-swap. An opening pins a source cut; an update does not
silently change the world halfway through that opening's work.

The testbed walkthrough uses local object storage. A provider Adapter changes
how objects and heads are stored, not the distinction between Corpus, Ont and
Ledger. Hosted deployment qualification is separate from explaining or
exercising this local lifecycle.

There is also a scale boundary: opening the current source-native representation
can hydrate corpus-sized structures. Object-storage-native does not yet mean
every read is a lazy remote graph traversal.

## 5. Serving: an agent asks for verified context

The user-facing question could be: “What is the latest recorded status of
ClickupTask CT-17?” The configured query schema maps supported source and field
names to a typed query. The application supplies the namespace so a matching ID
in another workspace cannot answer this question.

```text
Agent question
      |
      v
Bind scope, source-native identity, field and time
      |
      v
Eligible reviewed knowledge? ---- yes ---> revalidate its proof
      |
      no
      |
      v
BM25: find a plausible neighborhood
      |
      v
Ont: resolve the complete scoped identity census
      |
      +--> check chronology
      +--> select the requested field
      +--> include mapped qualifications / contradictions
      |
      v
Inspect exact authorized Corpus bytes
      |
      v
Verification: usable context or a typed refusal
```

The reviewed-knowledge branch requires an opening configured for
admitted-knowledge reuse. Without it, verification follows the fresh path.

For `ClickupTask CT-17`, search might return several plausible documents. The
Ont identifies the observations belonging to this exact object and selects the
relevant status under the time contract. Exact inspection then retrieves the
bytes spelling `in progress`.

The result includes context, source cut, selected identity, source location and
verification receipts.

```text
Verification
  answerable:  true
  scope:       example-workspace / clickup / task / CT-17
  time:        latest recorded observation in Commit A
  context:     in progress
  evidence:    exact source bytes + range + hashes
  receipts:    identity, resolution and verification
```

This block is explanatory output, not a literal serialized API response. An
agent can use that context to answer in natural language. The deterministic
source-native kernel does not need an answer model to establish this field
value.

If verification cannot complete, the result identifies the reason:

- Ambiguous identity or unmapped field.
- Incomplete source census.
- Missing or unverifiable Evidence.

The semantic kernel can also evaluate explicitly mapped qualification and
contradiction relations. Our `ClickupTask` status example has no such relations.
It does not demonstrate automatic discovery of counterevidence in arbitrary
prose.

## 6. Learning: preserve reviewed work, not just an answer

The managed capture path can return valid context now and separately propose the
source-grounded work for reuse. The first answer need not wait for an Admission.

```text
Fresh verified context
       |
       +---------------------------> return context to agent
       |
       v
Compile a source-grounded knowledge bundle
       |
       v
Proposer signs the proposal
       |
       v
Independent reviewer reconstructs and checks the proof
       |
       v
Reviewer signs an Admission
       |
       v
Append to the knowledge branch
```

The bundle records the question and typed query, source cut, proof obligations,
proposition and relation bindings, relevant census, Evidence references and
provenance.

An Admission makes that knowledge eligible for reuse under its bindings. It does
not promote the stored answer above its sources. The reviewer checks the proof
contract; it is not necessarily a second language model debating the business
conclusion.

If capture fails after verification succeeds, valid context can still be
returned. If review fails, the proposal does not become admitted knowledge.
These are separate outcomes.

## 7. Next-agent reuse: shorter work, with proof checks retained

When another agent asks an eligible question against the same source cut, the
Resolver can consult reviewed knowledge before doing fresh raw search.

```text
Next agent
    |
    v
Check knowledge head and accepted history
    |
    v
Find an authorized, eligible Admission
    |
    v
Re-evaluate its proof against the current opening
    |
    v
Inspect exact source Evidence
    |
    v
Return verified context
```

For this `ClickupTask`, reuse can skip BM25. Proof checks and source inspection
still run.

Current eligibility includes exact question and query bindings. It is not a
general semantic cache that recognizes every paraphrase. A warm opening can
refresh knowledge eligibility, while source-cut and trust bindings remain pinned
to the opening's contract.

Invalid or ineligible knowledge falls back to the ordinary path when that path
is available. Distinct conflicting eligible conclusions must not be resolved by
arbitrarily picking one.

## 8. Reconciliation: update without erasing how we got here

There are three different changes to keep separate.

### A new source observation

Suppose a later capture records `complete`. This is a hypothetical continuation,
not another observation from our testbed example.

```text
Commit A                         Commit B
========                         ========
April: to do                     April: to do
May:   in progress               May:   in progress
                                 Later: complete

Existing opening -> A            New opening -> B
```

Publication adds the new observation and advances the head. Earlier bytes and
history remain. An existing opening does not silently move from A to B; the
local product guard can require reopening when its published bindings drift.

Knowledge admitted for A does not automatically carry forward as proof for B.
Eligibility must be established against the new source cut.

### A correction to reviewed knowledge

An explicit correction can supersede earlier knowledge while preserving its history.

```text
Knowledge K1 ---- superseded by ----> Knowledge K2
      |                                    |
      +----------- history retained -------+

Corpus bytes: unchanged by this correction
```

This is a knowledge decision, not a rewrite of the source. “Newest timestamp
wins” is not a general reconciliation policy.

### Learning a better way to search

A procedural learning path is a different faculty from admitted factual reuse.

```text
Authorized Episodes
        |
        v
Independent group / authority requirements
        |
        v
Compile a SearchPolicy
        |
        v
Explicit activation
        |
        v
Later Resolver uses the policy for navigation
```

This path is experimental and does not ship in the public package. A SearchPolicy
guides navigation; it does not become factual Evidence. The public kernel's
reviewed proof reuse, described above, does not require it.

## 9. What changes when an agent touches an Ont?

Reading and learning are not interchangeable mutations.

```text
Operation                       What it can change
=========                       ==================
search / read                   No trusted knowledge mutation
ordinary public verify          No automatic Admission
managed verify with capture     May create a pending proposal
independent review              May append admitted knowledge
source publication              Publishes a new source cut
explicit correction             May supersede earlier knowledge
recovery                        Restores an accepted state
```

Counters and logs do not update trusted knowledge. Recovery restores accepted
state without creating new Evidence.

## 10. What makes this an ontology, not just an index?

The compiler links typed identities, declared field meanings, proposition roles,
temporal relations and scoped entity neighborhoods.

There are several kinds of link, and they should not be collapsed into one
unlabeled edge:

- Identity links group observations with the same complete source-native identity.
- Revision links connect changes to the same field of that identity.
- Evidence links bind a field or proposition to exact source bytes.
- Declared business-entity keys group related records within a namespace without claiming the records are the same object.
- Declared proposition relations express qualification and contradiction, and their targets must exist in the scoped projection.
- Knowledge links preserve the provenance, review and supersession of reusable work.

The input Adapter supplies the identities, meanings and semantic assertions it
can justify. The compiler validates and links them. The Resolver navigates the
constructed map. Verification checks whether that route satisfies the question's
proof obligations.

The current lexicon includes:

- Declared object-type and field aliases in query schemas.
- Supported names resolved against the complete typed identity census.
- Authored concept ObjectDefs, scoped aliases and source-attachment Claims.

Automatic concept discovery, synonym learning, cross-system equivalence and
database/code-map constructors are not part of this public kernel.

### The next layer: maps of ideas

A future construction-time studying process could extract candidate names,
concepts and relationships from source material, attach their Evidence and
scope, and propose them for review. Accepted links could then guide later
Resolvers.

```text
ClickupTask CT-17 ---- mentions ----> Inventory reconciliation
                                        ^
                                        |
Source document ----- defines ----------+

Each candidate link carries:
  source identity + exact span + relation meaning
  scope + temporal applicability + review state
```

This is an illustrative future map, not a link extracted from the status
example. A `mentions` edge helps navigation; it does not prove a causal
relationship. Two sources using the same phrase do not automatically describe
the same entity.

The [canonical record homes](../GLOSSARY.md#canonical-record-homes) already cover
entities, assertions, relations and Evidence. Automatic construction still needs
an extraction, review and evaluation loop.

The current implementation favors auditable, declared semantics over automatic
conceptual discovery.

### Executable concept map

Alpha.3 includes an authored version of this loop. Run the packaged
[semantic-map example](../examples/quickstart/semantic-map.mjs)
from the installed package, using a new output directory:

```sh
node node_modules/oont/examples/quickstart/semantic-map.mjs ./semantic-map-demo
```

The example builds three synthetic sources, an `AllocationException` ObjectDef,
the scoped alias `allocation mismatch`, and `defines` / `mentions` Claims. It
signs and stores a construction Admission with separate ephemeral keys, then
opens a fresh client. Keys are not written to disk. The signature step tests
mechanics; a real reviewer must inspect the source interpretation before signing.

```js
import { openSourceNativeProductWithConstruction } from 'oont/kernel';

const ont = openSourceNativeProductWithConstruction(options, { trustRegistry });
const found = await ont.search({
  term: 'allocation mismatch',
  scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' },
  limit: 20,
});
// Totals describe the full result; matches and concepts describe this page.
// Both resolved and ambiguous results can be inspected without merging identities.
if (found.state === 'unavailable-construction-navigation' || found.state === 'no-construction-match') {
  throw new Error(found.state);
}
const selected = found.matches.find(match => match.nativeObject.externalId === 'CT-17');
if (!selected) throw new Error('Requested ClickupTask is not in this page');
const passage = await ont.read({ ref: selected.ref });
const checked = await ont.verify({
  question: 'What is the current status?',
  typedQuery: {
    sourceSystem: 'clickup', objectType: 'ClickupTask', fieldPath: 'status',
    externalId: passage.binding.nativeObject.externalId,
  },
});
```

This example uses the kernel construction product, whose verification input
uses its internal `typedQuery` shape. The root `openOntology` client uses the
public `scope` shape instead; do not copy `typedQuery` into the root client.

This uses `oont/kernel`; it does not silently activate construction in the root
SDK or CLI. To serve an explicitly configured client over MCP, use the same
canonical handler:

```js
import { createSourceNativeProductMcpHandler } from 'oont/kernel';

const handler = createSourceNativeProductMcpHandler(ont, { profile: 'advanced' });
// Forward incoming JSON-RPC messages to handler.handle(message).
// Tools remain search and read. Search accepts a question OR a term, not both.
```

The default MCP profile exposes only `verify`. Construction-enabled advanced
handlers add metadata paging and exact reads, without review or Admission tools.

The example also exercises:

- Pagination and refusal of an unbound two-object factual query.
- Correction, invalidation of old read handles, cold reopen and reviewer revocation.
- Refusal to overwrite an existing output directory.

The retained Ont can be inspected, but its discarded ephemeral keys are not a
production review setup.

When using concept search:

- Supply a complete preferred name or declared alias, not an arbitrary question.
- Inspect ambiguous candidates, then select a `conceptId` or narrower scope.
  Use `nextCursor` for more results. Ambiguity describes the full result, not one page.
- The example selects a known `ClickupTask`. For an unfamiliar target, inspect
  and compare candidates first. Empty results do not prove absence.
- Reads return source passages. Their `mentions` or `defines` interpretation
  guides navigation; the subsequent field Verification establishes factual proof.

For a source-grounded review, open a review session before asking the independent
signer to approve the construction:

```js
import { openSourceNativeConstructionReview } from 'oont/kernel';

const review = openSourceNativeConstructionReview({ options, construction });
// Hand review.packet to an authorized independent human or model reviewer.
// It contains complete cited documents, not just the proposer's chosen spans.
const result = review.evaluate(reviewerResponse);
if (result.disposition !== 'accepted') throw new Error(result.disposition);
// Still unsigned. The independent reviewer separately decides whether to sign
// the unchanged construction using the existing Admission procedure.
```

The response names `packetSha256` and includes one decision per item:
`itemSha256`, `decision` (`accept`, `reject` or `abstain`), `reason`, and
`citations` containing exact `sourceRef` / `quote` pairs. Unknown sources,
omitted or duplicate item decisions, and fabricated quotes fail protocol
validation. A rejection cannot
be removed to approve a smaller implicit batch. A syntactically valid response
can still be a bad judgment; source interpretation must be independently tested.

The example exercises the mechanics. It does not evaluate semantic-review
quality, automatic studying or managed production readiness.

## The whole lifecycle, in one paragraph

Vacuum brings observations in. Corpus preserves them. Ont makes them navigable
and checkable. Resolvers find a path. Verification produces usable context.
Ledger preserves reviewed work so the next agent can get there more efficiently.
Updates and corrections change what is eligible without erasing how we got
there.

For executable local steps, see [Source input and updates](SOURCE-LIFECYCLE.md).
For the current public boundaries, see [Architecture](ARCHITECTURE.md),
[Storage](STORAGE.md) and the [Glossary](../GLOSSARY.md).
