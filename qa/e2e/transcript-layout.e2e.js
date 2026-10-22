// The transcript never collapses into a narrow column (regression for 2026-10-21: a one-speaker fresh result was laid
// out in the hidden speakers sidebar's 280px column). Measures the page it runs on, at the current window size:
//   fresh result on /:   (await import('/qa/e2e/transcript-layout.e2e.js')).fresh({ lines: 'one' | 'meeting' })
//   saved recording:     open /transcript?id=…, then (await import('/qa/e2e/transcript-layout.e2e.js')).check()
import { $, sleep, waitFor, makeWav, feed, knobs, runTests, assert } from './lib.js';

// the card holding the transcript is at least as wide as the column it lives in allows, and the text uses a reading
// measure (not a strip): ≥ 85% of the content column (or ≥ 90% of the viewport on phones), and text ≥ 60% of the card
export function measure() {
  const main = $('main.app');
  const card = [...document.querySelectorAll('.transcript-card')].find((c) => c.offsetParent !== null);
  const seg = card?.querySelector('.seg, .plain-transcript');
  const sidebar = [...document.querySelectorAll('.speakers-card')].find((c) => c.offsetParent !== null);
  const mainW = main.clientWidth - parseFloat(getComputedStyle(main).paddingLeft) - parseFloat(getComputedStyle(main).paddingRight);
  return { vw: innerWidth, mainW: Math.round(mainW), cardW: card?.offsetWidth || 0, textW: seg?.offsetWidth || 0, sidebarW: sidebar?.offsetWidth || 0, overflow: document.documentElement.scrollWidth - innerWidth };
}
export function check(label = location.pathname) {
  return runTests([[`${label} at ${innerWidth}px: the transcript fills its workspace`, async () => {
    await waitFor(() => document.querySelector('.transcript-card .seg, .transcript-card .plain-transcript'), { what: 'transcript' });
    await sleep(300);
    const m = measure();
    const room = m.mainW - (m.sidebarW ? m.sidebarW + 18 : 0);
    assert(m.cardW >= room * 0.85, `card ${m.cardW}px of ${room}px available: ${JSON.stringify(m)}`);
    assert(m.textW >= Math.min(m.cardW * 0.6, 520), `text ${m.textW}px in a ${m.cardW}px card: ${JSON.stringify(m)}`);
    assert(m.overflow <= 1, `no horizontal scroll: ${JSON.stringify(m)}`);
  }]]);
}
export async function fresh({ lines = 'one' } = {}) {
  knobs({ lines });
  feed(makeWav(20));
  await waitFor(() => !$('#resultsPanel').classList.contains('hidden'), { timeout: 30000, what: 'result' });
  return check(`fresh result (${lines})`);
}
