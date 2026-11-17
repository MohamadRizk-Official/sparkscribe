// Quiz validation (server/ai/study.js validateQuiz): which model-written questions are kept, fixed or dropped, and why.
import assert from 'node:assert/strict';
const S = await import(new URL('../server/ai/study.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const segs = [0, 1, 2].map((id) => ({ id, start: id * 10, end: id * 10 + 9, speaker: 'Speaker 1', text: 'x' }));
const concept = (id, extra = {}) => ({ id, importance: 'core', clarity: 'clear', stance: 'own', held_by: null, evidence: 'ev', refs: [0], ...extra });
const mc = (over = {}) => ({ concept: 'c1', type: 'multiple_choice', skill: 'understanding', question: 'Why does osmosis need no energy from ATP?', answer: 'Water moves down its concentration gradient',
  options: ['Water moves down its concentration gradient', 'A pump pushes water uphill', 'Mitochondria supply the energy', 'The membrane burns sugar'], explanation: null, refs: [0], ...over });
const run = (questions, concepts = [concept('c1'), concept('c2')], opts = {}) => {
  const c = { concepts, questions };
  const dropped = S.validateQuiz(c, segs, { count: 10, settings: {}, dominant: null, ...opts });
  return { c, dropped };
};

// ---- a good question ----
let r = run([mc()]);
ok(r.c.questions.length === 1 && r.dropped === 0 && r.c.quality.kept === 1, 'a well-formed multiple-choice question is kept');
const q = r.c.questions[0];
ok(q.options.length === 4 && q.options.includes(q.answer), 'the options keep all four choices, including the right answer');
ok(q.concept === 'c1' && q.skill === 'understanding' && q.evidence === 'ev', 'the question points at its concept and evidence');
ok(JSON.stringify(run([mc()]).c.questions[0].options) === JSON.stringify(q.options), 'option order is stable for the same question');

// ---- drops ----
const why = (qs, concepts, opts) => { const x = run(qs, concepts, opts); return { n: x.c.questions.length, quality: x.c.quality }; };
ok(why([mc({ question: 'Why?' })]).quality.empty === 1, 'a too-short question is dropped as empty');
ok(why([mc({ answer: '' })]).quality.empty === 1, 'a question without an answer is dropped as empty');
ok(why([mc({ concept: 'zzz' })], undefined, { rawConceptIds: new Set(['zzz']) }).quality.ungrounded_concept === 1, 'a concept removed by grounding drops its question');
ok(why([mc({ concept: 'new' })], undefined, { rawConceptIds: new Set(['c1']) }).quality.unmapped === 1, 'a concept the model never listed is kept as unmapped');
ok(why([mc()], [concept('c1', { importance: 'minor' })]).quality.minor_concept === 1, 'questions on minor concepts are dropped');
ok(why([mc()], [concept('c1', { clarity: 'unreliable' })]).quality.unreliable_source === 1, 'questions on unreliable concepts are dropped');
ok(why([mc({ type: 'short_answer' })], undefined, { settings: { types: 'multiple_choice' } }).quality.wrong_type === 1, 'a type other than the chosen one is dropped');
ok(why([mc({ question: 'What did he say about osmosis in class?' })]).quality.vague === 1, 'a question that leans on "he" is dropped as vague');
ok(why([mc({ options: ['Water moves down its concentration gradient', 'A pump pushes water uphill'] })]).quality.malformed === 1, 'fewer than three options is malformed');
ok(why([mc({ answer: 'Something that is not an option' })]).quality.malformed === 1, 'an answer that is not among the options is malformed');
ok(why([mc({ options: ['Water moves down its concentration gradient', 'A pump pushes water uphill', 'Mitochondria supply the energy', 'All of the above'] })]).quality.all_none_option === 1, '"all of the above" options are dropped');
ok(why([mc({ answer: 'Because water always moves from a region where it is highly concentrated to a region where it is much less concentrated across the membrane', options: ['Because water always moves from a region where it is highly concentrated to a region where it is much less concentrated across the membrane', 'A pump', 'Heat', 'Light'] })]).quality.giveaway_length === 1, 'a correct answer far longer than the others is dropped');
ok(why([{ ...mc(), type: 'essay' }]).quality.malformed === 1, 'an unknown question type is malformed');

// ---- other types ----
ok(why([{ concept: 'c1', type: 'true_false', skill: 'misconception', question: 'Osmosis needs energy from ATP to move water.', answer: 'false', options: [] }]).n === 1, 'a true/false question about a misconception is kept');
const tfq = run([{ concept: 'c1', type: 'true_false', skill: 'misconception', question: 'Osmosis needs energy from ATP to move water.', answer: 'false' }]).c.questions[0];
ok(tfq.answer === 'False' && tfq.options.join() === 'True,False', 'true/false answers are normalised to True or False');
ok(why([{ concept: 'c1', type: 'true_false', skill: 'recall', question: 'Osmosis needs energy from ATP to move water.', answer: 'true' }]).quality.trivial_true_false === 1, 'in a mixed quiz a recall true/false is dropped');
const tfTexts = ['Osmosis moves water toward the more concentrated solution.', 'Active transport moves molecules down a gradient without energy.', 'Mitochondria store the genetic code of the cell.'];
const tfs = tfTexts.map((t, i) => ({ concept: ['c1', 'c2', 'c3'][i], type: 'true_false', skill: 'distinction', question: t, answer: 'True' }));
ok(run(tfs, [concept('c1'), concept('c2'), concept('c3')]).c.questions.length === 2, 'a mixed quiz keeps at most two true/false questions');
ok(why([{ concept: 'c1', type: 'true_false', skill: 'recall', question: 'Osmosis needs energy from ATP to move water.', answer: 'maybe' }]).quality.malformed === 1, 'a true/false answer that is neither true nor false is malformed');
ok(why([{ concept: 'c1', type: 'short_answer', question: 'Which process moves water across a membrane?', answer: 'x'.repeat(130) }]).quality.malformed === 1, 'a short answer over 120 characters is malformed');
const sa = run([{ concept: 'c1', type: 'short_answer', question: 'Which process moves water across a membrane?', answer: 'Osmosis', accept: [' osmosis ', '', 'Osmosis!'] }]).c.questions[0];
ok(sa.answer === 'Osmosis' && sa.accept.join('|') === 'osmosis|Osmosis!', 'short-answer alternatives are trimmed and blanks removed');

// ---- duplicates, limits, speakers ----
ok(why([mc(), mc()]).quality.duplicate === 1, 'the same question twice keeps one');
const three = [mc({ question: 'Why does osmosis need no energy from ATP at all?' }), mc({ question: 'Which gradient decides the direction of water movement?' }), mc({ question: 'What would block water entering a plant root cell?' })];
ok(run(three).c.quality.duplicate === 1 && run(three).c.questions.length === 2, 'at most two questions per concept are kept');
ok(run(three.map((x, i) => ({ ...x, concept: i ? 'c2' : 'c1' })), undefined, { count: 2 }).c.questions.length === 2, 'the count is a ceiling');
ok(run(three.map((x, i) => ({ ...x, concept: i % 2 ? 'c2' : 'c1' })), undefined, { count: 1 }).c.quality.over_limit === 2, 'questions over the ceiling are counted in over_limit');
r = run([mc({ question: 'According to {{S1}}, why does osmosis need no energy from ATP?' })], undefined, { dominant: 'S1' });
ok(r.c.questions[0].question.startsWith('According to the lecturer'), 'the dominant speaker becomes "the lecturer"');
ok(r.c.quality.speaker_reference_fixed === 1 && r.dropped === 0, 'fixing a speaker reference is counted but is not a drop');
r = run([mc({ explanation: 'ok' })]);
ok(r.c.questions[0].explanation === null && r.c.quality.explanation_removed === 1, 'a too-short explanation is removed');
ok(run([mc()]).c.quality.core_uncovered === 1, 'a core concept with no question is counted as uncovered');

console.log(`${pass} checks passed`);
