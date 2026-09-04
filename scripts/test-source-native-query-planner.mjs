import assert from 'node:assert/strict';
import test from 'node:test';

import { compileSourceNativeFieldQuery } from '../src/source-native-query-planner.mjs';

const schemas = [{
  sourceSystem: 'supabase',
  objectType: 'customer-analytics',
  aliases: ['customer analytics', 'analytics record'],
  fields: [
    { fieldPath: 'weeklyActiveUsers', aliases: ['weekly active user count', 'wau'] },
    { fieldPath: 'formsSubmitted', aliases: ['forms-submitted count', 'forms submitted'] },
  ],
}, {
  sourceSystem: 'supabase',
  objectType: 'weekly-project-report',
  aliases: ['weekly project report'],
  fields: [{ fieldPath: 'temperature', aliases: ['project-report temperature'] }],
}];

test('compiles one exact adapter-declared native query from the natural-language question', () => {
  const plan = compileSourceNativeFieldQuery({
    question: 'An older customer analytics snapshot reports 7. What is the current weekly active user count?',
    schemas,
  });
  assert.equal(plan.state, 'resolved-native-field-query');
  assert.deepEqual(plan.query, {
    sourceSystem: 'supabase',
    objectType: 'customer-analytics',
    fieldPath: 'weeklyActiveUsers',
  });
  assert.equal(plan.modelCalls, 0);
  assert.equal(plan.networkCalls, 0);
  assert.equal(plan.targetLeakage, false);
});

test('fails closed for undeclared fields and ambiguous object types', () => {
  const unknown = compileSourceNativeFieldQuery({
    question: 'What is the current deployment confidence score in the customer analytics record?',
    schemas,
  });
  assert.equal(unknown.state, 'unavailable-native-field-not-declared');
  assert.equal(unknown.query, null);

  const ambiguous = compileSourceNativeFieldQuery({
    question: 'Compare the customer analytics record with the weekly project report temperature.',
    schemas,
  });
  assert.equal(ambiguous.state, 'unavailable-native-object-type-ambiguous');
  assert.equal(ambiguous.query, null);
});
