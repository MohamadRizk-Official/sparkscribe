// Keyboard access on the home page (D9, D14) plus basic accessible-name checks. Run on http://127.0.0.1:5190/
import { $, $$, sleep, waitFor, visible, makeWav, feed, knobs, runTests, assert, eq } from './lib.js';

const key = (el, k) => { const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev; };

export async function run() {
  return runTests([
    ['D9: the drop box is in the keyboard tab order and named', async () => {
      if (visible($('#newBtn'))) { $('#newBtn').click(); await sleep(150); document.querySelector('dialog[open] [data-act="ok"]')?.click(); }
      await waitFor(() => visible($('#dropzone')), { what: 'upload screen' });
      const dz = $('#dropzone');
      assert(visible(dz), 'drop box visible');
      eq(dz.tabIndex, 0, 'tabIndex');
      assert(/recording/i.test(dz.getAttribute('aria-label') || ''), 'accessible name');
      dz.focus(); eq(document.activeElement, dz, 'focusable');
    }],
    ['D9: Enter and Space on the drop box open the file picker', async () => {
      const input = $('#fileInput'); let opened = 0;
      const orig = input.click; input.click = () => { opened++; };
      try { key($('#dropzone'), 'Enter'); key($('#dropzone'), ' '); } finally { input.click = orig; }
      eq(opened, 2, 'picker opened twice');
    }],
    ['D14: on the results page, Space on a focused button is not taken over by the player', async () => {
      knobs({ worker: 'fake', runMs: 200, lines: 'meeting', failSave: false, saveDelayMs: 0 });
      feed(makeWav(10));
      await waitFor(() => visible($('#resultsPanel')) && $$('#transcript .grp').length, { what: 'results' });
      let played = 0; const pb = $('#playBtn'); const orig = pb.click; pb.click = () => { played++; };
      try {
        const btn = $$('#resultsPanel button').find((b) => visible(b) && b !== pb);
        btn.focus();
        const ev = key(btn, ' ');
        eq(ev.defaultPrevented, false, 'Space left to the button');
        eq(played, 0, 'player not toggled');
        const ev2 = key(document.body, ' ');
        eq(ev2.defaultPrevented, true, 'Space on the page body still plays/pauses');
        eq(played, 1, 'player toggled from body');
      } finally { pb.click = orig; }
    }],
    ['icon-only buttons on the results page have accessible names', async () => {
      const unnamed = $$('#resultsPanel button, header button').filter((b) => visible(b) && !(b.getAttribute('aria-label') || b.textContent.trim() || b.getAttribute('title')));
      eq(unnamed.length, 0, `unnamed buttons: ${unnamed.map((b) => b.outerHTML.slice(0, 80)).join(' | ')}`);
    }],
  ]);
}
