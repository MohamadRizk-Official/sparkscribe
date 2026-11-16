// The schemas the study engines and the Create tools hand to the model (server/ai/study.js, studymap.js, tools.js) are
// strict: every object lists all its properties as required and forbids extras, so the answer can be checked field by
// field. tests/prompts-schemas-test.mjs does the same for the insight schemas in prompts.js.
import assert from 'node:assert/strict';
const root = new URL('../server/ai/', import.meta.url).href;
const S = await import(root + 'study.js');
const M = await import(root + 'studymap.js');
const T = await import(root + 'tools.js');
const R = await import(root + 'studyrun.js');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

function problems(schema, path) {
  if (!schema || typeof schema !== 'object') return [];
  const bad = [];
  if (schema.type === 'object') {
    const keys = Object.keys(schema.properties || {});
    if (schema.additionalProperties !== false) bad.push(`${path}: additionalProperties is not false`);
    if (JSON.stringify([...(schema.required || [])].sort()) !== JSON.stringify(keys.sort())) bad.push(`${path}: required does not list every property`);
    for (const [k, v] of Object.entries(schema.properties || {})) bad.push(...problems(v, `${path}.${k}`));
  }
  if (schema.type === 'array') bad.push(...problems(schema.items, `${path}[]`));
  if (Array.isArray(schema.enum) && new Set(schema.enum).size !== schema.enum.length) bad.push(`${path}: enum has duplicates`);
  return bad;
}
const check = (name, schema) => { const bad = problems(schema, name); ok(bad.length === 0, `${name} is strict${bad.length ? ': ' + bad.join('; ') : ''}`); };

// ---- study engine 2
for (const [name, schema] of Object.entries({ CONCEPT: S.CONCEPT, FLASHCARD: S.FLASHCARD, FLASHCARDS_SCHEMA: S.FLASHCARDS_SCHEMA, QUESTION: S.QUESTION, QUIZ_SCHEMA: S.QUIZ_SCHEMA, FILL_SCHEMA: S.FILL_SCHEMA, FOCUS: S.FOCUS, EXPLAIN: S.EXPLAIN })) {
  if (schema) check(name, schema);
}
// ---- study engine 3
for (const [name, schema] of Object.entries({ SECTION_SCHEMA: M.SECTION_SCHEMA, CONSOLIDATE_SCHEMA: M.CONSOLIDATE_SCHEMA, WRITE_SCHEMA: M.WRITE_SCHEMA, VERIFY_SCHEMA: M.VERIFY_SCHEMA, COMPOSE_SCHEMA: R.COMPOSE_SCHEMA })) {
  if (schema) check(name, schema);
}
// ---- every Create tool
for (const [kind, tool] of Object.entries(T.TOOLS)) check(`tool ${kind}`, tool.schema);

// ---- enumOf and the shared vocabularies
const e = S.enumOf(['a', 'b'], 'pick');
ok(e.type === 'string' && e.enum.join() === 'a,b' && e.description === 'pick', 'enumOf is a string enum with its description');
ok(!('description' in S.enumOf(['a'])), '…and has no description key when none is given');
ok(S.CONCEPT_KINDS.length === 8 && S.CONCEPT_KINDS.includes('definition') && S.CONCEPT_KINDS.includes('fact'), 'there are eight kinds of concept');
ok(S.STANCES.join() === 'own,attributed,criticized,hypothetical,quotation,report', 'a concept has one of six stances');
ok(S.QUIZ_SKILLS.includes('recall') && S.QUIZ_SKILLS.length === 8, 'a question tests one of eight skills; "recall" is the fallback');
ok(Object.keys(S.QUIZ_TYPES).join() === 'mixed,multiple_choice,true_false', 'the quiz setup has three formats, each with its own instruction for the model');

// ---- speakerNote
const lecture = S.speakerNote({ dominant: 'S1' });
ok(/\{\{S1\}\} gives almost all of the content/.test(lecture) && /the lecturer/.test(lecture), 'one dominant speaker: they are "the lecturer", named by code');
ok(/never write "According to \{\{S1\}\}"/.test(lecture), '…and the model is told not to attribute every point to them');
const group = S.speakerNote({ dominant: null });
ok(/only when it matters for meaning/.test(group) && !/the lecturer/.test(group), 'no dominant speaker: speakers are named only when it matters');
ok(S.speakerNote({}) === group, 'no information is treated as no dominant speaker');

console.log(`${pass} checks passed`);
