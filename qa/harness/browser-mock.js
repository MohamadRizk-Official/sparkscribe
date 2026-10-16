(function () {
  // QA HARNESS ONLY (injected by qa/harness/dev-mock.mjs; never part of the app build).
  // - Fake signed-in Supabase session + the REST/RPC/auth calls the pages make, kept in sessionStorage and
  //   mirrored to the dev server's in-memory store so /api/* (real server code, mock AI) sees the same rows.
  // - Optional fake processing worker (canned lines, real message protocol) so UI flows can be tested
  //   without downloading speech models. Real-model runs are tested separately.
  // Knobs: sessionStorage.__qa = JSON {saveDelayMs, failSave, failPatch, patchDelayMs, worker:'fake'|'real',
  //        runMs, lines:'meeting'|'unicode'|'empty'|'one', signedOut, failDelete, deleteReason}
  const REF = 'strkrrdndoofpcenopxk';
  const USER = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'tester@example.com', user_metadata: { full_name: 'Test User' }, app_metadata: { provider: 'email' }, created_at: '2026-10-07T00:00:00Z' };
  const knobs = () => { try { return JSON.parse(sessionStorage.getItem('__qa') || '{}'); } catch { return {}; } };
  // the plan knob is mirrored to the dev server, whose entitlement checks (server code) read it like billing_status
  const mirrorPlan = (plan) => fetch('/__harness/plan?key=' + encodeURIComponent(plan || 'free')).catch(() => {});
  window.__qaKnobs = (k) => { sessionStorage.setItem('__qa', JSON.stringify({ ...knobs(), ...k })); if ('plan' in k) mirrorPlan(k.plan); return knobs(); };
  mirrorPlan(knobs().plan);
  window.__qaLog = [];
  const log = (e) => { window.__qaLog.push({ t: Math.round(performance.now()), ...e }); };
  const now = Math.floor(Date.now() / 1000);
  const sessionToken = () => ({ access_token: 'fake.jwt.token', refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
  if (!knobs().signedOut && !sessionStorage.getItem('__signedOut')) localStorage.setItem('sb-' + REF + '-auth-token', JSON.stringify(sessionToken()));
  const seed = window.__HARNESS_SEED || [];
  const db = JSON.parse(sessionStorage.getItem('__db') || 'null') || { rows: seed, folders: [], items: [] };
  db.folders ??= []; db.items ??= [];
  const persist = () => sessionStorage.setItem('__db', JSON.stringify(db));
  window.__qaDb = db;
  const realFetch = window.fetch.bind(window);
  const mirror = (row) => realFetch('/__harness/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row) });
  if (!sessionStorage.getItem('__seeded')) { db.rows.forEach(mirror); sessionStorage.setItem('__seeded', '1'); persist(); }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms || 0));
  // PostgREST filters: eq.X / in.(a,b) / is.null
  const filt = (url, col) => {
    const v = url.searchParams.get(col); if (v == null) return null;
    if (v.startsWith('eq.')) { const x = v.slice(3); return (r) => String(r[col]) === x; }
    if (v.startsWith('in.(')) { const xs = v.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, '')); return (r) => xs.includes(String(r[col])); }
    return null;
  };
  const where = (url, rows, cols) => cols.reduce((acc, c) => { const f = filt(url, c); return f ? acc.filter(f) : acc; }, rows);
  const real = new Set(['lecture', 'meeting', 'interview', 'podcast', 'voice_message']);
  const speakers = (r) => Array.isArray(r.segments) && r.segments.length ? new Set(r.segments.map((s) => s.sp).filter((s) => s !== 'Unknown')).size
    : new Set([...(r.transcript_text || '').matchAll(/^\[\d{1,2}(?::\d{2}){1,2}\] ([^\n]+):$/gm)].map((m) => m[1]).filter((s) => s !== 'Unknown')).size;

  // ---- billing (knobs: plan 'free'|'flash'|'bolt'|'thunder', usedSeconds, enforced, upgrades, cancelAtPeriodEnd, paymentProblem, introEligible) ----
  // the same rows as supabase/migrations/20261016100000_four_tier.sql
  const PLANS = [
    { key: 'free', name: 'Free', tagline: 'Try the real product', price_cents: 0, currency: 'usd', billing_interval: null, monthly_seconds: 1800, tier: 0, features: [], intro_price_cents: null, intro_months: null, is_default: true },
    { key: 'flash', name: 'Flash', tagline: 'Everyday studying', price_cents: 599, currency: 'usd', billing_interval: 'month', monthly_seconds: 10800, tier: 1, features: [], intro_price_cents: 100, intro_months: 1, is_default: false },
    { key: 'bolt', name: 'Bolt', tagline: 'Focused Review', price_cents: 999, currency: 'usd', billing_interval: 'month', monthly_seconds: 32400, tier: 2, features: ['focused_review', 'followup_practice'], intro_price_cents: null, intro_months: null, is_default: false },
    { key: 'thunder', name: 'Thunder', tagline: 'Connected recordings', price_cents: 1499, currency: 'usd', billing_interval: 'month', monthly_seconds: 72000, tier: 3, features: ['focused_review', 'followup_practice', 'across_ask', 'across_guide'], intro_price_cents: null, intro_months: null, is_default: false },
  ];
  window.__qaBilling = [];
  async function billingApi(init) {
    const K = knobs();
    let body = {}; try { body = JSON.parse(init.body || '{}'); } catch {}
    window.__qaBilling.push(body.action);
    if (K.signedOut || sessionStorage.getItem('__signedOut')) return json({ error: 'unauthorized', message: 'Sign in to continue.' }, 401);
    const plan = PLANS.find((p) => p.key === (K.plan || 'free'));
    const used = Number(K.usedSeconds || 0), remaining = Math.max(plan.monthly_seconds - used, 0);
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString();
    const st = { plan: plan.key, planName: plan.name, tier: plan.tier, features: plan.features, ...(K.introEligible != null && { introEligible: !!K.introEligible }), status: plan.key === 'free' ? 'free' : 'active', monthlySeconds: plan.monthly_seconds, usedSeconds: used, remainingSeconds: remaining,
      periodStart: new Date().toISOString(), periodEnd: end, periodKind: plan.key === 'free' ? 'calendar_month' : 'billing', cancelAtPeriodEnd: !!K.cancelAtPeriodEnd,
      hasBillingAccount: plan.key !== 'free', paymentProblem: !!K.paymentProblem, meteringStarted: !!K.enforced, enforced: !!K.enforced, upgradesAvailable: !!K.upgrades, testMode: false };
    if (body.action === 'status') return json(st);
    if (body.action === 'authorize') {
      const next = PLANS.find((p) => p.billing_interval && p.monthly_seconds > plan.monthly_seconds);
      const base = { plan: plan.key, remainingSeconds: remaining, monthlySeconds: plan.monthly_seconds, periodEnd: end, upgradeTo: next?.key || null, upgradesAvailable: !!K.upgrades && !!next };
      if (!K.enforced || body.durationSeconds <= remaining + 1) return json({ ok: true, enforced: !!K.enforced, ...base });
      return json({ ok: false, enforced: true, reason: remaining < 1 ? 'limit_reached' : 'too_long', requestedSeconds: body.durationSeconds, ...base });
    }
    if (body.action === 'checkout' || body.action === 'portal') return json({ error: 'payments_unavailable', message: "Paid plans aren't available yet. Nothing was charged." }, 503);
    if (body.action === 'delete_account') { // the server (no Stripe subscription here), then the delete_my_account RPC below
      if (K.deleteMissing) return json({ error: 'deletion_unavailable', message: 'Deleting accounts isn’t switched on yet. Nothing was deleted.' }, 503);
      const r = await window.fetch('https://qa.supabase.co/rest/v1/rpc/delete_my_account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_confirm: body.confirm }) });
      if (!r.ok) return json({ error: 'deletion_failed', message: 'Your account couldn’t be deleted, and nothing was removed. Try again.' }, 503);
      return json(await r.json());
    }
    return json({ error: 'bad_request', message: 'Unknown action.' }, 400);
  }

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    // billing API: answered here, so the harness never reaches the billing server (or Stripe, or production)
    if (url.origin === location.origin && url.pathname === '/api/billing') return billingApi(init);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const headers = new Headers(init.headers || {});
      headers.set('x-dev-harness', '1');
      return realFetch(input, { ...init, headers });
    }
    if (!url.host.endsWith('supabase.co')) return realFetch(input, init);
    const K = knobs();
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers(init.headers || {});
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
    const single = (headers.get('accept') || '').includes('vnd.pgrst.object');
    const out = (arr) => (single ? (arr.length ? json(arr[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)) : json(arr));
    const p = url.pathname;
    log({ method, path: p, q: url.search.slice(0, 120) });
    // ---- auth ----
    if (p === '/auth/v1/user') {
      if (method === 'PUT') { Object.assign(USER.user_metadata, body?.data || {}); return json(USER); }
      return K.signedOut ? json({ message: 'no session' }, 401) : json(USER);
    }
    if (p === '/auth/v1/settings') return json({ external: { google: false, email: true } });
    if (p === '/auth/v1/logout') { sessionStorage.setItem('__signedOut', '1'); return new Response(null, { status: 204 }); }
    if (p === '/auth/v1/token') {
      if (body?.password === 'unconfirmed-password') return json({ error: 'invalid_grant', error_code: 'email_not_confirmed', error_description: 'Email not confirmed', msg: 'Email not confirmed' }, 400);
      if (body?.password === 'wrong-password') return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' }, 400);
      sessionStorage.removeItem('__signedOut'); window.__qaKnobs({ signedOut: false });
      if (body?.password) sessionStorage.setItem('__reauthAt', String(Date.now())); // like the JWT's amr timestamp
      return json(sessionToken());
    }
    if (p === '/auth/v1/signup') return json({ id: crypto.randomUUID(), email: body?.email, confirmation_sent_at: new Date().toISOString() });
    if (p === '/auth/v1/recover') return json({});
    if (p === '/auth/v1/resend') { window.__qaResends = (window.__qaResends || 0) + 1; return K.failResend ? json({ code: 500, error_code: 'unexpected_failure', msg: 'Error sending confirmation email' }, 500) : json({}); }
    if (p === '/rest/v1/profiles') return out([{ display_name: 'Test User', avatar_url: null }]);
    if (p === '/rest/v1/billing_plans') return out(PLANS);
    // ---- transcriptions ----
    if (p === '/rest/v1/transcriptions') {
      if (method === 'GET') {
        let rows = where(url, db.rows, ['id']).sort((a, b) => b.created_at.localeCompare(a.created_at));
        const sel = url.searchParams.get('select') || '';
        if (sel.includes('folder_items')) rows = rows.map((r) => ({ ...r, folder_items: db.items.filter((i) => i.transcription_id === r.id).map((i) => ({ folder_id: i.folder_id })) }));
        return out(rows);
      }
      if (method === 'POST') {
        if (K.saveDelayMs) await sleep(K.saveDelayMs);
        if (K.failSave) return json({ message: 'QA: insert failed' }, 500);
        if (K.quotaSave) return json({ code: 'P0001', message: 'quota_exceeded', hint: 'This transcription is longer than the time left on your plan this month.' }, 400);
        // a chosen id that exists is refused like the primary key does (launch-integrity migration)
        if (body?.id && db.rows.some((r) => r.id === body.id)) return json({ code: '23505', message: 'duplicate key value violates unique constraint "transcriptions_pkey"' }, 409);
        const row = { id: crypto.randomUUID(), user_id: USER.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), content_version: 1, is_favorite: false, last_opened_at: null, ...body };
        db.rows.push(row); persist(); await mirror(row);
        // loseSaveResponse: the row is saved but the answer never arrives (a flaky mobile network)
        if (K.loseSaveResponse) throw new TypeError('Failed to fetch');
        return out([{ id: row.id }]);
      }
      if (method === 'PATCH') {
        if (K.patchDelayMs) await sleep(K.patchDelayMs);
        if (K.failPatch) return json({ message: 'QA: update failed' }, 500);
        const hit = where(url, db.rows, ['id']);
        for (const r of hit) {
          const changed = ('transcript_text' in body && body.transcript_text !== r.transcript_text) || ('segments' in body && JSON.stringify(body.segments) !== JSON.stringify(r.segments));
          Object.assign(r, body, { updated_at: new Date().toISOString() });
          if (changed) r.content_version = (r.content_version || 1) + 1;
          await mirror(r);
        }
        persist();
        return out(hit.map((r) => ({ id: r.id })));
      }
      if (method === 'DELETE') {
        const gone = where(url, db.rows, ['id']);
        db.rows = db.rows.filter((r) => !gone.includes(r)); db.items = db.items.filter((i) => !gone.some((g) => g.id === i.transcription_id));
        persist();
        return out(gone.map((g) => ({ id: g.id })));
      }
    }
    // ---- folders ----
    if (p === '/rest/v1/folders') {
      if (method === 'GET') return out([...db.folders].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ ...f, folder_items: [{ count: db.items.filter((i) => i.folder_id === f.id).length }] })));
      if (method === 'POST') { const f = { id: crypto.randomUUID(), name: body.name, created_at: new Date().toISOString() }; db.folders.push(f); persist(); return out([{ id: f.id, name: f.name }]); }
      if (method === 'PATCH') { for (const f of where(url, db.folders, ['id'])) Object.assign(f, body); persist(); return out([]); }
      if (method === 'DELETE') { const gone = where(url, db.folders, ['id']); db.folders = db.folders.filter((f) => !gone.includes(f)); db.items = db.items.filter((i) => !gone.some((g) => g.id === i.folder_id)); persist(); return out([]); }
    }
    if (p === '/rest/v1/folder_items') {
      if (method === 'POST') { for (const it of [].concat(body)) if (!db.items.some((i) => i.folder_id === it.folder_id && i.transcription_id === it.transcription_id)) db.items.push(it); persist(); return out([]); }
      if (method === 'DELETE') { const gone = where(url, db.items, ['folder_id', 'transcription_id']); db.items = db.items.filter((i) => !gone.includes(i)); persist(); return out([]); }
    }
    // ---- RPCs (simplified versions of the SQL functions, same result shapes) ----
    if (p === '/rest/v1/rpc/delete_my_account') { // same guards and result shape as the proposed SQL function
      if (K.failDelete) return json({ code: 'XX000', message: 'QA: delete failed' }, 500);
      if (K.deleteMissing) return json({ code: 'PGRST202', message: 'Could not find the function public.delete_my_account(p_confirm) in the schema cache' }, 404);
      if (body?.p_confirm !== 'DELETE') return json({ code: '22023', message: 'type DELETE to confirm' }, 400);
      if (K.deleteReason) return json({ deleted: false, reason: K.deleteReason });
      if (Date.now() - Number(sessionStorage.getItem('__reauthAt') || 0) > 600_000) return json({ deleted: false, reason: 'reauth' });
      db.rows = []; db.folders = []; db.items = []; persist(); window.__qaDb = db;
      sessionStorage.setItem('__accountDeleted', '1'); sessionStorage.setItem('__signedOut', '1'); // the account no longer exists
      return json({ deleted: true });
    }
    if (p === '/rest/v1/rpc/library_list') {
      const a = body || {};
      let rows = db.rows.filter((t) => (a.p_view !== 'favorites' || t.is_favorite)
        && (!a.p_type || (a.p_type === 'general' ? !real.has(t.recording_type) : t.recording_type === a.p_type))
        && (!a.p_folder || db.items.some((i) => i.folder_id === a.p_folder && i.transcription_id === t.id))
        && (!a.p_since || t.created_at >= a.p_since));
      const by = { oldest: (x, y) => x.created_at.localeCompare(y.created_at), longest: (x, y) => (y.duration_seconds || 0) - (x.duration_seconds || 0), shortest: (x, y) => (x.duration_seconds || 0) - (y.duration_seconds || 0), az: (x, y) => x.title.toLowerCase().localeCompare(y.title.toLowerCase()), recent: (x, y) => (y.last_opened_at || y.created_at).localeCompare(x.last_opened_at || x.created_at) }[a.p_sort] || ((x, y) => y.created_at.localeCompare(x.created_at));
      rows.sort(by);
      const total = rows.length, off = Math.max(0, a.p_offset || 0), lim = Math.min(Math.max(a.p_limit || 24, 1), 100);
      return json(rows.slice(off, off + lim).map((t) => ({ id: t.id, title: t.title, recording_type: real.has(t.recording_type) ? t.recording_type : null, created_at: t.created_at, duration_seconds: t.duration_seconds, is_favorite: !!t.is_favorite, last_opened_at: t.last_opened_at, status: t.status, speaker_count: speakers(t), coarse: !(Array.isArray(t.segments) && t.segments.length), summary: null, preview: (Array.isArray(t.segments) && t.segments[0]?.t) || (t.transcript_text || '').split('\n')[4] || '', folder_ids: db.items.filter((i) => i.transcription_id === t.id).map((i) => i.folder_id), total })));
    }
    if (p === '/rest/v1/rpc/search_library') {
      const q = String(body?.p_query || '').toLowerCase().trim(); if (!q) return json([]);
      const res = [];
      for (const t of db.rows) {
        const segs = Array.isArray(t.segments) && t.segments.length ? t.segments.map((s, i) => ({ line: i, start: s.s, speaker: s.sp, text: s.t })) : [];
        const hits = segs.filter((s) => s.text.toLowerCase().includes(q)).slice(0, 3).map((s) => ({ source: 'transcript', line: s.line, start: s.start, speaker: s.speaker, snippet: s.text.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), (m) => '\u0002' + m + '\u0003') }));
        const titleMatch = t.title.toLowerCase().includes(q);
        const count = segs.filter((s) => s.text.toLowerCase().includes(q)).length;
        if (titleMatch || count) res.push({ transcription_id: t.id, title: t.title, recording_type: real.has(t.recording_type) ? t.recording_type : null, created_at: t.created_at, duration_seconds: t.duration_seconds, is_favorite: !!t.is_favorite, title_match: titleMatch, coarse: !segs.length, score: count + (titleMatch ? 5 : 0), match_count: count, hits, partial: false });
      }
      res.sort((a, b) => b.score - a.score);
      return json(res.slice(body?.p_offset || 0, (body?.p_offset || 0) + (body?.p_limit || 10)));
    }
    // ---- Create results: the learner's own writes (quiz progress, deleting a result) go to the dev-server store,
    // which is where /api/* reads them ----
    if (p === '/rest/v1/transcription_artifacts' && (method === 'PATCH' || method === 'DELETE')) {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      const r = await realFetch('/__harness/artifact-write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, method, patch: body }) });
      return json(r.ok ? [] : { message: 'not found' }, r.ok ? 200 : 404);
    }
    if (p === '/rest/v1/rpc/library_stats') {
      const by = {}; for (const t of db.rows) { const k = real.has(t.recording_type) ? t.recording_type : 'general'; by[k] = (by[k] || 0) + 1; }
      return json([{ recordings: db.rows.length, seconds: db.rows.reduce((s, t) => s + (t.duration_seconds || 0), 0), this_month: db.rows.length, favorites: db.rows.filter((t) => t.is_favorite).length, by_type: by }]);
    }
    log({ unmocked: p });
    return json({ message: 'unmocked ' + p }, 404);
  };

  // ---- fake processing worker (only the app's own worker; anything else stays real) ----
  const FIXTURES = {
    meeting: [['SPEAKER_00', 'Okay, quick planning call for the bake sale.'], ['SPEAKER_01', "I'll print the flyers by Friday."], ['SPEAKER_00', 'Can you also book the hall?'],
      ['SPEAKER_01', "Yes, I'll book it tomorrow."], ['SPEAKER_00', "I'll send you the price list. Actually, done, I just sent it."], ['SPEAKER_01', 'Maybe one day we could sell coffee too.'],
      ['SPEAKER_00', "Let's order balloons. Hm, no, forget the balloons."], ['Unknown', 'Mm-hmm.'], ['SPEAKER_01', 'Who has the cash box?'], ['SPEAKER_00', 'I do.']],
    unicode: [['SPEAKER_00', 'Café menu: crème brûlée costs 5 € — “quoted” & <b>bold</b> --> arrow'], ['SPEAKER_01', 'Line two with naïve résumé façade, 50% off & tabs\tinside.'], ['SPEAKER_00', 'Emoji 🎉 and math ≤ ≥ ≠ and a very long word supercalifragilisticexpialidocious.']],
    one: [['SPEAKER_00', 'Just one person talking about the weather today.'], ['SPEAKER_00', 'It is sunny and warm.']],
    empty: [],
  };
  const RealWorker = window.Worker;
  window.Worker = function QaWorker(url, opts) {
    if (knobs().worker === 'real' || !/worker/i.test(String(url))) return new RealWorker(url, opts);
    const listeners = { message: [], error: [] };
    let dead = false;
    const emit = (data) => { if (dead) return; log({ worker: data.type }); for (const fn of listeners.message) fn({ data }); };
    const self = {
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
      terminate() { dead = true; log({ worker: 'terminated' }); },
      async postMessage(msg) {
        const K = knobs(); const step = (K.runMs ?? 600) / 6;
        if (msg.type === 'detect') return setTimeout(() => emit({ type: 'device', device: 'webgpu' }), 10);
        if (msg.type !== 'run') return;
        const dur = (msg.audio?.length || 16000 * 60) / 16000;
        for (const stage of ['analyze', 'load', 'speakers', 'run']) { await sleep(step); emit({ type: 'stage', stage }); }
        if (K.workerError) { await sleep(step); return emit({ type: 'error', message: 'QA: simulated worker failure' }); }
        const fx = FIXTURES[K.lines || 'meeting'];
        const n = fx.length, per = n ? dur / n : 0;
        const lines = fx.map(([sp, text], i) => ({ start: +(i * per).toFixed(2), end: +((i + 0.9) * per).toFixed(2), speaker: msg.diarize === false ? 'SPEAKER_00' : (msg.numSpeakers === 1 ? 'SPEAKER_00' : sp), text, language: 'en', uncertain: false }));
        await sleep(step); emit({ type: 'run-progress', done: dur, total: dur });
        emit({ type: 'complete', lines, language: 'en', ms: K.runMs ?? 600, device: 'webgpu', stats: { mode: msg.mode, model: 'qa-fake', languages: ['en'], turns: n } });
      },
    };
    return self;
  };
})();
