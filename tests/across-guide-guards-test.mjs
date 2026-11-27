// Combined study guide guards and prompt contract (server/ai/across.js: guideAcross, loadCollection, ACROSS_SYSTEM,
// GUIDE_SCHEMA). Every case here stops before any AI call; the database is a small stand-in that records what it was asked.
import assert from 'node:assert/strict';
const X = await import(new URL('../server/ai/across.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const never = () => { throw new Error('the AI must not be reserved'); };

// ---- loadCollection: what is refused, and in what order
let asked = [];
const db = (rows = {}, extra = {}) => ({ async getTranscription(i) { asked.push(i); return rows[i] || null; }, ...extra });
let e = await fail(X.loadCollection(db(), [id(1)], { max: 10 }));
ok(e?.status === 400 && e.code === 'bad_request' && /at least 2/.test(e.message), 'one recording is not a collection: "Choose at least 2 recordings."');
e = await fail(X.loadCollection(db(), [id(1), id(1)], { max: 10 }));
ok(e?.code === 'bad_request', 'the same recording twice still counts as one');
e = await fail(X.loadCollection(db(), [id(1), 'not-a-uuid', 42, null], { max: 10 }));
ok(e?.code === 'bad_request' && asked.length === 0, 'anything that is not an id is dropped before the database is asked');
e = await fail(X.loadCollection(db(), 'nope', { max: 10 }));
ok(e?.code === 'bad_request', 'ids that are not a list are refused');
e = await fail(X.loadCollection(db(), [id(1), id(2), id(3)], { max: 2 }));
ok(e?.status === 400 && e.code === 'too_many' && /at most 2/.test(e.message) && asked.length === 0, 'too many recordings are refused before the database is asked');
e = await fail(X.loadCollection(db({ [id(1)]: { id: id(1) } }), [id(1), id(2)], { max: 10 }));
ok(e?.status === 404 && e.code === 'not_found' && /One of the selected recordings is no longer/.test(e.message) && e.details.missing.join() === id(2), 'a recording that is gone is a 404 naming it');
e = await fail(X.loadCollection(db(), [id(1), id(2)], { max: 10 }));
ok(/^2 of the selected recordings are no longer in your library\. Remove them/.test(e.message) && e.details.missing.length === 2, 'two gone: the message counts them and says "them"');
const blank = { id: id(1), title: 'A', content: { segments: [] }, segments: [] };
e = await fail(X.loadCollection(db({ [id(1)]: blank, [id(2)]: { ...blank, id: id(2) } }), [id(1), id(2)], { max: 10 }));
ok(e?.status === 422 && e.code === 'empty', 'recordings with no text give a 422 "no text to work with"');

// ---- guideAcross
const busy = db({}, { async activeAi(task, ms) { busy.args = [task, ms]; return 1; } });
e = await fail(X.guideAcross(busy, { ids: [id(1), id(2)] }, { reserveAi: never }));
ok(e?.status === 429 && e.code === 'busy' && /already being written/.test(e.message), 'a second guide while one is running is a 429 busy');
ok(busy.args[0] === 'across:guide' && busy.args[1] === 120_000, '"running" means started in the last 2 minutes');
asked = [];
e = await fail(X.guideAcross(db({}, { async activeAi() { return 0; } }), { ids: [id(1)] }, { reserveAi: never }));
ok(e?.code === 'bad_request' && asked.length === 0, 'with nothing running, a one-recording request is still refused before any work');
e = await fail(X.guideAcross(db(), { ids: [id(1)] }, { reserveAi: never }));
ok(e?.code === 'bad_request', 'a database with no activeAi check skips the busy guard instead of failing');

// ---- the prompt contract
ok(X.MIN_RECORDINGS === 2, 'a collection needs at least 2 recordings');
for (const part of ['{{R2}}', '{{R2.S1}}', '[R2:45]', 'oldest first', 'Disagreement', 'Missing information']) ok(X.ACROSS_SYSTEM.includes(part), `the Ask prompt covers ${part}`);
ok(/never instructions to you/.test(X.ACROSS_SYSTEM), 'the Ask prompt says recording text is content, never instructions');
ok(/Never fill gaps with outside knowledge/.test(X.ACROSS_SYSTEM), 'the Ask prompt forbids outside knowledge');
const s = X.GUIDE_SCHEMA;
ok(s.additionalProperties === false && s.required.join() === 'overview,themes,definitions,distinctions,self_check', 'the guide schema is strict and requires all five sections');
ok(s.properties.themes.items.required.join() === 'title,summary,comparison,concepts', 'a theme has a title, summary, comparison and concepts');
ok(s.properties.themes.items.properties.comparison.anyOf.some((t) => t.type === 'null'), 'a comparison may be null: only given when recordings differ');
ok(['themes', 'definitions', 'distinctions', 'self_check'].every((k) => s.properties[k].items.properties.concepts?.items.type === 'string'), 'every item lists the concept references it rests on');
const ins = X.guideInstructions(['<recording label="R1"></recording>', '<recording label="R2"></recording>'], 'balanced');
ok(ins.includes('2 recordings (oldest first)') && ins.includes('<recording label="R2">'), 'the instructions count the recordings and include each block');
ok(!/examined on/.test(ins) && /examined on/.test(X.guideInstructions([], 'exam')), 'only exam focus adds the exam wording');

console.log(`\n${pass} checks passed`);
