import assert from 'node:assert/strict';
import { GEMINI_FALLBACK_MODELS, MAX_FALLBACK_CANDIDATES, isGeminiModel,
  isAllowedFallbackModel, selectGeminiCandidates } from '../ai-server/model-selection.mjs';

// Pure local catalog fixtures: no network, credentials, or paid completions.
const PRIMARY = 'gemini-4-argon';
const FIRST = 'gemini-2.5-flash';
const SECOND = 'gemini-2.0-flash';
const THIRD = 'gemini-flash-latest';
let groups = 0;

assert.deepEqual(GEMINI_FALLBACK_MODELS, [FIRST, SECOND, THIRD]);
assert.equal(Object.isFrozen(GEMINI_FALLBACK_MODELS), true);
assert.equal(MAX_FALLBACK_CANDIDATES, 3);
for (const value of [PRIMARY, 'gemini 4 -aron', 'Gemini_4_argon', 'gemini4-argon',
  'google/gemini-3-flash-preview', 'models/GEMINI-3.0-FLASH', '  GEMINI 4  ']) {
  assert.equal(isGeminiModel(value), true, `Recognize Gemini scope: ${value}`);
}
for (const value of [undefined, null, 4, {}, [], '', 'geminipremium', 'gpt-4', 'claude-gemini-4',
  'unknown/gemini-4-argon', 'google/models/gemini-4-argon', 'https://models/gemini-4',
  'google/gemini-4/argon', ' '.repeat(200) + PRIMARY]) {
  assert.equal(isGeminiModel(value), false);
}
groups++;

assert.deepEqual(selectGeminiCandidates([THIRD, SECOND, FIRST], PRIMARY), [FIRST, SECOND, THIRD]);
assert.deepEqual(selectGeminiCandidates([FIRST, SECOND, THIRD], FIRST), [SECOND, THIRD]);
assert.deepEqual(selectGeminiCandidates([FIRST], FIRST), []);
assert.deepEqual(selectGeminiCandidates([], 'gemini 4 -aron'), []);
assert.deepEqual(selectGeminiCandidates([PRIMARY], 'gpt-4-argon'), []);
assert.deepEqual(selectGeminiCandidates(['gemini-4-pro', 'gpt-4o', 'claude-4', 'unrelated-premium'], PRIMARY), []);
assert.deepEqual(selectGeminiCandidates([PRIMARY, 'GEMINI_4_ARGON', FIRST], PRIMARY), [FIRST],
  'An exact advertised primary disables cosmetic/typo correction');
assert.deepEqual(selectGeminiCandidates(['gemini-3-flash', 'google/GEMINI_3_FLASH', FIRST], 'gemini-3-flash'), [FIRST],
  'A Flash alias must not re-enter as a correction for an exact advertised primary');
groups++;

const original = 'models/GeMiNi_4_ARGON';
assert.deepEqual(selectGeminiCandidates([FIRST, original], 'gemini 4 -argon'), [original, FIRST]);
assert.deepEqual(selectGeminiCandidates([PRIMARY, FIRST], 'gemini 4 -aron'), [PRIMARY, FIRST]);
assert.deepEqual(selectGeminiCandidates(['google/' + PRIMARY, 'models/' + PRIMARY], 'gemini 4 -aron'),
  ['google/' + PRIMARY], 'Cosmetic aliases are one normalized typo target');
assert.deepEqual(selectGeminiCandidates([PRIMARY, 'gemini-4-arion', FIRST], 'gemini 4 -aron'), [FIRST],
  'Two distinct one-edit targets must not guess the intended spelling');
assert.deepEqual(selectGeminiCandidates([PRIMARY, 'gemini-4-arion', FIRST], 'gemini 4 -argon'), [PRIMARY, FIRST],
  'A cosmetic match takes precedence over a different one-edit target');
assert.deepEqual(selectGeminiCandidates(['gemini-5-argon', 'gemini-4.0-argon'], 'gemini 4 -aron'), []);
assert.deepEqual(selectGeminiCandidates(['gemini-2.0-argon'], 'gemini-2.5-aron'), []);
assert.deepEqual(selectGeminiCandidates(['gemini-25-argon'], 'gemini-2.5-aron'), []);
assert.deepEqual(selectGeminiCandidates(['gemini-4-argon-002'], 'gemini-4-aron-001'), []);
assert.deepEqual(selectGeminiCandidates([PRIMARY], 'gemini-4-agno'), [], 'More than one edit is not a repair');
assert.deepEqual(selectGeminiCandidates(['gemini-4-pro'], 'gemini-4-pr'), ['gemini-4-pro'],
  'A unique same-version intended-ID correction can preserve a Pro model');
assert.deepEqual(selectGeminiCandidates(['gemini-argon'], 'gemini-argn'), [],
  'A one-edit repair requires numeric version evidence');
assert.deepEqual(selectGeminiCandidates(['Gemini_ARGON'], 'gemini argon'), ['Gemini_ARGON'],
  'Cosmetic repair does not require numeric version evidence');
for (const suffix of ['image', 'audio', 'tts', 'live', 'embedding', 'thinking']) {
  const candidate = `gemini-4-${suffix}`;
  const typo = candidate.slice(0, -1);
  assert.deepEqual(selectGeminiCandidates([candidate, FIRST], typo), [FIRST],
    'One-edit correction must not select a nontext model');
  assert.deepEqual(selectGeminiCandidates([candidate, FIRST], candidate.replaceAll('-', ' ')), [FIRST],
    'Cosmetic correction must not select a nontext model');
  assert.equal(isAllowedFallbackModel(candidate, typo), false);
}
groups++;

const dynamic = ['models/GEMINI-3.0-FLASH-PREVIEW', 'google/gemini-3-flash-lite-preview-2026-09-01',
  'gemini-3.0-flash-001', 'gemini-3.0-flash', 'gemini-3-flash-preview-09-2025'];
const selected = selectGeminiCandidates(dynamic, PRIMARY);
assert.deepEqual(selected, ['gemini-3.0-flash', 'gemini-3.0-flash-001', dynamic[1]]);
assert.equal(selected.length, MAX_FALLBACK_CANDIDATES);
assert.deepEqual(selectGeminiCandidates(dynamic.slice().reverse(), PRIMARY), selected);
assert.deepEqual(selectGeminiCandidates(new Set(dynamic), PRIMARY), selected);
assert.deepEqual(selectGeminiCandidates([dynamic[0]], PRIMARY), [dynamic[0]],
  'Case and namespace are retained exactly as advertised');
assert.deepEqual(selectGeminiCandidates([dynamic[0], THIRD, SECOND, FIRST], PRIMARY), [FIRST, SECOND, THIRD]);
assert.deepEqual(selectGeminiCandidates(['google/GEMINI_2.5_FLASH', dynamic[0]], PRIMARY),
  ['google/GEMINI_2.5_FLASH', dynamic[0]]);
groups++;

for (const id of ['gemini-3.0-flash-preview', 'google/gemini-3-flash-preview-2025-12-17',
  'models/gemini-2.5-flash-preview-05-20', 'gemini-2.0-flash-lite-preview-02-05',
  'gemini-3-flash-2026-09-01', 'gemini-3-flash-001', 'gemini3.0-flash',
  'gemini-flash-lite-latest']) {
  assert.deepEqual(selectGeminiCandidates([id], PRIMARY), [id], `Accept advertised text Flash form: ${id}`);
  assert.equal(isAllowedFallbackModel(id, PRIMARY), true);
}
for (const id of ['gemini-3.0-pro', 'gemini-3.0-flash-image', 'gemini-3.0-flash-preview-image',
  'gemini-2.5-flash-native-audio', 'gemini-2.5-flash-tts', 'gemini-3-flash-live',
  'gemini-3-flash-embedding', 'gemini-2.0-flash-thinking-exp', 'gemini-3-flash-pro',
  'gemini-3-flash-premium', 'gemini-3-flash-fast', 'gemini-3-flash-unknown-001',
  'gemini-3-flash-exp', 'gemini-3-flash-preview-foo', 'gemini-3-flash-12345',
  'gemini-flash', 'gemini-flash-preview', 'gemini-flash-001',
  'other/gemini-3-flash', 'google/models/gemini-3-flash', 'https://example.test/gemini-3-flash']) {
  assert.deepEqual(selectGeminiCandidates([id], PRIMARY), [], `Reject unrelated fallback form: ${id}`);
  assert.equal(isAllowedFallbackModel(id, PRIMARY), false);
}
groups++;

assert.equal(isAllowedFallbackModel(PRIMARY, 'gemini 4 -aron'), true);
assert.equal(isAllowedFallbackModel(original, 'gemini 4 -argon'), true);
assert.equal(isAllowedFallbackModel(PRIMARY, PRIMARY), false);
assert.equal(isAllowedFallbackModel('gemini-5-argon', 'gemini 4 -aron'), false);
assert.equal(isAllowedFallbackModel(FIRST, 'gpt-4'), false);
for (const ids of [undefined, null, FIRST, {}, [FIRST, null], [FIRST, {}], [''],
  [FIRST, 'x'.repeat(201)], Array(5001).fill(FIRST), new Set(Array.from({ length: 5001 }, (_, i) => `gemini-${i}-flash`))]) {
  assert.deepEqual(selectGeminiCandidates(ids, PRIMARY), []);
}
assert.deepEqual(selectGeminiCandidates(Array(5000).fill(FIRST), PRIMARY), [FIRST]);
assert.deepEqual(selectGeminiCandidates([FIRST, FIRST, SECOND, THIRD], PRIMARY), [FIRST, SECOND, THIRD]);
for (const ids of [[...dynamic, FIRST, SECOND, THIRD], [PRIMARY, ...dynamic], [original, ...dynamic]]) {
  const candidates = selectGeminiCandidates(ids, 'gemini 4 -aron');
  assert.ok(candidates.length <= MAX_FALLBACK_CANDIDATES);
  assert.ok(candidates.every(id => ids.includes(id) && id !== 'gemini 4 -aron'),
    'Every selected value is a distinct, verbatim advertised ID');
  assert.deepEqual(selectGeminiCandidates(ids.slice().reverse(), 'gemini 4 -aron'), candidates);
}
groups++;

console.log(`PASS ${groups} model selection groups: original catalog IDs, bounded deterministic Flash selection, safe cosmetic/unique typo repair and no external requests`);
