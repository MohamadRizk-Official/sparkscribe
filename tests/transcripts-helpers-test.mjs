// Transcript helpers (src/lib/transcripts.js): duration text, language names, the .txt parser and the "sign in to save" stash.
// Loaded through tests/vite-env-hook.mjs; localStorage is an in-memory stand-in and IndexedDB is absent (as in a blocking browser).
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const T = await import(new URL('../src/lib/transcripts.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- fmtDuration
ok(T.fmtDuration(null) === '—' && T.fmtDuration(undefined) === '—', 'no duration shows a dash');
ok(T.fmtDuration(0) === '0:00', 'zero is 0:00');
ok(T.fmtDuration(5) === '0:05', 'seconds are zero padded');
ok(T.fmtDuration(65) === '1:05', 'minutes and seconds');
ok(T.fmtDuration(3599) === '59:59', 'just under an hour has no hours part');
ok(T.fmtDuration(3600) === '1:00:00', 'an hour shows h:mm:ss');
ok(T.fmtDuration(3725.4) === '1:02:05', 'fractions are rounded to the nearest second');
ok(T.fmtDuration(-30) === '0:00', 'negative values are clamped to zero');
ok(T.fmtDuration(36000) === '10:00:00', 'ten hours');

// ---- langName
ok(T.langName('') === '' && T.langName(null) === '' && T.langName(undefined) === '', 'no code, no name');
ok(T.langName('en') === 'English', 'en is English');
ok(T.langName('fr') === 'French', 'fr is French');
ok(T.langName('not a code!') === 'not a code!', 'an invalid code is returned as it is');

// ---- parseTranscriptText: the same shape the .txt export writes
const text = 'lecture.mp3\nLength: 1:00 · Speakers: 2\n\n[0:14] Speaker 1:\nHello there.\nSecond line.\n\n[0:31] Speaker 2:\nHi!\n\n[1:02:03] Dr. Lee:\nBack again.';
const g = T.parseTranscriptText(text);
ok(g.length === 3, 'three speaker turns');
ok(g[0].time === '0:14' && g[0].speaker === 'Speaker 1' && g[0].text === 'Hello there. Second line.', 'lines of one turn are joined with a space');
ok(g[1].time === '0:31' && g[1].text === 'Hi!', 'the next turn starts at the next timestamp');
ok(g[2].time === '1:02:03' && g[2].speaker === 'Dr. Lee', 'hour timestamps and speaker names with punctuation work');
ok(T.parseTranscriptText('title\nLength: 0:10\n').length === 0, 'text before the first timestamp is ignored');
ok(T.parseTranscriptText('').length === 0 && T.parseTranscriptText(null).length === 0 && T.parseTranscriptText(undefined).length === 0, 'empty input has no turns');
ok(T.parseTranscriptText('[0:01] A:\r\nwindows\r\nline ends\r\n')[0].text === 'windows line ends', 'Windows line endings are handled');
ok(T.parseTranscriptText('[0:01] A:\n\n   \n[0:02] B:\nx').map((x) => x.text).join('|') === '|x', 'a turn with no text keeps an empty string');
ok(T.parseTranscriptText('[0:01] Name: with colon:\nx')[0].speaker === 'Name: with colon', 'a colon inside the name is allowed (only the final colon ends it)');
ok(T.parseTranscriptText('[00:01:5] A:\nx').length === 0, 'a malformed timestamp is not a turn');

// ---- the pending-save stash
ok(T.PENDING_KEY === 'sparkscribe.pendingSave', 'the stash key');
ok(T.peekPending() === null, 'nothing is stashed at first');
ok(T.stashPending({ title: 'Lecture 1', text: 'hello' }, 'user-1') === true, 'stashing works');
const p = T.peekPending();
ok(p.title === 'Lecture 1' && p.owner === 'user-1' && typeof p.at === 'number', 'the stash comes back with its owner and a time');
ok(T.stashPending({ title: 'No owner' }) === true && T.peekPending().owner === null, 'the owner defaults to null');
T.clearPending({ keepAudio: true });
ok(T.peekPending() === null && !store.has(T.PENDING_KEY), 'clearPending removes the stash');

// an old stash (over an hour) is discarded when read
store.set(T.PENDING_KEY, JSON.stringify({ title: 'Old', at: Date.now() - 61 * 60 * 1000 }));
ok(T.peekPending() === null && !store.has(T.PENDING_KEY), 'a stash older than an hour is dropped and removed');
store.set(T.PENDING_KEY, JSON.stringify({ title: 'Fresh', at: Date.now() - 59 * 60 * 1000 }));
ok(T.peekPending().title === 'Fresh', 'a stash under an hour old is still offered');
store.set(T.PENDING_KEY, '{not json');
ok(T.peekPending() === null, 'a corrupted stash reads as nothing');
store.set(T.PENDING_KEY, 'null');
ok(T.peekPending() === null, 'a stored null reads as nothing');

// storage that throws
globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
ok(T.stashPending({ a: 1 }) === false, 'stashing reports false when storage is blocked');
ok(T.peekPending() === null, 'peeking returns null when storage is blocked');
T.clearPending({ keepAudio: true });
ok(true, 'clearing does not throw when storage is blocked');
console.log(`${pass} checks passed`);
