// SEO at build time (vite.config.js "sparkscribe-seo"). One place for what search engines and link previews read:
//   • plans: read from the database migrations (the same source tests/pricing-catalog-test.mjs checks), never typed
//     here, so the static pricing summary and the structured data can't drift from the real prices
//   • social tags for every indexable page: og:* filled from the page's own title / description / canonical, the
//     1200×630 image, and an X large card
//   • JSON-LD: Organization + WebSite + WebApplication (with the real offers) on Home and Pricing. No ratings,
//     reviews or counts: none exist yet, and Google forbids inventing them.
//   • Pricing: a plain summary of the four plans inside the cards' placeholder, so a crawler that doesn't run
//     JavaScript sees the plans and prices the page shows (pricing.js replaces it with the full cards)
// Private pages (meta robots noindex) are left untouched.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SITE = 'https://www.spark-scribe.com';
export const OG_IMAGE = `${SITE}/og-image.png`;
const ROOT = resolve(import.meta.dirname, '..');
const migration = (f) => readFileSync(resolve(ROOT, 'supabase/migrations', f), 'utf8');

const FEATURE = { focused_review: 'Focused Review', across_ask: 'Ask across recordings', across_guide: 'Combined study guides' };

// -> [{ key, name, price, yearly, intro, seconds, features }] in tier order (cents, seconds)
export function plansFromMigrations() {
  const four = migration('20261016100000_four_tier.sql');
  const yearly = migration('20261017300000_yearly_billing.sql');
  const free = /update public\.billing_plans set tier = 0, features = '\{\}', monthly_seconds = (\d+)/.exec(four);
  if (!free) throw new Error('seo: Free plan not found in the four-tier migration');
  const plans = [{ key: 'free', name: 'Free', price: 0, yearly: null, intro: null, seconds: Number(free[1]), features: [] }];
  const row = /\('(flash|bolt|thunder)',\s*'(\w+)',\s*'[^']*',\s*(\d+),\s*'usd',\s*'month',\s*(\d+),\s*\d+,\s*\w+,\s*\w+,\s*\d+,\s*'\{([^}]*)\}',\s*(\w+),\s*(\w+)\)/g;
  for (const m of four.matchAll(row)) {
    const y = new RegExp(`when '${m[1]}' then (\\d+)`).exec(yearly);
    plans.push({ key: m[1], name: m[2], price: Number(m[3]), seconds: Number(m[4]), features: m[5] ? m[5].split(',') : [],
      intro: m[6] === 'null' ? null : { price: Number(m[6]), months: Number(m[7]) }, yearly: y ? Number(y[1]) : null });
  }
  if (plans.length !== 4) throw new Error(`seo: expected 4 plans in the migrations, found ${plans.length}`);
  return plans;
}

const usd = (c) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
const hours = (s) => (s < 3600 ? `${Math.round(s / 60)} minutes` : `${s / 3600} hours`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function planLine(p) {
  const price = p.price ? (p.intro ? `$${usd(p.intro.price)} for the first month for new subscribers, then $${usd(p.price)} a month` : `$${usd(p.price)} a month`) : '$0';
  const year = p.yearly ? `, or $${usd(p.yearly)} a year` : '';
  const extra = p.features.filter((f) => FEATURE[f]).map((f) => FEATURE[f]);
  return { price: price + year, time: `${hours(p.seconds)} of transcription a month`, extra };
}

// the four plans, readable without JavaScript (inside #plans; replaced by the full cards)
export function pricingStatic(plans = plansFromMigrations()) {
  return plans.map((p, i) => {
    const l = planLine(p);
    const prev = plans[i - 1];
    const added = l.extra.filter((f) => !prev || !planLine(prev).extra.includes(f));
    const what = p.key === 'free' ? 'Summaries, notes, Ask, flashcards and quizzes' : added.length ? `Everything in ${prev.name}, plus ${added.join(' and ')}` : 'The full AI study workspace';
    return `<article class="pz-card skel pz-static"><h2>${esc(p.name)}</h2><p>${esc(l.price)}</p><p>${esc(l.time)}</p><p>${esc(what)}</p></article>`;
  }).join('');
}

function offers(plans) {
  const out = [];
  for (const p of plans) {
    out.push({ '@type': 'Offer', name: `${p.name}${p.price ? ' (monthly)' : ''}`, price: usd(p.price), priceCurrency: 'USD', description: `${hours(p.seconds)} of transcription a month`, url: `${SITE}/pricing` });
    if (p.yearly) out.push({ '@type': 'Offer', name: `${p.name} (yearly)`, price: usd(p.yearly), priceCurrency: 'USD', description: `${hours(p.seconds)} of transcription a month, billed yearly`, url: `${SITE}/pricing` });
  }
  return out;
}

export function jsonLd(page, plans = plansFromMigrations()) {
  const org = { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'SparkScribe', legalName: 'HRstudios LLC', url: `${SITE}/`, logo: `${SITE}/favicon.svg`, email: 'contact.hrstudios@gmail.com' };
  const site = { '@type': 'WebSite', '@id': `${SITE}/#website`, name: 'SparkScribe', url: `${SITE}/`, publisher: { '@id': `${SITE}/#org` }, inLanguage: 'en' };
  const app = {
    '@type': 'WebApplication', '@id': `${SITE}/#app`, name: 'SparkScribe', url: `${SITE}/`, applicationCategory: 'EducationalApplication', operatingSystem: 'Any (web browser)',
    description: 'Turns lecture recordings into transcripts, notes, flashcards, practice quizzes and study guides. Audio is transcribed in the browser; AI study tools use the transcript text.',
    publisher: { '@id': `${SITE}/#org` }, offers: offers(plans),
  };
  if (page === 'index') return { '@context': 'https://schema.org', '@graph': [org, site, app] };
  if (page === 'pricing') return { '@context': 'https://schema.org', '@graph': [org, app] };
  return null;
}

const has = (html, re) => re.test(html);
const attr = (html, re) => (re.exec(html) || [])[1];

// head additions for one page; `name` is the page file without .html
export function seoHead(html, name) {
  if (has(html, /<meta name="robots" content="[^"]*noindex/)) return html;
  const title = attr(html, /<title>([^<]*)<\/title>/);
  const desc = attr(html, /<meta name="description" content="([^"]*)"/);
  const canon = attr(html, /<link rel="canonical" href="([^"]*)"/);
  if (!title || !desc || !canon) return html; // only pages that declare themselves fully
  const tags = [];
  const og = (p, v) => { if (!has(html, new RegExp(`property="og:${p}"`))) tags.push(`<meta property="og:${p}" content="${v}" />`); };
  og('type', 'website'); og('site_name', 'SparkScribe'); og('url', canon); og('title', title); og('description', desc);
  tags.push(`<meta property="og:image" content="${OG_IMAGE}" />`, '<meta property="og:image:width" content="1200" />', '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="SparkScribe: turn lectures into notes, flashcards and quizzes" />', '<meta property="og:locale" content="en_US" />');
  html = html.replace(/\s*<meta name="twitter:card" content="[^"]*" \/>/, '');
  tags.push('<meta name="twitter:card" content="summary_large_image" />', `<meta name="twitter:image" content="${OG_IMAGE}" />`);
  if (!has(html, /name="twitter:title"/)) tags.push(`<meta name="twitter:title" content="${title}" />`);
  if (!has(html, /name="twitter:description"/)) tags.push(`<meta name="twitter:description" content="${desc}" />`);
  const ld = jsonLd(name);
  if (ld) tags.push(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
  return html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`);
}

// the pricing page's description, from the plans (one line a result can show)
export function pricingDescription(plans = plansFromMigrations()) {
  const [free, flash, bolt, thunder] = plans;
  const short = (s) => (s < 3600 ? `${Math.round(s / 60)} min` : `${s / 3600} h`);
  return `SparkScribe plans: Free (${short(free.seconds)} a month), Flash $${usd(flash.price)}${flash.intro ? ` ($${usd(flash.intro.price)} first month)` : ''}, Bolt $${usd(bolt.price)} with Focused Review, Thunder $${usd(thunder.price)} across recordings. Monthly or yearly.`;
}
