// What the browser shows about plans and usage (src/lib/billing.js): prices, allowance text, usage text and level,
// durations, reset dates, and the plan lookups. Display only; the server decides what a plan allows.
// Loaded through tests/vite-env-hook.mjs (Supabase reads as "not configured", so no data call is made).
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const B = await import(new URL('../src/lib/billing.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

// ---- price, perInterval
ok(B.price({ price_cents: 599 }) === '$5.99', 'a price is dollars and cents');
ok(B.price({ price_cents: 0 }) === '$0' && B.price({}) === '$0', 'no price is $0');
ok(B.price({ price_cents: 1000 }) === '$10.00', 'whole dollars keep their cents');
ok(B.perInterval({}) === '/month' && B.perInterval({ billing_interval: 'year' }) === '/year', 'the interval defaults to /month');

// ---- allowanceLabel: minutes up to two hours, hours from there
ok(B.allowanceLabel(1800) === '30 minutes', '30 minutes');
ok(B.allowanceLabel(3600) === '60 minutes', 'one hour is shown as 60 minutes');
ok(B.allowanceLabel(7199) === '120 minutes', 'just under two hours is still minutes');
ok(B.allowanceLabel(7200) === '2 hours', 'two hours');
ok(B.allowanceLabel(9 * 3600) === '9 hours', 'nine hours');
ok(B.allowanceLabel(9.5 * 3600) === '9.5 hours', 'half hours keep their decimal');

// ---- usageParts / usageText
eq(B.usageParts(41 * 60, 3600), { used: '41', total: '60', unit: 'min', unitLong: 'minutes' }, 'a small plan counts in minutes');
ok(B.usageText(41 * 60, 3600) === '41 / 60 min', '…as "41 / 60 min"');
ok(B.usageText(0, 3600) === '0 / 60 min', 'nothing used is 0');
ok(B.usageText(30, 3600) === '1 / 60 min', 'a few seconds used show as 1 minute, not 0');
ok(B.usageText(59 * 60 + 59, 3600) === '59 / 60 min', '59 minutes 59 seconds is still 59 (never "60 / 60" while time is left)');
ok(B.usageText(3600, 3600) === '60 / 60 min', 'all used is 60 / 60');
ok(B.usageText(99999, 3600) === '60 / 60 min', 'using more than the allowance is capped at the total');
ok(B.usageText(-50, 3600) === '0 / 60 min', 'a negative usage is 0');
ok(B.usageText(8.2 * 3600, 20 * 3600) === '8.2 / 20 hr', 'an hour plan counts in hours with one decimal');
ok(B.usageText(0, 7200) === '0 / 2 hr', 'two hours is the first plan counted in hours');
ok(B.usageParts(0, 7200).unitLong === 'hours', '…with the long unit "hours"');
ok(B.usageText(3 * 3600, 20 * 3600) === '3 / 20 hr', 'whole hours have no decimal');

// ---- durationText
ok(B.durationText(0) === '0 minutes', 'no time left');
ok(B.durationText(-5) === '0 minutes', 'negative time is none');
ok(B.durationText(1) === 'less than a minute' && B.durationText(59) === 'less than a minute', 'under a minute');
ok(B.durationText(60) === '1 minute', 'one minute is singular');
ok(B.durationText(8 * 60) === '8 minutes', 'minutes');
ok(B.durationText(3600) === '1 hour', 'one hour is singular');
ok(B.durationText(2 * 3600) === '2 hours', 'two hours');
ok(B.durationText(3600 + 5 * 60) === '1 hour 5 minutes', 'hours and minutes');
ok(B.durationText(2 * 3600 + 60) === '2 hours 1 minute', 'plural hours, singular minute');
ok(B.durationText(8 * 60 + 29) === '8 minutes', 'seconds are rounded to the nearest minute');
ok(B.durationText(8 * 60 + 31) === '9 minutes', '…up from half a minute');

// ---- dateText is in UTC
ok(B.dateText('2026-11-01T00:00:00Z') === 'November 1', 'a reset at 00:00 UTC is that day');
ok(B.dateText('2026-11-01T23:59:00Z') === 'November 1', '…and 23:59 UTC is still that day (never shifted by the viewer\'s time zone)');
ok(B.dateText('2026-12-31T12:00:00Z') === 'December 31', 'month and day, no year');

// ---- usageLevel: calm until it matters
ok(B.usageLevel(0, 100) === 'ok' && B.usageLevel(79, 100) === 'ok', 'under 80% is ok');
ok(B.usageLevel(80, 100) === 'warn' && B.usageLevel(94, 100) === 'warn', '80% to 94% is a warning');
ok(B.usageLevel(95, 100) === 'high' && B.usageLevel(200, 100) === 'high', '95% and over is high');
ok(B.usageLevel(10, 0) === 'ok' && B.usageLevel(0, 0) === 'ok', 'no allowance: ok (no division by zero)');

// ---- plan lookups
const plans = [{ key: 'free', features: [] }, { key: 'flash', features: ['study_tools'] }, { key: 'bolt', features: ['study_tools', 'across'] }, { key: 'thunder' }];
ok(B.planWith(plans, 'study_tools').key === 'flash', 'the lowest plan that includes a capability');
ok(B.planWith(plans, 'across').key === 'bolt', '…whichever plan first has it');
ok(B.planWith(plans, 'nothing') === null, 'no plan includes it: null');
ok(B.planWith([], 'x') === null, 'no plans: null');
ok(B.can(plans[1], 'study_tools') === true && B.can(plans[0], 'study_tools') === false, 'can() checks the plan\'s feature list');
ok(B.can(null, 'x') === false && B.can({}, 'x') === false, 'can() is false without a plan or features');

// ---- errors and loading without Supabase
const err = new B.BillingApiError('Nope', 'unauthorized', 401, { extra: 1 });
ok(err instanceof Error && err.message === 'Nope' && err.code === 'unauthorized' && err.status === 401 && err.extra === 1, 'BillingApiError carries message, code, status and extras');
eq(await B.loadPlans(), [], 'without Supabase there are no plans to list');

console.log(`${pass} checks passed`);
