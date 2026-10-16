// How plans and prices are written on the page (pricing, account). Formatting only: the plans themselves (prices,
// allowances, introductory prices, what each includes) come from the database (billing_plans, lib/billing.js
// loadPlans), the same rows the server uses; what Checkout charges is decided by the server and Stripe.

// a billing_plans row -> the page's plan: features always a list, the introductory price as { price_cents, months }
export const planFromRow = (r) => ({ ...r, features: r.features || [], intro: r.intro_price_cents != null ? { price_cents: r.intro_price_cents, months: r.intro_months || 1 } : null });

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
