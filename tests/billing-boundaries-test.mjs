// lib/billing.js display helpers at their boundaries: allowance labels, usage text, durations and usage level.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const B = await import(new URL('../src/lib/billing.js', import.meta.url).href);

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

eq(B.allowanceLabel(1800), '30 minutes', 'under two hours is shown in minutes');
eq(B.allowanceLabel(7199), '120 minutes', 'just under two hours still uses minutes');
eq(B.allowanceLabel(7200), '2 hours', 'two hours switches to hours');
eq(B.allowanceLabel(9000), '2.5 hours', 'hours keep one decimal');
eq(B.usageText(0, 1800), '0 / 30 min', 'unused small plan');
eq(B.usageText(30, 3600), '1 / 60 min', 'a few seconds used shows as 1 minute, never 0');
eq(B.usageText(3599, 3600), '59 / 60 min', 'a few seconds left never shows as 60 / 60');
eq(B.usageText(-50, 3600), '0 / 60 min', 'negative usage is clamped to 0');
eq(B.usageText(99999, 3600), '60 / 60 min', 'usage over the allowance is capped at the total');
eq(B.usageText(29520, 72000), '8.2 / 20 hr', 'big plans show hours');
eq(B.usageParts(0, 7200).unitLong, 'hours', 'a 2-hour plan counts in hours');
eq(B.usageParts(0, 7199).unitLong, 'minutes', 'just below 2 hours counts in minutes');
eq(B.durationText(0), '0 minutes', 'zero seconds');
eq(B.durationText(-5), '0 minutes', 'negative seconds are zero');
eq(B.durationText(30), 'less than a minute', 'under a minute');
eq(B.durationText(60), '1 minute', 'one minute is singular');
eq(B.durationText(3600), '1 hour', 'one hour is singular');
eq(B.durationText(3900), '1 hour 5 minutes', 'hours and minutes together');
eq(B.durationText(7200 + 120), '2 hours 2 minutes', 'plural hours and minutes');
eq(B.usageLevel(0, 0), 'ok', 'no allowance does not divide by zero');
eq(B.usageLevel(79, 100), 'ok', '79% is calm');
eq(B.usageLevel(80, 100), 'warn', '80% warns');
eq(B.usageLevel(94, 100), 'warn', '94% still warns');
eq(B.usageLevel(95, 100), 'high', '95% is high');
eq(B.usageLevel(200, 100), 'high', 'over the allowance is high');
eq(B.can({ features: ['a'] }, 'a'), true, 'can: feature present');
eq(B.can(null, 'a'), false, 'can: no plan means no');
eq(B.planWith([{ features: ['x'] }, { features: ['a'], name: 'B' }], 'a').name, 'B', 'planWith finds the first plan with the capability');
eq(B.planWith([{ features: null }], 'a'), null, 'planWith returns null when nobody has it');
console.log(`${pass} checks passed`);
