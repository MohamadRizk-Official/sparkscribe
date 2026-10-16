// The proposed four-plan pricing (design preview): allowances, prices and the comparisons the page states.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREVIEW_PLANS, allowance, money, times, perHour, priceGap, priceLines } from '../src/lib/pricing-catalog.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const plan = Object.fromEntries(PREVIEW_PLANS.map((p) => [p.key, p]));

ok(PREVIEW_PLANS.map((p) => p.key).join() === 'free,flash,bolt,thunder', 'four plans, in order: Free, Flash, Bolt, Thunder');
ok(allowance(plan.free.monthly_seconds).long === '30 minutes', 'Free: 30 minutes a month');
ok(allowance(plan.flash.monthly_seconds).long === '3 hours', 'Flash: 3 hours a month');
ok(allowance(plan.bolt.monthly_seconds).long === '9 hours', 'Bolt: 9 hours a month (not 8)');
ok(allowance(plan.thunder.monthly_seconds).long === '20 hours', 'Thunder: 20 hours a month');
ok(money(plan.flash.price_cents) === '$5.99' && money(plan.bolt.price_cents) === '$9.99' && money(plan.thunder.price_cents) === '$14.99' && money(plan.free.price_cents) === '$0', 'prices: $0, $5.99, $9.99, $14.99');
ok(times(plan.bolt, plan.flash) === '3×', 'Bolt is exactly 3× Flash');
ok(priceGap(plan.bolt, plan.flash) === '$4', 'Bolt costs $4 more than Flash’s regular price (never compared with the $1 month)');
ok(perHour(plan.flash) === '$2.00' && perHour(plan.bolt) === '$1.11' && perHour(plan.thunder) === '$0.75' && perHour(plan.free) === null, 'cost per hour uses regular prices: $2.00, $1.11, $0.75');

const flash = priceLines(plan.flash);
ok(flash.amount === '$1' && flash.note === 'Then $5.99/month', 'Flash shows $1 with “Then $5.99/month” beside it');
ok(/\$1 for your first month, then \$5\.99\/month until you cancel/.test(flash.renewal), 'Flash renewal disclosure names both prices');
ok(plan.flash.intro.months === 1 && PREVIEW_PLANS.filter((p) => p.intro).length === 1, 'only Flash has an introductory price, for one month');
ok(priceLines(plan.bolt).renewal === 'Renews at $9.99/month until you cancel.' && priceLines(plan.free).renewal === null, 'every paid plan states its renewal; Free has none');
ok(Object.isFrozen(PREVIEW_PLANS) && PREVIEW_PLANS.every(Object.isFrozen), 'the preview catalogue can’t be modified at runtime');
ok(!/plus|pro\b/i.test(JSON.stringify(PREVIEW_PLANS)), 'no Plus/Pro left in the proposed lineup');

// isolation: the server never reads the preview catalogue, and production builds refuse the preview flag
const serverFiles = ['api/billing.js', 'server/billing/config.js', 'server/billing/service.js'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
ok(!/pricing-catalog|PREVIEW_PLANS/.test(serverFiles), 'the server never imports the preview catalogue');
const page = readFileSync(new URL('../src/pages/pricing.js', import.meta.url), 'utf8');
ok(/look\.planned && PREVIEW/.test(page) && /thunderPlanned = PREVIEW &&/.test(page) && /In development/.test(page), 'Thunder’s planned capability is shown only in the design preview, labelled “In development”');
const { default: config } = await import('../vite.config.js');
const guard = config({ mode: 'production' }).plugins.find((p) => p.name === 'pricing-preview-guard');
const runGuard = (env) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try { guard.buildStart.call({ error: (m) => { throw new Error(m); } }); return 'built'; } catch (e) { return e.message; } finally {
    for (const k of Object.keys(env)) if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
  }
};
ok(/Production build stopped: VITE_PRICING_PREVIEW=1/.test(runGuard({ VITE_PRICING_PREVIEW: '1', VERCEL_ENV: 'production' })), 'a production build with VITE_PRICING_PREVIEW=1 is refused');
ok(runGuard({ VITE_PRICING_PREVIEW: '1', VERCEL_ENV: 'preview' }) === 'built', 'a Vercel Preview build may show the proposed plans');
ok(runGuard({ VERCEL_ENV: 'production' }) === 'built', 'production builds without the flag are unaffected');
console.log(`\n${pass} checks passed`);
