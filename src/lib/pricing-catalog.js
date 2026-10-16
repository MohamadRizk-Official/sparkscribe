// The PROPOSED four-plan lineup (Free, Flash, Bolt, Thunder), for the pricing design preview only.
//
// This is presentation data. Nothing on the server reads it: what a user is entitled to and what Checkout charges
// still come from the database (billing_plans) and the server's Stripe price IDs. The pricing page uses it only in
// a build made with VITE_PRICING_PREVIEW=1 (a Vercel Preview), and a production build refuses that flag
// (vite.config.js), so these prices can never be shown on, or bought from, the live site by accident.
// Phase 2 moves the approved lineup into billing_plans; this file then goes away.

export const PREVIEW_PLANS = Object.freeze([
  { key: 'free', name: 'Free', price_cents: 0, monthly_seconds: 30 * 60 },
  // $1 for the first monthly period only, then $5.99 every month (enforced server-side in Phase 3, never by the browser)
  { key: 'flash', name: 'Flash', price_cents: 599, intro: { price_cents: 100, months: 1 }, monthly_seconds: 3 * 3600 },
  { key: 'bolt', name: 'Bolt', price_cents: 999, monthly_seconds: 9 * 3600 },
  { key: 'thunder', name: 'Thunder', price_cents: 1499, monthly_seconds: 20 * 3600 },
].map((p) => Object.freeze({ currency: 'usd', billing_interval: p.price_cents ? 'month' : null, ...p })));

// $1, $5.99, $0 (whole dollars without cents)
export const money = (cents) => (cents % 100 ? `$${(cents / 100).toFixed(2)}` : `$${cents / 100}`);

// 1800 -> {num: "30", unit: "min", long: "30 minutes"}, 32400 -> {num: "9", unit: "hours", long: "9 hours"}
export function allowance(seconds) {
  if (seconds < 3600) { const m = Math.round(seconds / 60); return { num: String(m), unit: 'min', long: `${m} minutes` }; }
  const h = Math.round((seconds / 3600) * 10) / 10;
  return { num: String(h), unit: h === 1 ? 'hour' : 'hours', long: `${h} hour${h === 1 ? '' : 's'}` };
}

// how many times the allowance of `a` is that of `b`: "3×"
export const times = (a, b) => `${Math.round((a.monthly_seconds / b.monthly_seconds) * 10) / 10}×`;

// regular monthly price per hour of transcription ("$1.11"). Always the regular price: the $1 first month is never
// used as a reference point.
export const perHour = (p) => (p.price_cents ? `$${(p.price_cents / (p.monthly_seconds / 3600) / 100).toFixed(2)}` : null);

// regular price difference between two paid plans: "$4"
export const priceGap = (a, b) => money(Math.abs(a.price_cents - b.price_cents));

// The price as the customer must see it: the first-month price and the renewal price together, never one alone.
export function priceLines(p) {
  if (!p.price_cents) return { amount: '$0', per: '/month', note: 'No card needed', renewal: null };
  if (p.intro) {
    return {
      amount: money(p.intro.price_cents), per: 'first month',
      note: `Then ${money(p.price_cents)}/month`,
      renewal: `${money(p.intro.price_cents)} for your first month, then ${money(p.price_cents)}/month until you cancel.`,
    };
  }
  return { amount: money(p.price_cents), per: '/month', note: null, renewal: `Renews at ${money(p.price_cents)}/month until you cancel.` };
}
