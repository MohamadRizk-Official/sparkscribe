// fmtDate (src/lib/transcripts.js): the "date · time" line shown on a recording. The text depends on the machine's
// locale, so the checks look at its shape and at which parts of the instant it uses, not at exact wording.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { fmtDate } = await import(new URL('../src/lib/transcripts.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const local = new Date(2026, 2, 5, 14, 7); // 5 March 2026, 14:07 in this machine's own time zone
const text = fmtDate(local.toISOString());
ok(text.includes(' · '), 'the date and the time are separated by " · "');
const [date, time] = text.split(' · ');
ok(date === local.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), 'the first part is the short local date');
ok(time === local.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), 'the second part is the local time without seconds');
ok(/2026/.test(date) && /5/.test(date), 'the year and day of the month are in the date');
ok(/07/.test(time), 'minutes are always two digits');
ok(fmtDate(local.getTime()) === text, 'a timestamp in milliseconds gives the same text as its ISO string');
ok(fmtDate(local) === text, 'a Date object is accepted too');
const sameDayLater = fmtDate(new Date(2026, 2, 5, 23, 59).toISOString());
ok(sameDayLater.split(' · ')[0] === date && sameDayLater.split(' · ')[1] !== time, 'two times on one day share the date and differ in the time');
ok(/Invalid Date/.test(fmtDate('not a date')), 'an unreadable date is not hidden: it shows as Invalid Date (callers pass stored ISO strings)');

console.log(`\n${pass} checks passed`);
