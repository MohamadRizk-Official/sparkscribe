// Browser side of the intelligence API (/api/insights, /api/ask). Sends the user's Supabase access token;
// the server verifies it and works as that user. No AI keys or model calls exist in the browser.
import { supabase } from '../lib/supabase.js';

export class ApiError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

async function headers() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new ApiError('Sign in to use this.', 'unauthorized', 401);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(path, { ...init, headers: { ...(await headers()), ...(init.headers || {}) } });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Couldn't reach SparkScribe. Check your connection.", 'network', 0);
  }
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new ApiError(body?.message || `Request failed (${res.status}).`, body?.error || 'error', res.status), { details: body?.details || null });
  return body;
}

export const fetchState = (id) => call(`/api/insights?transcriptionId=${encodeURIComponent(id)}`);

export const requestInsight = (id, kind, recordingType, force = false) =>
  call('/api/insights', { method: 'POST', body: JSON.stringify({ transcriptionId: id, kind, recordingType, force }) });

// Streams an answer. Calls onStatus("searching" | "answering"), onDelta(text) and resolves with the
// final grounded answer { id, answer, refs, found, unsupported, cached }.
export async function askQuestion(id, question, at, { onStatus, onDelta } = {}) {
  let res;
  try {
    res = await fetch('/api/ask', { method: 'POST', headers: await headers(), body: JSON.stringify({ transcriptionId: id, question, at }) });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Couldn't reach SparkScribe. Check your connection.", 'network', 0);
  }
  if (!res.ok || !res.body) {
    let body = null;
    try { body = await res.json(); } catch {}
    throw new ApiError(body?.message || `Request failed (${res.status}).`, body?.error || 'error', res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data);
      if (event === 'delta') onDelta?.(payload.text);
      else if (event === 'status') onStatus?.(payload.status);
      else if (event === 'done') result = payload;
      else if (event === 'error') throw new ApiError(payload.message, payload.error, 500);
    }
  }
  if (!result) throw new ApiError("The answer couldn't be generated. Try again.", 'incomplete', 500);
  return result;
}

// ---- Across recordings (/api/across) ----
export const acrossStatus = (ids) => call('/api/across', { method: 'POST', body: JSON.stringify({ action: 'status', ids }) });
export const acrossGuide = (ids, focus, requestId) => call('/api/across', { method: 'POST', body: JSON.stringify({ action: 'guide', ids, focus, requestId }) });
// saved answers and guides (account-wide, any device)
export const acrossHistory = () => call('/api/across', { method: 'POST', body: JSON.stringify({ action: 'history' }) });
export const acrossThread = (ids) => call('/api/across', { method: 'POST', body: JSON.stringify({ action: 'thread', ids }) });
export const acrossDelete = (id) => call('/api/across', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
// errors keep the server's `details` (e.g. which recordings are gone)
async function streamSse(path, payload, { onStatus, onDelta, onNames } = {}) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: await headers(), body: JSON.stringify(payload) });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Couldn't reach SparkScribe. Check your connection.", 'network', 0);
  }
  if (!res.ok || !res.body) {
    let body = null;
    try { body = await res.json(); } catch {}
    throw Object.assign(new ApiError(body?.message || `Request failed (${res.status}).`, body?.error || 'error', res.status), { details: body?.details || null });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', result = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        const p = JSON.parse(data);
        if (event === 'delta') onDelta?.(p.text);
        else if (event === 'status') onStatus?.(p.status);
        else if (event === 'names') onNames?.(p);
        else if (event === 'done') result = p;
        else if (event === 'error') throw Object.assign(new ApiError(p.message, p.error, 500), { details: p.details || null });
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('The connection dropped before the answer was complete. Try again.', 'network', 0);
  }
  if (!result) throw new ApiError("The answer couldn't be generated. Try again.", 'incomplete', 500);
  return result;
}
export const askAcross = (ids, question, requestId, handlers) => streamSse('/api/across', { action: 'ask', ids, question, requestId }, handlers);

// Phase 5 (Create tab): generate one tool output, or get the stored one back if it is still current.
// Practice Quiz: check one short answer by meaning (the server reads the question from the stored quiz)
export const gradeAnswer = (id, artifactId, index, answer) =>
  call('/api/tools', { method: 'POST', body: JSON.stringify({ action: 'grade', transcriptionId: id, artifactId, index, answer }) });

// Focused Review: one or two new practice questions per concept for a quiz, written from the same passages
export const requestFollowups = (id, artifactId, concepts) =>
  call('/api/tools', { method: 'POST', body: JSON.stringify({ action: 'followups', transcriptionId: id, artifactId, concepts }) });

export const requestTool = (id, kind, settings = {}, force = false) =>
  call('/api/tools', { method: 'POST', body: JSON.stringify({ transcriptionId: id, kind, settings, force }) });
