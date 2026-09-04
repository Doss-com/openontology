/** Deterministic natural-language planner over Adapter-declared native fields. */
import { stableObjectSha256 } from './canonical-content.mjs';

const fail = (code) => { const error = new TypeError(code); error.code = code; throw error; };
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const normalized = (value) => String(value).normalize('NFKC').toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
const containsAlias = (text, alias) => ` ${text} `.includes(` ${alias} `);

export function normalizeSourceNativeQuerySchemas(input) {
  if (!Array.isArray(input) || input.length < 1) fail('SOURCE_NATIVE_QUERY_SCHEMA');
  const identity = new Set();
  return freeze(input.map((schema) => {
    if (typeof schema?.sourceSystem !== 'string' || !schema.sourceSystem
      || typeof schema.objectType !== 'string' || !schema.objectType
      || !Array.isArray(schema.aliases) || schema.aliases.length < 1
      || !Array.isArray(schema.fields) || schema.fields.length < 1) fail('SOURCE_NATIVE_QUERY_SCHEMA');
    const key = `${schema.sourceSystem}\0${schema.objectType}`;
    if (identity.has(key)) fail('SOURCE_NATIVE_QUERY_SCHEMA');
    identity.add(key);
    const aliases = [...new Set(schema.aliases.map(normalized))].sort();
    if (aliases.length !== schema.aliases.length || aliases.some((alias) => !alias)) fail('SOURCE_NATIVE_QUERY_SCHEMA');
    const fieldPaths = new Set();
    const fields = schema.fields.map((field) => {
      if (typeof field?.fieldPath !== 'string' || !field.fieldPath || fieldPaths.has(field.fieldPath)
        || !Array.isArray(field.aliases) || field.aliases.length < 1) fail('SOURCE_NATIVE_QUERY_SCHEMA');
      fieldPaths.add(field.fieldPath);
      const fieldAliases = [...new Set(field.aliases.map(normalized))].sort();
      if (fieldAliases.length !== field.aliases.length || fieldAliases.some((alias) => !alias)) {
        fail('SOURCE_NATIVE_QUERY_SCHEMA');
      }
      return freeze({ fieldPath: field.fieldPath, aliases: freeze(fieldAliases) });
    }).sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
    return freeze({ sourceSystem: schema.sourceSystem, objectType: schema.objectType,
      aliases: freeze(aliases), fields: freeze(fields) });
  }).sort((left, right) => left.sourceSystem.localeCompare(right.sourceSystem)
    || left.objectType.localeCompare(right.objectType)));
}

export function compileSourceNativeFieldQuery({ question, schemas: schemaInput } = {}) {
  if (typeof question !== 'string' || !question.trim()) fail('SOURCE_NATIVE_QUERY_INPUT');
  const schemas = normalizeSourceNativeQuerySchemas(schemaInput);
  const questionText = normalized(question);
  const plannerSchemaSha256 = stableObjectSha256(schemas);
  const matchedObjects = schemas.map((schema) => ({
    schema,
    aliases: schema.aliases.filter((alias) => containsAlias(questionText, alias)),
  })).filter((row) => row.aliases.length > 0);
  let state;
  let query = null;
  let matchedObjectAliases = [];
  let matchedFieldAliases = [];
  if (matchedObjects.length < 1) {
    state = 'unavailable-native-object-type-not-declared';
  } else if (matchedObjects.length > 1) {
    state = 'unavailable-native-object-type-ambiguous';
    matchedObjectAliases = matchedObjects.flatMap((row) => row.aliases).sort();
  } else {
    const matchedObject = matchedObjects[0];
    matchedObjectAliases = matchedObject.aliases;
    const matchedFields = matchedObject.schema.fields.map((field) => ({
      field,
      aliases: field.aliases.filter((alias) => containsAlias(questionText, alias)),
    })).filter((row) => row.aliases.length > 0);
    if (matchedFields.length < 1) {
      state = 'unavailable-native-field-not-declared';
    } else if (matchedFields.length > 1) {
      state = 'unavailable-native-field-ambiguous';
      matchedFieldAliases = matchedFields.flatMap((row) => row.aliases).sort();
    } else {
      state = 'resolved-native-field-query';
      matchedFieldAliases = matchedFields[0].aliases;
      query = freeze({
        sourceSystem: matchedObject.schema.sourceSystem,
        objectType: matchedObject.schema.objectType,
        fieldPath: matchedFields[0].field.fieldPath,
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
