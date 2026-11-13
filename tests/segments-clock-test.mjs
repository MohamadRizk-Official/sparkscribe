// Clock helpers of src/lib/segments.js: parseClock ("1:02:03" -> seconds) and fmtClock (seconds -> "m:ss" / "h:mm:ss").
import assert from 'node:assert/strict';
const { parseClock, fmtClock } = await import(new URL('../src/lib/segments.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

ok(parseClock('0:14') === 14, 'parseClock reads m:ss');
ok(parseClock('1:02:03') === 3723, 'parseClock reads h:mm:ss');
ok(parseClock('45') === 45, 'a bare number is seconds');
ok(parseClock('abc') === 0, 'text that is not a clock parses to 0');
ok(parseClock('1:xx') === 0, 'one bad part makes the whole clock 0');

ok(fmtClock(0) === '0:00', 'fmtClock(0) is 0:00');
ok(fmtClock(14) === '0:14', 'seconds are zero-padded');
ok(fmtClock(61) === '1:01', 'minutes are not padded');
ok(fmtClock(600) === '10:00', 'ten minutes');
ok(fmtClock(3600) === '1:00:00', 'an hour switches to h:mm:ss');
ok(fmtClock(3723.9) === '1:02:03', 'fractions are floored, not rounded');
ok(fmtClock(-5) === '0:00', 'negative time clamps to 0:00');
ok(fmtClock(undefined) === '0:00' && fmtClock(NaN) === '0:00', 'missing or NaN time is 0:00');
ok(parseClock(fmtClock(5025)) === 5025, 'fmtClock and parseClock round-trip');

console.log(`${pass} checks passed`);
