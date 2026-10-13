// AI cost controls (server/ai/service.js): grading prompt bounds, optional hourly budget, generation takeover.
// In-memory store + mock provider: no network, no key, no cost.
import assert from 'node:assert/strict';
import { memoryStore } from './memory-store.mjs';
process.env.AI_PROVIDER = 'mock';
const root = new URL('../', import.meta.url).href;
const svc = await import(root + 'server/ai/service.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- grading prompt: every field taken from the (browser-writable) stored quiz is bounded ----
const huge = 'x'.repeat(100_000);
const f = svc.gradePromptFields({ question: huge, answer: huge, accept: Array(500).fill(huge), explanation: huge, evidence: huge }, huge, huge);
const total = JSON.stringify(f).length;
ok(f.question.length <= 300 && f.expected.length <= 200 && f.explanation.length <= 400 && f.evidence.length <= 1200 && f.answer.length <= 200, 'grade: each field capped');
ok(f.accept.length <= 8 && f.accept.every((a) => a.length <= 120), 'grade: accepted answers capped (count and length)');
ok(total < 4000, `grade: whole prompt payload bounded (${total} chars from ~51 MB of stored input)`);
const normal = svc.gradePromptFields({ question: 'What is ATP?', answer: 'energy currency', accept: ['energy'], explanation: 'It stores energy.', evidence: 'ATP is the energy currency' }, 'the cell uses ATP', ' energy  ');
ok(normal.question === 'What is ATP?' && normal.answer === 'energy' && normal.evidence === 'ATP is the energy currency / the cell uses ATP', 'grade: normal quiz fields unchanged (whitespace tidied)');

// ---- AI usage ledger (server side of supabase/proposed/*_ai_usage_limits.sql) ----
const lines = Array.from({ length: 12 }, (_, i) => ({ s: i * 10, e: i * 10 + 8, sp: `Speaker ${(i % 2) + 1}`, t: `Line ${i}: we agreed the launch is on Monday and Sam will send the slides by Friday.` }));
const T = '22222222-3333-4444-8555-666666666666';
const db = memoryStore();
db.seed({ id: T, title: 'Budget test', duration_seconds: 120, transcript_text: 'x', segments: lines });

const a = await svc.generate(db, { transcriptionId: T, kind: 'overview' });
ok(a.insight.status === 'ready' && db._ai.length === 1 && db._ai[0].status === 'done' && db._ai[0].feature === 'overview', 'a model call reserves one ledger row and settles it as done');
ok(db._ai[0].estimate > 0 && db._ai[0].estimate < 5000, `the reservation carries a cost estimate (${db._ai[0].estimate} µ$)`);
const b = await svc.generate(db, { transcriptionId: T, kind: 'overview' });
ok(b.cached === true && db._ai.length === 1, 'cached results never touch the ledger');

db.aiLimits = { perHour: 2, budget: 10_000_000 };
await svc.generateArtifact(db, { transcriptionId: T, kind: 'study_guide', settings: {} });
let refused = null;
try { await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards', settings: {} }); } catch (e) { refused = e; }
ok(refused?.status === 429 && refused.code === 'rate_limited' && /in about 20 minutes/.test(refused.message), `hourly limit → 429 with a retry time ("${refused?.message}")`);
ok(!(await db.listArtifacts(T)).some((x) => x.kind === 'flashcards'), 'a refused request creates no result row and calls no model');
let askRefused = null;
try { await svc.askTranscript(db, { transcriptionId: T, question: 'When is the launch?' }, () => {}); } catch (e) { askRefused = e; }
ok(askRefused?.code === 'rate_limited', 'Ask is limited too');

db.aiLimits = { perHour: 100, budget: 1 };
let monthly = null;
try { await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards', settings: {} }); } catch (e) { monthly = e; }
ok(monthly?.status === 429 && monthly.code === 'quota_exceeded' && /renews on November 1/.test(monthly.message), `monthly allowance → 429 quota_exceeded ("${monthly?.message}")`);
db.aiLimits = null;

process.env.AI_MOCK_FAIL = '1';
try { await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards', settings: {} }); } catch { /* expected */ }
delete process.env.AI_MOCK_FAIL;
const last = db._ai.at(-1);
ok(last.feature.startsWith('tool:flashcards') && last.status === 'failed' && last.cost === 0, 'a failed model call is settled as failed with no cost');

const old = memoryStore(); delete old.reserveAi; delete old.settleAi;
old.seed({ id: T, title: 'No ledger', duration_seconds: 120, transcript_text: 'x', segments: lines });
ok((await svc.generate(old, { transcriptionId: T, kind: 'overview' })).insight.status === 'ready', 'without the ledger functions (migration not applied) everything runs unlimited');
ok(svc.estimateMicrousd('ask', 3000) === 500 && svc.estimateMicrousd('tool:quiz:k', 3000) === 1800, 'estimates follow Haiku base rates (input 0.1 µ$/token + expected output)');

// ---- the usage check fails closed (server/db.js reserveAi against a fake Supabase client) ----
const { supabaseStore } = await import(root + 'server/db.js');
const storeWith = (rpc) => supabaseStore({ rpc: async (...a) => rpc(...a) });
const quiet = console.error; console.error = () => {};
try {
  const notInstalled = () => ({ data: null, error: { code: 'PGRST202' } });
  delete process.env.AI_LIMITS_REQUIRED;
  ok((await storeWith(notInstalled).reserveAi('ask', 100)).allowed === true, 'rollout fallback: function not installed yet + AI_LIMITS_REQUIRED unset → runs (unmetered)');
  process.env.AI_LIMITS_REQUIRED = '1';
  ok((await storeWith(notInstalled).reserveAi('ask', 100)).reason === 'unavailable', 'after rollout (AI_LIMITS_REQUIRED=1) a missing function refuses');
  delete process.env.AI_LIMITS_REQUIRED;
  const failures = {
    'statement timeout': () => ({ data: null, error: { code: '57014' } }),
    'JWT / auth error': () => ({ data: null, error: { code: 'PGRST301' } }),
    'not signed in in SQL': () => ({ data: null, error: { code: '42501' } }),
    'network failure': () => ({ data: null, error: { message: 'TypeError: fetch failed' } }),
    'client throws': () => { throw new Error('socket hang up'); },
    'empty reply': () => ({ data: null, error: null }),
    'reply without allowed': () => ({ data: { id: 5 }, error: null }),
    'allowed as a string': () => ({ data: { allowed: 'true' }, error: null }),
  };
  for (const [name, rpc] of Object.entries(failures)) {
    const r = await storeWith(rpc).reserveAi('ask', 100);
    ok(r.allowed === false && r.reason === 'unavailable', `fails closed on ${name} (even with the rollout fallback on)`);
  }
  const pass = { allowed: true, id: 9, enforced: true }, deny = { allowed: false, reason: 'hourly', retry_after_s: 60 };
  ok((await storeWith(() => ({ data: pass, error: null })).reserveAi('ask', 1)) === pass && (await storeWith(() => ({ data: deny, error: null })).reserveAi('ask', 1)) === deny, 'normal replies pass through unchanged');
} finally { console.error = quiet; }

const down = memoryStore();
down.seed({ id: T, title: 'Check down', duration_seconds: 120, transcript_text: 'x', segments: lines });
down.reserveAi = async () => ({ allowed: false, reason: 'unavailable' });
let unavailable = null;
try { await svc.generateArtifact(down, { transcriptionId: T, kind: 'flashcards', settings: {} }); } catch (e) { unavailable = e; }
ok(unavailable?.status === 503 && unavailable.code === 'ai_unavailable' && !(await down.listArtifacts(T)).length, `check unavailable → 503 "${unavailable?.message}", no model call, no row`);

const long = memoryStore();
const bigLines = Array.from({ length: 400 }, (_, i) => ({ s: i * 10, e: i * 10 + 9, sp: 'Speaker 1', t: 'word '.repeat(250) }));
long.seed({ id: T, title: 'Long', duration_seconds: 4000, transcript_text: 'x', segments: bigLines });
await svc.generateArtifact(long, { transcriptionId: T, kind: 'study_guide', settings: {} }).catch(() => {});
ok(long._ai[0]?.estimate > 80_000 * 0.1 + 3000 * 0.5, `a long transcript's estimate covers every part it is read in (${long._ai[0]?.estimate} µ$, more than one 80k-token part)`);

// ---- takeover: a result marked "generating" 2 minutes ago is not regenerated by a second request ----
const db2 = memoryStore();
db2.seed({ id: T, title: 'Takeover', duration_seconds: 120, transcript_text: 'x', segments: lines });
const first = await svc.generateArtifact(db2, { transcriptionId: T, kind: 'meeting_recap', settings: {} });
const row = (await db2.listArtifacts(T)).find((r) => r.kind === 'meeting_recap');
Object.assign(row, { status: 'generating', updated_at: new Date(Date.now() - 150_000).toISOString() });
const second = await svc.generateArtifact(db2, { transcriptionId: T, kind: 'meeting_recap', settings: {}, force: true });
ok(first.artifact.status === 'ready' && second.cached === true && second.artifact.status === 'generating', 'takeover: a Create job started 150 s ago (api/tools runs up to 300 s) is not started again');
Object.assign(row, { status: 'generating', updated_at: new Date(Date.now() - 320_000).toISOString() });
const third = await svc.generateArtifact(db2, { transcriptionId: T, kind: 'meeting_recap', settings: {}, force: true });
ok(third.cached === false && third.artifact.status === 'ready', 'takeover: after 310 s a stuck job can be restarted');

// ---- D13: a failed update of a summary keeps the previous result (and its version) visible ----
const db3 = memoryStore();
db3.seed({ id: T, title: 'Failure', duration_seconds: 120, transcript_text: 'x', segments: lines });
const ok1 = await svc.generate(db3, { transcriptionId: T, kind: 'overview' });
const v1 = ok1.insight.sourceVersion;
db3.seed({ id: T, title: 'Failure', duration_seconds: 120, transcript_text: 'x', segments: lines.map((l, i) => (i ? l : { ...l, sp: 'Renamed' })) }); // transcript changed → summary out of date
process.env.AI_MOCK_FAIL = '1';
let failedUpdate = null;
try { await svc.generate(db3, { transcriptionId: T, kind: 'overview', force: true }); } catch (e) { failedUpdate = e; }
delete process.env.AI_MOCK_FAIL;
const st = await svc.getState(db3, T);
const ov = st.insights.find((i) => i.kind === 'overview');
ok(failedUpdate && ov.status === 'failed' && ov.error, 'failed update is reported');
ok(ov.content && ov.content.short_summary === ok1.insight.content.short_summary, 'previous summary is still returned to the browser');
ok(ov.sourceVersion === v1, 'and keeps the version it was made from (so it reads as out of date, not current)');

console.log(`\n${pass} checks passed`);
