(function () {
  // QA HARNESS ONLY (injected by qa/harness/dev-mock.mjs; never part of the app build).
  // - Fake signed-in Supabase session + the REST/RPC/auth calls the pages make, kept in sessionStorage and
  //   mirrored to the dev server's in-memory store so /api/* (real server code, mock AI) sees the same rows.
  // - Optional fake processing worker (canned lines, real message protocol) so UI flows can be tested
  //   without downloading speech models. Real-model runs are tested separately.
  // Knobs: sessionStorage.__qa = JSON {saveDelayMs, failSave, failPatch, patchDelayMs, worker:'fake'|'real',
  //        runMs, lines:'meeting'|'unicode'|'empty'|'one', signedOut}
  const REF = 'strkrrdndoofpcenopxk';
  const USER = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'tester@example.com', user_metadata: { full_name: 'Test User' }, app_metadata: { provider: 'email' }, created_at: '2026-10-07T00:00:00Z' };
  const knobs = () => { try { return JSON.parse(sessionStorage.getItem('__qa') || '{}'); } catch { return {}; } };
  window.__qaKnobs = (k) => { sessionStorage.setItem('__qa', JSON.stringify({ ...knobs(), ...k })); return knobs(); };
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

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
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
      if (body?.password === 'wrong-password') return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' }, 400);
      sessionStorage.removeItem('__signedOut'); window.__qaKnobs({ signedOut: false });
      return json(sessionToken());
    }
    if (p === '/auth/v1/signup') return json({ id: crypto.randomUUID(), email: body?.email, confirmation_sent_at: new Date().toISOString() });
    if (p === '/auth/v1/recover') return json({});
    if (p === '/rest/v1/profiles') return out([{ display_name: 'Test User', avatar_url: null }]);
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
        const row = { id: crypto.randomUUID(), user_id: USER.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), content_version: 1, is_favorite: false, last_opened_at: null, ...body };
        db.rows.push(row); persist(); await mirror(row);
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
