/** Deterministic natural-language planner over Adapter-declared native fields. */
import { stableObjectSha256 } from './canonical-content.mjs';

export interface QueryFieldSchema {
  fieldPath: string;
  aliases: string[];
}
export interface QuerySchema {
  sourceSystem: string;
  objectType: string;
  aliases: string[];
  fields: QueryFieldSchema[];
}
interface QueryPlanInput {
  question?: unknown;
  schemas?: unknown;
}
export type SourceNativeFieldQuery = {
  sourceSystem: string;
  objectType: string;
  fieldPath: string;
  namespace?: string;
  externalId?: string;
  anchorFieldSha256?: string;
};
export type SourceNativeQueryPlanState =
  | 'resolved-native-field-query'
  | 'unavailable-native-object-type-not-declared'
  | 'unavailable-native-object-type-ambiguous'
  | 'unavailable-native-field-not-declared'
  | 'unavailable-native-field-ambiguous';
export interface CompiledSourceNativeFieldQueryPlan {
  state: SourceNativeQueryPlanState;
  query: SourceNativeFieldQuery | null;
  matchedObjectAliases: string[];
  matchedFieldAliases: string[];
  plannerSchemaSha256: string;
}

const fail = (code: string): never => { const error = new TypeError(code) as TypeError & { code: string }; error.code = code; throw error; };
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const normalized = (value: unknown): string => String(value).normalize('NFKC').toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
const containsAlias = (text: string, alias: string): boolean => ` ${text} `.includes(` ${alias} `);

export function normalizeSourceNativeQuerySchemas(input: unknown): QuerySchema[] {
  if (input === undefined) fail('SOURCE_NATIVE_QUERY_SCHEMA');
  if (!Array.isArray(input) || input.length < 1) fail('SOURCE_NATIVE_QUERY_SCHEMA');
  const schemasInput: unknown[] = Array.isArray(input) ? input : fail('SOURCE_NATIVE_QUERY_SCHEMA');
  const identity = new Set<string>();
  return freeze(schemasInput.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SOURCE_NATIVE_QUERY_SCHEMA');
    const schema = value as Record<string, unknown>;
    const sourceSystem = typeof schema.sourceSystem === 'string' ? schema.sourceSystem : '';
    const objectType = typeof schema.objectType === 'string' ? schema.objectType : '';
    const aliasesInput: unknown[] = Array.isArray(schema.aliases) ? schema.aliases
      : fail('SOURCE_NATIVE_QUERY_SCHEMA');
    const fieldsInput: unknown[] = Array.isArray(schema.fields) ? schema.fields
      : fail('SOURCE_NATIVE_QUERY_SCHEMA');
    if (!sourceSystem || !objectType || aliasesInput.length < 1 || fieldsInput.length < 1) {
      fail('SOURCE_NATIVE_QUERY_SCHEMA');
    }
    const key = `${sourceSystem}\0${objectType}`;
    if (identity.has(key)) fail('SOURCE_NATIVE_QUERY_SCHEMA');
    identity.add(key);
    const aliases = [...new Set(aliasesInput.map(normalized))].sort();
    if (aliases.length !== aliasesInput.length || aliases.some((alias) => !alias)) fail('SOURCE_NATIVE_QUERY_SCHEMA');
    const fieldPaths = new Set<string>();
    const fields = fieldsInput.map((fieldValue: unknown) => {
      if (!fieldValue || typeof fieldValue !== 'object' || Array.isArray(fieldValue)) fail('SOURCE_NATIVE_QUERY_SCHEMA');
      const field = fieldValue as Record<string, unknown>;
      const fieldPath = typeof field.fieldPath === 'string' ? field.fieldPath : '';
      const fieldAliasesInput: unknown[] = Array.isArray(field.aliases) ? field.aliases
        : fail('SOURCE_NATIVE_QUERY_SCHEMA');
      if (!fieldPath || fieldPaths.has(fieldPath)
        || fieldAliasesInput.length < 1) fail('SOURCE_NATIVE_QUERY_SCHEMA');
      fieldPaths.add(fieldPath);
      const fieldAliases = [...new Set(fieldAliasesInput.map(normalized))].sort();
      if (fieldAliases.length !== fieldAliasesInput.length || fieldAliases.some((alias) => !alias)) {
        fail('SOURCE_NATIVE_QUERY_SCHEMA');
      }
      return freeze({ fieldPath, aliases: freeze(fieldAliases) });
    }).sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
    return freeze({ sourceSystem, objectType,
      aliases: freeze(aliases), fields: freeze(fields) });
  }).sort((left, right) => left.sourceSystem.localeCompare(right.sourceSystem)
    || left.objectType.localeCompare(right.objectType)));
}

export function compileSourceNativeFieldQuery({ question, schemas: schemaInput }: QueryPlanInput = {}): CompiledSourceNativeFieldQueryPlan {
  if (typeof question !== 'string' || !question.trim()) fail('SOURCE_NATIVE_QUERY_INPUT');
  const schemas = normalizeSourceNativeQuerySchemas(schemaInput);
  const questionText = normalized(question);
  const plannerSchemaSha256 = stableObjectSha256(schemas);
  const matchedObjects = schemas.map((schema: QuerySchema) => ({
    schema,
    aliases: schema.aliases.filter((alias: string) => containsAlias(questionText, alias)),
  })).filter((row) => row.aliases.length > 0);
  let state: SourceNativeQueryPlanState;
  let query: SourceNativeFieldQuery | null = null;
  let matchedObjectAliases: string[] = [];
  let matchedFieldAliases: string[] = [];
  if (matchedObjects.length < 1) {
    state = 'unavailable-native-object-type-not-declared';
  } else if (matchedObjects.length > 1) {
    state = 'unavailable-native-object-type-ambiguous';
    matchedObjectAliases = matchedObjects.flatMap((row) => row.aliases).sort();
  } else {
    const matchedObject = matchedObjects[0]!;
    matchedObjectAliases = matchedObject.aliases;
    const matchedFields = matchedObject.schema.fields.map((field) => ({
      field,
      aliases: field.aliases.filter((alias: string) => containsAlias(questionText, alias)),
    })).filter((row) => row.aliases.length > 0);
    if (matchedFields.length < 1) {
      state = 'unavailable-native-field-not-declared';
    } else if (matchedFields.length > 1) {
      state = 'unavailable-native-field-ambiguous';
      matchedFieldAliases = matchedFields.flatMap((row) => row.aliases).sort();
    } else {
      state = 'resolved-native-field-query';
      matchedFieldAliases = matchedFields[0]!.aliases;
      query = freeze({
        sourceSystem: matchedObject.schema.sourceSystem,
        objectType: matchedObject.schema.objectType,
        fieldPath: matchedFields[0]!.field.fieldPath,
      });
    }
  }
  const core = {
    schema: 1,
    kind: 'OpenOntologySourceNativeFieldQueryPlanV1',
    state,
    questionSha256: stableObjectSha256({ question }),
    plannerSchemaSha256,
    query,
    matchedObjectAliases: freeze(matchedObjectAliases),
    matchedFieldAliases: freeze(matchedFieldAliases),
    modelCalls: 0,
    networkCalls: 0,
    targetLeakage: false,
    navigationOnly: true,
    exactInspectRequired: true,
    exactSourcesRemainAuthority: true,
  };
  return freeze({ ...core, planSha256: stableObjectSha256(core) });
}
