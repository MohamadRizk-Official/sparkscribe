// Small request/response helpers that work the same on Vercel Node functions and the Vite dev server.
import { createClient } from '@supabase/supabase-js';
import { AIError } from './ai/provider.js';
import { supabaseStore } from './db.js';

const MAX_BODY = 16 * 1024;

export async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    // the platform may have parsed the body already: the size limit and JSON errors still apply
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      if (JSON.stringify(req.body).length > MAX_BODY) throw new AIError('Request too large.', { status: 413, code: 'bad_request' });
      return req.body;
    }
    const text = String(req.body);
    if (text.length > MAX_BODY) throw new AIError('Request too large.', { status: 413, code: 'bad_request' });
    try { return text ? JSON.parse(text) : {}; } catch { throw new AIError('Invalid request.', { status: 400, code: 'bad_request' }); }
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new AIError('Request too large.', { status: 413, code: 'bad_request' });
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new AIError('Invalid request.', { status: 400, code: 'bad_request' }); }
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function sendError(res, err) {
  const status = err instanceof AIError ? err.status : 500;
  const code = err instanceof AIError ? err.code : 'server_error';
  // never echo internals (or anything that could contain a token) to the client or the logs
  if (!(err instanceof AIError)) console.error('[ai] unexpected error:', err?.name || 'Error');
  // `details`: small, user-safe facts the page can act on (e.g. which of the selected recordings are gone)
  sendJson(res, status, { error: code, message: err instanceof AIError ? err.message : 'Something went wrong. Try again.', ...(err instanceof AIError && err.details ? { details: err.details } : {}) });
}

export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Who is calling? The browser sends its Supabase access token; Supabase Auth verifies it. The returned
// store queries the database AS that user, so RLS decides what exists for them.
// This deployment's own address, from Vercel's environment (never from the request), so database settings scoped to
// an origin (billing_settings.enforce_origins, e.g. the Preview) apply to the server's calls too.
export function deploymentOrigin(env = process.env) {
  const host = env.VERCEL_ENV === 'production' ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  return host ? `https://${host}` : null;
}
export async function authenticate(req) {
  // Local development only: the Vite dev server can plug in an in-memory store for UI testing.
  // Never active on Vercel (VERCEL is always set there) or without the dev server's explicit opt-in.
  if (!process.env.VERCEL && process.env.SPARKSCRIBE_DEV_HARNESS === '1' && globalThis.__sparkscribeDevHarness && req.headers['x-dev-harness'] === '1') {
    return globalThis.__sparkscribeDevHarness.context(req);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AIError('Accounts are not configured on this server.', { status: 503, code: 'not_configured' });
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) throw new AIError('Sign in to use this.', { status: 401, code: 'unauthorized' });
  const origin = deploymentOrigin();
  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}`, ...(origin && { 'x-sparkscribe-origin': origin }) } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new AIError('Your session has expired. Sign in again.', { status: 401, code: 'unauthorized' });
  return { user: { id: data.user.id }, db: supabaseStore(sb) };
}
