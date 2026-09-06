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
import { normalizeSourceNativeHistoricalTime } from './source-native-historical-field.mjs';

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
function normalizedDeclaredTitle(value: unknown): string {
  return String(value).normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ').trim();
}
const EXPLICIT_CURRENT_TIME = /\b(?:current|currently|latest|present|right now|now|today)\b/u;
const HISTORICAL_TIME = /\b(?:was|were|previous|previously|prior|original|originally|initial|initially|former|formerly|earlier|historical|history)\b/u;
const RELATIVE_TIME = /\b(?:yesterday|tomorrow|last (?:week|month|year)|next (?:week|month|year)|at the time|as of|ago|future|upcoming)\b/u;
const CHANGE_OVER_TIME = /\b(?:has|have|had|did|when)\b[^?]{0,80}\b(?:change|changed)\b|\b(?:change|revision|status) history\b|\bhow many times\b/u;
const ORDERED_TIME = /\b(?:before|after|followed|following|preceded|preceding|succeeded|succeeding)\b/u;
const CALENDAR_TIME = /\b(?:on|in|at|as of)\s+(?:(?:19|20)\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2},?)?(?:\s+(?:19|20)\d{2})?)\b/u;

function hasUndeclaredTemporalIntent(question: string, intent: 'current' | 'next' | 'at'): boolean {
  if (intent !== 'current') return false;
  const text = normalizedQuestion(question);
  return HISTORICAL_TIME.test(text)
    || RELATIVE_TIME.test(text)
    || CHANGE_OVER_TIME.test(text)
    || CALENDAR_TIME.test(text)
    || ORDERED_TIME.test(text) && !EXPLICIT_CURRENT_TIME.test(text);
}

interface DeclaredTitleParse {
  normalizedTitle: string | null;
  scanQuestion: string;
  refusal: 'unavailable-native-object-identifier-not-declared' | null;
}

function parseDeclaredTitle(question: string): DeclaredTitleParse {
  const clause = /\b(?:titled|named)\s*"/giu;
  let searchOffset = 0;
  let parsed: { normalizedTitle: string; openingQuote: number; closingQuote: number } | null = null;
  while (searchOffset < question.length) {
    clause.lastIndex = searchOffset;
    const match = clause.exec(question);
    if (match === null) break;
    const openingQuote = match.index + match[0].length - 1;
    let literal = '';
    let closingQuote = -1;
    for (let index = openingQuote + 1; index < question.length; index += 1) {
      const character = question[index];
      if (character === '\\') {
        const escaped = question[index + 1];
        if (escaped !== '"' && escaped !== '\\') {
          return {
            normalizedTitle: null,
            scanQuestion: question,
            refusal: 'unavailable-native-object-identifier-not-declared',
          };
        }
        literal += escaped;
        index += 1;
        continue;
      }
      if (character === '"') {
        closingQuote = index;
        break;
      }
      literal += character;
    }
    const normalizedTitle = normalizedDeclaredTitle(literal);
    if (closingQuote < 0 || !normalizedTitle) {
      return {
        normalizedTitle: null,
        scanQuestion: question,
        refusal: 'unavailable-native-object-identifier-not-declared',
      };
    }
    if (parsed !== null) {
      return {
        normalizedTitle: null,
        scanQuestion: question,
        refusal: 'unavailable-native-object-identifier-not-declared',
      };
    }
    parsed = { normalizedTitle, openingQuote, closingQuote };
    searchOffset = closingQuote + 1;
  }
  if (parsed === null) return { normalizedTitle: null, scanQuestion: question, refusal: null };
  const scanQuestion = `${question.slice(0, parsed.openingQuote)}${' '.repeat(parsed.closingQuote - parsed.openingQuote + 1)}${question.slice(parsed.closingQuote + 1)}`;
  return { normalizedTitle: parsed.normalizedTitle, scanQuestion, refusal: null };
}

function explicitNamespaceRefusal(question: string, namespace: string): boolean {
  const match = normalizedQuestion(question).match(/^\s*for\s+([^,?]+),/u);
  return match !== null && normalizedDeclaredTitle(match[1]) !== normalizedDeclaredTitle(namespace);
}

function bindDeclaredTitle({ normalizedTitle, map, namespace, query, visibleExternalId }: {
  normalizedTitle: string;
  map: SourceNativeObjectMap;
  namespace: string;
  query: SourceNativeFieldQuery;
  visibleExternalId: string | null;
}): { query: SourceNativeFieldQuery | null; state:
  'unavailable-native-object-identifier-not-declared'
  | 'unavailable-native-object-seed-ambiguous'
  | 'unavailable-native-multiple-object-identifiers' | null } {
  if (map.mappedSourceCount !== map.sourceCount || map.unsupportedSourceCount !== 0
    || map.parseFailureCount !== 0) {
    return { query: null, state: 'unavailable-native-object-identifier-not-declared' };
  }
  const scopedObjects = map.nativeObjects.filter((object) =>
    object.objectIdentity.namespace === namespace
    && object.objectIdentity.sourceSystem === query.sourceSystem
    && object.objectIdentity.objectType === query.objectType);
  if (scopedObjects.length === 0 || scopedObjects.some((object) =>
    !object.fields.some((field) => field.fieldPath === 'title'))) {
    return { query: null, state: 'unavailable-native-object-identifier-not-declared' };
  }
  const matchingObjects = scopedObjects.filter((object) => object.fields.some((field) =>
    field.fieldPath === 'title' && normalizedDeclaredTitle(field.value) === normalizedTitle));
  const matchingIdentities = new Map(matchingObjects.map((object) => [
    object.objectIdentitySha256, object.objectIdentity,
  ]));
  if (matchingIdentities.size === 0) {
    return { query: null, state: 'unavailable-native-object-identifier-not-declared' };
  }
  if (matchingIdentities.size > 1) {
    return { query: null, state: 'unavailable-native-object-seed-ambiguous' };
  }
  const identity = matchingIdentities.values().next().value;
  if (!identity || visibleExternalId !== null && visibleExternalId !== identity.externalId
    || query.externalId !== undefined && query.externalId !== identity.externalId) {
    return { query: null, state: 'unavailable-native-multiple-object-identifiers' };
  }
  return {
    query: freeze({ ...query, namespace, externalId: identity.externalId }),
    state: null,
  };
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
  anchorValue = null, typedQuery = null, at = null }: {
    question: string;
    namespace: string;
    querySchemas: QuerySchema[];
    map: SourceNativeObjectMap;
    intent: 'current' | 'next' | 'at';
    at?: string | null;
    anchorValue?: string | null;
    typedQuery?: SourceNativeFieldQuery | null;
  }) {
  if (intent === 'at') normalizeSourceNativeHistoricalTime(at);
  else if (at !== null) fail('SOURCE_NATIVE_PRODUCT_QUERY');
  let state: SourceNativeQueryPlanState | 'unavailable-native-object-identifier-not-declared'
    | 'unavailable-native-multiple-object-identifiers' | 'unavailable-native-field-anchor-not-matched'
    | 'unavailable-native-field-anchor-ambiguous' | 'unavailable-native-field-not-declared'
    | 'unavailable-native-temporal-intent-not-declared'
    | 'unavailable-native-object-seed-ambiguous';
  let query: SourceNativeFieldQuery | null;
  let matchedObjectAliases: string[];
  let matchedFieldAliases: string[];
  let plannerSchemaSha256: string;
  let mentionedExternalIds: string[] = [];
  let unresolvedExternalIds: string[] = [];
  const declaredTitle = parseDeclaredTitle(question);
  const scanQuestion = declaredTitle.scanQuestion;
  const namespaceMismatch = declaredTitle.normalizedTitle !== null
    && explicitNamespaceRefusal(scanQuestion, namespace);
  if (typedQuery === null) {
    const compiled = compileSourceNativeFieldQuery({ question: scanQuestion, schemas: querySchemas });
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
    if (declaredTitle.normalizedTitle !== null) {
      const compiled = compileSourceNativeFieldQuery({ question: scanQuestion, schemas: querySchemas });
      if (compiled.state === 'resolved-native-field-query'
        && compiled.query?.sourceSystem === typedQuery.sourceSystem
        && compiled.query.objectType === typedQuery.objectType
        && compiled.query.fieldPath === typedQuery.fieldPath) {
        matchedObjectAliases = compiled.matchedObjectAliases;
        matchedFieldAliases = compiled.matchedFieldAliases;
      }
    }
    plannerSchemaSha256 = stableObjectSha256(querySchemas);
  }
  if (query !== null) {
    const mention = query.externalId === undefined || declaredTitle.normalizedTitle !== null
      ? mentionedExternalId(scanQuestion, map, namespace, query)
      : { value: query.externalId, candidates: [], unresolvedExternalIds: [] };
    const externalId = query.externalId ?? mention.value;
    mentionedExternalIds = mention.candidates;
    unresolvedExternalIds = mention.unresolvedExternalIds;
    if (mention.value === EXTERNAL_ID_COLLISION) {
      state = 'unavailable-native-object-identifier-not-declared';
      query = null;
    } else if (mention.value === EXTERNAL_ID_MULTIPLE) {
      state = 'unavailable-native-multiple-object-identifiers';
      query = null;
    } else {
      query = freeze({ ...query, namespace,
        ...(typeof externalId === 'string' ? { externalId } : {}) });
    }
  }
  if (declaredTitle.refusal !== null || namespaceMismatch) {
    state = declaredTitle.refusal ?? 'unavailable-native-object-identifier-not-declared';
    query = null;
  }
  if (query !== null && declaredTitle.normalizedTitle !== null) {
    const titleBinding = bindDeclaredTitle({
      normalizedTitle: declaredTitle.normalizedTitle,
      map,
      namespace,
      query,
      visibleExternalId: mentionedExternalIds.length === 1 ? mentionedExternalIds[0]! : null,
    });
    if (titleBinding.state !== null) {
      state = titleBinding.state;
      query = null;
    } else {
      query = titleBinding.query;
    }
  }
  if (query !== null && hasUndeclaredTemporalIntent(scanQuestion, intent)) {
    state = 'unavailable-native-temporal-intent-not-declared';
    query = null;
  }
  if (query !== null && intent === 'next') {
    const anchor = bindHistoricalAnchor({
      question: scanQuestion,
      explicitAnchorValue: anchorValue,
      map,
      namespace,
      query,
    });
    state = anchor.state;
    query = anchor.query;
  }
  const plannerSha256 = stableObjectSha256({
    adapter: 'source-native-product-query-v3-declared-title-v1', namespace, querySchemas,
  });
  const core = {
    schema: 1,
    kind: 'OpenOntologySourceNativeFieldQueryPlanV1',
    state,
    namespace,
    query,
    ...(intent === 'at' ? { at, temporalProfile: 'source-native-basic-retrospective-v1' } : {}),
    mentionedExternalIds: freeze(mentionedExternalIds),
    unresolvedExternalIds: freeze(unresolvedExternalIds),
    matchedObjectAliases: freeze(matchedObjectAliases),
    matchedFieldAliases: freeze(matchedFieldAliases),
    declaredTitle: declaredTitle.normalizedTitle === null ? null : freeze({
      normalizedTitle: declaredTitle.normalizedTitle,
      fieldPath: 'title',
      bindingProfile: 'declared-title-v1',
    }),
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
    adapter: 'source-native-product-query-v3-declared-title-v1',
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
