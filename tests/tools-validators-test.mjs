// The checks each Create-tab tool runs after the model answers (server/ai/tools.js): Action Plan, Exam Points, Study
// Guide, Definitions, the exam wording test and the "unverified details" flag on drafts. No model is called.
import assert from 'node:assert/strict';
const T = await import(new URL('../server/ai/tools.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const segs = [
  { id: 0, text: 'Welcome everyone.' },
  { id: 1, text: 'This will be on the midterm.' },
  { id: 2, text: 'I will send the report.' },
  { id: 3, text: 'Sent it just now.' },
];

// ---- examBacked: an item is exam information only when its words or its line mention an assessment
ok(T.examBacked({ evidence: 'know this for the exam', refs: [] }, segs), 'evidence that mentions the exam backs the item');
ok(T.examBacked({ evidence: '', refs: [1] }, segs), 'a line that mentions the midterm backs the item');
ok(!T.examBacked({ evidence: 'this is key', refs: [0] }, segs), 'neither mentions an assessment: not exam information');
ok(!T.examBacked({ refs: [99] }, segs), 'a line that does not exist backs nothing');
ok(!T.examBacked({}, segs), 'an item with no evidence and no refs is not backed');
ok(T.EXAM_RE.test('Homework is due Friday') && T.EXAM_RE.test('this is a quiz'), 'homework and quiz count as assessment words');
ok(!T.EXAM_RE.test('examination of the cell'), '"examination" is not "exam"');

// ---- cardCount: from the recording's length
ok(T.cardCount(5, 'standard') === 8 && T.cardCount(20, 'standard') === 15 && T.cardCount(60, 'standard') === 25, 'standard: 8 / 15 / 25 cards by length');
ok(T.cardCount(60, 'fewer') === 13 && T.cardCount(5, 'fewer') === 5, 'fewer: half, never under 5');
ok(T.cardCount(60, 'more') === 40 && T.cardCount(5, 'more') === 13, 'more: 1.6 times, never over 40');
ok(T.cardCount(10, 'standard') === 15 && T.cardCount(40, 'standard') === 25, 'the length boundaries are 10 and 40 minutes');
ok(T.questionCount(30, 'standard') === 10, 'questionCount is the quiz setup\'s own count');

// ---- Action Plan
const plan = T.TOOLS.action_plan;
const task = (o) => ({ task: 'Send report', status: 'open', owner: 'Sam', owner_basis: 'volunteered', resolution: 'x', resolution_refs: [], ...o });
let c = { tasks: [task({ status: 'bogus' })] };
let fixed = plan.validate(c, segs);
ok(c.tasks[0].status === 'unclear' && fixed === 1, 'an unknown status becomes "unclear" and is counted');
c = { tasks: [task({ status: 'completed_in_recording', resolution_refs: [3] })] };
fixed = plan.validate(c, segs);
ok(c.tasks[0].status === 'completed_in_recording' && fixed === 0, 'done, and pointing at the line where it happened, stays done');
ok(c.tasks[0].resolution === 'x', '…and keeps its resolution text');
c = { tasks: [task({ status: 'completed_in_recording', resolution_refs: [] })] };
fixed = plan.validate(c, segs);
ok(c.tasks[0].status === 'unclear' && fixed === 1, '"done" with no line to show for it becomes "unclear"');
c = { tasks: [task({ status: 'cancelled', resolution_refs: [42] })] };
plan.validate(c, segs);
ok(c.tasks[0].status === 'unclear' && c.tasks[0].resolution_refs.length === 0, '"cancelled" pointing at a line that does not exist becomes "unclear"');
c = { tasks: [task({ status: 'open', resolution_refs: [3] })] };
plan.validate(c, segs);
ok(c.tasks[0].resolution === null && c.tasks[0].resolution_refs.length === 0, 'an open task carries no resolution');
c = { tasks: [task({ status: 'completed_in_recording', resolution_refs: [3, 3, 2, 99, '1'] })] };
plan.validate(c, segs);
ok(JSON.stringify(c.tasks[0].resolution_refs) === '[1,2,3]', 'resolution lines are numbers, real, unique and in order');
c = { tasks: [task({ status: 'discussed_only', resolution_refs: [0, 1, 2, 3, 0, 1] })] };
plan.validate(c, segs);
ok(c.tasks[0].resolution_refs.length === 4, 'at most five resolution lines are kept (here all four real ones)');
c = { tasks: [task({ owner: null, owner_basis: 'assigned' })] };
plan.validate(c, segs);
ok(c.tasks[0].owner_basis === 'none', 'no owner means owner_basis "none"');
c = { tasks: [task({ owner: 'Sam', owner_basis: 'maybe' })] };
plan.validate(c, segs);
ok(c.tasks[0].owner_basis === 'inferred', 'an owner with an unknown basis is "inferred", never "assigned"');
ok(plan.validate({}, segs) === 0, 'an answer with no tasks is fine');
ok(T.PLAN_STATUSES.length === 5 && T.PLAN_STATUSES[0] === 'open', 'there are five plan statuses and "open" is the plan itself');

// ---- Exam Points
const ex = T.TOOLS.exam_points;
c = { explicit: [{ text: 'cells', evidence: 'on the midterm', refs: [] }, { text: 'atoms', evidence: 'quite key', refs: [0] }], worth_reviewing: [] };
fixed = ex.validate(c, segs);
ok(c.explicit.length === 1 && c.explicit[0].text === 'cells' && fixed === 1, 'an "explicit" point that never mentions an assessment is moved out of the explicit list');
ok(c.worth_reviewing.length === 1 && c.worth_reviewing[0].text === 'atoms' && /exam/.test(c.worth_reviewing[0].reason), '…into "worth reviewing", with a neutral reason');
c = { explicit: [{ text: 'x', refs: [0] }] };
ex.validate(c, segs);
ok(c.explicit.length === 0 && c.worth_reviewing.length === 1, 'worth_reviewing is created when it is missing and something moves into it');

// ---- Study Guide
const sg = T.TOOLS.study_guide;
c = {
  exam_info: [{ text: 'a', evidence: 'the exam', refs: [] }, { text: 'b', evidence: 'nothing', refs: [0] }],
  processes: [{ name: 'p1', steps: ['one', 'two'] }, { name: 'p2', steps: ['only one'] }, { name: 'p3', steps: ['x', '  '] }],
  definitions: [{ term: 'Cell ', definition: 'd1' }, { term: 'cell', definition: 'd2' }, { term: 'Atom', definition: 'd3' }],
  review: [],
};
fixed = sg.validate(c, segs);
ok(c.exam_info.length === 1 && c.review.length === 1 && c.review[0].text === 'b', 'an exam item without exam wording moves to "review"');
ok(c.processes.length === 1 && c.processes[0].name === 'p1', 'a process needs at least two real steps');
ok(c.definitions.length === 2 && c.definitions[0].definition === 'd1', 'a term defined twice is kept once (the first)');
ok(fixed === 1 + 2 + 1, 'the count is one moved item, two thin processes and one duplicate');
const withTopics = { topics: [{ title: 'Intro', start_ref: '2' }, { title: '  ', start_ref: 1 }, { title: 'Ghost', start_ref: 77 }, null] };
sg.after(withTopics, segs);
ok(withTopics.topics.length === 2 && withTopics.topics[0].start_ref === 2 && withTopics.topics[1].start_ref === null, 'topics: blank titles dropped, start lines made numbers, unknown lines become null');

// ---- Definitions
const df = T.TOOLS.definitions;
c = { definitions: [{ term: 'A b', definition: '1' }, { term: 'a-b', definition: '2' }, { term: '', definition: '3' }] };
fixed = df.validate(c);
ok(c.definitions.length === 1 && fixed === 2, 'definitions with the same term (ignoring case and punctuation) or no term are dropped');

// ---- Meeting recap participants come from the transcript
const rec = T.TOOLS.meeting_recap;
const lines = [{ id: 0, speaker: 'A' }, { id: 1, speaker: 'B' }, { id: 2, speaker: 'A' }, { id: 3, speaker: 'Unknown' }];
c = { topics: [] };
rec.after(c, lines, { codeOf: new Map([['A', 'S1']]) });
ok(c.participants.length === 2 && c.participants[0].label === '{{S1}}' && c.participants[0].lines === 2, 'participants are counted from the lines, most lines first, with the speaker code');
ok(c.participants[1].label === 'B' && c.participants[1].lines === 1, 'a speaker with no code keeps its label');
ok(!c.participants.some((p) => p.label === 'Unknown'), '"Unknown" is not a participant');

// ---- drafts: details the recording never mentions are flagged
ok(T.unverifiedDetails('See you tomorrow', 'we said tomorrow').length === 0, 'a detail that is in the recording is not flagged');
ok(T.unverifiedDetails('Call me ASAP', 'no rush').join() === 'ASAP', 'urgency the recording does not have is flagged');
ok(T.unverifiedDetails('', 'x').length === 0 && T.unverifiedDetails(null, 'x').length === 0, 'no draft, nothing to flag');
ok(T.unverifiedDetails('1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21', '').length <= 10, 'at most ten details are flagged');
ok(T.ARTIFACT_KINDS.includes('action_plan') && T.ARTIFACT_KINDS.length === Object.keys(T.TOOLS).length, 'ARTIFACT_KINDS lists every tool');

console.log(`${pass} checks passed`);
