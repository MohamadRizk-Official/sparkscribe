// Original audio, kept on THIS device so a saved recording can be played along with its transcript later.
//
// The audio never leaves the device: it is stored in the browser's IndexedDB (not in Supabase, not in any
// bucket), keyed by the recording's id. The transcript's timestamps were made from this same file, so playback
// lines up without re-transcribing. Everything here is best effort: a browser without IndexedDB (private
// windows, strict settings, storage full) just has no stored audio, and the transcript page then offers
// "Attach original audio" instead. Nothing in the app depends on a call here succeeding.
//
// Keys: the recording id (uuid). A recording transcribed before sign-in is parked under PENDING_AUDIO_KEY and
// re-keyed once it is saved (main.js). Deleting a recording, forgetting this browser, or deleting the account
// removes the audio too (library.js / account.js).

const DB_NAME = 'sparkscribe-audio';
const STORE = 'audio';
export const PENDING_AUDIO_KEY = 'pending';
export const KEEP_AUDIO_KEY = 'sparkscribe.keepAudio'; // "1" (default) or "0": Settings → Recording

let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

// one transaction, one request; resolves to undefined/false on any failure
async function run(mode, fn) {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : true);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export function keepAudioPref() {
  try { return localStorage.getItem(KEEP_AUDIO_KEY) !== '0'; } catch { return true; }
}
export function setKeepAudioPref(on) {
  try { localStorage.setItem(KEEP_AUDIO_KEY, on ? '1' : '0'); } catch { /* this page only */ }
}

// Store the file under `key`. Asks the browser to keep this origin's storage out of automatic eviction (once;
// the browser may still say no). Returns true when stored.
// `env` is the recording's loudness envelope (lib/breath.js), kept with it so links start in a pause.
export async function putAudio(key, file, env = null) {
  if (!key || !file || !file.size) return false;
  if (!keepAudioPref()) return false;
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* unsupported */ }
  const rec = { blob: file, name: file.name || 'recording', type: file.type || '', size: file.size, savedAt: Date.now(), ...(env && { env }) };
  const ok = await run('readwrite', (s) => s.put(rec, String(key)));
  return ok === true;
}

// Add the envelope to audio stored before envelopes existed (made once, on this device).
export async function putEnvelope(key, env) {
  if (!key || !env) return false;
  const rec = await run('readonly', (s) => s.get(String(key)));
  if (!rec?.blob) return false;
  return (await run('readwrite', (s) => s.put({ ...rec, env }, String(key)))) === true;
}

// The stored audio for a recording: { blob, name, type, size, savedAt, env? } or null.
export async function getAudio(key) {
  if (!key) return null;
  const rec = await run('readonly', (s) => s.get(String(key)));
  return rec && rec.blob ? rec : null;
}

export async function hasAudio(key) {
  if (!key) return false;
  const n = await run('readonly', (s) => s.count(String(key)));
  return n > 0;
}

export async function deleteAudio(keys) {
  const list = [].concat(keys).filter(Boolean).map(String);
  if (!list.length) return;
  await run('readwrite', (s) => { for (const k of list) s.delete(k); return null; });
}

// A parked recording becomes a saved one: move its audio to the recording's id.
export async function rekeyAudio(from, to) {
  if (!from || !to) return false;
  const rec = await run('readonly', (s) => s.get(String(from)));
  if (!rec) return false;
  const ok = await run('readwrite', (s) => { s.put(rec, String(to)); s.delete(String(from)); return null; });
  return ok === true;
}

export async function clearAllAudio() {
  await run('readwrite', (s) => s.clear());
}

// What is on this device: how many recordings and how many bytes (for Settings → Privacy & Data).
export async function audioStorageInfo() {
  const keys = (await run('readonly', (s) => s.getAllKeys())) || [];
  const recs = (await run('readonly', (s) => s.getAll())) || [];
  const bytes = recs.reduce((t, r) => t + (r?.size || 0), 0);
  let quota = null;
  try { const e = await navigator.storage?.estimate?.(); if (e) quota = { usage: e.usage || 0, quota: e.quota || 0 }; } catch { /* unsupported */ }
  return { count: keys.filter((k) => k !== PENDING_AUDIO_KEY).length, bytes, quota, available: !!(await open()) };
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}
