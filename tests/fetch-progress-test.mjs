// Converter download watchdog (src/lib/fetch-progress.js): progress, stalls, slow-but-moving downloads, timeouts.
// Fake fetch + streams: no network.
import assert from 'node:assert/strict';
import { fetchBlobURL, withTimeout, StallError } from '../src/lib/fetch-progress.js';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a fake fetch whose body yields `chunks` with `gapMs` between them, then optionally hangs forever
function fakeFetch({ chunks = [], gapMs = 0, hangAfter = false, status = 200, hangBeforeHeaders = false, length = true }) {
  return (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    if (hangBeforeHeaders) return;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    let i = 0;
    const body = new ReadableStream({
      async pull(ctrl) {
        if (i < chunks.length) { if (gapMs) await sleep(gapMs); ctrl.enqueue(new Uint8Array(chunks[i++])); return; }
        if (hangAfter) return new Promise(() => {});
        ctrl.close();
      },
    });
    resolve(new Response(body, { status, headers: length ? { 'content-length': String(total) } : {} }));
  });
}

const progress = [];
const url = await fetchBlobURL('/x.wasm', 'application/wasm', { fetchImpl: fakeFetch({ chunks: [[1, 2], [3], [4, 5, 6]] }), onProgress: (g, t) => progress.push([g, t]) });
const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
ok(url.startsWith('blob:') && bytes.join() === '1,2,3,4,5,6', 'downloads into a blob: URL with the exact bytes');
ok(JSON.stringify(progress) === '[[2,6],[3,6],[6,6]]', `reports progress against content-length (${JSON.stringify(progress)})`);

let t0 = Date.now(), err = null;
try { await fetchBlobURL('/x', 'x', { stallMs: 150, fetchImpl: fakeFetch({ chunks: [[1]], hangAfter: true }) }); } catch (e) { err = e; }
ok(err instanceof StallError && /stopped/.test(err.message) && Date.now() - t0 < 1500, `a download that stops mid-way fails after the stall window (${Date.now() - t0} ms): "${err?.message}"`);

t0 = Date.now(); err = null;
try { await fetchBlobURL('/x', 'x', { stallMs: 150, fetchImpl: fakeFetch({ hangBeforeHeaders: true }) }); } catch (e) { err = e; }
ok(err instanceof StallError && Date.now() - t0 < 1500, 'a server that never answers fails after the stall window');

t0 = Date.now();
const slow = await fetchBlobURL('/x', 'x', { stallMs: 150, fetchImpl: fakeFetch({ chunks: Array.from({ length: 8 }, () => [7]), gapMs: 80 }) });
ok(slow.startsWith('blob:') && Date.now() - t0 > 500, `a slow download that keeps moving is never cut off (${Date.now() - t0} ms total, 150 ms stall window)`);

err = null;
try { await fetchBlobURL('/x', 'x', { fetchImpl: fakeFetch({ status: 404 }) }); } catch (e) { err = e; }
ok(err && !(err instanceof StallError) && /404/.test(err.message), 'an HTTP error is reported as such');

const noLen = [];
await fetchBlobURL('/x', 'x', { fetchImpl: fakeFetch({ chunks: [[1], [2]], length: false }), onProgress: (g, t) => noLen.push([g, t]) });
ok(JSON.stringify(noLen) === '[[1,0],[2,0]]', 'without content-length, progress still counts bytes (total 0 = unknown)');

let stopped = false; err = null;
try { await withTimeout(new Promise(() => {}), 100, 'did not start', () => { stopped = true; }); } catch (e) { err = e; }
ok(err instanceof StallError && err.message === 'did not start' && stopped, 'withTimeout rejects and stops the slow step');
ok((await withTimeout(Promise.resolve(42), 100, 'x')) === 42, 'withTimeout passes a prompt result through');

console.log(`\n${pass} checks passed`);
