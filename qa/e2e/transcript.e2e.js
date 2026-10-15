// Saved transcript page: open, speaker rename / move / someone new, persistence, save failures, rapid edits,
// Details, recording type, export after corrections. Run on http://127.0.0.1:5190/transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
import { $, $$, sleep, waitFor, visible, knobs, dbRows, runTests, assert, eq } from './lib.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = () => dbRows().find((r) => r.id === ID);
const speakersInDb = () => [...new Set(row().segments.map((s) => s.sp))];
const groups = () => $$('#transcript .grp');
const nameOf = (g) => g.querySelector('.who-name')?.textContent;
async function menu(groupIdx) { groups()[groupIdx].querySelector('button.who').click(); return waitFor(() => $('.menu[role="menu"]'), { what: 'speaker menu' }); }
async function pick(labelRe) { const b = [...$('.menu').querySelectorAll('button')].find((x) => labelRe.test(x.textContent)); assert(b, `menu item ${labelRe}`); b.click(); }
async function answerPrompt(value) {
  const dlg = await waitFor(() => document.querySelector('dialog[open].prompt-dlg, dialog[open]'), { what: 'name dialog' });
  const input = dlg.querySelector('input'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
  dlg.querySelector('form').requestSubmit();
  await waitFor(() => !document.querySelector('dialog[open]'), { what: 'dialog closed' });
}
const toastText = () => $('.toast')?.textContent || '';
const settle = () => sleep(400);

export async function run() {
  const apiCallsAtOpen = window.__qaLog.filter((e) => /\/api\//.test(e.path || '') && e.method === 'POST').length;
  return runTests([
    ['opening a saved transcript starts no AI work and records "last opened"', async () => {
      await waitFor(() => groups().length > 0, { what: 'transcript rendered' });
      await sleep(800);
      eq(apiCallsAtOpen, 0, 'AI POST requests on open');
      assert(row().last_opened_at, 'last_opened_at set');
    }],
    ['rename a speaker everywhere → saved, original label kept', async () => {
      const before = speakersInDb();
      await menu(0); await pick(/^Rename Speaker 1 everywhere/); await answerPrompt('Maya');
      await waitFor(() => /saved/.test(toastText()), { what: 'saved toast' });
      assert(groups().every((g) => nameOf(g) !== 'Speaker 1'), 'no "Speaker 1" left on screen');
      assert(speakersInDb().includes('Maya') && !speakersInDb().includes('Speaker 1'), `db speakers ${speakersInDb()} (was ${before})`);
      assert(row().segments.filter((s) => s.sp === 'Maya').every((s) => s.o === 'Speaker 1'), 'original label stored');
      assert(/Speakers: .*Maya/.test(row().transcript_text.split('\n')[1]) && /\] Maya:/.test(row().transcript_text), 'saved text uses the new name');
    }],
    ['move one part to another speaker → only that part changes', async () => {
      const gi = groups().findIndex((g) => nameOf(g) === 'Speaker 2');
      const firstId = Number(groups()[gi].querySelector('.seg').dataset.i);
      const countBefore = row().segments.filter((s) => s.sp === 'Speaker 2').length;
      await menu(gi); await pick(/^Maya$/);
      await waitFor(() => /Moved to Maya/.test(toastText()), { what: 'moved toast' });
      eq(row().segments[firstId].sp, 'Maya', 'moved line');
      assert(row().segments.filter((s) => s.sp === 'Speaker 2').length < countBefore, 'only that group moved');
    }],
    ['someone new → a third name appears and is saved', async () => {
      await menu(groups().length - 1); await pick(/^Someone new/); await answerPrompt('Sam Ortiz');
      await waitFor(() => speakersInDb().includes('Sam Ortiz'), { what: 'new speaker saved' });
    }],
    ['changes survive a reload (checked by re-reading the stored row)', async () => {
      const r = row();
      assert(r.segments.some((s) => s.sp === 'Sam Ortiz') && r.segments.some((s) => s.sp === 'Maya'), 'stored');
    }],
    ['D12: a failed save is not silently lost — it is retried with the next change', async () => {
      knobs({ failPatch: true });
      await menu(0); await pick(/^Rename Maya everywhere/); await answerPrompt('Maya Lee');
      await waitFor(() => /Couldn.t save/i.test(toastText()), { what: 'error toast' });
      assert(!speakersInDb().includes('Maya Lee'), 'failed save not in db (expected)');
      knobs({ failPatch: false });
      const gi = groups().findIndex((g) => nameOf(g) === 'Sam Ortiz');
      await menu(gi); await pick(/^Unknown$/);
      await waitFor(() => /saved/.test(toastText()), { what: 'next save' });
      await settle();
      assert(speakersInDb().includes('Maya Lee'), `the earlier rename reached the database (db: ${speakersInDb()})`);
    }],
    ['D12: rapid edits whose saves finish out of order keep the LAST edit', async () => {
      knobs({ patchDelayMs: 900 });
      const g0 = groups().findIndex((g) => nameOf(g) === 'Maya Lee');
      await menu(g0); await pick(/^Rename Maya Lee everywhere/); await answerPrompt('Ava');
      knobs({ patchDelayMs: 50 }); // the second save overtakes the first
      await menu(0); await pick(/^Rename Ava everywhere/); await answerPrompt('Ava Final');
      await sleep(1500);
      knobs({ patchDelayMs: 0 });
      const screen = [...new Set(groups().map(nameOf))];
      assert(screen.includes('Ava Final'), 'screen shows the last name');
      assert(speakersInDb().includes('Ava Final') && !speakersInDb().includes('Ava'), `database matches the screen (db: ${speakersInDb()})`);
    }],
    ['Details lists the facts and recording type', async () => {
      $('#detailsBtn').click();
      const pop = await waitFor(() => $('.details-pop'), { what: 'details popover' });
      const t = pop.innerText;
      for (const k of ['Length', 'Speakers', 'Recording type', 'Words', 'Saved', 'Audio']) assert(t.includes(k), `Details shows ${k}`);
      assert(/(Not on|On) this device/.test(t) && /never uploaded|attach the original file/.test(t), 'audio statement: whether this device has the recording, and that it is never uploaded');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await waitFor(() => !$('.details-pop'), { what: 'closed with Escape' });
    }],
  ]);
}
