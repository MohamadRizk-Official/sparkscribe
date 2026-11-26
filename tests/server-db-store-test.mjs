// The server's database store (server/db.js): insights and tools ("artifacts") bookkeeping, as requests to the database.
// A real Supabase client talks to a made-up address; fetch is the database stand-in, so every request is recorded
// here and nothing leaves this machine. (The AI usage ledger part of the store is covered by tests/ai-limits-test.mjs.)
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const { supabaseStore } = await import(new URL('../server/db.js', import.meta.url).href);
const { AIError } = await import(new URL('../server/ai/provider.js', import.meta.url).href);

const sent = [];
let reply = () => ({ status: 200, body: [] });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
  sent.push({ method: init.method || 'GET', path: u.pathname, q: u.searchParams, body, headers: new Headers(init.headers) });
  const r = reply();
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const sb = createClient('http://db.invalid', 'sb_publishable_test', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const db = supabaseStore(sb);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };
const last = () => sent.at(-1);

// ---- reads
reply = () => ({ status: 200, body: { id: 't1', title: 'Lecture' } });
ok((await db.getTranscription('t1')).title === 'Lecture' && last().path === '/rest/v1/transcriptions' && last().q.get('id') === 'eq.t1', 'getTranscription reads one transcript by id');
ok(!last().q.get('select').includes('user_id') && last().q.get('select').includes('content_version'), 'it selects named columns (never the user id) including the content version');
reply = () => ({ status: 200, body: null });
ok((await db.getTranscription('nope')) === null, 'a missing (or not yours) transcript is null');
reply = () => ({ status: 500, body: { code: 'XX000', message: 'secret internal detail' } });
let e = await fail(db.getTranscription('t1'));
ok(e instanceof AIError && e.status === 500 && e.code === 'db_error' && e.message === "Couldn't load the transcript.", 'a database error becomes a 500 db_error');
ok(!/secret/.test(e.message), 'and the database\'s own message is never passed on');

reply = () => ({ status: 200, body: [{ id: 'i1' }] });
ok((await db.listInsights('t1')).length === 1 && last().path === '/rest/v1/transcription_insights' && last().q.get('transcription_id') === 'eq.t1', 'listInsights reads by transcript');
reply = () => ({ status: 200, body: { id: 'i1' } });
await db.getInsight('t1', 'summary', 'lecture');
ok(last().q.get('kind') === 'eq.summary' && last().q.get('recording_type') === 'eq.lecture' && last().q.get('transcription_id') === 'eq.t1', 'getInsight filters by transcript, kind and recording type');
reply = () => ({ status: 200, body: [] });
await db.listArtifacts('t1');
ok(last().path === '/rest/v1/transcription_artifacts', 'listArtifacts reads the tools table');
reply = () => ({ status: 200, body: { id: 'a1' } });
await db.getArtifact('t1', 'quiz', 'k1');
ok(last().q.get('kind') === 'eq.quiz' && last().q.get('settings_key') === 'eq.k1', 'getArtifact filters by kind and settings key');

// ---- starting an insight (first claim wins)
const row = { id: 'i1', updated_at: '2026-01-01T00:00:00Z' };
reply = () => ({ status: 200, body: [{ id: 'i1', status: 'generating' }] });
const claimed = await db.startInsight(row, { transcriptionId: 't1', kind: 'summary', recordingType: 'lecture', version: 4 });
ok(claimed.id === 'i1' && last().method === 'PATCH' && last().q.get('id') === 'eq.i1', 'an existing result is updated');
ok(last().q.get('updated_at') === 'eq.2026-01-01T00:00:00Z', 'only if nobody touched it since it was read');
ok(last().body.status === 'generating' && last().body.error === null && last().body.source_version === 4, 'and is marked as being generated at this version');
reply = () => ({ status: 200, body: [] });
ok((await db.startInsight(row, { transcriptionId: 't1', kind: 'summary', recordingType: 'lecture', version: 4 })) === null, 'if another request got there first, the claim is null');
reply = () => ({ status: 201, body: [{ id: 'new' }] });
ok((await db.startInsight(null, { transcriptionId: 't1', kind: 'summary', recordingType: 'lecture', version: 2 })).id === 'new', 'a new result is inserted');
ok(last().method === 'POST' && last().body.transcription_id === 't1' && last().body.kind === 'summary' && last().body.recording_type === 'lecture' && !('user_id' in last().body), 'with the transcript, kind and type, and no user id');
reply = () => ({ status: 409, body: { code: '23505', message: 'duplicate' } });
ok((await db.startInsight(null, { transcriptionId: 't1', kind: 'summary', recordingType: 'lecture', version: 2 })) === null, 'a duplicate (someone just started it) is a null claim, not an error');
reply = () => ({ status: 500, body: { code: 'XX000', message: 'x' } });
ok((await fail(db.startInsight(null, { transcriptionId: 't1', kind: 'k', recordingType: 'r', version: 1 })))?.message === "Couldn't save progress.", 'any other insert error is thrown');

// ---- finishing and failing
reply = () => ({ status: 200, body: { id: 'i1', status: 'ready' } });
await db.finishInsight('i1', { content: { s: 1 }, model: 'claude-haiku-5-5', usage: { input: 100, output: 50 } });
ok(last().body.status === 'ready' && last().body.content.s === 1 && last().body.model === 'claude-haiku-5-5' && last().body.input_tokens === 100 && last().body.output_tokens === 50 && last().body.error === null, 'finishing stores the content, the model and the token counts and clears any error');
reply = () => ({ status: 200, body: [] });
await db.failInsight('i1', 'x'.repeat(900), null);
ok(last().body.status === 'failed' && last().body.error.length === 500 && !('source_version' in last().body), 'a failure stores a message cut to 500 characters');
await db.failInsight('i1', 'oops', 3);
ok(last().body.source_version === 3, 'and puts back the previous version, so the earlier content stays visible');
reply = () => ({ status: 500, body: { message: 'down' } });
ok((await fail(db.failInsight('i1', 'oops', 3))) === null, 'recording a failure never throws');

// ---- artifacts
reply = () => ({ status: 201, body: [{ id: 'a1' }] });
await db.startArtifact(null, { transcriptionId: 't1', kind: 'quiz', settings: { count: 5 }, settingsKey: 'count=5', version: 1 });
ok(last().body.settings.count === 5 && last().body.settings_key === 'count=5' && last().body.status === 'generating', 'a new tool result stores its settings and key');
reply = () => ({ status: 200, body: [{ id: 'a1' }] });
await db.finishArtifact('a1', { content: { q: [] }, model: 'm', usage: { input: 1, output: 2 } });
ok(last().body.status === 'ready' && last().body.progress === null, 'finishing a tool clears the learner-visible progress marker');
await db.failArtifact('a1', 'bad', 7);
ok(last().body.status === 'failed' && last().body.source_version === 7, 'a failed tool keeps its previous version');

// ---- Focused Review follow-ups
const art = { id: 'a1', status: 'ready', updated_at: 'T1', content: { quiz: [1], followups: [{ q: 'old' }] } };
reply = () => ({ status: 200, body: [{ id: 'a1' }] });
ok((await db.appendFollowups(art, [{ q: 'new' }])).id === 'a1', 'follow-ups are added to a ready quiz');
ok(last().body.content.followups.length === 2 && last().body.content.followups[1].q === 'new' && last().body.content.quiz[0] === 1, 'after the existing ones, leaving the rest of the content as it was');
ok(Object.keys(last().body).join() === 'content', 'only the content column changes (the learner\'s progress is untouched)');
ok(last().q.get('status') === 'eq.ready' && last().q.get('updated_at') === 'eq.T1', 'and only if the quiz is still ready and unchanged');
reply = () => ({ status: 200, body: [] });
ok((await db.appendFollowups(art, [{ q: 'x' }])) === null, 'if it changed meanwhile the result is null');
await db.appendFollowups({ id: 'a2', status: 'ready', updated_at: 'T', content: null }, [{ q: 'first' }]);
ok(last().body.content.followups.length === 1, 'a quiz with no content or follow-ups yet starts the list');

// ---- version bump after a plain rename
await db.bumpInsightVersion('i1', 9);
ok(last().body.source_version === 9 && last().q.get('source_version') === 'lt.9', 'a reused result moves to the new version, and never backwards');

// ---- questions
reply = () => ({ status: 200, body: [{ id: 'q3' }, { id: 'q2' }, { id: 'q1' }] });
ok((await db.listQuestions('t1')).map((q) => q.id).join() === 'q1,q2,q3', 'questions come back oldest first');
ok(last().q.get('limit') === '100' && last().q.get('order') === 'created_at.desc', '(the newest 100 are fetched)');
reply = () => ({ status: 200, body: [{ id: 'a', question: 'What is X?' }, { id: 'b', question: 'Why Y?' }] });
const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').trim();
ok((await db.findAnswer('t1', 'why y', 5, norm)).id === 'b' && last().q.get('source_version') === 'eq.5', 'findAnswer matches a question by its normalised text, for that version only');
ok((await db.findAnswer('t1', 'something else', 5, norm)) === null, '…and is null when none matches');

console.log(`${pass} checks passed`);
