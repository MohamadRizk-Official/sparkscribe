// Budgeted REAL-model check of Master Phase 2 (Haiku via server/ai/*), on the synthetic recordings in
// qa/fixtures/across.mjs, with the in-memory store: no Supabase, no production data, no private recordings.
// Reads ANTHROPIC_API_KEY from .env.local into this process only (never printed or written).
//   node qa/ai-real/across.mjs            → qa/out/across-real.json (answers, citations, tokens, cost, latency)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^(ANTHROPIC_API_KEY|AI_MODEL[A-Z_]*)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
delete process.env.AI_PROVIDER; // the real provider
mkdirSync(resolve(ROOT, 'qa/out'), { recursive: true });
const imp = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const svc = await imp('server/ai/service.js');
const { memoryStore } = await imp('tests/memory-store.mjs');
const F = await imp('qa/fixtures/across.mjs');
const { estimateCost } = await imp('server/ai/usage.js');

// every model call is logged by the meter as "[ai-usage] {json}": collect them (and stay quiet)
const calls = [];
const log0 = console.log;
console.log = (...a) => { const s = String(a[0]); if (s.startsWith('[ai-usage] ')) calls.push(JSON.parse(s.slice(11))); else log0(...a); };
const MAX_CALLS = 60;
const guard = () => { if (calls.length > MAX_CALLS) throw new Error(`call budget exceeded (${calls.length})`); };

const db = memoryStore({ userId: F.ALL[0].user_id });
for (const r of F.ALL) db.seed({ ...r });
const idOf = (r) => r.id;
const lineText = (rec, line) => rec.segments[line]?.t || '';
const recById = new Map(F.ALL.map((r) => [r.id, r]));

const out = { asks: [], guide: null, followups: null, totals: null };
async function ask(name, recs, question, expect) {
  const before = calls.length, t0 = Date.now();
  const r = await svc.askAcrossRecordings(db, { ids: recs.map(idOf), question, userId: 'qa' });
  const mine = calls.slice(before);
  const cost = mine.reduce((s, c) => s + (c.actualCostUsd ?? c.estimatedCostUsd ?? 0), 0);
  const cites = r.refs.map((x) => ({ rec: x.title, line: x.line, text: lineText(recById.get(x.transcriptionId), x.line) }));
  const checks = Object.fromEntries(Object.entries(expect).map(([k, fn]) => [k, !!fn(r, cites)]));
  const removed = mine.find((c) => c.task === 'across:ask')?.droppedItems ?? null; // citations of lines it wasn't given
  out.asks.push({ name, question, recordings: recs.map((x) => x.title), answer: r.answer, citations: cites, checks, invalidCitationsRemoved: removed, ms: Date.now() - t0, inputTokens: r.usage.input, outputTokens: r.usage.output, costUsd: Number(cost.toFixed(6)), mode: r.mode });
  log0(`${Object.values(checks).every(Boolean) ? 'PASS' : 'CHECK'} ${name}: ${JSON.stringify(checks)} · ${r.usage.input}+${r.usage.output} tok · $${cost.toFixed(5)} · ${Date.now() - t0} ms`);
  guard();
  return r;
}
const cited = (r, title) => r.refs.some((x) => x.title === title);

// overviews first (as the page does for recordings without one): one call each, stored with the recording
for (const r of F.ALL) await svc.generate(db, { transcriptionId: r.id, kind: 'overview', recordingType: 'general', userId: 'qa' });
guard();

await ask('contradiction + chronology', F.LECTURES, 'Does osmosis require energy from ATP?', {
  citesLecture2: (r) => cited(r, 'Biology Lecture 2'),
  citesLecture5: (r) => cited(r, 'Biology Lecture 5'),
  saysCorrected: (r) => /correct|wrong|later|revis|changed|retract/i.test(r.answer),
  finalAnswerPassive: (r) => /passive|no energy|doesn['’]t (?:need|require)|does not (?:need|require)|not require|no ATP/i.test(r.answer),
});
await ask('recurring concept', F.LECTURES, 'Which concepts came up in all three lectures?', {
  mentionsOsmosis: (r) => /osmosis/i.test(r.answer),
  citesAllThree: (r) => ['Biology Lecture 2', 'Biology Lecture 5', 'Biology Lecture 7'].every((t) => cited(r, t)),
  doesNotClaimAquaporinsEverywhere: (r) => !/aquaporin[^.]*\b(all|every|each)\b/i.test(r.answer),
});
await ask('compare one topic across two lectures', [F.LECTURE_2, F.LECTURE_5], 'Compare how osmosis was explained in Lecture 2 and Lecture 5.', {
  citesBoth: (r) => cited(r, 'Biology Lecture 2') && cited(r, 'Biology Lecture 5'),
  namesTheDifference: (r) => /ATP|energy/i.test(r.answer),
});
await ask('missing information', F.LECTURES, 'What did the lectures say about photosynthesis?', {
  saysNotCovered: (r) => /(?:not|n['’]t|no)\b[^.]*\b(?:mention|cover|discuss|come up|talk)/i.test(r.answer) || /none of/i.test(r.answer),
  noCitations: (r) => r.refs.length === 0,
});
await ask('similar titles kept apart', [F.LECTURE_5, F.LECTURE_5_REVIEW], 'What did each of these recordings cover?', {
  citesBoth: (r) => cited(r, 'Biology Lecture 5') && cited(r, 'Biology Lecture 5 — review session'),
  reviewIsOrganelles: (r) => /organelle|mitochondri|ribosom/i.test(r.answer),
});
await ask('decision changed between meetings', F.MEETINGS, 'What decisions changed between these meetings?', {
  mondayThenWednesday: (r) => /monday/i.test(r.answer) && /wednesday/i.test(r.answer),
  givesReason: (r) => /QA|bug/i.test(r.answer),
  citesBoth: (r) => cited(r, 'Team sync — Oct 6') && cited(r, 'Team sync — Oct 13'),
});
await ask('repeated action item', F.MEETINGS, 'Which action items came up more than once?', {
  pricingTable: (r) => /pricing table/i.test(r.answer),
  citesBoth: (r) => cited(r, 'Team sync — Oct 6') && cited(r, 'Team sync — Oct 13'),
});
await ask('mixed collection stays on topic', F.ALL.slice(0, 6), 'When is the beta launch?', {
  wednesday: (r) => /wednesday/i.test(r.answer),
  onlyMeetingsCited: (r) => r.refs.every((x) => /Team sync/.test(x.title)),
});

// ---------- a long collection: the same three lectures inside ~1.5 hours of unrelated talk each → retrieval mode
const FILLER = ['Please remember to bring safety goggles to the lab on Thursday.', 'The reading for next week is chapter four, sections one to three.', 'Office hours move to room two hundred and twelve this month.', 'If you missed the field trip form, email the department office.', 'The library extended its opening hours during the exam period.', 'Group projects should have four members, five at most.', 'We will have a guest speaker from the hospital in November.', 'Late homework loses ten percent per day, as the syllabus says.', 'The parking lot behind the science building is closed for repairs.', 'Lab reports must include a title page and a references section.'];
const pad = (r, n) => {
  const lines = r.segments.map((s) => [s.sp, s.t]);
  const filler = Array.from({ length: 250 }, (_, i) => ['Speaker 1', `${FILLER[(i + n) % FILLER.length]} (${n}.${i})`]);
  const all = [...filler.slice(0, 120), ...lines, ...filler.slice(120)];
  return { ...r, id: r.id.replace(/^bbbbbbbb/, 'cccccccc'), title: `${r.title} (full session)`, segments: all.map(([sp, t], i) => ({ s: i * 22, e: i * 22 + 20, sp, t })), duration_seconds: all.length * 22 };
};
const LONG = F.LECTURES.map((r, i) => pad(r, i));
for (const r of LONG) db.seed({ ...r });
for (const r of LONG) recById.set(r.id, r);
await ask('long collection (retrieval mode)', LONG, 'Does osmosis require energy from ATP?', {
  retrievalMode: (r) => r.mode === 'retrieval',
  citesTheCorrection: (r) => r.refs.some((x) => /Lecture 5/.test(x.title)),
  finalAnswerPassive: (r) => /passive|no energy|doesn['’]t (?:need|require)|does not (?:need|require)|not require|no ATP/i.test(r.answer),
  noFillerCited: (r) => r.refs.every((x) => !FILLER.some((f) => (recById.get(x.transcriptionId).segments[x.line]?.t || '').startsWith(f))),
});

// ---------- combined study guide (3 lectures): each lecture's own study guide first (stored maps), then one call
const g0 = calls.length, gt = Date.now();
for (const r of F.LECTURES) await svc.generateArtifact(db, { transcriptionId: r.id, kind: 'study_guide', userId: 'qa' });
const mapCost = calls.slice(g0).reduce((s, c) => s + (c.actualCostUsd ?? c.estimatedCostUsd ?? 0), 0);
const g1 = calls.length, gt1 = Date.now();
const gd = await svc.guideAcrossRecordings(db, { ids: F.LECTURES.map(idOf), focus: 'exam', userId: 'qa' });
const guideCost = calls.slice(g1).reduce((s, c) => s + (c.actualCostUsd ?? c.estimatedCostUsd ?? 0), 0);
out.guide = {
  themes: gd.content.themes.map((t) => ({ title: t.title, recordings: t.recordings, summary: t.summary, comparison: t.comparison, sources: t.sources.map((s) => `${s.title} · ${s.concept}`) })),
  definitions: gd.content.definitions.map((d) => d.term), selfCheck: gd.content.self_check.map((q) => q.question),
  recurring: gd.content.recurring, dropped: gd.dropped,
  checks: {
    osmosisRecurs: gd.content.themes.some((t) => /osmosis|water/i.test(t.title + t.summary) && t.recordings.length >= 2),
    notesTheCorrection: gd.content.themes.some((t) => /ATP|energy|passive/i.test(`${t.summary} ${t.comparison || ''}`)),
    everyItemSourced: [...gd.content.themes, ...gd.content.definitions, ...gd.content.distinctions, ...gd.content.self_check].every((x) => x.sources.length),
  },
  mapsCostUsd: Number(mapCost.toFixed(6)), mapsMs: gt1 - gt, guideCostUsd: Number(guideCost.toFixed(6)), guideMs: Date.now() - gt1,
  guideTokens: gd.usage,
};
log0(`GUIDE ${JSON.stringify(out.guide.checks)} · maps $${mapCost.toFixed(5)} (${gt1 - gt} ms) · guide $${guideCost.toFixed(5)} (${Date.now() - gt1} ms)`);
guard();

// ---------- Focused Review: a quiz on Lecture 5, then follow-ups for its first concept
const q0 = calls.length;
const quiz = (await svc.generateArtifact(db, { transcriptionId: F.LECTURE_5.id, kind: 'quiz', userId: 'qa' })).artifact;
const quizCost = calls.slice(q0).reduce((s, c) => s + (c.actualCostUsd ?? c.estimatedCostUsd ?? 0), 0);
const concept = quiz.content.questions[0].concept;
const f0 = calls.length, ft = Date.now();
const fu = await svc.generateFollowups(db, { transcriptionId: F.LECTURE_5.id, artifactId: quiz.id, conceptIds: [concept], userId: 'qa' });
const fuCost = calls.slice(f0).reduce((s, c) => s + (c.actualCostUsd ?? c.estimatedCostUsd ?? 0), 0);
const conceptObj = quiz.content.map.concepts.find((c) => c.id === concept);
out.followups = {
  quizQuestions: quiz.content.questions.length, quizCostUsd: Number(quizCost.toFixed(6)),
  concept: conceptObj?.name, conceptSummary: conceptObj?.summary,
  original: quiz.content.questions.filter((q) => q.concept === concept).map((q) => q.question),
  added: fu.added, questions: (fu.artifact.content.followups || []).map((q) => ({ question: q.question, answer: q.answer, options: q.options, refs: q.refs })),
  costUsd: Number(fuCost.toFixed(6)), ms: Date.now() - ft, tokens: fu.usage,
};
log0(`FOLLOWUPS +${fu.added} for "${conceptObj?.name}" · $${fuCost.toFixed(5)} · ${Date.now() - ft} ms`);

const total = calls.reduce((s, c) => s + (c.actualCostUsd ?? c.estimatedCostUsd ?? 0), 0);
out.totals = { calls: calls.length, costUsd: Number(total.toFixed(6)), models: [...new Set(calls.map((c) => c.model))] };
writeFileSync(resolve(ROOT, 'qa/out/across-real.json'), JSON.stringify(out, null, 2));
log0(`\n${out.asks.filter((a) => Object.values(a.checks).every(Boolean)).length}/${out.asks.length} questions passed every check · ${calls.length} calls · $${total.toFixed(4)} total → qa/out/across-real.json`);
void estimateCost;
