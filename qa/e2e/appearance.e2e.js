// Settings → Appearance: System / Light / Dark, applied at once, kept across pages, System follows the device.
// Run on /settings.  (Device preference is emulated through the frame's matchMedia; nothing global is changed.)
import { $, sleep, waitFor, runTests, assert, eq } from './lib.js';

let frame;
async function open(path) {
  frame?.remove();
  frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:800px;height:600px;opacity:.01;pointer-events:none';
  document.body.appendChild(frame);
  frame.src = path;
  await waitFor(() => frame.contentDocument?.readyState === 'complete' && frame.contentWindow.location.pathname === path, { what: `load ${path}` });
  await sleep(400);
  return frame.contentDocument;
}
const theme = (d = document) => d.documentElement.dataset.theme;
// the new appearance is applied inside the circular reveal (a View Transition: the next frame, or within 300 ms when
// the page isn't painting): wait for the preference to land rather than a fixed delay
const choose = async (v) => { $(`#themeSeg [data-v="${v}"]`).click(); await waitFor(() => document.documentElement.dataset.themePref === v, { timeout: 1500, what: `appearance ${v}` }); };

export async function run() {
  const saved = localStorage.getItem('sparkscribe.theme');
  try {
    return await runTests([
      ['new visitors start in Light', async () => {
        localStorage.removeItem('sparkscribe.theme');
        const d = await open('/pricing');
        eq(theme(d), 'light', 'theme');
      }],
      ['Dark applies immediately, is remembered, and other pages open in Dark before first paint', async () => {
        await choose('dark');
        eq(theme(), 'dark', 'this page');
        eq($('#themeSeg [data-v="dark"]').getAttribute('aria-checked'), 'true', 'radio state');
        const d = await open('/library');
        eq(theme(d), 'dark', 'next page');
      }],
      ['Light applies immediately', async () => {
        await choose('light');
        eq(theme(), 'light', 'this page');
      }],
      ['System follows the device setting (emulated dark device → dark)', async () => {
        await choose('system');
        eq(document.documentElement.dataset.themePref, 'system', 'preference recorded');
        // the boot script reads matchMedia; emulate a dark device for a fresh page
        const d = await open('/terms');
        const w = frame.contentWindow;
        const darkDevice = !w.matchMedia('(prefers-color-scheme: light)').matches;
        eq(theme(d), darkDevice ? 'dark' : 'light', `follows this device (${darkDevice ? 'dark' : 'light'})`);
      }],
      ['keyboard: arrow keys move the choice', async () => {
        await choose('light');
        $('#themeSeg [data-v="light"]').focus();
        $('#themeSeg').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await waitFor(() => theme() === 'dark', { timeout: 1500, what: 'dark after ArrowRight' }).catch(() => {});
        eq(theme(), 'dark', 'ArrowRight from Light → Dark');
        assert(document.activeElement === $('#themeSeg [data-v="dark"]'), 'focus moved');
      }],
    ]);
  } finally {
    frame?.remove();
    if (saved == null) localStorage.removeItem('sparkscribe.theme'); else localStorage.setItem('sparkscribe.theme', saved);
  }
}
