// Study engine 2 in the browser (mock AI): earlier flashcards / quizzes stay readable and keep their score, the
// improved version is made only on request, "Explain why" on cards, speaker renames show up in existing results
// without regenerating or "out of date", and a real change (a paragraph reassigned) still marks them out of date.
// Run on /transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa with a fresh harness: load, clear sessionStorage,
// reload, seed(), reload, run().
import { $, $$, sleep, waitFor, runTests, assert } from './lib.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tab = (name) => { const b = [...$$('#resTabs [role="tab"], #resTabs button')].find((x) => new RegExp(name, 'i').test(x.textContent)); assert(b, `tab ${name}`); b.click(); };
const panel = () => $('#insightsHost [data-panel="create"]');
const text = () => (panel()?.innerText || '').replace(/\s+/g, ' ');
const btn = (re, root = panel()) => [...(root?.querySelectorAll('button') || [])].find((b) => re.test(b.textContent));
const toastText = () => $('.toast')?.textContent || '';
const openTool = async (name) => {
  tab('Create');
  const back = [...(panel()?.querySelectorAll('button') || [])].find((b) => /^(← )?All tools$|Back to Create|^Create$/.test(b.textContent.trim()));
  if (back) { back.click(); await sleep(100); }
  const card = await waitFor(() => [...panel().querySelectorAll('[data-tool]')].find((b) => new RegExp(name, 'i').test(b.textContent)), { what: `${name} card` });
  card.click();
  await sleep(150);
};
// the deck on its question side
const questionSide = async () => { const c = await waitFor(() => panel().querySelector('.fc'), { what: 'card' }); if (c.classList.contains('flipped')) c.click(); await sleep(50); };
const seedArtifact = (row) => fetch('/__harness/artifact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcription_id: ID, ...row }) }).then((r) => r.json());
const stored = () => fetch('/__harness/artifacts').then((r) => r.json());
async function speakerMenu(groupIndex, itemRe) {
  $$('#transcript .grp')[groupIndex].querySelector('button.who').click();
  const b = await waitFor(() => [...($('.menu')?.querySelectorAll('button') || [])].find((x) => itemRe.test(x.textContent)), { what: `menu item ${itemRe}` });
  b.click();
}

// step 1 (then reload the page): results made by the earlier engine, as they exist in people's libraries
export async function seed() {
  await seedArtifact({ kind: 'flashcards', settings_key: '', content: { cards: [{ front: 'What did Speaker 1 say about the price?', back: 'Seven ninety nine', evidence: 'x', refs: [0] }], target: 8 } });
  await seedArtifact({ kind: 'quiz', settings_key: '', progress: { last_score: 2, total: 3, attempts: 1 }, content: { questions: [
    { type: 'true_false', question: 'Speaker 1 said the price is settled.', options: ['True', 'False'], answer: 'True', accept: [], explanation: 'x', evidence: 'x', refs: [0] },
  ], target: 5 } });
}

// step 2
export async function run() {
  return runTests([
    ['Earlier flashcards stay as they were, with an offer to create the improved version', async () => {
      await openTool('Flashcards');
      await waitFor(() => /Made with the earlier version/.test(text()), { what: 'earlier-version note' });
      assert(/What did Speaker 1 say about the price/.test(text()), 'the earlier card is still shown');
      assert(btn(/Create improved version/), 'improved version offered');
    }],
    ['The improved version is made on request; the earlier one is kept and reachable', async () => {
      btn(/Create improved version/).click();
      await waitFor(() => btn(/Earlier version/), { timeout: 15000, what: 'improved deck with an Earlier version button' });
      assert(!/Made with the earlier version/.test(text()), 'the improved deck is shown');
      const rows = (await stored()).filter((a) => a.kind === 'flashcards');
      assert(rows.some((a) => a.settings_key === '' && a.content.cards[0].front.includes('Speaker 1')) && rows.some((a) => a.settings_key === 'g2' && a.content.engine === 2), 'both versions are stored');
      btn(/Earlier version/).click();
      await waitFor(() => /What did Speaker 1 say about the price/.test(text()), { what: 'earlier deck shown again' });
      btn(/Back to the improved version/).click();
      await waitFor(() => !/What did Speaker 1 say about the price/.test(text()), { what: 'back to improved' });
    }],
    ['A card can be flipped to its answer and "Explain why" opens the explanation', async () => {
      const card = await waitFor(() => panel().querySelector('.fc'), { what: 'card' });
      if (!card.classList.contains('flipped')) card.click();
      const more = await waitFor(() => panel().querySelector('.fc-more'), { what: 'Explain why' });
      more.querySelector('summary').click();
      assert(more.open && more.querySelector('p').textContent.length > 10, 'explanation shown');
    }],
    ['Renaming a speaker shows the new name inside the existing cards, without "out of date" or regenerating', async () => {
      const before = (await stored()).find((a) => a.settings_key === 'g2' && a.kind === 'flashcards');
      assert(/\{\{S1\}\}/.test(JSON.stringify(before.content.cards)), 'the stored card refers to the speaker by code');
      await speakerMenu(0, /^Rename .* everywhere/);
      const dlg = await waitFor(() => document.querySelector('dialog[open]'), { what: 'rename dialog' });
      dlg.querySelector('input').value = 'Professor Ahmad'; dlg.querySelector('form').requestSubmit();
      await waitFor(() => /saved/.test(toastText()), { what: 'rename saved' });
      await openTool('Flashcards');
      await questionSide();
      await waitFor(() => /Professor Ahmad/.test(text()), { what: 'new name in the card' });
      assert(!/Speaker 1/.test(text().replace(/What did Speaker 1 say about the price/, '')), 'the old name is gone from the improved card');
      assert(!/Out of date/.test(text()), 'not out of date after a rename');
      const after = (await stored()).find((a) => a.settings_key === 'g2' && a.kind === 'flashcards');
      assert(after.updated_at === before.updated_at && after.content.cards[0].front === before.content.cards[0].front, 'nothing was regenerated or rewritten');
      // renamed again: still right
      await speakerMenu(0, /^Rename .* everywhere/);
      const d2 = await waitFor(() => document.querySelector('dialog[open]'), { what: 'rename dialog' });
      d2.querySelector('input').value = 'Dr. Ahmad'; d2.querySelector('form').requestSubmit();
      await waitFor(() => /saved/.test(toastText()), { what: 'second rename saved' });
      await openTool('Flashcards');
      await questionSide();
      await waitFor(() => /Dr\. Ahmad/.test(text()) && !/Professor Ahmad/.test(text()), { what: 'latest name' });
    }],
    ['The earlier quiz keeps its last score; the improved quiz is a separate result', async () => {
      await openTool('Practice Quiz');
      await waitFor(() => /Made with the earlier version/.test(text()) && /Last score 2\/3/.test(text()), { what: 'earlier quiz with its score' });
      btn(/Create improved version/).click();
      await waitFor(() => btn(/Earlier quiz/), { timeout: 15000, what: 'improved quiz ready' });
      const rows = (await stored()).filter((a) => a.kind === 'quiz');
      assert(rows.find((a) => a.settings_key === '').progress?.last_score === 2, 'the earlier quiz still has its score');
      const g2 = rows.find((a) => a.settings_key === 'g2');
      assert(g2 && !g2.content.questions.some((q) => q.type === 'true_false' && q.skill === 'recall'), 'no trivial true/false in the improved quiz');
    }],
    ['A saved quiz shows a renamed speaker, keeps its score, and leaves unrelated names alone', async () => {
      const { transcriptBasis, speakerTable } = await import('/src/lib/speaker-refs.js');
      const row = window.__qaDb.rows.find((r) => r.id === ID);
      const segs = row.segments.map((x, id) => ({ id, speaker: x.sp, text: x.t }));
      const { table } = speakerTable(segs);
      const code = Object.entries(table).find(([, t]) => t.name === 'Speaker 2')[0];
      const q = `Why did {{${code}}} disagree with Grace Hopper's view on the Speaker 10 slide?`;
      const right = `Because {{${code}}} thought the price was too high`;
      const seeded = await seedArtifact({ kind: 'quiz', settings_key: 'g2', progress: { last_score: 1, total: 2, attempts: 1 }, content: {
        engine: 2, speakers: table, basis: transcriptBasis(segs), target: 5, concepts: [],
        questions: [{ concept: 'c1', type: 'multiple_choice', skill: 'reasoning', question: q, answer: right, options: [right, 'Because Grace wanted it lower', 'Because the survey was late', 'Because Speaker 10 left'], accept: [], explanation: `{{${code}}} said nine ninety nine might be too high.`, evidence: 'x', refs: [1] },
          { concept: 'c1', type: 'short_answer', skill: 'recall', question: 'What price did the survey suggest?', answer: 'Seven ninety nine', options: [], accept: [], explanation: null, evidence: 'x', refs: [2] }],
      } });
      await speakerMenu(1, /^Rename .* everywhere/);
      const dlg = await waitFor(() => document.querySelector('dialog[open]'), { what: 'rename dialog' });
      dlg.querySelector('input').value = 'Lina'; dlg.querySelector('form').requestSubmit();
      await waitFor(() => /saved/.test(toastText()), { what: 'rename saved' });
      await openTool('Practice Quiz');
      await waitFor(() => /Last score 1\/2/.test(text()), { what: 'score kept' });
      assert(!/changed after these questions/.test(text()), 'not out of date after a rename');
      btn(/Start Quiz/).click();
      await waitFor(() => /Why did Lina disagree with Grace Hopper's view on the Speaker 10 slide\?/.test(text()), { what: 'renamed speaker in the question, other names untouched' });
      assert(/Because Lina thought the price was too high/.test(text()) && /Because Grace wanted it lower/.test(text()) && /Because Speaker 10 left/.test(text()), 'options: speaker renamed, unrelated names unchanged');
      btn(/^\s*[A-D]?\s*Because Lina/)?.click() || [...panel().querySelectorAll('[data-opt]')].find((b) => /Lina/.test(b.textContent)).click();
      await waitFor(() => /Correct/.test(text()), { what: 'the renamed option is still the right answer' });
      assert(/Lina said nine ninety nine/.test(text()), 'explanation shows the new name');
      const after = (await stored()).find((a) => a.kind === 'quiz' && a.settings_key === 'g2');
      assert(after.updated_at === seeded.updated_at && after.content.questions[0].question === q && after.progress.last_score === 1, 'nothing regenerated or rewritten; the score is kept');
      btn(/End quiz/)?.click();
    }],
    ['A paragraph given to another speaker (a real change) marks the improved cards out of date', async () => {
      await speakerMenu(1, /^Speaker 3$|^Dr\. Ahmad$/);
      await waitFor(() => /saved/.test(toastText()), { what: 'move saved' });
      await openTool('Flashcards');
      await waitFor(() => /Out of date/.test(text()), { what: 'out-of-date banner' });
    }],
  ]);
}
