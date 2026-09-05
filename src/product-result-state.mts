/** Closed result-state vocabulary shared by the public client and product runtime. */
export const OPENONTOLOGY_RESULT_STATES = [
  'resolved-current-field',
  'resolved-next-field-revision',
  'unavailable-native-object-type-not-declared',
  'unavailable-native-object-type-ambiguous',
  'unavailable-native-field-not-declared',
  'unavailable-native-field-ambiguous',
  'unavailable-native-object-identifier-not-declared',
  'unavailable-native-multiple-object-identifiers',
  'unavailable-native-field-anchor-not-matched',
  'unavailable-native-field-anchor-ambiguous',
  'unavailable-native-temporal-intent-not-declared',
  'unavailable-native-object-not-seeded',
  'unavailable-native-object-seed-ambiguous',
  'unavailable-native-object-scope-ambiguous',
  'unavailable-native-field-not-present',
  'unavailable-native-field-successor-ambiguous',
  'unavailable-native-field-successor-not-present',
  'unavailable-incomplete-recorded-field-chronology',
  'unavailable-exact-source',
  'verified-native-object-absent-from-bound-source-catalog',
] as const;

export type OpenOntologyResultState = typeof OPENONTOLOGY_RESULT_STATES[number];
