# Hosting SparkScribe on Cloudflare Workers (evaluated alternative to Vercel)

SparkScribe runs on Vercel today. Vercel's Hobby plan is for non-commercial use only, so a paid launch needs either
Vercel Pro or another host. This folder is a working proof that the same code runs on Cloudflare Workers.

## What was proven (2026-10-15, wrangler 4.40.0 / workerd, locally)
`worker.mjs` serves the Vite build as static assets and runs the **unchanged** API handlers (`api/*.js`) through a small
req/res adapter.

| Check | Result |
|---|---|
| Static pages with clean URLs (`/`, `/pricing`, `/library`, `/privacy`), robots.txt, 404 | pass |
| `/api/billing`, `/api/insights`, `/api/ask` refuse signed-out calls; a bad token is checked against Supabase from the Worker | pass |
| Stripe webhook: valid signature accepted, wrong secret and tampered body refused (Web Crypto; `constructEventAsync`, which Vercel uses too) | pass |
| Server-sent events (Ask) stream as they are written (0.03 s, 0.72 s, 1.44 s, not buffered) | pass |
| Long AI requests (Create tools wait up to ~5 min) | supported: waiting on the network doesn't count toward CPU time (Workers Paid: 30 s CPU by default, up to 5 min) |

## What a move would still need
1. **Two files over Workers' 25 MiB per-asset limit:** `ffmpeg-core.wasm` (30.7 MiB, the audio converter) and the ONNX
   runtime wasm (26.2 MiB; at runtime the app loads it from jsDelivr anyway). Serve the converter from Cloudflare R2
   (free tier: 10 GB, no egress fees) or a pinned jsDelivr URL, and drop the unused ORT file from the asset upload.
2. **DNS on Cloudflare:** a Worker can only serve a custom domain whose DNS is hosted by Cloudflare, so the nameservers
   for spark-scribe.com would move from Squarespace to Cloudflare (free). The domain stays registered at Squarespace.
   Today the zone has only the web records and SPF/DMARC TXT, so moving it is simple; email records must be copied
   in the same step.
3. `_headers` for the security headers and CSP (from vercel.json), Workers Builds or a GitHub Action for deploys and
   per-branch previews, secrets set with `wrangler secret put`, and `APP_URL` / a `DEPLOY_ORIGIN` for the server.
4. Stripe webhook URL unchanged (same domain); Supabase auth URLs unchanged.

Estimated effort: about one working day, plus a monitored cutover. Rollback: point the DNS records back at Vercel.

## Local run
```
npx vite build
npx wrangler@4.40.0 dev --config cloudflare/wrangler.toml --env-file <file with the server variables>
```
(Exclude the two oversized wasm files from the assets directory first, or the run stops with "Asset too large".)
