// Study engine 2 checks (server/ai/study.js) and stable speaker references (src/lib/speaker-refs.js).
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).href;
const R = await import(root + 'src/lib/speaker-refs.js');
const S = await import(root + 'server/ai/study.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---------- speaker codes ----------
const seg = (rows) => rows.map(([speaker, text], id) => ({ id, start: id * 10, speaker, text }));
const lecture = seg([['Speaker 1', 'Today: two schools.'], ['Speaker 1', 'The first school holds X.'], ['Unknown', 'mm'], ['Speaker 2', 'Why X?'], ['Speaker 1', 'Because of Y.'], ['Speaker 3', 'Thanks.']]);
const { table, codeOf, shares } = R.speakerTable(lecture);
ok(Object.keys(table).join() === 'S1,S2,S3' && codeOf.get('Speaker 2') === 'S2' && !codeOf.has('Unknown'), 'codes follow first appearance; Unknown gets none');
ok(R.dominantSpeaker({ S1: 0.95, S2: 0.05 }) === 'S1' && R.dominantSpeaker({ S1: 0.6, S2: 0.4 }) === null, 'a speaker with ≥80% of the words is "the lecturer"');
ok(JSON.stringify(R.toRanges([5, 1, 2, 3, 9])) === '[[1,3],[5,5],[9,9]]' && R.fromRanges([[1, 3], [9, 9]]).join() === '1,2,3,9', 'line ranges round-trip');

const out = R.tokenizeSpeakers({
  a: 'Why did {S2} object, and how did [[S1]] answer?', b: 'S1 says {{ S3 }} thanked Speaker 1 and speaker 2.',
  c: 'Grace Hopper said it.', d: 'Unknown code {{S9}}.', quote: 'Speaker 1 told S1 to stop', evidence: 'S2 said so',
}, new Map([...codeOf, ['Grace', 'S4']]));
ok(out.a === 'Why did {{S2}} object, and how did {{S1}} answer?', 'the model\'s ways of writing a code become {{S1}}');
ok(out.b === '{{S1}} says {{S3}} thanked {{S1}} and {{S2}}.', 'bare codes and automatic labels ("Speaker 1", any case) become codes');
ok(out.c === 'Grace Hopper said it.', 'a name the user gave a speaker is never searched for in the text ("Grace Hopper" untouched)');
ok(out.d === 'Unknown code a speaker.', 'a code that does not exist is not shown as a code');
ok(out.quote === 'Speaker 1 told S1 to stop' && out.evidence === 'S2 said so', 'verbatim quotes and evidence are never changed');

// resolving: renames, renamed twice, merges, moved to Unknown, restructured transcript
const now = (names) => lecture.map((s, i) => ({ ...s, speaker: names[i] ?? s.speaker }));
const res = (segs) => R.speakerResolver(table, segs);
ok(res(lecture)('S1') === 'Speaker 1', 'unchanged transcript: the name it had');
ok(res(now({ 0: 'Professor Ahmad', 1: 'Professor Ahmad', 4: 'Professor Ahmad' }))('S1') === 'Professor Ahmad', 'renamed: the new name');
ok(res(now({ 0: 'Dr. Ahmad', 1: 'Dr. Ahmad', 4: 'Dr. Ahmad' }))('S1') === 'Dr. Ahmad', 'renamed again: the latest name');
const merged = res(now({ 3: 'Speaker 1' }));
ok(merged('S2') === 'Speaker 1' && merged('S1') === 'Speaker 1', 'merged speakers: both codes show the merged name');
ok(res(now({ 5: 'Unknown' }))('S3') === 'an unidentified speaker', 'lines moved to Unknown: "an unidentified speaker"');
ok(res(now({ 1: 'Sara' }))('S1') === 'Speaker 1', 'one line reassigned: the name most of the speaker\'s lines carry');
ok(res([])('S2') === 'Speaker 2' && res(lecture)('S7') === 'a speaker', 'lines gone: the name at generation; unknown code: "a speaker"');

const stored = { speakers: table, basis: { n: 1 }, cards: [{ front: 'What did {{S2}} ask?', back: 'Why {{S1}} holds X.' }], evidence: 'x' };
const shown = R.resolveContent(stored, now({ 0: 'Ahmad', 1: 'Ahmad', 4: 'Ahmad', 3: 'Lina' }));
ok(shown.cards[0].front === 'What did Lina ask?' && shown.cards[0].back === 'Why Ahmad holds X.' && stored.cards[0].front.includes('{{S2}}'), 'a result shows current names; the stored result is unchanged');
ok(R.resolveContent({ cards: [{ front: 'Speaker 1' }] }, lecture).cards[0].front === 'Speaker 1', 'results made before codes existed are left as they were');

// fingerprint: renames don't count as changes; words and reassignments do
const base = R.transcriptBasis(lecture);
ok(R.sameBasis(base, R.transcriptBasis(now({ 0: 'Ahmad', 1: 'Ahmad', 4: 'Ahmad' }))), 'rename: same fingerprint (not out of date)');
ok(R.sameBasis(base, R.transcriptBasis(lecture.map((s) => ({ ...s, text: `  ${s.text} ` })))), 'whitespace differences: same fingerprint');
ok(!R.sameBasis(base, R.transcriptBasis(now({ 3: 'Speaker 1' }))), 'merging two speakers: out of date');
ok(!R.sameBasis(base, R.transcriptBasis(now({ 1: 'Speaker 2' }))), 'a paragraph reassigned: out of date');
ok(!R.sameBasis(base, R.transcriptBasis(lecture.map((s, i) => (i === 1 ? { ...s, text: 'The first school holds Z.' } : s)))), 'changed words: out of date');
ok(!R.sameBasis(undefined, base), 'no fingerprint (older results): decided by version as before');

// ---------- quality checks ----------
ok(S.isCircular('What distinguishes mitosis from meiosis?', 'Mitosis is different from meiosis.'), 'circular: "Mitosis is different from meiosis"');
ok(S.isCircular('Why should people evaluate what is said?', 'What was said.'), 'circular: "What was said"');
ok(S.isCircular('What did the author say to look at instead of who wrote something?', 'What was said'), 'circular: an answer that only echoes the question');
ok(!S.isCircular('What is the distinction between mitosis and meiosis as explained in the lecture?', 'Mitosis makes two identical cells; meiosis makes four cells with half the chromosomes, for reproduction.'), 'a real answer is not circular');
ok(!S.isCircular('Which rule says a composite index only serves queries on its leading columns?', 'The leftmost prefix rule'), 'a short term answer is not circular');
ok(S.vagueStart('What did he say about it?') && S.vagueStart('It refers to what?') && !S.vagueStart('What is the difference between X and Y?'), 'vague pronoun questions detected');
ok(S.dropNeedlessAttribution('According to {{S1}}, which is better: saving early, or saving more later?', 'S1') === 'Which is better: saving early, or saving more later?', '"According to Speaker 1, …" dropped when one speaker gives the lecture');
ok(S.dropNeedlessAttribution('Why does {{S2}} object to X?', 'S1') === 'Why does {{S2}} object to X?', 'another speaker\'s contribution keeps its attribution');
ok(S.dropNeedlessAttribution('What is X, as explained by {{S1}}?', 'S1') === 'What is X?' && S.lecturerWord('{{S1}} argues X.', 'S1') === 'the lecturer argues X.', 'other forms become "the lecturer" or disappear');
const school = { stance: 'attributed', held_by: 'Keynesian school' };
ok(!S.keepsAttribution({ front: 'What causes inflation?', back: 'Spending and cost pressures can build it up.' }, school), 'a school\'s position stated as a general truth is caught');
ok(S.keepsAttribution({ front: 'In the Keynesian view, what can cause inflation?', back: 'Spending and cost pressures can build it up.' }, school), 'the same position with its school named passes');
ok(S.keepsAttribution({ front: 'Why does the lecturer reject the claim that printing money never causes inflation?', back: '…' }, { stance: 'criticized', held_by: 'some online commentators' }), 'a criticized view may be asked about through the criticism');
ok(!S.keepsAttribution({ front: 'What argument was given for pricing at ten dollars?', back: 'Higher costs.' }, { stance: 'attributed', held_by: '{{S2}}' })
  && S.keepsAttribution({ front: 'Why did {{S2}} argue for ten dollars a month?', back: 'Higher costs.' }, { stance: 'attributed', held_by: '{{S2}}' }), "a meeting participant's proposal must say whose it was");
// legitimate items must survive the checks (short answers, definitions, technical terms, numbers, nuance)
const legit = [
  ['What data structure do most database indexes use?', 'A B-tree'],
  ['What is the term for the costs of changing prices, such as printing new menus?', 'Menu costs'],
  ['What does CPI stand for?', 'Consumer price index'],
  ['How is inflation defined in the lecture?', 'A sustained rise in the general price level'],
  ['How many rhetorical functions of the command form have scholars identified?', '25'],
  ['Is a bleached coral dead?', 'No'],
  ['What does the monetarist view say causes sustained inflation?', 'The money supply growing faster than output'],
  ['What is the real interest rate?', 'The nominal interest rate minus inflation'],
];
ok(legit.every(([q, a]) => !S.isCircular(q, a)), 'short answers, definitions, terms, numbers and yes/no are not mistaken for circular answers');
ok(['What does this lecture define as inflation?', 'Why does that school reject the claim?', 'What is the itinerary of the argument?', 'How do these two schools differ on free will?'].every((q) => !S.vagueStart(q)), '"this lecture", "that school", "these two schools" are specific, not vague');
ok(!S.restates('Because repayments are fixed in money terms, inflation lowers what they are worth.', 'It helps borrowers.', 'Why does inflation help borrowers?')
  && S.restates('It helps borrowers.', 'It helps borrowers and hurts lenders.', 'Who does inflation help?'), 'a short but real explanation is kept; one that repeats the answer is removed');
const cards = [
  { concept: 'p2', front: 'What price did {{S2}} propose, and why?', back: 'Ten dollars a month, to keep a healthy margin.', explanation: null, refs: [1] },
  { concept: 'p3', front: 'What price did {{S3}} propose, and why?', back: 'Eight dollars, because competitors charge eight and nine.', explanation: null, refs: [2] },
  { concept: 'p2', front: 'What price did {{S2}} propose and why?', back: 'Ten dollars a month.', explanation: null, refs: [1] },
];
const deck = { concepts: [
  { id: 'p2', importance: 'core', clarity: 'clear', stance: 'attributed', held_by: '{{S2}}', evidence: 'x', refs: [1] },
  { id: 'p3', importance: 'core', clarity: 'clear', stance: 'attributed', held_by: '{{S3}}', evidence: 'x', refs: [2] }], cards };
S.validateFlashcards(deck, [], { count: 10, dominant: null });
ok(deck.cards.length === 2 && deck.quality.duplicate === 1 && deck.quality.core_uncovered === 0, "two participants' opposing proposals are both kept; a true repeat is dropped");
ok(S.uncoveredConcepts([{ id: 'a', importance: 'core', clarity: 'clear' }, { id: 'b', importance: 'core', clarity: 'unreliable' }, { id: 'c', importance: 'supporting', clarity: 'clear' }], [{ concept: 'x' }]).map((k) => k.id).join() === 'a', 'coverage counts reliable core concepts only');
ok(S.keepsAttribution({ type: 'true_false', question: 'Adding more indexes to a table always makes queries faster.', answer: 'False', options: ['True', 'False'] }, { stance: 'criticized', held_by: 'a common misconception' })
  && !S.keepsAttribution({ type: 'true_false', question: 'Adding more indexes to a table always makes queries faster.', answer: 'True', options: ['True', 'False'] }, { stance: 'criticized', held_by: 'a common misconception' }),
  'a true/false item that marks a criticized claim False is kept; one presenting it as true is not');
ok(S.keepsAttribution({ front: 'How does the Keynes-inspired position explain wage pressure?', back: '…' }, { stance: 'attributed', held_by: 'Keynesian school' })
  && S.keepsAttribution({ front: 'How does the behaviorist position explain learning?', back: '…' }, { stance: 'attributed', held_by: 'Behaviourism' })
  && S.keepsAttribution({ front: "What does the ONeill model predict?", back: '…' }, { stance: 'attributed', held_by: "O'Neill's school" }), "spelling variants of a school's name count as naming it");
ok(!S.isCircular('In the lecture, is the money supply fixed or flexible under that rule?', 'Fixed') && S.isCircular('What does the rule say about money?', 'Money'), 'picking one of the alternatives a question names is an answer, not circular');
const um = { concepts: [{ id: 'k1', importance: 'core', clarity: 'clear', stance: 'own', held_by: null, evidence: 'x', refs: [0] }], cards: [
  { concept: 'k1', front: 'What is a covering index?', back: 'An index holding every column a query needs, so the table is not read.', explanation: null, refs: [0] },
  { concept: 'k9', front: 'Why does a low-selectivity column rarely benefit from an index?', back: 'The database would still read a large share of the rows.', explanation: null, refs: [1] },
  { concept: 'k5', front: 'What does the invented concept claim about indexes?', back: 'Something nobody said in the lesson at all.', explanation: null, refs: [1] },
] };
S.validateFlashcards(um, [], { count: 10, dominant: null, rawConceptIds: new Set(['k1', 'k5']) });
ok(um.cards.length === 2 && um.quality.unmapped === 1 && um.quality.ungrounded_concept === 1, 'a grounded item for an idea missing from the map is kept; one whose concept failed grounding is dropped');
ok(S.keepsAttribution({ question: 'What concern did {{S2}} raise about an eight-dollar price?', answer: 'Support costs' }, { stance: 'attributed', held_by: '{{S3}}' }), "a question about another participant's reaction to a proposal still says whose view it is");
ok(S.uncoveredConcepts([{ id: 's', importance: 'supporting', clarity: 'clear' }, { id: 'a', importance: 'core', clarity: 'clear' }, { id: 'm', importance: 'minor', clarity: 'clear' }], [], { supporting: true }).map((k) => k.id).join() === 'a,s', 'the coverage pass fills core concepts first, then supporting ones, never minor');
ok(S.shuffle(['a', 'b', 'c', 'd'], 'q1').join() === S.shuffle(['a', 'b', 'c', 'd'], 'q1').join(), 'option order is stable');

console.log(`\n${pass} checks passed`);
