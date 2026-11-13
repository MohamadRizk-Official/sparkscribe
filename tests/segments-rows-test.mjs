// segmentsFromRow in src/lib/segments.js: stored segments, and the paragraph fallback for older saves.
import assert from 'node:assert/strict';
const S = await import(new URL('../src/lib/segments.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const row = { segments: [{ s: 0, e: 4, sp: 'Dana', t: ' Hello. ', o: 'Speaker 1' }, { s: 4, e: 6, sp: 'Lee', t: 'Hi.' }] };
let r = S.segmentsFromRow(row);
ok(r.coarse === false && r.segments.length === 2, 'stored segments are fine-grained (coarse false)');
ok(r.segments[0].id === 0 && r.segments[1].id === 1, 'ids are line numbers starting at 0');
ok(r.segments[0].text === 'Hello.', 'text is trimmed');
ok(r.segments[0].orig === 'Speaker 1' && r.segments[1].orig === 'Lee', 'orig is o when present, else the speaker');

r = S.segmentsFromRow({ segments: [{ s: 'x', e: undefined, sp: '', t: 'ok' }, null, { s: 1, e: 2, sp: 'A', t: 5 }] });
ok(r.segments.length === 1, 'entries that are not objects with a string t are dropped');
ok(r.segments[0].start === 0 && r.segments[0].end === 0 && r.segments[0].speaker === 'Unknown', 'bad numbers become 0 and a blank speaker becomes Unknown');
r = S.segmentsFromRow({ segments: [{ s: 3, t: 'x', sp: 'A' }] });
ok(r.segments[0].end === 3, 'a missing end falls back to the start');

const text = '[0:00] Speaker 1:\nHello there.\nHow are you?\n\n[0:14] Speaker 2:\nFine.\n\n[1:05] Speaker 1:\nGood.';
r = S.segmentsFromRow({ transcript_text: text, duration_seconds: 90 });
ok(r.coarse === true && r.segments.length === 3, 'older saves are rebuilt from the paragraphs of transcript_text (coarse true)');
ok(r.segments[0].text === 'Hello there. How are you?', 'lines of one paragraph are joined with a space');
ok(r.segments[1].start === 14 && r.segments[2].start === 65, 'paragraph clocks are parsed to seconds');
ok(r.segments[0].end === 14 && r.segments[1].end === 65, 'a paragraph ends where the next one starts');
ok(r.segments[2].end === 90, 'the last paragraph ends at duration_seconds');
r = S.segmentsFromRow({ transcript_text: '[2:00] Speaker 1:\nLast.' });
ok(r.segments[0].end === 120, 'without a duration the last paragraph ends at its own start');

for (const empty of [null, undefined, {}, { segments: [] }, { transcript_text: '' }]) {
  const e = S.segmentsFromRow(empty);
  ok(e.segments.length === 0 && e.coarse === true, `empty input ${JSON.stringify(empty)} gives no segments`);
}

console.log(`${pass} checks passed`);
