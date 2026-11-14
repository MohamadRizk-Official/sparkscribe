// Local audio store helpers (src/lib/audio-store.js): the byte formatter and the keep-audio preference.
// Node has no IndexedDB, which is the same situation as a browser that blocks it, so the "no storage" paths run for real.
import assert from 'node:assert/strict';
const A = await import(new URL('../src/lib/audio-store.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- fmtBytes
ok(A.fmtBytes(0) === '0 MB' && A.fmtBytes(undefined) === '0 MB' && A.fmtBytes(null) === '0 MB', 'nothing stored reads "0 MB"');
ok(A.fmtBytes(1) === '1 KB', 'a single byte rounds up to 1 KB, never "0 KB"');
ok(A.fmtBytes(1500) === '2 KB', 'kilobytes are rounded');
ok(A.fmtBytes(999_999) === '1000 KB', 'just under a megabyte stays in KB');
ok(A.fmtBytes(1_000_000) === '1.0 MB', 'from 1 MB, one decimal');
ok(A.fmtBytes(9_949_999) === '9.9 MB', 'under 10 MB keeps one decimal');
ok(A.fmtBytes(12_400_000) === '12 MB', 'from 10 MB, no decimals');
ok(A.fmtBytes(999_000_000) === '999 MB', 'just under a gigabyte stays in MB');
ok(A.fmtBytes(1_500_000_000) === '1.50 GB', 'gigabytes get two decimals');

// ---- constants
ok(A.PENDING_AUDIO_KEY === 'pending', 'unsaved recordings are parked under the key "pending"');
ok(A.KEEP_AUDIO_KEY === 'sparkscribe.keepAudio', 'the preference key is sparkscribe.keepAudio');

// ---- keepAudioPref with no localStorage at all (throws ReferenceError inside the try) → default on
ok(A.keepAudioPref() === true, 'without localStorage, keeping audio defaults to on');
A.setKeepAudioPref(false); // must not throw
ok(true, 'setting the preference without localStorage does not throw');

// ---- with a localStorage stand-in
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
ok(A.keepAudioPref() === true, 'nothing stored: on');
A.setKeepAudioPref(false);
ok(store.get('sparkscribe.keepAudio') === '0' && A.keepAudioPref() === false, 'off is stored as "0"');
A.setKeepAudioPref(true);
ok(store.get('sparkscribe.keepAudio') === '1' && A.keepAudioPref() === true, 'on is stored as "1"');
store.set('sparkscribe.keepAudio', 'garbage');
ok(A.keepAudioPref() === true, 'any value other than "0" means on');

// ---- every IndexedDB operation is best effort and resolves quietly when there is no database
ok(await A.putAudio('', new Blob(['x'])) === false && await A.putAudio('k', null) === false && await A.putAudio('k', new Blob([])) === false, 'putAudio refuses a missing key, a missing file and an empty file');
A.setKeepAudioPref(false);
ok(await A.putAudio('k', new Blob(['x'])) === false, 'putAudio stores nothing when the keep-audio preference is off');
A.setKeepAudioPref(true);
ok(await A.putAudio('k', new Blob(['x'])) === false, 'putAudio reports false (not an exception) when IndexedDB is missing');
ok(await A.putEnvelope('k', [1]) === false && await A.putAlign('k', {}) === false && await A.rekeyAudio('a', 'b') === false, 'envelope, align and rekey report false with no storage');
await A.deleteAudio(['k']); await A.deleteAudio(null); await A.clearAllAudio();
ok(true, 'delete and clear are quiet no-ops with no storage');
ok(await A.hasAudio('k') === false, 'hasAudio is false with no storage');
ok((await A.getAudio('k')) == null, 'getAudio finds nothing with no storage');
const info = await A.audioStorageInfo();
ok(info.available === false && info.count === 0 && info.bytes === 0, 'audioStorageInfo reports unavailable storage as empty');
console.log(`${pass} checks passed`);
