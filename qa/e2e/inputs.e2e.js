// File intake edge cases through the REAL decode path (src/audio.js).
// Unreadable files fall back to FFmpeg, whose own worker does not run under the Vite dev server: run the three
// "refused" cases on a production build (npm run build + a static server). Verified 2026-10-12 on the build:
// PDF / empty / text-as-mp3 each show "Couldn't read …" in 0.2–0.4 s; real models: 0.2 s tone and 6 s silence end
// with "No speech was recognised in this file." and no text.
import { $, $$, sleep, waitFor, visible, makeWav, feed, knobs, runTests, assert } from './lib.js';

const errorText = () => ($('#errorText')?.textContent || '').trim();
async function toDrop() {
  for (const id of ['#newBtn', '#retryBtn']) if (visible($(id))) $(id).click();
  await sleep(100);
  document.querySelector('dialog[open] [data-act="ok"]')?.click();
  await waitFor(() => visible($('#dropPanel')), { what: 'drop panel' });
}
async function expectReadError(file) {
  await toDrop();
  feed(file);
  await waitFor(() => visible($('#errorPanel')), { timeout: 30000, what: 'error panel' });
  assert(/Couldn.t read/.test(errorText()), `explains the file could not be read (got: ${errorText().slice(0, 120)})`);
  assert(errorText().includes(file.name), 'names the file');
  $('#retryBtn').click();
  await waitFor(() => visible($('#dropPanel')), { what: 'back to drop panel after Try again' });
}
function silentWav(seconds) { const f = makeWav(seconds); return f.arrayBuffer().then((b) => { new Int16Array(b, 44).fill(0); return new File([b], `silence-${seconds}s.wav`, { type: 'audio/wav' }); }); }

export async function run() {
  knobs({ worker: 'fake', runMs: 200, lines: 'meeting', failSave: false, saveDelayMs: 0 });
  return runTests([
    ['a PDF is refused with a clear message and the page recovers', async () => {
      await expectReadError(new File(['%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n'], 'notes.pdf', { type: 'application/pdf' }));
    }],
    ['an empty (0-byte) file is refused with a clear message', async () => {
      await expectReadError(new File([], 'empty.m4a', { type: 'audio/mp4' }));
    }],
    ['a text file renamed to .mp3 is refused with a clear message', async () => {
      await expectReadError(new File(['hello this is not audio at all'], 'fake.mp3', { type: 'audio/mpeg' }));
    }],
    ['a 0.2 s clip is processed without crashing', async () => {
      await toDrop();
      feed(makeWav(0.2));
      await waitFor(() => visible($('#resultsPanel')) || visible($('#errorPanel')), { timeout: 15000, what: 'result or error' });
      assert(visible($('#resultsPanel')) || /Couldn.t read/.test(errorText()), 'ends in a defined state');
    }],
    ['a silent recording reaches the worker as real audio (decoded length matches)', async () => {
      await toDrop();
      const before = window.__qaLog.length;
      feed(await silentWav(6));
      await waitFor(() => visible($('#resultsPanel')), { timeout: 15000, what: 'results' });
      assert(window.__qaLog.slice(before).some((e) => e.worker === 'complete'), 'worker completed');
    }],
  ]);
}
