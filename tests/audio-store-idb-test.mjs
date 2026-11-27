// Audio kept on this device (src/lib/audio-store.js): saving, reading, enriching, moving and deleting recordings.
// Node has no IndexedDB, so a small in-memory stand-in with the same request/transaction shape is installed first
// (docs/testing/stand-ins.md): operations run on a Map and each transaction completes on the next tick.
import assert from 'node:assert/strict';

const data = new Map();
let upgrades = 0, failNext = false;
const request = (result) => ({ result });
const store = {
  put: (v, k) => { data.set(k, v); return request(k); },
  get: (k) => request(data.get(k)),
  delete: (k) => { data.delete(k); return request(undefined); },
  count: (k) => request(data.has(k) ? 1 : 0),
  clear: () => { data.clear(); return request(undefined); },
  getAll: () => request([...data.values()]),
  getAllKeys: () => request([...data.keys()]),
};
globalThis.indexedDB = {
  open() {
    const req = { result: { onversionchange: null, transaction: () => { if (failNext) { failNext = false; throw new Error('blocked'); } const tx = { objectStore: () => store }; setTimeout(() => tx.oncomplete?.(), 0); return tx; }, createObjectStore() { upgrades++; } } };
    setTimeout(() => { req.onupgradeneeded?.(); req.onsuccess?.(); }, 0);
    return req;
  },
};
const store2 = new Map();
globalThis.localStorage = { getItem: (k) => (store2.has(k) ? store2.get(k) : null), setItem: (k, v) => store2.set(k, String(v)), removeItem: (k) => store2.delete(k) };
const setNavigator = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
setNavigator({ storage: { persist: async () => true, estimate: async () => ({ usage: 5, quota: 100 }) } });
const A = await import(new URL('../src/lib/audio-store.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const file = (size, name = 'lecture.m4a', type = 'audio/mp4') => ({ size, name, type });

// ---- putAudio / getAudio / hasAudio
ok((await A.putAudio('', file(10))) === false && (await A.putAudio('k', null)) === false && (await A.putAudio('k', file(0))) === false, 'nothing is stored without a key, a file or any bytes');
ok(data.size === 0 && upgrades === 0, '…and the database is not even opened for those');
ok((await A.putAudio('rec1', file(2000), { peaks: [1, 2] })) === true, 'a recording is stored');
ok(upgrades === 1, 'the database is created on first use');
const got = await A.getAudio('rec1');
ok(got.name === 'lecture.m4a' && got.type === 'audio/mp4' && got.size === 2000 && got.env.peaks.length === 2 && got.savedAt > 0, 'it comes back with its name, type, size, envelope and save time');
ok((await A.getAudio('nope')) === null && (await A.getAudio('')) === null, 'a missing or blank key reads as null');
ok((await A.hasAudio('rec1')) === true && (await A.hasAudio('nope')) === false && (await A.hasAudio('')) === false, 'hasAudio tells stored from not stored');
ok((await A.putAudio(7, { size: 5 })) === true && (await A.getAudio('7')).name === 'recording' && (await A.getAudio('7')).type === '', 'keys are text and a file with no name is called "recording"');

// ---- the keep-audio switch
A.setKeepAudioPref(false);
ok((await A.putAudio('rec2', file(10))) === false && !data.has('rec2'), 'with "keep audio" off nothing is stored');
A.setKeepAudioPref(true);
ok((await A.putAudio('rec2', file(10))) === true, 'switched back on, storing works again');

// ---- putEnvelope / putAlign add to a stored recording
ok((await A.putEnvelope('rec1', { peaks: [9] })) === true && (await A.getAudio('rec1')).env.peaks[0] === 9, 'an envelope can be added or replaced later');
ok((await A.putAlign('rec1', { words: 3 })) === true && (await A.getAudio('rec1')).align.words === 3, 'word timings can be added too');
ok((await A.getAudio('rec1')).env.peaks[0] === 9 && (await A.getAudio('rec1')).size === 2000, '…and each addition keeps what was already there');
ok((await A.putEnvelope('missing', { a: 1 })) === false && (await A.putAlign('missing', { a: 1 })) === false, 'nothing can be added to a recording that is not stored');
ok((await A.putEnvelope('rec1', null)) === false && (await A.putAlign('', { a: 1 })) === false, 'a missing envelope, timing or key is refused');

// ---- rekeyAudio: a parked recording becomes a saved one
await A.putAudio(A.PENDING_AUDIO_KEY, file(300, 'parked.wav', 'audio/wav'));
ok((await A.rekeyAudio(A.PENDING_AUDIO_KEY, 'saved-id')) === true, 'a parked recording can be moved to the saved recording\'s id');
ok((await A.hasAudio('saved-id')) && !(await A.hasAudio(A.PENDING_AUDIO_KEY)) && (await A.getAudio('saved-id')).name === 'parked.wav', '…it is under the new key, gone from the old one, and unchanged');
ok((await A.rekeyAudio('nothing-here', 'x')) === false && (await A.rekeyAudio('', 'x')) === false && (await A.rekeyAudio('x', '')) === false, 'moving something that is not there, or with a blank key, does nothing');

// ---- audioStorageInfo
await A.putAudio(A.PENDING_AUDIO_KEY, file(100));
const info = await A.audioStorageInfo();
ok(info.available === true && info.count === 4 && info.bytes === 2000 + 5 + 10 + 300 + 100, 'storage info counts saved recordings and every byte, but not the parked one in the count');
ok(info.quota.usage === 5 && info.quota.quota === 100, '…and passes on the browser\'s own quota estimate');
const noEstimate = globalThis.navigator;
setNavigator({});
ok((await A.audioStorageInfo()).quota === null, 'a browser with no storage estimate reports quota null');
setNavigator(noEstimate);

// ---- deleteAudio / clearAllAudio
await A.deleteAudio('rec1');
ok(!(await A.hasAudio('rec1')) && (await A.hasAudio('saved-id')), 'one recording can be deleted without touching the others');
await A.deleteAudio(['saved-id', '7', '', null, 'never-existed']);
ok(!(await A.hasAudio('saved-id')) && !(await A.hasAudio('7')), 'several can be deleted in one go; blanks and unknown keys are ignored');
await A.deleteAudio([]);
await A.deleteAudio(undefined);
ok(true, 'deleting nothing is fine');
await A.clearAllAudio();
ok(data.size === 0 && (await A.audioStorageInfo()).count === 0, 'clearing removes everything');

// ---- failures are quiet
failNext = true;
ok((await A.putAudio('rec9', file(10))) === false, 'a transaction that cannot start makes putAudio say false instead of throwing');
failNext = true;
ok((await A.getAudio('rec9')) === null, '…and getAudio say null');

console.log(`\n${pass} checks passed`);
