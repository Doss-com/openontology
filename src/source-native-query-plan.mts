/** Bind product questions to declared source-native fields and identities. */
import { stableObjectSha256 } from './canonical-content.mjs';
import { compileSourceNativeFieldQuery } from './source-native-query-planner.mjs';
import type {
  QuerySchema,
  SourceNativeFieldQuery,
  SourceNativeQueryPlanState,
} from './source-native-query-planner.mjs';
import type { SourceNativeField, SourceNativeObjectMap } from './source-native-object-map.mjs';
import type { FieldQueryPlanner, ValidatedFieldQueryPlan } from './source-native-resolver-support.mjs';

const EXTERNAL_ID_COLLISION = Symbol('external-id-collision');
const EXTERNAL_ID_MULTIPLE = Symbol('external-id-multiple');
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function normalizedQuestion(value: unknown): string {
  return String(value).normalize('NFKC').toLocaleLowerCase('en-US');
}
const EXPLICIT_CURRENT_TIME = /\b(?:current|currently|latest|present|right now|now|today)\b/u;
const HISTORICAL_TIME = /\b(?:was|were|previous|previously|prior|original|originally|initial|initially|former|formerly|earlier|historical|history)\b/u;
const RELATIVE_TIME = /\b(?:yesterday|tomorrow|last (?:week|month|year)|next (?:week|month|year)|at the time|as of|ago|future|upcoming)\b/u;
const CHANGE_OVER_TIME = /\b(?:has|have|had|did|when)\b[^?]{0,80}\b(?:change|changed)\b|\b(?:change|revision|status) history\b|\bhow many times\b/u;
const ORDERED_TIME = /\b(?:before|after|followed|following|preceded|preceding|succeeded|succeeding)\b/u;
const CALENDAR_TIME = /\b(?:on|in|at|as of)\s+(?:(?:19|20)\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2},?)?(?:\s+(?:19|20)\d{2})?)\b/u;

function hasUndeclaredTemporalIntent(question: string, intent: 'current' | 'next'): boolean {
  if (intent !== 'current') return false;
  const text = normalizedQuestion(question);
  return HISTORICAL_TIME.test(text)
    || RELATIVE_TIME.test(text)
    || CHANGE_OVER_TIME.test(text)
    || CALENDAR_TIME.test(text)
    || ORDERED_TIME.test(text) && !EXPLICIT_CURRENT_TIME.test(text);
}
function mentionedExternalId(question: string, map: SourceNativeObjectMap, namespace: string,
  query: SourceNativeFieldQuery): { value: string | symbol | null; candidates: string[]; unresolvedExternalIds: string[] } {
  const text = normalizedQuestion(question);
  let unsafeMention = false;
  const knownExternalIds = [...new Set(map.nativeObjects.filter((object) =>
    object.objectIdentity.namespace === namespace
    && object.objectIdentity.sourceSystem === query.sourceSystem
    && object.objectIdentity.objectType === query.objectType)
    .map((object) => object.objectIdentity.externalId))];
  const candidates = knownExternalIds.filter((externalId) => {
    const needle = normalizedQuestion(externalId);
    let index = text.indexOf(needle);
    while (index >= 0) {
      const before = index === 0 ? '' : text[index - 1];
      const after = index + needle.length === text.length ? '' : text[index + needle.length];
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
      unsafeMention = true;
      index = text.indexOf(needle, index + 1);
    }
    return false;
  });
  const identifierTokens = text.match(/[\p{L}\p{N}]+(?:[-_:./][\p{L}\p{N}]+)+/gu) ?? [];
  const identifierShape = (value: string): string => value.replace(/\p{N}+/gu, '#');
  const knownByText = new Set(knownExternalIds.map(normalizedQuestion));
  const knownShapes = new Set([...knownByText].map(identifierShape));
  const unresolvedExternalIds = [...new Set(identifierTokens.filter((token) =>
    !knownByText.has(token) && knownShapes.has(identifierShape(token))))].sort();
  if (candidates.length > 1 || candidates.length === 1 && unresolvedExternalIds.length > 0) {
    return { value: EXTERNAL_ID_MULTIPLE, candidates: candidates.sort(), unresolvedExternalIds };
  }
  if (candidates.length === 1) {
    return { value: candidates[0], candidates, unresolvedExternalIds };
  }
  return {
    value: unsafeMention || unresolvedExternalIds.length > 0 ? EXTERNAL_ID_COLLISION : null,
    candidates: [],
    unresolvedExternalIds,
  };
}
function normalizedAnchorValue(value: unknown): string {
  return String(value).normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

function bindHistoricalAnchor({ question, explicitAnchorValue, map, namespace, query }: {
  question: string;
  explicitAnchorValue: string | null;
  map: SourceNativeObjectMap;
  namespace: string;
  query: SourceNativeFieldQuery;
}): { state: 'resolved-native-field-query' | 'unavailable-native-object-identifier-not-declared' | 'unavailable-native-field-anchor-not-matched' | 'unavailable-native-field-anchor-ambiguous'; query: SourceNativeFieldQuery | null } {
  if (query.externalId === undefined) {
    return { state: 'unavailable-native-object-identifier-not-declared', query: null };
  }
  const fields = map.nativeObjects.filter((object) =>
    object.objectIdentity.namespace === namespace
    && object.objectIdentity.sourceSystem === query.sourceSystem
    && object.objectIdentity.objectType === query.objectType
    && object.objectIdentity.externalId === query.externalId)
    .map((object) => object.fields.find((field) => field.fieldPath === query.fieldPath))
    .filter((field): field is SourceNativeField => field !== undefined);
  const requested = explicitAnchorValue === null ? null : normalizedAnchorValue(explicitAnchorValue);
  const questionText = ` ${normalizedAnchorValue(question)} `;
  const matches = fields.filter((field) => {
    const fieldValue = normalizedAnchorValue(field.value);
    return fieldValue && (requested === null
      ? questionText.includes(` ${fieldValue} `)
      : fieldValue === requested);
  });
  const uniqueMatches = [...new Map(matches.map((field) => [field.fieldSha256, field])).values()];
  if (uniqueMatches.length !== 1) {
    return {
      state: uniqueMatches.length > 1
        ? 'unavailable-native-field-anchor-ambiguous'
        : 'unavailable-native-field-anchor-not-matched',
      query: null,
    };
  }
  const anchorField = uniqueMatches[0];
  if (!anchorField) return { state: 'unavailable-native-field-anchor-not-matched', query: null };
  return {
    state: 'resolved-native-field-query',
    query: freeze({ ...query, anchorFieldSha256: anchorField.fieldSha256 }),
  };
}

export function compileProductQueryPlan({ question, namespace, querySchemas, map, intent,
  anchorValue = null, typedQuery = null }: {
    question: string;
    namespace: string;
    querySchemas: QuerySchema[];
    map: SourceNativeObjectMap;
    intent: 'current' | 'next';
    anchorValue?: string | null;
    typedQuery?: SourceNativeFieldQuery | null;
  }) {
  let state: SourceNativeQueryPlanState | 'unavailable-native-object-identifier-not-declared'
    | 'unavailable-native-multiple-object-identifiers' | 'unavailable-native-field-anchor-not-matched'
    | 'unavailable-native-field-anchor-ambiguous' | 'unavailable-native-field-not-declared'
    | 'unavailable-native-temporal-intent-not-declared';
  let query: SourceNativeFieldQuery | null;
  let matchedObjectAliases: string[];
  let matchedFieldAliases: string[];
  let plannerSchemaSha256: string;
  let mentionedExternalIds: string[] = [];
  let unresolvedExternalIds: string[] = [];
  if (typedQuery === null) {
    const compiled = compileSourceNativeFieldQuery({ question, schemas: querySchemas });
    state = compiled.state;
    query = compiled.query;
    matchedObjectAliases = compiled.matchedObjectAliases;
    matchedFieldAliases = compiled.matchedFieldAliases;
    plannerSchemaSha256 = compiled.plannerSchemaSha256;
  } else {
    if (typeof typedQuery?.sourceSystem !== 'string' || !typedQuery.sourceSystem
      || typeof typedQuery.objectType !== 'string' || !typedQuery.objectType
      || typeof typedQuery.fieldPath !== 'string' || !typedQuery.fieldPath
      || typedQuery.externalId !== undefined
        && (typeof typedQuery.externalId !== 'string' || !typedQuery.externalId)) {
      fail('SOURCE_NATIVE_PRODUCT_QUERY');
    }
    const schema = querySchemas.find((candidate) =>
      candidate.sourceSystem === typedQuery.sourceSystem
      && candidate.objectType === typedQuery.objectType);
    const field = schema?.fields.find((candidate) => candidate.fieldPath === typedQuery.fieldPath);
    state = schema === undefined ? 'unavailable-native-object-type-not-declared'
      : field === undefined ? 'unavailable-native-field-not-declared'
        : 'resolved-native-field-query';
    query = state === 'resolved-native-field-query' ? { ...typedQuery } : null;
    matchedObjectAliases = [];
    matchedFieldAliases = [];
    plannerSchemaSha256 = stableObjectSha256(querySchemas);
  }
  if (query !== null) {
    const mention = query.externalId === undefined
      ? mentionedExternalId(question, map, namespace, query)
      : { value: query.externalId, candidates: [], unresolvedExternalIds: [] };
    const externalId = mention.value;
    mentionedExternalIds = mention.candidates;
    unresolvedExternalIds = mention.unresolvedExternalIds;
    if (externalId === EXTERNAL_ID_COLLISION) {
      state = 'unavailable-native-object-identifier-not-declared';
      query = null;
    } else if (externalId === EXTERNAL_ID_MULTIPLE) {
      state = 'unavailable-native-multiple-object-identifiers';
      query = null;
    } else {
      query = freeze({ ...query, namespace,
        ...(typeof externalId === 'string' ? { externalId } : {}) });
    }
  }
  if (query !== null && hasUndeclaredTemporalIntent(question, intent)) {
    state = 'unavailable-native-temporal-intent-not-declared';
    query = null;
  }
  if (query !== null && intent === 'next') {
    const anchor = bindHistoricalAnchor({
      question,
      explicitAnchorValue: anchorValue,
      map,
      namespace,
      query,
    });
    state = anchor.state;
    query = anchor.query;
  }
  const plannerSha256 = stableObjectSha256({
    adapter: 'source-native-product-query-v2', namespace, querySchemas,
  });
  const core = {
    schema: 1,
    kind: 'OpenOntologySourceNativeFieldQueryPlanV1',
    state,
    namespace,
    query,
    mentionedExternalIds: freeze(mentionedExternalIds),
    unresolvedExternalIds: freeze(unresolvedExternalIds),
    matchedObjectAliases: freeze(matchedObjectAliases),
    matchedFieldAliases: freeze(matchedFieldAliases),
    questionSha256: stableObjectSha256({ question }),
    plannerSchemaSha256,
    plannerSha256,
    modelCalls: 0,
    networkCalls: 0,
    targetLeakage: false,
    navigationOnly: true,
    exactInspectRequired: true,
    exactSourcesRemainAuthority: true,
  };
  return freeze({ ...core, planSha256: stableObjectSha256(core) });
}

export function queryPlanner({ namespace, plan }: {
  namespace: string;
  plan: ValidatedFieldQueryPlan;
}): FieldQueryPlanner {
  const plannerSha256 = plan.plannerSha256;
  return freeze({
    kind: 'OpenOntologySourceNativeFieldQueryPlannerV1',
    adapter: 'source-native-product-query-v2',
    namespace,
    plannerSha256,
    modelCalls: 0,
    networkCalls: 0,
    plan: ({ question }: { question: string }) => {
      if (stableObjectSha256({ question }) !== plan.questionSha256) fail('SOURCE_NATIVE_PRODUCT_QUERY');
      return plan;
    },
  });
}
