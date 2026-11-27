// Study guide composition (server/ai/studyrun.js: studyGuide). The study map is stored, so the only AI call is the
// compose step, and it is a stand-in here that records what it was asked and returns canned JSON.
import assert from 'node:assert/strict';
const S = await import(new URL('../server/ai/studyrun.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const basis = { n: 4, text: 'a', parts: 'p' };
const concept = (o) => ({ topic: 't1', importance: 'core', clarity: 'clear', kind: 'concept', stance: 'own', refs: [0], summary: 'S.', ...o });
const map = {
  topics: [{ id: 't1', title: 'Cells', importance: 'major', start_ref: 0 }, { id: 't2', title: 'Trivia', importance: 'minor' }],
  concepts: [
    concept({ id: 'c1', name: 'Mitosis', summary: 'Cell division.', reasoning: 'Needed for growth.' }),
    concept({ id: 'c2', name: 'Cell', kind: 'definition', importance: 'supporting', summary: 'Basic unit.', refs: [1], evidence: 'a cell is' }),
    concept({ id: 'c3', name: 'Odd fact', topic: 't2', importance: 'minor', refs: [1] }),
    concept({ id: 'c4', name: 'Vague idea', clarity: 'unclear' }),
    concept({ id: 'c5', name: 'Spindle', stance: 'attributed', held_by: 'Dr Chen', summary: 'Pulls chromosomes.', refs: [2], importance: 'supporting' }),
  ],
};
const segments = [{ id: 0, text: 'Mitosis is division.' }, { id: 1, text: 'A cell is a unit.' }, { id: 2, text: 'Dr Chen says the spindle pulls chromosomes.' }, { id: 3, text: 'This will be on the exam.' }];
const db = { async listArtifacts() { return [{ kind: 'study_map', status: 'ready', updated_at: '2026-01-01', content: { engine: 3, basis, map, quality: { sections: 2 } } }]; } };
const speakers = { codeOf: new Map() };
const run = async (focus, json) => {
  const asked = [];
  const call = async (a) => { asked.push(a); return { json: json || { overview: 'Overview.', topic_summaries: [{ topic: 't1', summary: 'About cells.' }], self_check: [{ concept: 'c1', question: 'Why divide?', answer: 'To grow.' }] } }; };
  const { content } = await S.studyGuide({ db, transcriptionId: 't', segments, speakers, basis, ctx: { settings: focus ? { focus } : {} }, call });
  return { content, asked };
};

const { content: bal, asked } = await run();
ok(asked.length === 1 && asked[0].task === 'study_guide:compose', 'with a stored map the only AI call is the compose step');
ok(asked[0].instructions.includes('Mitosis') && asked[0].body === '', 'it is given the map, not the transcript');
ok(bal.overview === 'Overview.' && bal.topics[0].summary === 'About cells.', 'the overview and topic summaries come from the AI');
ok(bal.quality.map_reused === 1 && bal.quality.sections === 2, 'the quality note says the stored map was reused');
ok(bal.concepts.map((c) => c.term).join() === 'Mitosis,Spindle', 'balanced focus keeps core and supporting ideas, drops minor and unclear ones');
ok(bal.definitions.map((d) => d.term).join() === 'Cell' && bal.definitions[0].evidence === 'a cell is', 'definitions are listed apart from other concepts');
ok(bal.concepts[0].explanation === 'Cell division. Reason given: Needed for growth.', 'the speaker\'s stated reason is added to an explanation');
ok(bal.concepts[1].explanation.startsWith('View of Dr Chen: '), 'an idea held by a person says whose view it is');
ok(bal.topics.length === 1 && bal.topics[0].title === 'Cells', 'a topic with no kept ideas is left out');
ok(bal.self_check.length === 1 && bal.self_check[0].refs[0] === 0, 'a self-check question carries the lines of its concept');
ok(bal.coverage.topics === 1 && bal.coverage.topics_covered === 1 && bal.coverage.core === 1 && bal.coverage.core_covered === 1, 'coverage counts major topics and clear core ideas');

const concepts = await run('concepts');
ok(concepts.content.concepts.map((c) => c.term).join() === 'Mitosis' && concepts.content.definitions.length === 0, 'concepts focus keeps only core ideas');
const detailed = await run('detailed');
ok(detailed.content.topics.length === 2 && detailed.content.concepts.some((c) => c.term === 'Odd fact'), 'detailed focus also keeps minor ideas (and their topics)');
const exam = await run('exam');
ok(/Favour what a student would most likely be examined on/.test(exam.asked[0].instructions), 'exam focus changes the compose instructions');
ok(!/Favour what a student/.test(asked[0].instructions), '…and balanced focus does not');

const bad = await run('balanced', { overview: 'O', topic_summaries: [], self_check: [{ concept: 'nope', question: 'Q', answer: 'A' }, { concept: 'c1', question: '', answer: 'A' }, { concept: 'c1', question: 'Q', answer: '' }] });
ok(bad.content.self_check.length === 0, 'self-check items for unknown concepts or with a blank question or answer are dropped');
ok(bad.content.topics[0].summary === '', 'a topic the AI did not summarise has an empty summary');
const none = await run('balanced', {});
ok(none.content.overview === '' && none.content.self_check.length === 0, 'an empty AI reply gives an empty overview, not an error');

const examMap = { ...map, concepts: [...map.concepts, concept({ id: 'c6', name: 'Midterm', refs: [3], exam_words: 'on the exam' }), concept({ id: 'c7', name: 'Unbacked', refs: [0], exam_words: 'on the exam' })] };
db.listArtifacts = async () => [{ kind: 'study_map', status: 'ready', updated_at: '2026-01-01', content: { engine: 3, basis, map: examMap, quality: { sections: 1 } } }];
const withExam = await run();
ok(withExam.content.exam_info.length === 1 && withExam.content.exam_info[0].text === 'Midterm', 'exam information appears only where the cited lines really mention the exam');

console.log(`\n${pass} checks passed`);
