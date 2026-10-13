// Shared-computer privacy of the transcript parked for "sign in to save" (lib/transcripts.js + resumePendingSave in
// main.js). Each case needs a page load, so it runs as stages across reloads:
//   const m = await import('/qa/e2e/pending-privacy.e2e.js'); m.start()   (navigates)
//   then after each load: await m.next()   until it returns { done, passed, failed, results }
import { $, sleep, waitFor, dbRows, assert, eq } from './lib.js';

const KEY = 'sparkscribe.pendingSave';
const S = '__qaPending';
const park = (extra = {}) => localStorage.setItem(KEY, JSON.stringify({ title: 'Private chat', durationSeconds: 30, language: 'en', text: 'secret words', segments: [{ s: 0, e: 3, sp: 'Speaker 1', t: 'secret words' }], recordingType: null, owner: null, at: Date.now(), ...extra }));
const card = () => $('.pending-card');
const state = () => JSON.parse(sessionStorage.getItem(S) || '{"i":0,"results":[]}');
const setState = (s) => sessionStorage.setItem(S, JSON.stringify(s));

// [name, setup (before navigating), url, check (after load)]
const CASES = [
  ['an ordinary visit by the next person neither shows nor saves a parked transcript', () => park(), '/', async (rows) => {
    await sleep(1200);
    assert(!card(), 'no card');
    eq(dbRows().length, rows, 'nothing saved');
    assert(localStorage.getItem(KEY), 'still parked (expires within the hour)');
  }],
  ['returning from "sign in to save" asks first; Discard saves nothing and forgets it', () => park(), '/?save=pending', async (rows) => {
    const c = await waitFor(card, { what: 'pending card' });
    assert(/Save “Private chat” to My Library\?/.test(c.textContent) && /min ago/.test(c.textContent), `card: ${c.textContent}`);
    eq(location.search, '', 'address cleaned');
    c.querySelector('[data-act=discard]').click();
    await sleep(200);
    assert(!card() && !localStorage.getItem(KEY), 'card gone, nothing parked');
    eq(dbRows().length, rows, 'nothing saved');
  }],
  ['…and Save saves it and opens it', () => park(), '/?save=pending', async (rows) => {
    const c = await waitFor(card, { what: 'pending card' });
    sessionStorage.setItem('__qaRowsBefore', String(rows));
    c.querySelector('[data-act=save]').click();
    return 'navigates';
  }, async () => {
    await waitFor(() => /\/transcript/.test(location.pathname), { what: 'opened the saved transcript' });
    eq(dbRows().length, Number(sessionStorage.getItem('__qaRowsBefore')) + 1, 'one row saved');
    assert(dbRows().some((r) => r.title === 'Private chat'), 'it is the parked one');
    assert(!localStorage.getItem(KEY), 'no longer parked');
  }],
  ['a transcript parked under another account is dropped, not saved into this one', () => park({ owner: '99999999-9999-4999-8999-999999999999' }), '/?save=pending', async (rows) => {
    await sleep(1200);
    assert(!card(), 'no card');
    eq(dbRows().length, rows, 'nothing saved');
    assert(!localStorage.getItem(KEY), 'dropped');
  }],
  ['a transcript parked more than an hour ago is dropped', () => park({ at: Date.now() - 61 * 60 * 1000 }), '/?save=pending', async (rows) => {
    await sleep(1200);
    assert(!card(), 'no card');
    eq(dbRows().length, rows, 'nothing saved');
    assert(!localStorage.getItem(KEY), 'dropped');
  }],
  ['anonymous transcript over the account’s monthly time: refused by the database, explained, text downloadable, still parked', () => { park(); window.__qaKnobs({ quotaSave: true }); }, '/?save=pending', async (rows) => {
    const c = await waitFor(card, { what: 'pending card' });
    const blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { blobs.push(b); return orig.call(URL, b); };
    const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { blobs.name = this.download; };
    try {
      c.querySelector('[data-act=save]').click();
      await waitFor(() => /longer than the transcription time left/.test(card()?.textContent || ''), { what: 'quota message' });
      assert(!/quota_exceeded|Retry/.test(card().textContent), 'no raw error or useless Retry');
      card().querySelector('[data-act=download]').click();
      await sleep(100);
      assert(blobs.length === 1 && /secret words/.test(await blobs[0].text()) && blobs.name === 'Private chat.txt', 'the text downloads');
      eq(dbRows().length, rows, 'nothing saved');
      assert(localStorage.getItem(KEY), 'still parked');
    } finally { URL.createObjectURL = orig; HTMLAnchorElement.prototype.click = click; window.__qaKnobs({ quotaSave: false }); localStorage.removeItem(KEY); }
  }],
  ['signing out forgets a parked transcript', () => park(), '/settings', async () => {
    const { signOut } = await import('/src/lib/account.js');
    await signOut();
    assert(!localStorage.getItem(KEY), 'cleared on sign-out');
  }],
];

export function start() {
  setState({ i: 0, results: [] });
  CASES[0][1]();
  location.href = CASES[0][2];
  return 'started';
}

export async function next() {
  const st = state();
  const c = CASES[st.i];
  if (!c) return { done: true, ...summary(st) };
  const t0 = performance.now();
  try {
    if (st.afterNav) { await c[4](); delete st.afterNav; }
    else {
      const rows = dbRows().length;
      const r = await c[3](rows);
      if (r === 'navigates') { st.afterNav = true; setState(st); return { waiting: c[0] }; }
    }
    st.results.push({ name: c[0], ok: true, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    delete st.afterNav;
    st.results.push({ name: c[0], ok: false, error: e.message });
  }
  st.i++;
  setState(st);
  const n = CASES[st.i];
  if (!n) return { done: true, ...summary(st) };
  n[1]();
  location.href = n[2];
  return { ran: c[0] };
}
const summary = (st) => ({ passed: st.results.filter((r) => r.ok).length, failed: st.results.filter((r) => !r.ok).length, results: st.results });
