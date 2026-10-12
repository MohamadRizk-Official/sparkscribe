// QA end-to-end helpers. Runs INSIDE the app page served by qa/harness/dev-mock.mjs (import('/qa/e2e/lib.js')).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const visible = (el) => !!el && !el.closest('.hidden') && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;

export async function waitFor(pred, { timeout = 8000, every = 50, what = 'condition' } = {}) {
  const t0 = performance.now();
  for (;;) {
    let v; try { v = await pred(); } catch { v = null; }
    if (v) return v;
    if (performance.now() - t0 > timeout) throw new Error(`timeout waiting for ${what}`);
    await sleep(every);
  }
}

// a real WAV file (16-bit PCM mono): tone bursts with pauses, so decoders see real audio
export function makeWav(seconds = 20, sr = 16000) {
  const n = Math.floor(seconds * sr), data = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; const on = Math.floor(t) % 3 !== 2; data[i] = on ? Math.round(8000 * Math.sin(2 * Math.PI * (180 + 40 * (Math.floor(t) % 4)) * t)) : 0; }
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  return new File([buf], `qa-tone-${seconds}s.wav`, { type: 'audio/wav' });
}

export function feed(file, inputSel = '#fileInput') {
  const dt = new DataTransfer(); dt.items.add(file);
  const input = $(inputSel); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
}

export const knobs = (k) => window.__qaKnobs(k);
export const dbRows = () => window.__qaDb.rows;
export const harnessState = async () => (await fetch('/__harness/state')).json();

// tiny test runner: each test returns nothing or throws; results are collected, never thrown
export async function runTests(tests) {
  const results = [];
  for (const [name, fn] of tests) {
    const t0 = performance.now();
    try { const note = await fn(); results.push({ name, ok: true, ms: Math.round(performance.now() - t0), ...(note ? { note } : {}) }); }
    catch (e) { results.push({ name, ok: false, ms: Math.round(performance.now() - t0), error: String(e?.message || e).slice(0, 300) }); }
  }
  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results };
}
export function assert(cond, msg) { if (!cond) throw new Error(msg); }
export function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
