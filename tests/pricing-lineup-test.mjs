// The four-tier lineup from docs/PROJECT-CONTEXT.md run through the price formatting helpers (src/lib/pricing-catalog.js):
// Free 30 min; Flash $5.99/mo ($1 first month) 3 h; Bolt $9.99 9 h; Thunder $14.99 20 h; yearly $59 / $99 / $149.
// The plan rows here are test data in the shape of billing_plans rows, not a copy of the live database.
import assert from 'node:assert/strict';
const P = await import(new URL('../src/lib/pricing-catalog.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const row = (key, tier, price, yearly, hours, extra = {}) => P.planFromRow({ key, tier, price_cents: price, yearly_price_cents: yearly, monthly_seconds: hours * 3600, billing_interval: price ? 'month' : null, ...extra });
const free = row('free', 0, 0, null, 0.5);
const flash = row('flash', 1, 599, 5900, 3, { intro_price_cents: 100, intro_months: 1 });
const bolt = row('bolt', 2, 999, 9900, 9);
const thunder = row('thunder', 3, 1499, 14900, 20);

// ---- money and allowance
ok(P.money(0) === '$0' && P.money(100) === '$1' && P.money(599) === '$5.99' && P.money(1499) === '$14.99', 'money writes whole dollars without cents');
ok(P.allowance(1800).long === '30 minutes' && P.allowance(1800).unit === 'min', 'Free is 30 minutes');
ok(P.allowance(3 * 3600).long === '3 hours' && P.allowance(9 * 3600).num === '9', 'Flash and Bolt are in hours');
ok(P.allowance(3600).long === '1 hour' && P.allowance(3600).unit === 'hour', 'one hour is singular');
ok(P.allowance(5400).long === '1.5 hours', 'one and a half hours keeps the decimal');

// ---- rows become page plans
ok(Array.isArray(free.features) && free.intro === null, 'a row without features gets an empty list and no intro');
ok(flash.intro.price_cents === 100 && flash.intro.months === 1, 'Flash has the $1 first month');
ok(P.planFromRow({ intro_price_cents: 100 }).intro.months === 1, 'an intro with no month count means one month');

// ---- what the customer sees
const f = P.priceLines(flash);
ok(f.amount === '$1' && f.per === 'first month' && f.note === 'Then $5.99/month', 'Flash shows the first-month price and the renewal price together');
ok(/\$1 for your first month, then \$5\.99\/month until you cancel/.test(f.renewal), 'the renewal sentence names both prices');
ok(P.priceLines(bolt).amount === '$9.99' && P.priceLines(bolt).renewal === 'Renews at $9.99/month until you cancel.', 'a plan with no intro shows its regular price');
ok(P.priceLines(free).amount === '$0' && P.priceLines(free).renewal === null, 'Free has no renewal line');

// ---- comparisons use the regular price, never the $1 month
ok(P.perHour(flash) === '$2.00' && P.perHour(bolt) === '$1.11' && P.perHour(thunder) === '$0.75', 'price per hour: $2.00, $1.11, $0.75');
ok(P.perHour(free) === null, 'Free has no price per hour');
ok(P.times(thunder, flash) === '6.7×' && P.times(bolt, flash) === '3×', 'allowance ratios');
ok(P.priceGap(bolt, flash) === '$4' && P.priceGap(flash, bolt) === '$4', 'the gap between Flash and Bolt is $4 either way round');

// ---- yearly
ok(P.hasYearly(flash) && P.hasYearly(bolt) && P.hasYearly(thunder), 'the paid plans can be billed yearly');
ok(!P.hasYearly(free) && !P.hasYearly(null), 'Free and a missing plan cannot');
ok(P.yearlySavings(flash) === 599 * 12 - 5900 && P.yearlySavings(bolt) === 999 * 12 - 9900 && P.yearlySavings(thunder) === 1499 * 12 - 14900, 'yearly savings are measured against 12 regular months');
ok(P.yearlySavingsPct(flash) === 18 && P.yearlySavingsPct(bolt) === 17 && P.yearlySavingsPct(thunder) === 17, 'savings are about 17–18%');
ok(P.yearlySavings(free) === 0 && P.yearlySavingsPct(free) === 0, 'Free saves nothing');
ok(P.perMonthOfYearly(flash) === '$4.92' && P.perMonthOfYearly(bolt) === '$8.25' && P.perMonthOfYearly(thunder) === '$12.42', 'the monthly equivalent is rounded up to the cent');
const y = P.yearlyPriceLines(flash);
ok(y.amount === '$59' && y.per === '/year' && y.note === '$4.92/month, billed yearly', 'the yearly price block');
ok(!/\$1\b(?!\d)/.test(y.renewal) && /renew every month/.test(y.renewal), 'a yearly price never mentions the $1 month and says the time renews monthly');

console.log(`\n${pass} checks passed`);
