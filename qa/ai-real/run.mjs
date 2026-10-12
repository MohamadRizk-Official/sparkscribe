// Budgeted REAL-model grounding check (Haiku via server/ai/*), in-memory store: no Supabase, no production data.
// Reads ANTHROPIC_API_KEY from .env.local into this process only (never printed or written). Budget: <= 7 calls.
//   node qa/ai-real/run.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^(ANTHROPIC_API_KEY|AI_MODEL[A-Z_]*)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
delete process.env.AI_PROVIDER; // real provider
mkdirSync(resolve(ROOT, 'qa/out'), { recursive: true });
process.env.AI_USAGE_LOG = resolve(ROOT, 'qa/out/ai-real-usage.jsonl');
const svc = await import(pathToFileURL(resolve(ROOT, 'server/ai/service.js')).href);
const { memoryStore } = await import(pathToFileURL(resolve(ROOT, 'tests/memory-store.mjs')).href);

// Scripted meeting with known ground truth
const script = [
  ['Speaker 1', 'Okay, quick planning call for the school bake sale on Saturday.'],
  ['Speaker 2', 'I will print the flyers by Friday.'],
  ['Speaker 1', 'Great. Can you also book the hall?'],
  ['Speaker 2', 'Yes, I will book it tomorrow morning.'],
  ['Speaker 1', 'I will send you the price list. Actually, done, I just sent it to you now.'],
  ['Speaker 2', 'Got it, thanks, I can see it.'],
  ['Speaker 2', 'Maybe one day we could sell coffee too.'],
  ['Speaker 1', 'Let us order balloons for the entrance.'],
  ['Speaker 2', 'Hm, the school does not allow balloons.'],
  ['Speaker 1', 'Right, forget the balloons then.'],
  ['Speaker 2', 'For prices, I was thinking two dollars per cookie.'],
  ['Speaker 1', 'Let us make it one fifty, so kids can afford it. Agreed?'],
  ['Speaker 2', 'Agreed, one fifty per cookie.'],
  ['Speaker 1', 'Someone should ask the principal about the tables at some point.'],
  ['Speaker 2', 'I could do that if nobody else does.'],
  ['Speaker 1', 'We still have not decided who brings the cash box.'],
];
const segs = script.map(([sp, t], i) => ({ s: i * 6, e: i * 6 + 5, sp, t }));
const db = memoryStore();
const T = '33333333-4444-4555-8666-777777777777';
db.seed({ id: T, title: 'Bake sale planning', duration_seconds: segs.at(-1).e, transcript_text: 'x', segments: segs, recording_type: 'meeting' });

// which checks to run: all by default, or e.g. `node qa/ai-real/run.mjs recap insights`
const only = new Set(process.argv.slice(2));
const want = (k) => !only.size || only.has(k);
const out = {};
const t0 = Date.now();
if (want('action_plan')) out.action_plan = (await svc.generateArtifact(db, { transcriptionId: T, kind: 'action_plan', settings: {} })).artifact.content;
if (want('recap')) out.meeting_recap = (await svc.generateArtifact(db, { transcriptionId: T, kind: 'meeting_recap', settings: {} })).artifact.content;
if (want('insights')) out.meeting_insights = (await svc.generate(db, { transcriptionId: T, kind: 'insights', recordingType: 'meeting' })).insight.content;
if (want('overview')) out.overview = (await svc.generate(db, { transcriptionId: T, kind: 'overview' })).insight.content;
if (want('ask')) {
  out.ask_coffee = await svc.askTranscript(db, { transcriptionId: T, question: 'Did they decide to sell coffee?' }, () => {});
  out.ask_offtopic = await svc.askTranscript(db, { transcriptionId: T, question: 'What is the capital of France?' }, () => {});
  out.ask_price = await svc.askTranscript(db, { transcriptionId: T, question: 'What price per cookie did they settle on?' }, () => {});
}
out.elapsedS = (Date.now() - t0) / 1000;
writeFileSync(resolve(ROOT, `qa/out/ai-real-results${only.size ? '-' + [...only].join('-') : ''}.json`), JSON.stringify(out, null, 1));

// cost of this run (from the usage log written by server/ai/usage.js; no text in it)
const usage = readFileSync(process.env.AI_USAGE_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((u) => Date.parse(u.ts) >= t0 - 1000);
const calls = usage.filter((u) => !u.cached && !u.failed);
console.log(JSON.stringify({ modelCalls: calls.length, estCostUsd: +calls.reduce((s, u) => s + (u.estimatedCostUsd || 0), 0).toFixed(5), models: [...new Set(calls.map((u) => u.model))], elapsedS: out.elapsedS }));
