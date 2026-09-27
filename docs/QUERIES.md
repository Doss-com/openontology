# Queries and results

Build the example Ont with the [quickstart](../README.md#two-minute-quickstart),
then open it from JavaScript or TypeScript:

```js
import { openOntology } from 'oont';

const ont = openOntology({ artifactRoot: './verified-context' });
const result = await ont.verify('What is the current title of task-1?');

if (result.answerable) {
  console.log(result.context);
} else {
  console.log(result.state);
}
```

`verify` returns checked source context for one declared field. It resolves
identity and chronology, reads exact source passages, and includes any required
qualifying or contradicting evidence. It does not generate a prose answer or
update the source. A quoted plan is not confirmation that it happened.

## Results and refusals

A result describes the source snapshot opened by this client. A current-field
result requires complete, unambiguous recorded chronology. It does not claim to
know what changed in the live system after capture.

Check `answerable` before using the returned context. A refusal identifies why
verification could not complete, such as an ambiguous identity, an unsupported
field or incomplete chronology. Results can include `availableFields` to help
you choose a declared field.

If the question contains meaning beyond the selected native field, verification
returns `unavailable-native-question-residual-not-declared` and lists the
uncovered words in `uncoveredWords`. This check accounts for declared aliases,
identity and quoted-name selectors, and a small query grammar. It does not claim
to understand arbitrary language, and a field selector does not authorize an
answer to a different question about that field.

Unbound ordering qualifiers such as `after Alpha` and live-source qualifiers
such as `real-time updates` remain uncovered residual meaning. Use the
supported `intent` and `anchorValue` inputs for successor questions, or issue a
plain query against the captured source snapshot.

An exact typed identity absent from a complete catalog can receive an absence
receipt with `answerable: false` and no context. This establishes absence within
that catalog, not everywhere. An empty search result alone cannot establish it.

Result states are exported as `OpenOntologyResultState`. States beginning with
`unavailable-` are normal typed refusals, not transport failures. Invalid input
or corrupt storage can still throw errors.

## Search and read

Use `verify` when you want checked context. Use `search` followed by `read` when
you want to inspect candidates yourself:

```js
const candidates = await ont.search('What is the current title of task-1?');
for (const match of candidates.matches) {
  const passage = await ont.read(match.ref);
  console.log(passage);
}
```

References belong to the client that issued them. Wait for search to return and
pass its References to `read` on that same client. Reads of already-issued
References can run concurrently. Reading a candidate does not perform all of
the checks made by `verify`.

To navigate the native identities recorded in an Ont, use the separate browse
input. It returns metadata only, including observed queryable fields. It does
not return field values, References or an absence claim:

```js
const page = await ont.search({
  browse: 'objects',
  scope: { sourceSystem: 'tracker', objectType: 'task' },
  limit: 20,
});
for (const row of page.objects) {
  console.log(row.objectIdentity, row.fields);
}
```

SDK and advanced MCP `limit` values are page sizes from 1 through 64. A cursor
can only be passed to the same opened client and is bound to its source cut and
scope. The result is navigation, not proof. Select a row and use its full
identity as qualifiers for ordinary `verify`.
This source-native browse path is separate from construction MCP, which
continues to use question or term search for configured navigation.

The root client exposes:

```ts
interface OpenOntologyProduct {
  verify(query: string | OpenOntologyQueryInput): Promise<OpenOntologyVerificationResult>;
  search(query: string | OpenOntologyQueryInput): Promise<OpenOntologySearchResult>;
  search(query: OpenOntologyObjectDiscoveryInput): Promise<OpenOntologyObjectDiscoveryResult>;
  read(ref: string | { ref: string }): Promise<OpenOntologyReadResult>;
  status(): OpenOntologyStatus;
}
```

See the [exported types](https://github.com/Doss-com/openontology/blob/v0.3.0-alpha.6/src/openontology.ts)
for complete result shapes.

## Typed scope

Natural language can be narrowed with an explicit source scope:

```js
await ont.verify({
  question: 'What is the current title?',
  scope: {
    sourceSystem: 'tracker',
    objectType: 'task',
    externalId: 'task-1',
    field: 'title',
  },
});
```

The same query through the CLI:

```bash
npx --no-install oont verify ./verified-context \
  'What is the current title?' \
  --source-system tracker \
  --object-type task \
  --external-id task-1 \
  --field title
```

Scope names are case-sensitive and must match the Adapter schema. An explicit
ID in the question must agree with `scope.externalId`. A conflicting profile or
ID returns a refusal. An explicit `scope.field` selects that field even when
the question names another declared field; the other field word remains
subject to lexical coverage and may return a typed refusal. If an opaque ID does
not reveal its object type, include the type in the question or provide scope.

For example, `What is the date of decision decision-1?` with an explicit scope
targeting object type `decision` and field `statement` selects `statement`, but
`date` remains subject to the coverage audit. When the declared ID and other
selectors are covered, it returns
`unavailable-native-question-residual-not-declared` with `date` uncovered and no
context. It is not answerable by this rule; the explicit scope does not claim
that the broader question is semantically understood.

When a question places an identifier-shaped token directly after a declared
object alias, the token must be a known ID in the bound map or agree with an
explicit `scope.externalId`. An unknown or conflicting token returns a typed
refusal instead of falling back to a different unique object. Generic
unique-object questions without a named identifier remain supported. An
explicit `scope.externalId` that is absent from the bound catalog retains the
catalog-scoped absence receipt path.

With a typed object scope, an identifier-shaped token directly after `of` or
`for` is also treated as an object selector when the object alias is omitted.
The supplied successor `anchorValue` is a field value, not an object selector.

Identity comes from the complete scoped map, not the highest-ranked search hit.

The CLI has a bounded aggregate form for fresh-agent navigation:

```bash
npx --no-install oont search ./verified-context --browse objects \
  --source-system tracker --object-type task --limit 128
```

CLI `--limit` is the total row count for that invocation, defaults to 64 and
has a maximum of 256. The command follows same-process SDK pages internally,
caps serialized output at 1 MiB, returns complete rows only, and reports
`truncated` with a reason when capped. It does not emit or accept a portable
cursor. Browse mode rejects question, field, `--read`, and temporal options.

## Declared titles

An Adapter with complete `title` coverage can identify an object by a quoted name:

```js
await ont.verify('What is the current status of the task titled "Release review"?');
```

This requires a source with that title and a declared `status` field; it is not
a question for the quickstart's title-only schema.

Use one `titled "..."` or `named "..."` clause. Matching normalizes Unicode,
case and whitespace, while preserving punctuation. Unknown or ambiguous names,
incomplete coverage and conflicting IDs return no context. Recorded titles can
identify an object across revisions; the requested value still follows chronology.

## Temporal intent

`current` is the default intent. OpenOntology does not infer a historical
operation from question wording. A question about a prior value, a date, a change
or relative ordering without a supported selector returns
`unavailable-native-temporal-intent-not-declared` with `answerable: false`.

`next` selects the field revision that immediately followed an exact anchor value:

```bash
npx --no-install oont verify ./verified-context \
  'What title immediately followed Prepare launch for task-1?' \
  --intent next
```

For a point-in-time query:

```js
await ont.verify({
  question: 'What was the title of task-1?',
  at: '2026-01-15T00:00:00.000Z',
});
```

- CLI uses `--at`; MCP uses `at`. Supply a UTC ISO timestamp with milliseconds.
- Do not combine `at` with `intent: next` or `anchorValue`.
- For `next`, `anchorValue` is the previous field value, not the object's ID.
  Omit both selectors for current-value questions.

An `at` query selects what was valid within the source snapshot, including
later-learned corrections. It does not reconstruct what was known then. Missing
`validAt` falls back to observation time. Requests outside the recorded horizon
or with unresolved chronology return no context.

See [Architecture](ARCHITECTURE.md) for temporal and counterevidence rules.

## MCP

Start the default server to expose one tool, `verify`:

```bash
npx --no-install oont serve ./verified-context --mcp
```

A verification request needs only `question`:

```json
{ "question": "What is the current title of task-1?" }
```

Optional `scope`, `intent`, `at` and `anchorValue` follow the rules above. The
advanced profile exposes `search` and `read` instead of `verify`:

```bash
npx --no-install oont serve ./verified-context --mcp --advanced
```

The stdio server writes startup status JSON to stderr before serving requests.
Use stdout for JSON-RPC messages and stderr for diagnostics.

## Check the Ont itself

`verify` answers a question against an Ont. CLI `check` validates the Ont itself;
`status` returns a diagnostic snapshot of the validated Ont. The SDK also
provides `ont.status()`.

Both commands reject corrupt storage or invalid descriptors. Neither refreshes
the original source or rebuilds the Ont. For that, see [Source input and
updates](SOURCE-LIFECYCLE.md).
