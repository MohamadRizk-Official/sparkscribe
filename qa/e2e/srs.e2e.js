// Spaced review for flashcards (no AI): after the answer the student rates the card, the schedule is saved in the set's
// progress, due cards can be reviewed on their own, and the home page suggests them.
// Run on /transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa with a fresh harness: load, clear sessionStorage,
// seed(), then open /transcript?id=…&tab=create&tool=flashcards and run(); then home() on /.
import { $, $$, sleep, waitFor, runTests, assert, eq } from './lib.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DAY = Math.floor(Date.now() / 86_400_000);
const panel = () => $('#insightsHost [data-panel="create"]');
const deck = () => panel()?.querySelector('.deck');
const text = () => (deck()?.innerText || '').replace(/\s+/g, ' ');
const btn = (re) => [...(deck()?.querySelectorAll('button') || [])].find((b) => re.test(b.textContent));
const stored = async () => (await (await fetch('/__harness/artifacts')).json()).find((a) => a.transcription_id === ID && a.kind === 'flashcards');
const flip = async () => { const c = await waitFor(() => deck()?.querySelector('.fc:not(.flipped)'), { what: 'question side' }); c.click(); await waitFor(() => deck()?.querySelector('.fc-rate'), { what: 'rating buttons' }); };

export async function seed() {
  const card = (n) => ({ front: `Question ${n}`, back: `Answer ${n}`, evidence: 'x', refs: [0] });
  // card 1 was rated before and is due since yesterday; cards 2 and 3 were never rated
  await fetch('/__harness/artifact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcription_id: ID, kind: 'flashcards', settings_key: '', progress: { srs: { 0: [DAY - 1, 1] } }, content: { cards: [card(1), card(2), card(3)], target: 8 } }) });
}

export async function run() {
  return runTests([
    ['The deep link opens the set, and says one card is due', async () => {
      await waitFor(() => deck(), { what: 'deck', timeout: 12000 });
      assert(/1 card is due for review/.test(text()), text());
      assert(/1 \/ 3/.test(text()) && /due now/.test(text()), text());
      assert(!deck().querySelector('.fc-rate'), 'no rating before the answer is shown');
    }],
    ['After the answer: three ratings, each saying when the card comes back', async () => {
      await flip();
      const r = $$('.fc-rate [data-rate]', deck()).map((b) => b.innerText.replace(/\s+/g, ' ').trim());
      eq(r.length, 3, 'ratings');
      assert(/Didn’t know Back again today/.test(r[0]), r[0]);
      assert(/Knew it Back in 7 days/.test(r[1]), r[1]);   // step 1 -> 2 (7 days)
      assert(/Easy Back in 16 days/.test(r[2]), r[2]);    // step 1 -> 3 (16 days)
    }],
    ['"Knew it" saves the schedule and moves on; nothing is due any more', async () => {
      btn(/Knew it/).click();
      await waitFor(() => /2 \/ 3/.test(text()), { what: 'card 2' });
      await waitFor(async () => (await stored())?.progress?.srs?.['0']?.[0] === DAY + 7, { what: 'saved schedule' });
      eq(JSON.stringify((await stored()).progress.srs), JSON.stringify({ 0: [DAY + 7, 2] }), 'srs');
      assert(!/due for review/.test(text()), 'no due bar');
    }],
    ['"Didn’t know" (key 1) brings the card back today', async () => {
      await flip();
      deck().dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
      await waitFor(() => /3 \/ 3/.test(text()), { what: 'card 3' });
      await waitFor(async () => (await stored())?.progress?.srs?.['1']?.[0] === DAY, { what: 'saved' });
      assert(/1 card is due for review/.test(text()), text());
    }],
    ['Finishing the set says so, and offers the due card again', async () => {
      await flip();
      btn(/Easy/).click();
      await waitFor(() => deck()?.querySelector('.deck-done'), { what: 'done' });
      assert(/You’ve been through every card/.test(text()) && /1 card you didn’t know is due again today/.test(text()), text());
      const s = (await stored()).progress.srs;
      eq(JSON.stringify(s[2]), JSON.stringify([DAY + 3, 1]), 'easy on a new card -> step 1');
    }],
    ['Review due shows only the due card; rating it ends the review', async () => {
      btn(/Go again/).click();
      await waitFor(() => /Spaced review · 1 card/.test(text()), { what: 'review mode' });
      assert(/Question 2/.test(text()) && /1 \/ 1/.test(text()), text());
      assert(!btn(/Shuffle/), 'no shuffle while reviewing');
      await flip();
      btn(/Knew it/).click();
      await waitFor(() => /Review done\./.test(text()), { what: 'review done' });
      assert(/come back on their own schedule/.test(text()), text());
      btn(/Start over with all cards/).click();
      await waitFor(() => /1 \/ 3/.test(text()) && /Question 1/.test(text()), { what: 'all cards' });
    }],
    ['Other data in the set’s progress is kept', async () => {
      const p = (await stored()).progress;
      eq(Object.keys(p).join(), 'srs', 'only srs');
      eq(Object.keys(p.srs).sort().join(), '0,1,2', 'three rated cards');
    }],
  ]);
}

// on / (signed in): the home suggests the due cards, linking straight to the set
export async function home() {
  return runTests([
    ['What to study next lists the due flashcards', async () => {
      const item = await waitFor(() => $$('.dash-next-item').find((a) => /Review \d+ flashcards?/.test(a.textContent)), { what: 'review suggestion', timeout: 12000 });
      assert(/Due today in your spaced review/.test(item.textContent), item.textContent);
      assert(item.getAttribute('href').endsWith(`id=${ID}&tab=create&tool=flashcards`), item.getAttribute('href'));
    }],
  ]);
}
