// Home page: process → results → auto-save, and the save-integrity cases (D1, D2, D3, D8).
// Run on http://127.0.0.1:5190/ (QA harness, fake worker):  (await import('/qa/e2e/home-save.e2e.js')).run()
import { $, $$, sleep, waitFor, visible, makeWav, feed, knobs, dbRows, runTests, assert, eq } from './lib.js';

const errors = [];
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + String(e.reason?.message || e.reason)));

const resultsShown = () => visible($('#resultsPanel')) && $$('#transcript .grp').length > 0;
const saveStatus = () => ($('#saveBar')?.innerText || '').replace(/\s+/g, ' ').trim();
async function process(file, k = {}) {
  knobs({ worker: 'fake', runMs: 300, lines: 'meeting', saveDelayMs: 0, failSave: false, failPatch: false, ...k });
  feed(file);
  await waitFor(resultsShown, { what: 'results panel' });
}
async function toDrop() {
  // leave any result page through the app's own control
  if (visible($('#newBtn'))) $('#newBtn').click();
  await sleep(50);
  const dlg = document.querySelector('dialog[open]');
  if (dlg) dlg.querySelector('[data-act="ok"], .btn-danger, .btn-primary')?.click();
  await waitFor(() => visible($('#dropPanel')), { what: 'drop panel' });
}

export async function run() {
  return runTests([
    ['process → results → auto-saved with every line', async () => {
      await toDrop();
      const before = dbRows().length;
      await process(makeWav(20));
      await waitFor(() => /saved/i.test(saveStatus()) && dbRows().length === before + 1, { what: 'auto-save' });
      const row = dbRows().at(-1);
      eq(row.segments.length, 10, 'saved segments');
      eq(row.segments[0].sp, 'Speaker 1', 'first speaker label');
      assert(row.segments.some((s) => s.sp === 'Unknown'), 'Unknown line kept');
      assert(/Speaker 1/.test(row.transcript_text) && /Speaker 2/.test(row.transcript_text), 'text has both speakers');
      eq($$('#transcript .grp').length > 0, true, 'groups rendered');
    }],
    ['D1: "New" while the first save is in flight must not overwrite that recording', async () => {
      await toDrop();
      const before = dbRows().length;
      await process(makeWav(20), { saveDelayMs: 1500, lines: 'meeting' });
      await waitFor(() => /saving/i.test(saveStatus()), { what: 'saving state' });
      await toDrop(); // user starts over while "Saving…"
      await sleep(1700); // the first insert finishes in the background
      const firstId = dbRows().at(-1).id, firstText = dbRows().at(-1).transcript_text;
      await process(makeWav(12), { saveDelayMs: 0, lines: 'unicode' });
      await waitFor(() => /saved/i.test(saveStatus()), { what: 'second save' });
      await sleep(300);
      const first = dbRows().find((r) => r.id === firstId);
      eq(dbRows().length, before + 2, 'two separate recordings saved');
      eq(first.transcript_text, firstText, 'first recording unchanged');
    }],
    ['D2: a rename made during the first save reaches the saved copy', async () => {
      await toDrop();
      await process(makeWav(20), { saveDelayMs: 1200 });
      await waitFor(() => /saving/i.test(saveStatus()), { what: 'saving state' });
      const input = $('#speakerList .spk-name'); input.value = 'Alexandra'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await waitFor(() => /saved/i.test(saveStatus()), { timeout: 8000, what: 'saved' });
      await sleep(1800); // any follow-up sync
      const row = dbRows().at(-1);
      assert(row.segments.some((s) => s.sp === 'Alexandra'), `saved copy has the new name (got ${[...new Set(row.segments.map((s) => s.sp))].join(', ')})`);
    }],
    ['D3: leaving within the 900 ms results window must not crash or re-open results', async () => {
      await toDrop();
      errors.length = 0;
      knobs({ worker: 'fake', runMs: 200, lines: 'meeting' });
      feed(makeWav(10));
      await waitFor(() => window.__qaLog.some((e) => e.worker === 'complete' && e.t > performance.now() - 3000), { what: 'complete message' });
      $('#cancelBtn')?.click(); // still on the progress panel during the 900 ms delay
      await sleep(1300);
      assert(visible($('#dropPanel')), 'drop panel stays visible');
      assert(!visible($('#resultsPanel')), 'results panel must not re-open');
      eq(errors.length, 0, `page errors (${errors.join(' | ')})`);
    }],
    ['D8: "New" on an unsaved signed-out result asks before discarding', async () => {
      await toDrop();
      await process(makeWav(10), { failSave: true });
      await waitFor(() => /couldn|error|try/i.test(saveStatus()), { what: 'save error' });
      $('#newBtn').click();
      await sleep(200);
      assert(!!document.querySelector('dialog[open]') && visible($('#resultsPanel')), 'a confirmation is shown and the transcript is still on screen');
      document.querySelector('dialog[open] [data-act="cancel"]')?.click();
      knobs({ failSave: false });
    }],
    ['D8: leaving the page warns while a transcript is unsaved, not once it is saved', async () => {
      const leaveBlocked = () => { const ev = new Event('beforeunload', { cancelable: true }); dispatchEvent(ev); return ev.defaultPrevented; };
      await toDrop();
      eq(leaveBlocked(), false, 'no warning on an empty home page');
      await process(makeWav(10), { failSave: true });
      await waitFor(() => /couldn|error|try/i.test(saveStatus()), { what: 'save error' });
      eq(leaveBlocked(), true, 'warning while unsaved');
      knobs({ failSave: false });
      $('#saveBar [data-act="retry"]').click();
      await waitFor(() => /saved/i.test(saveStatus()), { what: 'saved after retry' });
      eq(leaveBlocked(), false, 'no warning once saved');
    }],
  ]);
}
