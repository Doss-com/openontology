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

`verify` searches the Ont, checks identity and chronology, reads the required
source text, and returns context with verification receipts. It does not generate
a natural-language answer or update the source.

## Results and refusals

A result describes the source snapshot opened by this client. A current-field
result requires complete, unambiguous recorded chronology. It does not claim to
know what changed in the live system after capture.

Check `answerable` before using the returned context. A refusal identifies why
verification could not complete, such as an ambiguous identity, an unsupported
field or incomplete chronology. Results can include `availableFields` to help
you choose a declared field.

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

The root client exposes:

```ts
interface OpenOntologyProduct {
  verify(query: string | OpenOntologyQueryInput): Promise<OpenOntologyVerificationResult>;
  search(query: string | OpenOntologyQueryInput): Promise<OpenOntologySearchResult>;
  read(ref: string | { ref: string }): Promise<OpenOntologyReadResult>;
  status(): OpenOntologyStatus;
}
```

See the [exported types](https://github.com/Doss-com/openontology/blob/v0.3.0-alpha.4/src/openontology.ts)
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
ID in the question must agree with `scope.externalId`. A conflicting profile,
field or ID returns a refusal. If an opaque ID does not reveal its object type,
include the type in the question or provide scope.

Identity comes from the complete scoped map, not the highest-ranked search hit.

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
