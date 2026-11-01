// Drives the real app (a production build, `vite preview`) in a Chrome started with the GPU disabled and pinned to two
// cores (a CPU-only laptop stand-in), over the DevTools protocol: processes one file with default settings, logs every
// stage, then clicks sentences with real mouse events and records how long until the audio starts and where.
//   node qa/e2e/cpu-only-drive.mjs <port> <file.wav> <out.json> [appUrl]   (READ_S: seconds of reading before clicks)
import { writeFileSync } from 'node:fs';
const [port, file, out, app = 'http://localhost:4176/'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

const HOOK = `(() => { const W = window.Worker; window.__ev = []; window.__dl = {}; window.__plays = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__plays.push([Math.round(performance.now()), +this.currentTime.toFixed(3)]); return play.apply(this, arguments); };
  window.Worker = class extends W { constructor(u, o) { super(u, o); const name = String(u).split('/').pop().split('?')[0];
    const post = this.postMessage.bind(this);
    this.postMessage = (m, t) => { if (m?.type === 'align') window.__ev.push([Math.round(performance.now()), name, 'send-align', m.id]); return post(m, t); };
    this.addEventListener('message', ({ data }) => { const t = Math.round(performance.now());
      if (data.type === 'progress' && data.file) { if (data.total) window.__dl[name + ':' + data.file] = data.total; return; }
      if (['stage', 'status', 'device', 'error', 'aligned', 'failed'].includes(data.type)) window.__ev.push([t, name, data.type, data.stage || data.text || data.device || data.message || '', data.reason || '']);
      if (data.type === 'complete') { window.__complete = data; window.__ev.push([t, name, 'complete']); } }); } }; })();`;
await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
await send('Page.navigate', { url: app });
await sleep(6000);
const gpu = await evaluate(`(async () => navigator.gpu ? String(!!(await navigator.gpu.requestAdapter())) : 'no navigator.gpu')()`);
console.log('page WebGPU adapter:', gpu, '| cores reported:', await evaluate('navigator.hardwareConcurrency'), '| isolated:', await evaluate('crossOriginIsolated'));
const { root } = (await send('DOM.getDocument')).result;
const input = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })).result.nodeId;
const t0 = Date.now();
await send('DOM.setFileInputFiles', { nodeId: input, files: [file] });
let last = 0;
while (true) {
  await sleep(5000);
  const ev = (await evaluate('window.__ev')) || [];
  for (const e of ev.slice(last)) console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's', JSON.stringify(e));
  last = ev.length;
  if (await evaluate('!!window.__complete')) break;
  if (ev.some((e) => e[2] === 'error')) break;
  if (Date.now() - t0 > 3 * 3600e3) break;
}
const totalS = (Date.now() - t0) / 1000;
const result = await evaluate(`(() => { const c = window.__complete; return c && { segments: (c.segments || c.lines)?.map(({ start, end, text, speaker }) => ({ start, end, text, speaker })), stats: c.diarStats || c.stats || null, keys: Object.keys(c) }; })()`);
console.log('done in', totalS.toFixed(0), 's; segments', result?.segments?.length, 'keys', result?.keys);
// clicks, as a student makes them (real mouse events): sentences of a few paragraphs; for each, how long until the
// audio starts and where. The first click also starts the word-timing model's download.
const mouse = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
const READ_S = Number(process.env.READ_S || 30); // the student reads before clicking
await sleep(READ_S * 1000);
await evaluate("document.querySelector('audio')?.pause()");
const clicks = [];
for (const [i, k] of [[2, 0], [2, 1], [5, 0], [8, 0], [8, 1], [11, 0], [14, 0], [17, 0], [20, 0], [20, 1]]) {
  const r = await evaluate(`(() => { const el = document.querySelector('#transcript .seg[data-i="${i}"] .snt[data-k="${k}"]') || document.querySelector('.seg[data-i="${i}"] .snt[data-k="${k}"]');
    if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getClientRects()[0]; return { x: b.left + Math.min(12, b.width / 2), y: b.top + b.height / 2, text: el.textContent.slice(0, 50) }; })()`);
  if (!r) { clicks.push({ i, k, missing: true }); continue; }
  await sleep(300);
  const before = (await evaluate('window.__plays.length')) || 0;
  const tc = await evaluate('Math.round(performance.now())');
  await mouse(r.x, r.y);
  let p = null;
  for (let w = 0; w < 100 && !p; w++) { await sleep(100); p = (await evaluate(`window.__plays[${before}] || null`)); }
  clicks.push({ i, k, text: r.text, clickToPlayMs: p ? p[0] - tc : null, at: p ? p[1] : null });
  console.log('click', JSON.stringify(clicks.at(-1)));
  await sleep(2500);
  await evaluate("document.querySelector('audio')?.pause()");
}
writeFileSync(out, JSON.stringify({ file, totalS, gpu, events: await evaluate('window.__ev'), downloads: await evaluate('window.__dl'), clicks, plays: await evaluate('window.__plays'), ...result }, null, 1));
await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
process.exit(0);
