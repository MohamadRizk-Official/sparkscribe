// Cloudflare Workers entry point (evaluated as an alternative to Vercel; see cloudflare/README.md).
// Static files come from the Vite build (dist/, served by Workers Static Assets). /api/* runs the SAME handlers as
// on Vercel (api/*.js): each fetch Request is presented to them as the small Node req/res they use (method, url,
// headers, body stream; statusCode, setHeader, write, end, flushHeaders). Streaming (Ask's server-sent events) passes
// straight through. Requires the nodejs_compat flag (Buffer, process.env, node:fs import).
import ask from '../api/ask.js';
import insights from '../api/insights.js';
import tools from '../api/tools.js';
import billing from '../api/billing.js';
import stripeWebhook from '../api/stripe-webhook.js';

const ROUTES = { '/api/ask': ask, '/api/insights': insights, '/api/tools': tools, '/api/billing': billing, '/api/stripe-webhook': stripeWebhook };

function nodeRequest(request, url) {
  const headers = {};
  for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    body: undefined, // handlers read the stream themselves (raw bytes matter for Stripe signatures)
    async *[Symbol.asyncIterator]() {
      if (!request.body) return;
      const reader = request.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield Buffer.from(value);
      }
    },
  };
}

export function runHandler(handler, request, url, ctx) {
  return new Promise((resolve) => {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const headers = new Headers();
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      resolve(new Response(readable, { status: res.statusCode || 200, headers }));
    };
    const res = {
      statusCode: 200,
      setHeader(k, v) { headers.set(k, Array.isArray(v) ? v.join(', ') : String(v)); },
      getHeader(k) { return headers.get(k); },
      flushHeaders() { commit(); },
      write(chunk) { commit(); writer.write(typeof chunk === 'string' ? enc.encode(chunk) : chunk); return true; },
      end(chunk) { if (chunk != null) this.write(chunk); else commit(); writer.close(); },
    };
    const done = Promise.resolve()
      .then(() => handler(nodeRequest(request, url), res))
      .catch((err) => {
        console.error('[worker] handler failed:', err?.name || 'Error');
        if (!committed) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'server_error' })); }
        else writer.close().catch(() => {});
      });
    ctx.waitUntil(done); // a streamed answer keeps running after the response has started
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = ROUTES[url.pathname];
    if (!handler) return env.ASSETS.fetch(request);
    // the handlers read their configuration from process.env, as on Vercel
    for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && process.env[k] === undefined) process.env[k] = v;
    return runHandler(handler, request, url, ctx);
  },
};
