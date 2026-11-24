// lib/pricing-catalog.js formatting: money, allowance, yearly savings and the two price-line shapes, on boundary inputs.
import assert from 'node:assert/strict';
import * as P from '../src/lib/pricing-catalog.js';

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

eq(P.money(0), '$0', 'zero cents is $0');
eq(P.money(100), '$1', 'whole dollars have no cents');
eq(P.money(599), '$5.99', 'cents are shown with two digits');
eq(P.money(1050), '$10.50', 'a trailing zero is kept');
eq(P.allowance(1800), { num: '30', unit: 'min', long: '30 minutes' }, '1800 s is 30 minutes');
eq(P.allowance(3600), { num: '1', unit: 'hour', long: '1 hour' }, 'exactly one hour is singular');
eq(P.allowance(5400), { num: '1.5', unit: 'hours', long: '1.5 hours' }, '90 minutes is 1.5 hours');
eq(P.allowance(72000), { num: '20', unit: 'hours', long: '20 hours' }, '72000 s is 20 hours');

const flash = { price_cents: 599, yearly_price_cents: 5900, billing_interval: 'month', monthly_seconds: 10800, features: [] };
eq(P.hasYearly(flash), true, 'a plan with an interval and a yearly price has yearly billing');
eq(P.hasYearly({ ...flash, yearly_price_cents: null }), false, 'no yearly price: no yearly billing');
eq(P.hasYearly({ ...flash, billing_interval: null }), false, 'no billing interval (Free): no yearly billing');
eq(P.hasYearly(null), false, 'null is not yearly');
eq(P.yearlySavings(flash), 599 * 12 - 5900, 'yearly savings are measured against 12 regular months');
eq(P.yearlySavings({ ...flash, yearly_price_cents: 99999 }), 0, 'a yearly price above 12 months never gives negative savings');
eq(P.yearlySavingsPct(flash), Math.round(((599 * 12 - 5900) / (599 * 12)) * 100), 'savings percent is rounded');
eq(P.yearlySavingsPct({ price_cents: 0 }), 0, 'a plan without yearly billing saves 0%');
eq(P.perMonthOfYearly(flash), '$4.92', 'the yearly price per month is rounded UP to the cent');
eq(P.perMonthOfYearly({ yearly_price_cents: 6000 }), '$5.00', 'an exact division stays exact');
eq(P.perHour({ price_cents: 0, monthly_seconds: 1800 }), null, 'Free has no per-hour price');
eq(P.perHour({ price_cents: 1000, monthly_seconds: 36000 }), '$1.00', 'per-hour price uses the regular monthly price');
eq(P.priceGap({ price_cents: 599 }, { price_cents: 999 }), '$4', 'the price gap is the same either way round');
eq(P.priceGap({ price_cents: 999 }, { price_cents: 599 }), '$4', 'the price gap is never negative');
eq(P.times({ monthly_seconds: 32400 }, { monthly_seconds: 10800 }), '3×', 'allowance ratio is shown as N×');
eq(P.times({ monthly_seconds: 72000 }, { monthly_seconds: 32400 }), '2.2×', 'the ratio is rounded to one decimal');

eq(P.priceLines({ price_cents: 0 }), { amount: '$0', per: '/month', note: 'No card needed', renewal: null }, 'Free price lines');
const withIntro = P.planFromRow({ price_cents: 599, intro_price_cents: 100, intro_months: null, features: null });
eq(withIntro.intro, { price_cents: 100, months: 1 }, 'an intro price with no months defaults to one month');
eq(withIntro.features, [], 'null features become an empty list');
eq(P.planFromRow({ price_cents: 999 }).intro, null, 'no intro price gives intro null');
eq(P.priceLines(withIntro).note, 'Then $5.99/month', 'an intro plan always shows the renewal price next to the first-month price');
eq(P.priceLines({ price_cents: 999, intro: null }).renewal, 'Renews at $9.99/month until you cancel.', 'a regular plan states its renewal');
eq(P.yearlyPriceLines(flash).amount + P.yearlyPriceLines(flash).per, '$59/year', 'yearly price lines show the yearly amount');
console.log(`${pass} checks passed`);
