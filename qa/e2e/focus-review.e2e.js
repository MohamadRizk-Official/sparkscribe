// Focused Review in the browser (mock AI): Quiz Result → Concepts to Review → Review → Practice Again, kept across a
// reload, flags not counted, follow-up questions written on request, and the quiz itself unchanged.
// Run on /transcript?id=bbbbbbbb-0000-4000-8000-000000000001 after addFixtures() + reload:
//   const m = await import('/qa/e2e/focus-review.e2e.js'); await m.run()        (sets the Bolt plan itself)
// The plan gate: on /transcript?id=bbbbbbbb-0000-4000-8000-000000000002 with __qaKnobs({ plan: 'flash' }) + reload:
//   await (await import('/qa/e2e/focus-review.e2e.js')).gate()
import { $$, sleep, waitFor, runTests, assert } from './lib.js';

const ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const panel = () => document.querySelector('#insightsHost [data-panel="create"]');
const text = () => (panel()?.innerText || '').replace(/\s+/g, ' ');
const btn = (re, root = panel()) => [...(root?.querySelectorAll('button') || [])].find((b) => re.test(b.textContent.replace(/\s+/g, ' ').trim()));
const tab = (name) => { const b = [...$$('#resTabs [role="tab"], #resTabs button')].find((x) => new RegExp(name, 'i').test(x.textContent)); assert(b, `tab ${name}`); b.click(); };
const pageId = () => new URLSearchParams(location.search).get('id') || ID;
const quizRow = async () => (await (await fetch('/__harness/artifacts')).json()).find((a) => a.transcription_id === pageId() && a.kind === 'quiz' && a.status === 'ready');
const openQuiz = async () => {
  tab('Create');
  const back = btn(/^(← )?All tools$|Back to Create|^Create$/);
  if (back) { back.click(); await sleep(100); }
  (await waitFor(() => [...panel().querySelectorAll('[data-tool]')].find((b) => /Practice Quiz/.test(b.textContent)), { what: 'quiz card' })).click();
  await sleep(150);
};
// answer the question on screen: wrong (or right), using the stored quiz to know which is which
async function answer(right) {
  const row = await quizRow();
  const all = [...row.content.questions, ...(row.content.followups || [])];
  const qText = document.querySelector('#qText')?.textContent.trim();
  // speaker codes are shown as names on screen: match on the end of the question
  const tail = (t) => t.replace(/\{\{S\d+\}\}/g, '').replace(/\s+/g, ' ').trim().slice(-40);
  const q = all.find((x) => tail(x.question) === tail(qText));
  assert(q, `question on screen is in the stored quiz: ${qText}`);
  if (q.type === 'short_answer') {
    const input = panel().querySelector('.sa-input');
    input.value = right ? q.answer : 'zzz qqq';
    panel().querySelector('[data-act="sa"]').requestSubmit();
  } else {
    const b = [...panel().querySelectorAll('[data-opt]')].find((x) => (x.querySelector('.ans-text').textContent.trim() === q.answer) === right);
    b.click();
  }
  await waitFor(() => panel().querySelector('[data-act="qnext"]'), { what: 'feedback', timeout: 15000 });
  panel().querySelector('[data-act="qnext"]').click();
  await sleep(80);
}
async function playAll(right) {
  for (let i = 0; i < 40 && document.querySelector('#qText'); i++) await answer(typeof right === 'function' ? right(i) : right);
}

// Flash (no Focused Review): the result keeps the per-question review and retakes, plus one calm line about Bolt;
// asking the server for new practice questions directly is refused before any AI call.
export async function gate() {
  return runTests([
    ['Flash: after a quiz, the per-question review and retakes, one line about Focused Review, no concept list', async () => {
      await openQuiz();
      if (btn(/End quiz/)) { btn(/End quiz/).click(); await sleep(200); }
      const start = await waitFor(() => btn(/Start Quiz/), { what: 'start (the quiz is written first)', timeout: 60000 });
      start.click();
      await waitFor(() => document.querySelector('#qText'), { what: 'first question' });
      await playAll(false);
      await waitFor(() => /Quiz complete/i.test(text()), { what: 'result' });
      assert(btn(/Review missed questions/) && btn(/Retake missed/) && !btn(/^Review \d+ concepts?/), 'Free/Flash review actions, no "Review N concepts"');
      assert(!panel().querySelector('.fr-list') && panel().querySelector('.miss-list'), 'missed questions listed, not concepts');
      const up = panel().querySelector('.fr-upsell');
      assert(up && /Focused Review/.test(up.innerText) && /Bolt/.test(up.innerText) && up.querySelector('a[href="/pricing?plan=bolt"]'), 'one line about Focused Review with a link to Bolt');
      btn(/Review missed questions/).click();
      await waitFor(() => /Missed question 1 of|Question 1 of/i.test(text()) && panel().querySelector('.miss-card.full'), { what: 'per-question review still works' });
    }],
    ['Flash: the server refuses new practice questions (403) without any AI call', async () => {
      const row = await quizRow();
      const before = (await (await fetch('/__harness/ai-limits')).json()).ledger.length;
      const r = await fetch('/api/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dev-harness': '1' }, body: JSON.stringify({ action: 'followups', transcriptionId: pageId(), artifactId: row.id, concepts: [row.content.map.concepts[0].id] }) });
      const body = await r.json();
      const after = (await (await fetch('/__harness/ai-limits')).json()).ledger.length;
      assert(r.status === 403 && body.error === 'plan_required' && body.details?.plan === 'bolt', `403 plan_required → Bolt (${r.status} ${body.error})`);
      assert(after === before && !((await quizRow()).content.followups || []).length, 'nothing reserved, the quiz unchanged');
    }],
  ]);
}

export async function run() {
  window.__qaKnobs({ plan: 'bolt' });
  await sleep(150);
  return runTests([
    ['A quiz with every answer wrong ends on "Review N concepts", listing concepts (not questions)', async () => {
      await openQuiz();
      if (btn(/End quiz/)) { btn(/End quiz/).click(); await sleep(200); }
      btn(/Start Quiz/).click();
      await waitFor(() => document.querySelector('#qText'), { what: 'first question (quiz written by mock engine 3)', timeout: 30000 });
      await playAll(false);
      await waitFor(() => /Quiz complete/i.test(text()), { what: 'result' });
      const row = await quizRow();
      assert(row.content.map?.concepts?.length, 'the quiz carries its study map');
      assert(btn(/^Review \d+ concepts?/), 'primary action: Review N concepts');
      assert(/Concepts to review/i.test(text()) && panel().querySelectorAll('.fr-concept').length >= 1, 'concepts to review are listed');
      assert(row.progress?.review?.c && Object.keys(row.progress.review.c).length >= 1, 'review state saved in the quiz progress');
      assert(row.progress.last_score === 0 && row.progress.total >= 1, 'the score is saved as before');
      assert(!JSON.stringify(row.progress.review).match(/[a-z]{12,}/i), 'the saved review holds ids only, no text');
    }],
    ['Reviewing a concept shows what the recording says, the passage, and the missed question', async () => {
      btn(/^Review \d+ concepts?/).click();
      await waitFor(() => /What the recording says/i.test(text()), { what: 'concept review' });
      assert(/Concept 1 of \d+/i.test(text()), 'progress through concepts');
      assert(panel().querySelector('.fr-line [data-seek]'), 'each source line opens the moment in the transcript');
      assert(/The question you missed/i.test(text()) && /Correct answer/i.test(text()), 'the missed question with its correct answer');
      assert(btn(/This question seems wrong or unclear/), 'a question can be flagged');
    }],
    ['The review survives a reload and resumes from the quiz screen', async () => {
      location.reload();
    }],
  ]);
}

// second half, after the reload above
export async function run2() {
  return runTests([
    ['After a reload the quiz offers "Continue review"', async () => {
      await waitFor(() => document.querySelector('#resTabs'), { what: 'page', timeout: 15000 });
      await openQuiz();
      await waitFor(() => /Focused Review/i.test(text()) && btn(/Continue review/), { what: 'resume banner' });
    }],
    ['Practice again: new questions are written on request, then a focused run clears the concepts answered right', async () => {
      btn(/Continue review/).click();
      await waitFor(() => /What the recording says/i.test(text()), { what: 'concept review' });
      for (let i = 0; i < 12 && btn(/Got it — next concept/); i++) { btn(/Got it — next concept/).click(); await sleep(120); }
      const quizBefore = (await quizRow()).content.questions.map((q) => q.question).join('|');
      btn(/^Practice (this concept|these \d+ concepts)/).click();
      await sleep(200);
      assert(btn(/Write new questions/), 'every stored question on the concept was already missed: new questions are offered');
      btn(/Write new questions/).click();
      await waitFor(() => document.querySelector('#qText'), { what: 'practice run with follow-ups', timeout: 30000 });
      const row = await quizRow();
      assert((row.content.followups || []).length >= 1, 'follow-up questions saved with the quiz');
      assert(row.content.questions.map((q) => q.question).join('|') === quizBefore, "the quiz's own questions are unchanged");
      assert(/Focused Review practice/i.test(text()), 'the run is labelled as Focused Review practice');
      await playAll(true);
      await waitFor(() => /Focused practice done/i.test(text()), { what: 'practice result' });
      const review = (await quizRow()).progress.review;
      assert(Object.values(review.c).every((e) => e.s === 'cleared' || e.s === 'check'), 'answered right → cleared');
      assert(!btn(/^Review \d+ concepts?/), 'nothing left to review');
    }],
    ['A new miss reopens the concept; flagging that question removes it again', async () => {
      btn(/Retake full quiz/).click();
      await waitFor(() => document.querySelector('#qText'), { what: 'full retake' });
      assert(!/Focused Review practice/i.test(text()), 'a normal full run');
      await playAll(false);
      await waitFor(() => btn(/^Review \d+ concepts?/), { what: 'concepts to review again' });
      btn(/^Review \d+ concepts?/).click();
      await waitFor(() => btn(/This question seems wrong or unclear/), { what: 'flag button' });
      const before = Object.entries((await quizRow()).progress.review.c).filter(([, e]) => e.s === 'review').length;
      const many = panel().querySelectorAll('.fr-flag').length > 1;
      btn(/This question seems wrong or unclear/).click();
      await sleep(500);
      const after = (await quizRow()).progress.review;
      assert(after.flag.length >= 1, 'the flag is saved');
      const open = Object.entries(after.c).filter(([, e]) => e.s === 'review').length;
      assert(many ? open === before : open === before - 1, 'a concept resting only on that question is no longer to review');
    }],
    ['Existing quiz features still work from the setup screen', async () => {
      await openQuiz();
      if (btn(/End quiz/)) { btn(/End quiz/).click(); await sleep(200); }
      btn(/Start Quiz/).click();
      await waitFor(() => document.querySelector('#qText'), { what: 'a normal run' });
      btn(/End quiz/).click();
      await sleep(200);
      assert(btn(/Start Quiz/), 'back on the setup screen');
    }],
  ]);
}
