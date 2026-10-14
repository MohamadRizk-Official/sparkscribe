// Study engine 3, pure parts (server/ai/studymap.js): sections, the merged map, selection, checks, names.
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).href;
const M = await import(root + 'server/ai/studymap.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---------- sections ----------
const segs = Array.from({ length: 40 }, (_, id) => ({ id, start: id * 10, end: id * 10 + (id === 13 ? 2 : 9.5), text: 'x' }));
const secs = M.sectionize(segs, () => 100, 1500);
ok(secs.length === 3 && secs[0].to === 13, 'a section ends at a natural pause once three quarters of its budget is used');
ok(secs.every((s, i) => i === 0 || s.from === secs[i - 1].to + 1) && secs.at(-1).to === 39, 'sections cover every line exactly once');
ok(secs[1].before.length === 4 && secs[1].after.length === 4 && secs[0].before.length === 0, 'each section sees four lines of context on each side');
ok(M.sectionize(segs.slice(0, 5), () => 100, 1500).length === 1, 'a short recording is one section');
ok(M.sectionize(segs.slice(0, 17), () => 100, 1500).length === 1, 'a tiny remainder joins the previous section');

// ---------- the map ----------
const con = (id, name, importance, refs, extra = {}) => ({ id, name, kind: 'principle', importance, stance: 'own', held_by: null, summary: name, reasoning: null, clarity: 'clear', exam_words: null, evidence: name, refs, topic: extra.topic || 'A', ...extra });
const sections = [
  { topics: [{ title: 'A', start_ref: 0 }], concepts: [con('c1', 'Elasticity debate', 'supporting', [10]), con('c2', 'Comparative advantage', 'core', [2]), con('c3', 'A date', 'minor', [4])] },
  { topics: [{ title: 'B', start_ref: 20 }], concepts: [con('c1', 'Comparative advantage again', 'supporting', [21], { topic: 'B' }), con('c2', 'Minimum wage debate', 'core', [30], { topic: 'B' })] },
];
const merged = M.buildMap(sections, {
  topics: [{ title: 'Trade', importance: 'minor', keys: ['s1.c2', 's1.c3', 's2.c1'] }, { title: 'Labour', importance: 'minor', keys: ['s2.c2'] }, { title: 'Aside', importance: 'minor', keys: ['s1.c1'] }],
  same: [{ keys: ['s1.c2', 's2.c1'], name: 'Comparative advantage (trade)' }],
});
ok(merged.concepts.length === 4, 'the same idea in two sections becomes one concept; nothing else is lost');
const trade = merged.concepts.find((c) => c.name === 'Comparative advantage (trade)');
ok(trade.refs.join() === '2,21' && trade.importance === 'core', 'a merged concept keeps the lines of every section and the highest importance any section gave it');
ok(merged.concepts.find((c) => c.name === 'A date').importance === 'minor', 'entries keep their own importance');
ok(merged.concepts.map((c) => c.id).join() === 'c1,c2,c3,c4' && merged.concepts[0].name === 'Comparative advantage (trade)', 'concepts are numbered in recording order');
const topicTitles = merged.topics.map((t) => t.title);
ok(topicTitles.join() === 'Trade,Aside,Labour' && merged.topics.map((t) => t.id).join() === 't1,t2,t3', 'topics come from the merge, numbered in recording order');
ok(merged.topics.find((t) => t.title === 'Trade').importance === 'major' && merged.topics.find((t) => t.title === 'Labour').importance === 'major', 'a topic holding a core idea is major even when the merge called it minor');
ok(merged.topics.find((t) => t.title === 'Aside').importance === 'minor', 'a topic with one supporting idea stays minor');
const long = M.buildMap([{ topics: [], concepts: [con('c1', 'Debate one', 'supporting', [1, 2, 3, 4]), con('c2', 'Debate two', 'supporting', [5, 6, 7, 8])] }], { topics: [{ title: 'Debate', importance: 'minor', keys: ['s1.c1', 's1.c2'] }], same: [] });
ok(long.topics[0].importance === 'major', 'a topic the speaker spent substantial time explaining is major');
ok(merged.concepts.find((c) => c.name === 'Minimum wage debate').topic === merged.topics.find((t) => t.title === 'Labour').id, 'each concept is in the topic the merge placed it in');
ok(M.buildMap(sections, null).concepts.length === 5, 'without a merge (one section) every entry stays');

// ---------- selection ----------
const map = {
  topics: [{ id: 't1', title: 'One', importance: 'major' }, { id: 't2', title: 'Two', importance: 'major' }, { id: 't3', title: 'Three', importance: 'major' }, { id: 't4', title: 'Aside', importance: 'minor' }],
  concepts: [
    { id: 'c1', topic: 't1', importance: 'core', clarity: 'clear', refs: [1] }, { id: 'c2', topic: 't1', importance: 'core', clarity: 'clear', refs: [2] },
    { id: 'c3', topic: 't1', importance: 'core', clarity: 'clear', refs: [3] }, { id: 'c4', topic: 't2', importance: 'supporting', clarity: 'clear', refs: [10] },
    { id: 'c5', topic: 't3', importance: 'core', clarity: 'clear', refs: [20] }, { id: 'c6', topic: 't3', importance: 'core', clarity: 'unreliable', refs: [21] },
    { id: 'c7', topic: 't4', importance: 'minor', clarity: 'clear', refs: [30] },
  ],
};
const three = M.selectConcepts(map, 3);
ok(three.selected.map((c) => c.id).join() === 'c1,c4,c5', 'with room for three, every major topic gets one before a topic gets a second');
ok(three.coverage.topics === 3 && three.coverage.topics_covered === 3 && three.coverage.core === 4 && three.coverage.core_covered === 2, 'coverage counts major topics and core ideas');
const two = M.selectConcepts(map, 2);
ok(two.coverage.topics_covered === 2 && two.coverage.missing_topics.join() === 'Three', 'a size too small for every major topic reports what is left out');
const all = M.selectConcepts(map, 20);
ok(all.selected.length === 5 && !all.selected.some((c) => c.id === 'c6' || c.id === 'c7'), 'never a minor or an unreliable concept, even with room to spare');
ok(M.selectConcepts(map, 20, { focus: 'essentials' }).selected.map((c) => c.id).join() === 'c1,c2,c3,c5', 'Essentials: core ideas only');
const lopsided = { topics: [{ id: 't1', title: 'Big', importance: 'major' }, { id: 't2', title: 'Small', importance: 'major' }], concepts: [
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ id: `b${i}`, topic: 't1', importance: 'core', clarity: 'clear', refs: [i] })),
  ...[1, 2].map((i) => ({ id: `s${i}`, topic: 't2', importance: 'core', clarity: 'clear', refs: [20 + i] })) ] };
ok(M.selectConcepts(lopsided, 4).selected.filter((c) => c.topic === 't1').length === 3, 'a topic with more key ideas gets proportionally more items, not the same number as a small one');
ok(M.excerptIds([{ refs: [5] }, { refs: [7] }], Array.from({ length: 20 }, (_, id) => ({ id })), 1).join() === '4,5,6,7,8', 'excerpts: the cited lines with a little context, in order');

// ---------- checks ----------
const items = [
  { concept: 'c1', front: 'Q1?', back: 'A1', explanation: 'E1', refs: [1] },
  { concept: 'c2', front: 'Q2?', back: 'A2', explanation: 'E2', refs: [2] },
  { concept: 'c3', front: 'Why does Al-Kaldoon say the cycle repeats?', back: 'A3', explanation: null, refs: [3] },
  { concept: 'c4', front: 'Q4?', back: 'wrong', explanation: null, refs: [4] },
];
const base = { matches: true, supported: true, explanation_supported: true, attribution_ok: true, distractors_ok: true, uncertain_terms: [], drop: false, fixed_question: null, fixed_answer: null, fixed_explanation: null, fixed_options: [] };
const { items: kept, stats } = M.applyChecks('flashcards', items, [
  { ...base, index: 0, supported: false },
  { ...base, index: 1, explanation_supported: false },
  { ...base, index: 2, uncertain_terms: ['Al-Kaldoon', 'not in the item'] },
  { ...base, index: 3, matches: false, fixed_answer: 'right' },
]);
ok(kept.length === 3 && stats.verify_dropped === 1, 'an unsupported item is dropped');
ok(kept[0].explanation === null && stats.explanation_unsupported === 1, 'an unsupported explanation is removed, the card stays');
ok(/“Al-Kaldoon” may be misheard/.test(kept[1].caution) && !/not in the item/.test(kept[1].caution), 'a word that looks misheard is labelled (only words the item actually uses), never corrected');
ok(kept[2].back === 'right' && stats.verify_fixed === 1, 'a mismatched answer is replaced by the fix from the same lines');
ok(M.applyChecks('flashcards', [items[0]], [{ ...base, index: 0, matches: false }]).items.length === 0, 'a mismatch with no fix is dropped');
const mcq = { concept: 'c1', type: 'multiple_choice', question: 'Q?', answer: 'B', options: ['A', 'B', 'C', 'D'], refs: [1] };
const weak = M.applyChecks('quiz', [mcq], [{ ...base, index: 0, distractors_ok: false, fixed_options: ['B', 'Plausible 1', 'Plausible 2', 'Plausible 3'] }]);
ok(weak.items[0].options.includes('Plausible 1') && weak.items[0].options.includes('B'), 'weak distractors are replaced when the check offers better ones');
ok(M.applyChecks('quiz', [mcq], [{ ...base, index: 0, fixed_answer: 'Z' }]).items.length === 0, 'a "fixed" answer that is not among the options is not accepted');

// ---------- names the transcript doesn't contain ----------
const words = M.transcriptWordSet([{ text: "Al-Kaldoon said the cycle repeats. The Keynesians and O'Neill's followers disagree; Adam Smith said look at what was said." }]);
ok(M.unseenNames('What did al-Khaldun say about the cycle?', words).join() === 'al-Khaldun', 'a guessed spelling of a garbled name is caught');
ok(M.unseenNames("Why do Keynesian and O'Neill's views differ, according to Adam Smith?", words).length === 0, 'plural / possessive forms of names in the transcript are fine');
ok(M.unseenNames(['Which method did they propose?', 'Setting up protection areas', 'Moving reefs'].join('\n'), new Set(['which', 'method', 'they', 'propose', 'protection', 'areas', 'reefs'])).length === 0, 'the first word of each answer option is not treated as a name');
ok(M.unseenNames('Mitosis is described by Smith.', new Set(['mitosis', 'described'])).join() === 'Smith', 'the first word of a sentence is not treated as a name');

console.log(`\n${pass} checks passed`);
