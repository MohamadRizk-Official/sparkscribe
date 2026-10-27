// Local-development stand-in for the AI provider (AI_PROVIDER=mock; refused in production).
// Deterministic and crude on purpose: it exercises the whole pipeline — storage, caching, staleness,
// streaming, citations — without a key or any cost. It also deliberately returns one made-up line
// number, one invented quote and one decision with invented evidence, so the grounding checks are
// exercised on every run.
// It says nothing about real answer quality.

const parseLines = (text) =>
  [...String(text).matchAll(/^\[(\d+)\] (\d+(?::\d+)+) ([^:\n]+): (.+)$/gm)].map((m) => ({ id: Number(m[1]), speaker: m[3], text: m[4] }));
const firstSentence = (t) => (t.match(/^.*?[.!?](\s|$)/) || [t])[0].trim();
const COMMON = new Set('what about that this with they them have said from were when where which would could should there their your into does did the and for'.split(' '));
const words = (t) => (String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 3 && !COMMON.has(w));
const pick = (lines, re, n = 4) => lines.filter((l) => re.test(l.text)).slice(0, n);
const BOGUS = 99999;

function structured(task, lines) {
  if (task === 'expand') return { keywords: [] };
  if (task === 'overview') {
    const long = [...lines].sort((a, b) => b.text.length - a.text.length).slice(0, 4).sort((a, b) => a.id - b.id);
    const step = Math.max(1, Math.floor(lines.length / 4));
    return {
      short_summary: `[Mock] ${lines.slice(0, 2).map((l) => firstSentence(l.text)).join(' ')}`,
      key_points: [...long.map((l) => ({ text: firstSentence(l.text), refs: [l.id] })), { text: 'Ungrounded point (mock)', refs: [BOGUS] }],
      chapters: lines.length >= 8 ? [0, 1, 2, 3].map((k) => ({ title: `Mock part ${k + 1}`, summary: firstSentence(lines[k * step].text), start_ref: lines[k * step].id })) : [],
    };
  }
  if (task === 'detailed_summary') {
    const half = Math.ceil(lines.length / 2);
    return { sections: [lines.slice(0, half), lines.slice(half)].filter((p) => p.length).map((p, i) => ({ heading: i ? 'Later' : 'Beginning', points: p.slice(0, 3).map((l) => ({ text: firstSentence(l.text), refs: [l.id] })) })) };
  }
  // Phase 5 tools: deliberately include items the validators must reject (made-up evidence, a vague card,
  // a malformed quiz question, an exam claim without exam words)
  const L = (i) => lines[Math.min(i, lines.length - 1)] || { id: 0, text: '' };
  const ev = (l) => firstSentence(l.text);
  if (task === 'study_guide') {
    return {
      overview: `[Mock] ${ev(L(0))}`, topics: [{ title: 'Mock topic', summary: ev(L(0)), start_ref: L(0).id }],
      concepts: [{ term: 'Mock concept', explanation: ev(L(1)), refs: [L(1).id] }],
      definitions: [{ term: 'Mock term', definition: ev(L(1)), evidence: ev(L(1)), refs: [L(1).id] }, { term: 'Invented', definition: 'x', evidence: 'words nobody said at all', refs: [L(1).id] }],
      examples: [], processes: [{ name: 'One step only', steps: ['a'], refs: [L(0).id] }], relationships: [],
      emphasis: [], exam_info: [{ text: 'Not really an exam point', evidence: ev(L(0)), refs: [L(0).id] }], review: [],
    };
  }
  // study engine 2: a knowledge map, then items; plus every kind of weak item the checks must reject
  if (task === 'flashcards' || task === 'quiz') {
    const concepts = [
      { id: 'c1', name: 'Main idea', kind: 'principle', importance: 'core', stance: 'own', held_by: null, summary: ev(L(0)), reasoning: null, clarity: 'clear', evidence: ev(L(0)), refs: [L(0).id] },
      { id: 'c2', name: 'Second idea', kind: 'definition', importance: 'supporting', stance: 'attributed', held_by: 'Mock School', summary: ev(L(1)), reasoning: ev(L(1)), clarity: 'clear', evidence: ev(L(1)), refs: [L(1).id] },
      { id: 'c3', name: 'Trivia', kind: 'fact', importance: 'minor', stance: 'report', held_by: null, summary: 'a count', reasoning: null, clarity: 'clear', evidence: ev(L(0)), refs: [L(0).id] },
      { id: 'c4', name: 'Garbled bit', kind: 'fact', importance: 'core', stance: 'own', held_by: null, summary: '?', reasoning: null, clarity: 'unreliable', evidence: ev(L(1)), refs: [L(1).id] },
      { id: 'c5', name: 'Invented', kind: 'fact', importance: 'core', stance: 'own', held_by: null, summary: 'x', reasoning: null, clarity: 'clear', evidence: 'words nobody ever said in this recording', refs: [L(0).id] },
    ];
    const w = words(L(0).text)[0] || 'this';
    if (task === 'flashcards') {
      return { concepts, cards: [
        { concept: 'c1', front: `According to {{S1}}, why does the recording stress ${w}?`, back: ev(L(0)), explanation: `Because ${ev(L(1))}`, refs: [L(0).id] },
        { concept: 'c1', front: `Why does the recording stress ${w}?`, back: ev(L(0)), explanation: null, refs: [L(0).id] },          // duplicate
        { concept: 'c2', front: 'In the Mock School view, what is the second idea?', back: ev(L(1)), explanation: ev(L(1)), refs: [] },  // explanation restates; refs inherited
        { concept: 'c2', front: 'What does the second idea describe?', back: 'Heads that like water and tails that avoid it', explanation: null, refs: [L(1).id] }, // attribution lost
        { concept: 'c1', front: 'What did he say about it?', back: ev(L(0)), explanation: null, refs: [L(0).id] },                      // vague
        { concept: 'c3', front: 'How many things were counted in the recording?', back: 'Twenty five', explanation: null, refs: [L(0).id] }, // minor
        { concept: 'c4', front: 'What does the garbled passage mean exactly?', back: 'Something unclear', explanation: null, refs: [L(1).id] }, // unreliable
        { concept: 'c5', front: 'What invented thing was never really said?', back: 'Nothing at all', explanation: null, refs: [L(0).id] },  // concept not grounded
        { concept: 'c1', front: 'What distinguishes the first idea from the second?', back: 'The first idea is different from the second', explanation: null, refs: [L(0).id] }, // circular
      ] };
    }
    return { concepts, questions: [
      { concept: 'c1', type: 'multiple_choice', skill: 'understanding', question: `According to {{S1}}, which statement best explains ${w}?`, options: [ev(L(0)), ev(L(1)), ev(L(2)), `${ev(L(0)).split(' ').reverse().join(' ')}`], answer: ev(L(0)), accept: [], explanation: `The recording explains it this way: ${ev(L(1))}`, refs: [L(0).id] },
      { concept: 'c1', type: 'true_false', skill: 'recall', question: 'The recording has a first line.', options: ['True', 'False'], answer: 'true', accept: [], explanation: null, refs: [L(0).id] }, // trivial true/false
      { concept: 'c2', type: 'true_false', skill: 'misconception', question: 'In the Mock School view, the second idea is the opposite of the first.', options: ['True', 'False'], answer: 'false', accept: [], explanation: 'The Mock School view presents it as a definition, not as an opposite of the first idea.', refs: [L(1).id] },
      { concept: 'c1', type: 'multiple_choice', skill: 'reasoning', question: 'Malformed: answer not among the options?', options: ['A', 'B', 'C', 'D'], answer: 'E', accept: [], explanation: null, refs: [L(0).id] },
      { concept: 'c1', type: 'multiple_choice', skill: 'reasoning', question: 'Which option is obviously the longest one here?', options: ['This correct option is very much longer than every one of the other options listed', 'Short', 'Brief', 'Tiny'], answer: 'This correct option is very much longer than every one of the other options listed', accept: [], explanation: null, refs: [L(0).id] },
      { concept: 'c2', type: 'multiple_choice', skill: 'recall', question: 'In the Mock School view, which of these applies?', options: ['One', 'Two', 'All of the above', 'Three'], answer: 'One', accept: [], explanation: null, refs: [L(1).id] },
      { concept: 'c3', type: 'short_answer', skill: 'recall', question: 'How many items were counted?', options: [], answer: '25', accept: [], explanation: null, refs: [L(0).id] },
      { concept: 'c2', type: 'short_answer', skill: 'recall', question: `What does the Mock School call the idea about ${w}?`, options: [], answer: words(L(1).text)[0] || 'x', accept: [], explanation: null, refs: [] },
    ] };
  }
  if (task === 'definitions') return { definitions: [{ term: 'Mock term', definition: ev(L(1)), evidence: ev(L(1)), refs: [L(1).id] }] };
  if (task === 'exam_points') return { explicit: [{ text: 'Claimed exam point without exam words', evidence: ev(L(0)), refs: [L(0).id] }], worth_reviewing: [] };
  if (task === 'meeting_recap') return { overview: `[Mock] ${ev(L(0))}`, topics: [{ title: 'Mock', summary: ev(L(0)), start_ref: BOGUS }], decisions: [], action_items: [], open_questions: [], follow_ups: [], important_dates: [] };
  if (task === 'action_plan') return { tasks: [
    { task: 'Mock task', status: 'open', owner: null, owner_basis: 'none', deadline: null, evidence: ev(L(0)), refs: [L(0).id], resolution: null, resolution_refs: [] },
    { task: 'Mock done task', status: 'completed_in_recording', owner: L(0).speaker, owner_basis: 'volunteered', deadline: null, evidence: ev(L(0)), refs: [L(0).id], resolution: 'Done in the meeting', resolution_refs: [L(0).id] },
  ] };
  if (task === 'followup_email') return { subject: 'Follow-up', body: 'Hi [name],\nAs agreed, the price is $49 and we will ship by Monday.\nThanks', facts: [{ fact: 'something', evidence: ev(L(0)), refs: [L(0).id] }] };
  if (task === 'reply_draft') return { reply: 'Sure, I will send it first thing tomorrow.', addresses: [{ request: 'send the file', evidence: ev(L(0)), refs: [L(0).id] }] };
  if (task === 'interview_qa') return { is_interview: true, pairs: [{ question: L(0).text, asked_by: L(0).speaker, response: ev(L(1)), answered_by: L(1).speaker, refs: [L(0).id, L(1).id] }], quotes: [{ quote: ev(L(1)), speaker: L(1).speaker, refs: [L(1).id] }, { quote: 'A made-up quote nobody said', speaker: 'Speaker 1', refs: [L(0).id] }] };
  if (task === 'episode_notes') return { summary: `[Mock] ${ev(L(0))}`, outline: [{ title: 'Start', summary: ev(L(0)), start_ref: L(0).id }], takeaways: [{ text: ev(L(1)), refs: [L(1).id] }], quotes: [] };
  if (task === 'notes') {
    const half = Math.ceil(lines.length / 2);
    return {
      sections: [lines.slice(0, half), lines.slice(half)].filter((p) => p.length).map((p, i) => ({
        heading: i ? 'Later topic (mock)' : 'First topic (mock)',
        start_ref: i ? p[0].id : BOGUS, // an invalid section start, which the server must repair
        items: [...p.slice(0, 3).map((l, k) => ({ type: 'point', text: firstSentence(l.text), key: k === 0, refs: [l.id] })), { type: 'detail', text: 'Ungrounded note (mock)', key: false, refs: [BOGUS] }],
      })),
    };
  }
  const acts = pick(lines, /\b(will|need to|needs to|should|please|can you|send|finish|prepare)\b/i).map((l) => ({ task: firstSentence(l.text), owner: null, deadline: (l.text.match(/\b(by|before|on) ([A-Z][a-z]+day|tomorrow|next \w+)/) || [])[0] || null, evidence: firstSentence(l.text), refs: [l.id] }));
  const decs = pick(lines, /\b(agreed|decided|we'll go with|let's go with|final)\b/i).map((l) => ({ text: firstSentence(l.text), evidence: firstSentence(l.text), refs: [l.id] }));
  if (lines.length) decs.push({ text: 'Invented decision (mock)', evidence: 'we all agreed on something nobody said', refs: [lines[0].id] });
  const dates = pick(lines, /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(st|nd|rd|th))\b/i)
    .map((l) => ({ what: firstSentence(l.text), when: (l.text.match(/\b(next \w+|\w+day|tomorrow|\w+ \d{1,2}(st|nd|rd|th)?)\b/i) || ['as said'])[0], refs: [l.id] }));
  const pts = lines.slice(0, 3).map((l) => ({ text: firstSentence(l.text), refs: [l.id] }));
  const quotes = [...lines.slice(0, 2).map((l) => ({ quote: firstSentence(l.text), speaker: l.speaker, refs: [l.id] })), { quote: 'A sentence nobody ever said in this recording', speaker: 'Speaker 1', refs: [lines[0]?.id ?? 0] }];
  const type = task.split(':')[1];
  const common = { action_items: [...acts, { task: 'Invented task (mock)', owner: 'Nobody', deadline: null, evidence: 'nothing', refs: [BOGUS] }], decisions: decs, suggestions: [], priorities: [], concerns: [], important_dates: dates };
  switch (type) {
    case 'meeting': return { ...common, open_questions: pick(lines, /\?$/).map((l) => ({ text: l.text, refs: [l.id] })), follow_ups: [] };
    case 'lecture': return { key_concepts: [], definitions: pick(lines, /\b(is defined as|means|refers to)\b/i).map((l) => ({ term: l.text.split(' ').slice(0, 2).join(' '), definition: l.text, refs: [l.id] })), important_topics: pts, exam_points: pick(lines, /\b(exam|test|quiz|important|remember)\b/i).map((l) => ({ text: l.text, refs: [l.id] })) };
    case 'interview': return { questions: pick(lines, /\?$/).map((l) => ({ question: l.text, asked_by: l.speaker, answer: lines.find((x) => x.id === l.id + 1)?.text || '', answered_by: lines.find((x) => x.id === l.id + 1)?.speaker || null, refs: [l.id, l.id + 1] })), major_topics: pts, notable_quotes: quotes, key_takeaways: pts };
    case 'podcast': return { main_topics: pts, key_takeaways: pts, notable_quotes: quotes };
    case 'voice_message': return { important_information: pts, requested_actions: acts, dates_times: dates };
    default: return common;
  }
}

// AI_MOCK_FAIL=1 makes every call fail, to exercise the error / retry paths.
const maybeFail = () => {
  if (process.env.AI_MOCK_FAIL === '1') throw Object.assign(new Error('Mock provider failure'), { status: 502 });
};

// Study engine 3 steps. The section step finds the same five concepts as engine 2's mock (one good, one a school's
// view, one trivia, one garbled, one with invented evidence); the writer returns good and bad items for the chosen
// concepts, so every check still runs.
function studyEngine3(base, step, text) {
  const tag = (t) => (text.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [, ''])[1];
  if (base === 'studymap' && step === 'section') {
    const lines = parseLines(tag('section'));
    const L = (i) => lines[Math.min(i, lines.length - 1)] || { id: 0, text: '' };
    const ev = (l) => firstSentence(l.text);
    if (!lines.length) return { topics: [], concepts: [] };
    const c = (id, name, kind, importance, stance, held_by, l, clarity = 'clear', evidence = ev(l)) => ({ id, topic: 'Mock topic', name, kind, importance, stance, held_by, summary: ev(l), reasoning: null, clarity, exam_words: null, evidence, refs: [l.id] });
    return {
      topics: [{ title: 'Mock topic', start_ref: L(0).id, educational: true }],
      concepts: [
        c('c1', 'Main idea', 'principle', 'core', 'own', null, L(0)),
        c('c2', 'Second idea', 'definition', 'supporting', 'attributed', 'Mock School', L(1)),
        c('c3', 'Trivia', 'fact', 'minor', 'report', null, L(0)),
        c('c4', 'Garbled bit', 'fact', 'core', 'own', null, L(1), 'unreliable'),
        c('c5', 'Invented', 'fact', 'core', 'own', null, L(0), 'clear', 'words nobody ever said in this recording'),
      ],
    };
  }
  if (base === 'studymap' && step === 'merge') {
    const keys = [...tag('entries').matchAll(/^(s\d+\.c\d+) \|/gm)].map((m) => m[1]);
    return { topics: [{ title: 'Mock topic', importance: 'major', keys }], same: [] };
  }
  if (step === 'compose') {
    const ids = [...tag('map').matchAll(/"id": "(c\d+)"/g)].map((m) => m[1]);
    const tids = [...tag('map').matchAll(/"id": "(t\d+)"/g)].map((m) => m[1]);
    return { overview: '[Mock] What the recording teaches.', topic_summaries: tids.map((t) => ({ topic: t, summary: '[Mock] Topic summary.' })), self_check: ids.slice(0, 1).map((id) => ({ concept: id, question: 'Why does the main idea matter here?', answer: '[Mock] Because the recording explains it.' })) };
  }
  if (step === 'write') {
    const concepts = JSON.parse(tag('concepts') || '[]');
    const lines = parseLines(tag('transcript'));
    const ev = (i) => firstSentence((lines[Math.min(i, lines.length - 1)] || { text: '' }).text);
    const own = concepts.find((k) => k.stance === 'own'), att = concepts.find((k) => k.stance === 'attributed');
    const w = words(ev(0))[0] || 'this';
    if (base === 'flashcards') {
      const cards = [];
      if (own) cards.push(
        { concept: own.id, front: `According to {{S1}}, why does the recording stress ${w}?`, back: ev(0), explanation: `Because ${ev(1)}`, refs: [] },
        { concept: own.id, front: `Why does the recording stress ${w}?`, back: ev(0), explanation: null, refs: [] },
        { concept: own.id, front: 'What did he say about it?', back: ev(0), explanation: null, refs: [] },
        { concept: own.id, front: 'What distinguishes the first idea from the second?', back: 'The first idea is different from the second', explanation: null, refs: [] });
      if (att) cards.push(
        { concept: att.id, front: 'In the Mock School view, what is the second idea?', back: ev(1), explanation: ev(1), refs: [] },
        { concept: att.id, front: 'What does the second idea describe?', back: 'Heads that like water and tails that avoid it', explanation: null, refs: [] });
      return { cards };
    }
    const questions = [];
    if (own) questions.push(
      { concept: own.id, type: 'multiple_choice', skill: 'understanding', question: `According to {{S1}}, which statement best explains ${w}?`, options: [ev(0), ev(1), ev(2), ev(0).split(' ').reverse().join(' ')], answer: ev(0), accept: [], explanation: `The recording explains it this way: ${ev(1)}`, refs: [] },
      { concept: own.id, type: 'true_false', skill: 'recall', question: 'The recording has a first line.', options: ['True', 'False'], answer: 'true', accept: [], explanation: null, refs: [] },
      { concept: own.id, type: 'multiple_choice', skill: 'reasoning', question: 'Which option is obviously the longest one here?', options: ['This correct option is very much longer than every one of the other options listed', 'Short', 'Brief', 'Tiny'], answer: 'This correct option is very much longer than every one of the other options listed', accept: [], explanation: null, refs: [] });
    if (att) questions.push(
      { concept: att.id, type: 'true_false', skill: 'misconception', question: 'In the Mock School view, the second idea is the opposite of the first.', options: ['True', 'False'], answer: 'false', accept: [], explanation: 'The Mock School view presents it as a definition, not as an opposite of the first idea.', refs: [] },
      { concept: att.id, type: 'multiple_choice', skill: 'recall', question: 'In the Mock School view, which of these applies?', options: ['One', 'Two', 'All of the above', 'Three'], answer: 'One', accept: [], explanation: null, refs: [] },
      { concept: att.id, type: 'short_answer', skill: 'recall', question: `What does the Mock School call the idea about ${w}?`, options: [], answer: words(ev(1))[0] || 'x', accept: [], explanation: null, refs: [] });
    // Focused Review follow-ups: the same ideas asked another way (an application), plus one exact repeat that the
    // duplicate check must drop
    if (/FOLLOW-UP questions/.test(text)) {
      const repeat = (text.match(/never reuse their answer or options:\n- (.+)/) || [])[1];
      return { questions: [
        ...concepts.map((k) => ({ concept: k.id, type: 'multiple_choice', skill: 'application', question: `In a new situation, which choice applies the idea "${k.name}" correctly?`, options: [ev(0), ev(1), ev(2), `Not ${ev(0)}`], answer: ev(0), accept: [], explanation: `The recording explains it this way: ${ev(1)}`, refs: [] })),
        ...(repeat ? [{ concept: concepts[0]?.id, type: 'short_answer', skill: 'recall', question: repeat, options: [], answer: 'x', accept: [], explanation: null, refs: [] }] : []),
      ] };
    }
    return { questions };
  }
  if (step === 'verify' || step === 'recheck') {
    const n = [...text.matchAll(/<item index="(\d+)">/g)].length;
    // AI_MOCK_VERIFY=drop0: the check rejects the first item; =fix0: it rewrites its answer
    const mode = process.env.AI_MOCK_VERIFY || '';
    // =ambig0: another option of the first item also fits (=ambig0fix: and the check re-words the question)
    const blocks = [...text.matchAll(/<item index="(\d+)">([\s\S]*?)<\/item>/g)].map((m) => m[2]);
    const optionChecks = (b, i) => {
      // options are shown lettered, "(A) text  (B) text"; the check answers with the letter
      const opts = ((b.match(/^Options: (.*)$/m) || [, ''])[1]).split(/\s*\(([A-E])\)\s+/).slice(1);
      const pairs = []; for (let k = 0; k < opts.length; k += 2) pairs.push([opts[k], opts[k + 1].trim()]);
      const ans = (b.match(/^Answer: (.*)$/m) || [, ''])[1].trim();
      let other = false;
      return pairs.map(([letter, o]) => {
        const isKey = o === ans;
        const fits = isKey ? 'yes' : (!other && i === 0 && /^ambig0/.test(mode) && !text.includes('already corrected once')) ? ((other = true), 'yes') : 'no';
        return { option: letter, fits };
      });
    };
    return { checks: Array.from({ length: n }, (_, i) => ({ index: i, matches: true, supported: !(mode === 'drop0' && i === 0), explanation_supported: true, attribution_ok: true, distractors_ok: true, option_checks: optionChecks(blocks[i] || '', i), uncertain_terms: [], drop: false, fixed_question: mode === 'ambig0fix' && i === 0 && !text.includes('already corrected once') ? '[Mock] Which example did the lecturer specifically give?' : null, fixed_answer: mode === 'fix0' && i === 0 ? '[Mock] A corrected answer that matches the question.' : null, fixed_explanation: null, fixed_options: [] })) };
  }
  return {};
}

// Across recordings: for each recording, the line sharing most words with the question, cited [R2:45]; plus one
// citation of a line it was never given ([R9:999]), which grounding must remove.
function acrossAnswer(prompt) {
  const question = (prompt.match(/<question>\n?([\s\S]*?)\n?<\/question>/) || [, ''])[1];
  const qw = new Set(words(question));
  const recs = [...prompt.matchAll(/<recording label="(R\d+)" title="([^"]*)"[^>]*>([\s\S]*?)<\/recording>/g)];
  const parts = [];
  // like the real prompt asks: recordings as {{R2}}, speakers as {{R2.S1}}; one bare label ("R1") and one unknown
  // speaker code are left in, which the server must turn into a token / a neutral word
  for (const [, label, , body] of recs) {
    let best = null, score = 0;
    for (const m of body.matchAll(/^\[(R\d+):(\d+)\] (?:\d+:\d+(?::\d+)? (\S[^:]*): )?(.+)$/gm)) {
      const s = words(m[4]).filter((w) => qw.has(w)).length;
      if (s > score) { best = { line: m[2], code: /^R\d+\.S\d+$/.test(m[3] || '') ? m[3] : null, text: m[4] }; score = s; }
    }
    if (best) parts.push(`In {{${label}}}, ${best.code ? `{{${best.code}}}` : 'the speaker'} says: "${firstSentence(best.text)}" [${label}:${best.line}].`);
  }
  return parts.length ? `[Mock] ${parts.join(' ')} Compare R1 with the others; {{R1.S9}} said nothing. One invented link [R9:999].` : '[Mock] None of the selected recordings mention that.';
}
// Combined guide: one theme joining the first concept of every recording (a recurring theme), one theme per
// recording, and one item resting only on a concept that doesn't exist (dropped by grounding).
function acrossGuide(text) {
  const refs = [...new Set([...text.matchAll(/^(R\d+\.c\d+) \|/gm)].map((m) => m[1]))];
  const first = [...new Map(refs.map((r) => [r.split('.')[0], r])).values()];
  return {
    overview: '[Mock] What these recordings teach together.',
    themes: [
      { title: 'Shared idea', summary: '[Mock] An idea that comes up in several recordings.', comparison: first.length > 1 ? `[Mock] {{${first[1].split('.')[0]}}} refines {{${first[0].split('.')[0]}}}.` : null, concepts: first },
      ...first.map((r, i) => ({ title: `Theme of recording ${i + 1}`, summary: '[Mock] Taught in one recording.', comparison: null, concepts: [r] })),
      { title: 'Invented theme', summary: 'Rests on nothing real.', comparison: null, concepts: ['R9.c99'] },
    ],
    definitions: refs.slice(0, 2).map((r) => ({ term: `Term ${r}`, definition: '[Mock] As the recording defines it.', concepts: [r] })),
    distinctions: [{ text: '[Mock] Two ideas not to confuse.', concepts: first.slice(0, 2) }],
    self_check: [{ question: '[Mock] How do the recordings connect?', answer: '[Mock] Through the shared idea.', concepts: first }],
  };
}

export function mockProvider() {
  return {
    name: 'mock',
    async complete({ task, messages }) {
      maybeFail();
      const text = messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text).join('\n'))).join('\n');
      await new Promise((r) => setTimeout(r, 400));
      if (task === 'grade') {   // crude: a shared word → correct; a few broad place words → close
        const tag = (t) => (text.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [, ''])[1].toLowerCase();
        const exp = words(tag('expected_answer')), ans = tag('learner_answer');
        const json = exp.some((w) => ans.includes(w)) ? { verdict: 'correct', feedback: '[Mock] Same idea as the recording.', corrected: null }
          : /worldwide|global|everywhere|nationwide/.test(ans) ? { verdict: 'close', feedback: '[Mock] Close enough — the recording said it differently.', corrected: null }
            : { verdict: 'incorrect', feedback: '[Mock] Not what the recording says.', corrected: null };
        return { text: JSON.stringify(json), json, model: 'mock', usage: { input: Math.ceil(text.length / 3.2), output: 30 } };
      }
      let json;
      const [base, step] = String(task).split(':');
      if (task === 'across:guide') json = acrossGuide(text);
      else if (base === 'studymap' || ['write', 'verify', 'recheck', 'compose'].includes(step)) json = studyEngine3(base, step, text);
      else if (step === 'fill') {
        // coverage pass: items for exactly the concepts it was asked about
        const ids = new Set([...((text.match(/<concepts>([\s\S]*?)<\/concepts>/) || [, '[]'])[1].matchAll(/"id": "([^"]+)"/g))].map((m) => m[1]));
        const all = structured(base, parseLines(text));
        const key = base === 'quiz' ? 'questions' : 'cards';
        json = { [key]: all[key].filter((x) => ids.has(x.concept)) };
      } else {
        json = structured(task, parseLines(text));
        // AI_MOCK_UNCOVERED=1: the first pass leaves out the core concept c1 (exercises the coverage pass)
        if (process.env.AI_MOCK_UNCOVERED === '1' && (task === 'flashcards' || task === 'quiz')) {
          const key = task === 'quiz' ? 'questions' : 'cards';
          json[key] = json[key].filter((x) => x.concept !== 'c1');
        }
      }
      return { text: JSON.stringify(json), json, model: 'mock', usage: { input: Math.ceil(text.length / 3.2), output: 200 } };
    },
    async stream({ task, messages }, onDelta) {
      maybeFail();
      const last = messages[messages.length - 1];
      const prompt = typeof last.content === 'string' ? last.content : last.content.map((c) => c.text).join('\n');
      if (task === 'across:ask') {
        const answer = acrossAnswer(prompt);
        for (const piece of answer.match(/\S+\s*/g)) { onDelta(piece); await new Promise((r) => setTimeout(r, 20)); }
        return { text: answer, model: 'mock', usage: { input: Math.ceil(prompt.length / 3.2), output: 80 }, truncated: false };
      }
      const question = (prompt.match(/<question>\n?([\s\S]*?)\n?<\/question>/) || [, ''])[1];
      const lines = parseLines(prompt);
      const qw = new Set(words(question));
      let best = null, bestScore = 0;
      for (const l of lines) {
        const s = words(l.text).filter((w) => qw.has(w)).length;
        if (s > bestScore) { best = l; bestScore = s; }
      }
      // a found answer uses the formatting Ask renders (a bold lead, a list, grouped citations)
      const next = lines[lines.indexOf(best) + 1];
      const answer = bestScore >= 2
        ? `[Mock] **${firstSentence(best.text)}** [${best.id}][${BOGUS}]

What the recording shows:
- The closest passage says: "${firstSentence(best.text)}" [${best.id}]${next ? `
- Right after: "${firstSentence(next.text)}" [${best.id}, ${next.id}]` : ''}`
        : `[Mock] The recording doesn't mention that (${question.replace(/\?$/, '').slice(0, 60)}).`;
      for (const piece of answer.match(/\S+\s*/g)) { onDelta(piece); await new Promise((r) => setTimeout(r, 25)); }
      return { text: answer, model: 'mock', usage: { input: Math.ceil(prompt.length / 3.2), output: 40 }, truncated: false };
    },
  };
}
