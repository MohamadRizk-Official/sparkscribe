// The four-plan pricing as the page writes it: allowances, prices and the comparisons it states, computed from the
// same values the database holds (the migration that creates the plans is read here, so the two can't drift apart).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowance, money, times, perHour, priceGap, priceLines, planFromRow } from '../src/lib/pricing-catalog.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

// the plan rows exactly as supabase/migrations/20261016100000_four_tier.sql inserts them
const sql = readFileSync(new URL('../supabase/migrations/20261016100000_four_tier.sql', import.meta.url), 'utf8');
const rows = [...sql.matchAll(/\('(flash|bolt|thunder)',\s*'(\w+)',\s*'[^']*',\s*(\d+),\s*'usd',\s*'month',\s*(\d+),\s*\d+,\s*false,\s*false,\s*(\d),\s*'\{([^}]*)\}',\s*(null|\d+),\s*(null|\d+)\)/g)]
  .map((m) => planFromRow({ key: m[1], name: m[2], price_cents: Number(m[3]), billing_interval: 'month', monthly_seconds: Number(m[4]), tier: Number(m[5]), features: m[6] ? m[6].split(',') : [], intro_price_cents: m[7] === 'null' ? null : Number(m[7]), intro_months: m[8] === 'null' ? null : Number(m[8]) }));
const freeSeconds = Number(/set tier = 0, features = '\{\}', monthly_seconds = (\d+)/.exec(sql)[1]);
const plans = [planFromRow({ key: 'free', name: 'Free', price_cents: 0, billing_interval: null, monthly_seconds: freeSeconds, tier: 0, features: [], intro_price_cents: null }), ...rows];
const plan = Object.fromEntries(plans.map((p) => [p.key, p]));

ok(plans.map((p) => p.key).join() === 'free,flash,bolt,thunder', 'four plans, in order: Free, Flash, Bolt, Thunder');
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
ok(plan.flash.intro.months === 1 && plans.filter((p) => p.intro).length === 1, 'only Flash has an introductory price, for one month');
ok(priceLines({ ...plan.flash, intro: null }).amount === '$5.99', 'a customer not eligible for the offer sees the regular $5.99');
ok(priceLines(plan.bolt).renewal === 'Renews at $9.99/month until you cancel.' && priceLines(plan.free).renewal === null, 'every paid plan states its renewal; Free has none');
ok(plan.bolt.features.join() === 'focused_review,followup_practice' && plan.thunder.features.includes('across_ask') && plan.thunder.features.includes('across_guide') && !plan.flash.features.length, 'Bolt adds Focused Review; Thunder adds asking across recordings and combined guides');

// the page never hard-codes prices or plans
const page = readFileSync(new URL('../src/pages/pricing.js', import.meta.url), 'utf8');
ok(!/\b(599|999|1499|10800|32400|72000)\b/.test(page) && !/\$5\.99|\$9\.99|\$14\.99/.test(page), 'the pricing page states no price or allowance of its own: all come from the database');
ok(!/VITE_PRICING_PREVIEW|In development|PREVIEW_PLANS/.test(page), 'no design-preview switch or “in development” label is left');
const serverFiles = ['api/billing.js', 'server/billing/config.js', 'server/billing/service.js'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
ok(/not\('tier', 'is', null\)/.test(serverFiles) && !/'plus'|'pro'|PLUS_PRICE|PRO_PRICE/i.test(serverFiles), 'the server offers the four-tier lineup only (no Plus/Pro)');
console.log(`\n${pass} checks passed`);
