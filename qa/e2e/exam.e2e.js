// Exam prep on the study home (no AI): a course gets an exam date and topics; the home counts down and lists a plan
// made from that course's own records, and says which lectures mention each topic. Before the database has the
// exam columns, nothing about exams is shown.
// Run on / with a fresh harness: load, clear sessionStorage, reload, await setup(), reload, run().
import { $, $$, sleep, waitFor, runTests, assert, eq } from './lib.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // "Pricing meeting"
const DAY = Math.floor(Date.now() / 86_400_000);
const ymd = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const card = () => $('.dash-exam');
const text = (el) => (el?.innerText || '').replace(/\s+/g, ' ');
const dlg = () => $('dialog.exam-dlg[open]');

export async function setup() {
  const lib = await import('/src/lib/library.js');
  const other = window.__qaDb.rows.find((r) => r.id !== ID && Array.isArray(r.segments) && r.segments.length);
  const c = await lib.createFolder('Economics 101');
  await lib.addToFolder(c.id, [ID, other.id]);
  await lib.createFolder('History 110');
  const seed = (row) => fetch('/__harness/artifact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcription_id: ID, ...row }) });
  await seed({ kind: 'quiz', settings_key: '', progress: { last_score: 1, total: 3, attempts: 1, missed: [1, 2] }, content: { questions: [] } });
  await seed({ kind: 'flashcards', settings_key: '', progress: { srs: { 0: [DAY - 2, 0] } }, content: { cards: [{ front: 'a', back: 'b', refs: [0] }] } });
  return other.title;
}

export async function run(otherTitle) {
  return runTests([
    ['Each course offers "Add exam"; no exam card before one is set', async () => {
      await waitFor(() => $$('.dash-exam-btn').length === 2, { what: 'exam buttons', timeout: 12000 });
      assert(!card(), 'no exam card');
    }],
    ['The dialog refuses a date in the past', async () => {
      $$('.dash-exam-btn').find((b) => /Economics/.test(b.getAttribute('aria-label'))).click();
      await waitFor(() => dlg(), { what: 'dialog' });
      const f = dlg().querySelector('form');
      f.elements.date.value = ymd(-3);
      f.requestSubmit();
      await waitFor(() => !dlg().querySelector('.dlg-err').hidden, { what: 'error' });
      assert(/has passed/.test(dlg().querySelector('.dlg-err').textContent), 'past-date message');
    }],
    ['Saving shows the countdown, on the card and on the course', async () => {
      const f = dlg().querySelector('form');
      f.elements.date.value = ymd(10);
      f.elements.topics.value = 'price, photosynthesis\nprice';
      f.requestSubmit();
      await waitFor(() => !dlg() && card(), { what: 'exam card' });
      assert(/Economics 101 exam in 10 days/.test(text(card())), text(card()));
      assert(/Exam in 10 days/.test(text($('.dash-courses'))), text($('.dash-courses')));
      assert(/Add exam/.test(text($('.dash-courses'))), 'the other course still offers Add exam');
    }],
    ['The plan comes from the course’s own records, with a pace', async () => {
      await waitFor(() => card().querySelector('.exam-steps'), { what: 'plan' });
      const steps = $$('.exam-steps li', card()).map((li) => text(li));
      eq(steps.length, 3, `steps: ${steps.join(' | ')}`);
      assert(/Make flashcards or a practice quiz/.test(steps[0]) && steps[0].includes(otherTitle), steps[0]);
      assert(/Retake 2 missed questions Pricing meeting/.test(steps[1]), steps[1]);
      assert(/Review 1 flashcard Pricing meeting/.test(steps[2]), steps[2]);
      assert(/3 steps across 2 lectures\. About 1 a day/.test(text(card())), text(card()));
      const href = $$('.exam-steps a', card())[1].getAttribute('href');
      assert(href.endsWith(`id=${ID}&tab=create&tool=quiz`), href);
    }],
    ['Each listed topic (repeats dropped) says which lectures mention it', async () => {
      await waitFor(() => !card().querySelector('.exam-topics[aria-busy]'), { what: 'coverage' });
      const t = $$('.exam-topics li', card()).map((li) => text(li));
      eq(t.length, 2, t.join(' | '));
      assert(/^price Mentioned in Pricing meeting/.test(t[0]), t[0]);
      assert(/^photosynthesis Not found in this course’s lectures/.test(t[1]), t[1]);
    }],
    ['Remove exam takes the card away', async () => {
      card().querySelector('[data-act="edit-exam"]').click();
      await waitFor(() => dlg(), { what: 'dialog' });
      eq(dlg().querySelector('form').elements.date.value, ymd(10), 'prefilled date');
      dlg().querySelector('[data-act="remove"]').click();
      await waitFor(() => !dlg() && !card() && $$('.dash-exam-btn').length === 2, { what: 'card removed' });
      assert(!/Exam in/.test(text($('.dash-courses'))), 'no chip');
    }],
    ['Before the database has exam columns, exams are not offered and the home still works', async () => {
      window.__qaKnobs({ noExamColumns: true });
      const { mountDashboard } = await import('/src/home/dashboard.js');
      const { supabase } = await import('/src/lib/supabase.js');
      await mountDashboard($('#dashboard'), (await supabase.auth.getSession()).data.session);
      await waitFor(() => $('.dash-courses'), { what: 'courses' });
      eq($$('.dash-exam-btn').length, 0, 'no exam buttons');
      assert(/Economics 101/.test(text($('.dash-courses'))), 'courses still listed');
      window.__qaKnobs({ noExamColumns: false });
    }],
  ]);
}
