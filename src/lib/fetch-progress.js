// Download a file into a blob: URL, reporting progress and giving up when the download stalls (no bytes for
// `stallMs`). A slow connection that keeps moving is never cut off; one that stops is, with a clear message,
// instead of leaving "Loading…" on screen forever.
export class StallError extends Error {}

export async function fetchBlobURL(url, type, { stallMs = 30_000, onProgress = () => {}, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  let timer = null;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new StallError('stalled')), stallMs); };
  arm();
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    const total = Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    let got = 0;
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const aborted = new Promise((_, reject) => ctrl.signal.addEventListener('abort', () => reject(ctrl.signal.reason), { once: true }));
      aborted.catch(() => {});
      ctrl.signal.addEventListener('abort', () => reader.cancel().catch(() => {}), { once: true });
      for (;;) {
        arm();
        const { done, value } = await Promise.race([reader.read(), aborted]);
        // cancelling ends a pending read as "done": never mistake a stalled download for a complete one
        if (ctrl.signal.aborted) throw ctrl.signal.reason;
        if (done) break;
        chunks.push(value);
        got += value.byteLength;
        onProgress(got, total);
      }
    } else {
      const buf = await res.arrayBuffer();
      chunks.push(new Uint8Array(buf));
      onProgress(buf.byteLength, total);
    }
    return URL.createObjectURL(new Blob(chunks, { type }));
  } catch (err) {
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof StallError) throw new StallError('The download stopped. Check your connection and try again.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Reject if `promise` hasn't settled within `ms` (the promise itself keeps running; `onTimeout` can stop it).
export function withTimeout(promise, ms, message, onTimeout) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => { onTimeout?.(); reject(new StallError(message)); }, ms); }),
  ]);
}
