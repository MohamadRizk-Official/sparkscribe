import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { BRAND_HTML, MARK_HTML, BRAND_FONT_LINK, LEGAL_HTML } from './src/lib/brand-markup.js';
import { THEME_BOOT } from './src/lib/theme.js';

// Server-only settings the /api functions read from process.env. Locally they come from .env.local;
// on Vercel from the project's Environment Variables. They are NOT in envPrefix, so they never reach the
// browser bundle.
const SERVER_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PLUS_PRICE_ID', 'STRIPE_PRO_PRICE_ID', 'STRIPE_PORTAL_CONFIGURATION_ID', 'BILLING_DB_SECRET', 'BILLING_PAYMENTS_ENABLED', 'APP_URL', 'ANTHROPIC_API_KEY', 'AI_PROVIDER', 'AI_USAGE_LOG', 'AI_MODEL', 'AI_MODEL_ASK', 'AI_MODEL_SUMMARY', 'AI_MODEL_INSIGHTS', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];

// Pages of the multi-page app. Vercel serves them at clean URLs (vercel.json "cleanUrls"),
// e.g. /library -> library.html; the dev-server plugin below does the same locally.
const pages = {
  main: 'index.html',
  auth: 'auth.html',
  authCallback: 'auth/callback.html',
  library: 'library.html',
  transcript: 'transcript.html',
  settings: 'settings.html',
  pricing: 'pricing.html',
  across: 'across.html',
  account: 'account.html',
  privacy: 'privacy.html',
  terms: 'terms.html',
};
const cleanRoutes = new Set(['/auth', '/auth/callback', '/library', '/transcript', '/settings', '/pricing', '/across', '/account', '/privacy', '/terms']);

export default defineConfig(({ mode }) => ({
  // The Supabase settings live in Vercel as NEXT_PUBLIC_* (public, browser-safe values).
  // Only these prefixes are ever exposed to the browser bundle.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  optimizeDeps: {
    // ffmpeg.wasm spawns its own worker; pre-bundling breaks that.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    rollupOptions: {
      // the accuracy lab (eval.html) is only built with `--mode eval`; it is never deployed
      input: Object.fromEntries(
        Object.entries(mode === 'eval' ? { ...pages, eval: 'eval.html' } : pages).map(([k, f]) => [k, resolve(import.meta.dirname, f)]),
      ),
    },
  },
  plugins: [
    {
      // Public sign-up must not launch with unfinished policies: a PRODUCTION build (Vercel production, or
      // REQUIRE_FINAL_LEGAL=1 locally) fails while /privacy or /terms is still a draft. Previews build normally.
      // Final pages come from `node scripts/build-legal.mjs --final`, which refuses while review notes remain.
      name: 'legal-final-guard',
      apply: 'build',
      buildStart() {
        if (process.env.VERCEL_ENV !== 'production' && process.env.REQUIRE_FINAL_LEGAL !== '1') return;
        const drafts = ['privacy.html', 'terms.html'].filter((f) => /legal-banner|legal-flag/.test(readFileSync(resolve(import.meta.dirname, f), 'utf8')));
        if (drafts.length) this.error(`Production build stopped: ${drafts.join(' and ')} ${drafts.length > 1 ? 'are' : 'is'} still a draft. Finish the text in docs/launch, then run "node scripts/build-legal.mjs --final".`);
      },
    },
    {
      // One brand for every page: <!-- sparkscribe:brand --> (header logo + wordmark) and
      // <!-- sparkscribe:mark --> (the mark alone) come from src/lib/brand-markup.js, plus the wordmark's font,
      // and the theme boot script (src/lib/theme.js) at the very top of <head> so the theme never flashes.
      name: 'sparkscribe-brand',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html
          .replace(/<head>/i, `<head>
    ${THEME_BOOT}`)
          .replace('<!-- sparkscribe:brand -->', BRAND_HTML)
          .replaceAll('<!-- sparkscribe:mark -->', MARK_HTML)
          .replace('<!-- sparkscribe:legal -->', LEGAL_HTML)
          .replace('</head>', `  ${BRAND_FONT_LINK}\n  </head>`),
      },
    },
    {
      // Runs the Vercel functions in api/ on the dev server, so `npm run dev` behaves like production.
      name: 'api-functions-dev',
      configureServer(server) {
        const env = loadEnv(mode, process.cwd(), '');
        for (const k of SERVER_ENV) if (env[k] && !process.env[k]) process.env[k] = env[k];
        server.middlewares.use(async (req, res, next) => {
          const m = /^\/api\/([a-z-]+)$/.exec(req.url.split('?')[0]);
          if (!m) return next();
          try {
            const mod = await server.ssrLoadModule(`/api/${m[1]}.js`);
            await mod.default(req, res);
          } catch (err) {
            if (err?.code === 'ERR_LOAD_URL' || /Failed to load url/.test(err?.message)) { res.statusCode = 404; return res.end(); }
            server.config.logger.error(`[api] ${m[1]}: ${err?.message || err}`);
            if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"server_error"}'); }
          }
        });
      },
    },
    {
      name: 'clean-urls-dev',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const [path, query] = req.url.split('?');
          if (cleanRoutes.has(path)) req.url = `${path}.html${query ? `?${query}` : ''}`;
          next();
        });
      },
    },
  ],
}));
