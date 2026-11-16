// How Create-tab results become text for Copy and Export (src/insights/tools.js artifactBlocks, blocksToText, toolsFor).
import assert from 'node:assert/strict';
import { artifactBlocks, blocksToText, toolsFor, TOOL_INFO } from '../src/insights/tools.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const timeOf = (refs) => (refs && refs.length ? refs[0] * 10 : null); // line n starts at n*10 seconds

// ---- unknown or empty input
ok(artifactBlocks('quiz', null, timeOf).length === 0, 'no content: no blocks');
ok(artifactBlocks('nonsense', { a: 1 }, timeOf).length === 0, 'an unknown kind: no blocks');
ok(artifactBlocks('quiz', {}, timeOf).length === 0, 'a quiz with no questions: no blocks');
ok(artifactBlocks('study_guide', {}, timeOf).length === 0, 'a study guide with no sections: no headings either');

// ---- study guide: sections only appear when they have items
let b = artifactBlocks('study_guide', { overview: 'About cells.', concepts: [{ term: 'Cell', explanation: 'A unit', refs: [2] }], processes: [{ name: 'Mitosis', steps: ['Split', 'Divide'], refs: [] }] }, timeOf);
ok(b.map((x) => x.t).join() === 'h,p,h,li,h,li', 'overview, concepts and processes each get a heading and their items');
ok(b[0].text === 'Overview' && b[1].text === 'About cells.', 'the overview is a paragraph under its heading');
ok(b[3].text === 'Cell: A unit' && b[3].time === 20, 'a concept shows its term and the time of its line');
ok(b[5].text === 'Mitosis: 1. Split 2. Divide' && b[5].time === null, 'process steps are numbered in one line; no refs means no time');

// ---- flashcards
b = artifactBlocks('flashcards', { cards: [{ front: 'Q1', back: 'A1', refs: [3], explanation: 'because', caution: 'Spelling not found in the transcript: Foo. Check the recording.' }, { front: 'Q2', back: 'A2' }] }, timeOf);
ok(b.filter((x) => x.t === 'h').map((x) => x.text).join() === 'Card 1,Card 2', 'each card is a numbered heading');
ok(b[1].text === 'Q: Q1' && b[2].text === 'A: A1' && b[2].time === 30, 'the answer carries the time');
ok(b.some((x) => x.text === 'Why: because'), 'an explanation is added when there is one');
ok(b.some((x) => x.text === 'Note: Spelled differently in the transcript: Foo.'), 'an old-style spelling note is shown in the current wording');
ok(!b.slice(5).some((x) => /^(Why|Note):/.test(x.text)), 'a card without explanation or note adds neither');

// ---- quiz: options are lettered for multiple choice only
b = artifactBlocks('quiz', { questions: [
  { type: 'multiple_choice', question: 'Pick', options: ['x', 'y'], answer: 'y', explanation: 'it is y', refs: [1] },
  { type: 'true_false', question: 'Sky is blue', options: ['True', 'False'], answer: 'True' },
] }, timeOf);
ok(b.some((x) => x.t === 'li' && x.text === 'A. x') && b.some((x) => x.text === 'B. y'), 'multiple-choice options are lettered');
ok(b.some((x) => x.t === 'li' && x.text === 'True') && !b.some((x) => x.text === 'A. True'), 'true/false options are not lettered');
ok(b.some((x) => x.text === 'Answer: y — it is y' && x.time === 10), 'the answer line has the explanation and the time');
ok(b.some((x) => x.text === 'Answer: True'), 'no explanation, no dash');

// ---- action plan: only open work is "still to do"
b = artifactBlocks('action_plan', { tasks: [
  { task: 'Send report', owner: 'Sam', owner_basis: 'assigned', deadline: 'Friday', status: 'open', refs: [1] },
  { task: 'Book room', owner: 'Kim', owner_basis: 'inferred', status: 'open' },
  { task: 'Email Bob', status: 'completed_in_recording', resolution: 'sent at the end', resolution_refs: [4], refs: [2] },
  { task: 'Old idea', status: 'cancelled' },
] }, timeOf);
const texts = b.map((x) => x.text);
ok(texts.includes('Still to do') && texts.includes('Completed in this conversation'), 'open and completed tasks have their own sections');
ok(texts.includes('Send report — Sam · Friday'), 'an owner and a deadline are shown');
ok(texts.includes('Book room — Likely owner: Kim · No deadline'), 'an owner that was only inferred is shown as "Likely owner"');
ok(texts.includes('Email Bob — sent at the end'), 'a completed task shows what happened');
ok(b.find((x) => x.text.startsWith('Email Bob')).time === 40, '…and the time of the line where it happened');
ok(!texts.some((x) => /Old idea/.test(x)), 'a cancelled task is not listed');
b = artifactBlocks('action_plan', { tasks: [{ task: 'Legacy', owner: null }] }, timeOf);
ok(b.some((x) => x.text === 'Legacy — Owner not specified · No deadline'), 'a result made before statuses existed counts as open');
b = artifactBlocks('action_plan', { tasks: [] }, timeOf);
ok(b.length === 1 && b[0].text === 'Nothing is left to do after this recording.', 'an empty plan says nothing is left to do');

// ---- meeting recap
b = artifactBlocks('meeting_recap', { overview: 'Kickoff.', participants: [{ label: 'Ann' }, { label: 'Bo' }], action_items: [{ task: 'Plan', refs: [1] }], important_dates: [{ when: 'May 1', what: 'Launch' }] }, timeOf);
ok(b.some((x) => x.text === 'Ann, Bo'), 'participants are listed in one line');
ok(b.some((x) => x.text === 'Plan — Owner: Not specified · Deadline: Not specified'), 'an action item without an owner or deadline says so');
ok(b.some((x) => x.text === 'May 1: Launch'), 'dates show when and what');

// ---- drafts
b = artifactBlocks('followup_email', { subject: 'Hi', body: 'Line 1\nLine 2' }, timeOf);
ok(b[0].t === 'meta' && /review before sending/.test(b[0].text) && b[1].text === 'Subject: Hi' && b[2].t === 'pre' && b[2].text === 'Line 1\nLine 2', 'an email draft: a review note, the subject, then the body kept as written');
b = artifactBlocks('reply_draft', { reply: 'Sounds good' }, timeOf);
ok(b.length === 2 && b[1].t === 'pre' && b[1].text === 'Sounds good', 'a reply draft: a review note and the reply');

// ---- interview and episode notes
b = artifactBlocks('interview_qa', { is_interview: false, pairs: [{ question: 'Why?', asked_by: 'Ann', response: 'Because', answered_by: 'Bo', refs: [1] }], quotes: [{ quote: 'Wow', speaker: 'Bo', refs: [2] }] }, timeOf);
ok(b[0].t === 'meta' && /not mainly a question-and-answer/.test(b[0].text), 'a recording that is not an interview is said to be so');
ok(b.some((x) => x.t === 'h' && x.text === 'Q1 (Ann): Why?') && b.some((x) => x.text === 'Bo: Because' && x.time === 10), 'a pair has its asker in the heading and its answerer before the answer');
ok(b.some((x) => x.t === 'quote' && x.text === '“Wow” — Bo' && x.time === 20), 'a quote has quote marks and the speaker');
b = artifactBlocks('episode_notes', { summary: 'S', outline: [{ title: 'Intro', summary: 'Hello', start_ref: 0 }, { title: 'End', summary: 'Bye', start_ref: null }] }, timeOf);
ok(b.find((x) => x.text === 'Intro: Hello').time === 0 && b.find((x) => x.text === 'End: Bye').time === null, 'a chapter with a start line has a time (including line 0); one without has none');

// ---- blocksToText
ok(blocksToText([]) === '\n', 'no blocks: just a newline');
const txt = blocksToText([{ t: 'h', text: 'Title' }, { t: 'li', text: 'item', time: 75 }, { t: 'p', text: 'para', time: 3725 }, { t: 'p', text: 'plain' }]);
ok(txt === 'Title\n\n- item [1:15]\npara [1:02:05]\nplain\n', 'headings stand apart, items start with a dash, times are shown as clock values');
ok(blocksToText([{ t: 'li', text: 'zero', time: 0 }]) === '- zero [0:00]\n', 'a time of 0 is shown (it is not "no time")');

// ---- toolsFor
ok(toolsFor('lecture').tools.join() === 'flashcards,quiz,study_guide', 'a lecture is offered flashcards, a quiz and a study guide');
ok(toolsFor('meeting').tools[0] === 'meeting_recap', 'a meeting starts with the recap');
ok(toolsFor('anything else').tools.join() === toolsFor('general').tools.join(), 'an unknown type is offered the general tools');
ok(toolsFor(undefined).tools.length === 3, 'no type: the general tools');
ok(Object.values(toolsFor('voice_message')).flat().every((k) => TOOL_INFO[k]), 'every offered tool has a label');

console.log(`${pass} checks passed`);
