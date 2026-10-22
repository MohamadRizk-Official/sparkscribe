// SEO guarantees (scripts/seo.mjs, public/robots.txt, public/sitemap.xml, the pages' <head>):
// every sitemap URL is a real, indexable page with its own canonical; private pages say noindex; the static plan
// summary, the pricing description and the structured data carry the prices in the migrations, never invented ones.
import { readFileSync } from 'node:fs';
import { plansFromMigrations, pricingStatic, pricingDescription, jsonLd, seoHead, SITE } from '../scripts/seo.mjs';

let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok' : 'NOT OK'} - ${m}`); if (!c) failed++; };
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fileOf = (path) => (path === '/' ? 'index.html' : `${path.slice(1)}.html`);

const plans = plansFromMigrations();
ok(plans.map((p) => `${p.key}:${p.price}:${p.yearly}:${p.seconds}`).join() === 'free:0:null:1800,flash:599:5900:10800,bolt:999:9900:32400,thunder:1499:14900:72000', 'plans read from the migrations: Free $0/30 min, Flash $5.99/$59/3 h, Bolt $9.99/$99/9 h, Thunder $14.99/$149/20 h');
ok(plans[1].intro?.price === 100 && plans[1].intro.months === 1, 'Flash introductory price: $1 for one month');

const st = pricingStatic(plans);
ok(['Free', 'Flash', 'Bolt', 'Thunder', '$5.99', '$9.99', '$14.99', '$59 a year', '30 minutes', '20 hours', 'Focused Review', 'Ask across recordings'].every((t) => st.includes(t)), 'the static plan summary names every plan, price and allowance');
ok(!/coming soon|no payment details/i.test(read('pricing.html')), 'the pricing HTML no longer says paid plans are coming soon');
ok(read('pricing.html').includes('<!-- sparkscribe:plans-static -->') && read('pricing.html').includes('__PRICING_DESCRIPTION__'), 'pricing.html takes its plan summary and description from the build');
ok(/\$5\.99/.test(pricingDescription(plans)) && pricingDescription(plans).length <= 160, 'pricing description from the plans, short enough for a result');

const offers = jsonLd('pricing', plans)['@graph'].find((n) => n['@type'] === 'WebApplication').offers;
ok(offers.length === 7 && offers.some((o) => o.name === 'Thunder (yearly)' && o.price === '149') && offers.some((o) => o.name === 'Bolt (monthly)' && o.price === '9.99'), 'structured data offers: the real monthly and yearly prices');
ok(!JSON.stringify(jsonLd('index', plans)).match(/aggregateRating|review|ratingValue/i), 'no ratings or reviews in the structured data');

// sitemap ↔ pages
const urls = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(urls.length >= 6 && urls.every((u) => u.startsWith(`${SITE}/`)), 'sitemap: canonical host only');
for (const u of urls) {
  const path = u.slice(SITE.length);
  const html = read(fileOf(path));
  ok(!/name="robots" content="[^"]*noindex/.test(html), `${path} is indexable`);
  ok(new RegExp(`<link rel="canonical" href="${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html), `${path} canonical is itself`);
  ok((html.match(/<link rel="canonical"/g) || []).length === 1, `${path} has exactly one canonical`);
}
const titles = urls.map((u) => (read(fileOf(u.slice(SITE.length))).match(/<title>([^<]*)<\/title>/) || [])[1]);
ok(new Set(titles).size === titles.length, 'every indexable page has its own title');
for (const f of ['library.html', 'transcript.html', 'settings.html', 'account.html', 'across.html', 'auth.html', 'auth/callback.html']) {
  ok(/name="robots" content="[^"]*noindex/.test(read(f)), `${f} is noindex`);
  ok(!urls.some((u) => fileOf(u.slice(SITE.length)) === f), `${f} is not in the sitemap`);
}
const vercel = JSON.parse(read('vercel.json'));
ok(vercel.headers.some((h) => /library\|transcript\|settings\|account\|across\|auth/.test(h.source) && h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value))), 'private routes also send X-Robots-Tag: noindex');
ok(/Sitemap: https:\/\/www\.spark-scribe\.com\/sitemap\.xml/.test(read('public/robots.txt')) && !/Disallow: \/\s*$/m.test(read('public/robots.txt')), 'robots.txt allows crawling and names the sitemap');

// social tags
const home = seoHead(read('index.html'), 'index');
ok(/property="og:image" content="https:\/\/www\.spark-scribe\.com\/og-image\.png"/.test(home) && /twitter:card" content="summary_large_image"/.test(home) && (home.match(/twitter:card/g) || []).length === 1, 'home: one large X card and the 1200×630 image');
ok(/application\/ld\+json/.test(home), 'home: structured data');
const priv = read('library.html');
ok(seoHead(priv, 'library') === priv, 'private pages get no social tags');

console.log(failed ? `${failed} FAILED` : 'all SEO checks passed');
process.exit(failed ? 1 : 0);
