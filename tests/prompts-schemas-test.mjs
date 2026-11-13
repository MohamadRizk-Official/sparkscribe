// The structured-output schemas in server/ai/prompts.js: every recording type has an insight spec, and every
// schema is strict (all properties required, no extra properties) so the model's output can be checked field by field.
import assert from 'node:assert/strict';
const P = await import(new URL('../server/ai/prompts.js', import.meta.url).href);
const { RECORDING_TYPES } = await import(new URL('../src/lib/segments.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

ok(RECORDING_TYPES.every((t) => P.INSIGHT_SPECS[t]), 'every recording type has an insight spec');
ok(Object.keys(P.INSIGHT_SPECS).every((t) => RECORDING_TYPES.includes(t)), 'there is no insight spec for an unknown recording type');

// every object schema, however deeply nested, lists all its properties as required and forbids extras
function strict(schema, path) {
  if (!schema || typeof schema !== 'object') return [];
  const bad = [];
  if (schema.type === 'object') {
    const keys = Object.keys(schema.properties || {});
    if (schema.additionalProperties !== false) bad.push(`${path}: additionalProperties is not false`);
    if (JSON.stringify([...(schema.required || [])].sort()) !== JSON.stringify([...keys].sort())) bad.push(`${path}: required does not list every property`);
    for (const k of keys) bad.push(...strict(schema.properties[k], `${path}.${k}`));
  }
  if (schema.items) bad.push(...strict(schema.items, `${path}[]`));
  return bad;
}
for (const [type, spec] of Object.entries(P.INSIGHT_SPECS)) {
  ok(typeof spec.instructions === 'string' && spec.instructions.length > 50, `${type}: instructions are written out`);
  ok(spec.schema.type === 'object', `${type}: the schema is an object`);
  const bad = strict(spec.schema, type);
  ok(bad.length === 0, `${type}: schema is strict${bad.length ? ' (' + bad.join('; ') + ')' : ''}`);
}
for (const [name, schema] of Object.entries({ OVERVIEW_SCHEMA: P.OVERVIEW_SCHEMA, DETAILED_SCHEMA: P.DETAILED_SCHEMA, NOTES_SCHEMA: P.NOTES_SCHEMA, EXPAND_SCHEMA: P.EXPAND_SCHEMA, GRADE_SCHEMA: P.GRADE_SCHEMA })) {
  const bad = strict(schema, name);
  ok(bad.length === 0, `${name} is strict${bad.length ? ' (' + bad.join('; ') + ')' : ''}`);
}

ok(JSON.stringify(P.GRADE_SCHEMA.properties.verdict.enum) === JSON.stringify(['correct', 'close', 'incorrect']), 'a quiz answer is graded correct, close or incorrect');
ok(P.NOTE_TYPES.includes('point') && P.NOTE_TYPES.includes('definition') && new Set(P.NOTE_TYPES).size === P.NOTE_TYPES.length, 'note types include point and definition, with no repeats');
ok(P.OVERVIEW_SCHEMA.properties.chapters.items.properties.start_ref.type === 'integer', 'a chapter starts at a line number (an integer)');

console.log(`${pass} checks passed`);
