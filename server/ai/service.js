// SparkScribe intelligence: everything built on top of a saved transcript.
//
//   generateOverview()        short summary + key points + chapters, in ONE model call
//   generateDetailedSummary() structured summary for the recording type
//   generateNotes()           organized reference / study notes for the recording type
//   generateInsights()        type-specific extraction (actions, decisions, dates, quotes…)
//   askTranscript()           grounded Q&A with timestamp citations, streamed
//   generateArtifact()        Phase 5 tools from the Create tab (study guide, flashcards, quiz, recap, drafts…)
//   (cleanTranscript is rule-based and runs in the browser: src/lib/clean.js)
//
// Cost rules enforced here:
//   * a result is generated once per (transcript version, kind, recording type) and then read from the
//     database; nothing regenerates unless the transcript changed or the user asks;
//   * concurrent requests for the same result share one generation instead of starting another;
//   * every prompt stays under ~90k tokens (Haiku's cheaper price band); longer transcripts are analysed
//     in parts and the partial results merged;
//   * Ask sends only the relevant excerpts of long transcripts, and repeated questions are answered from
//     the stored answer.
import { getProvider, taskConfig, AIError } from './provider.js';
import { createMeter } from './usage.js';
import { GRADE_SYSTEM, GRADE_SCHEMA, gradeInstructions, ANALYST_SYSTEM, ASK_SYSTEM, OVERVIEW_SCHEMA, overviewInstructions, DETAILED_SCHEMA, detailedInstructions, NOTES_SCHEMA, notesInstructions, INSIGHT_SPECS, EXPAND_SCHEMA, expandInstructions } from './prompts.js';
import { groundStructured, groundChapters, groundAnswer } from './grounding.js';
import { TOOLS, ARTIFACT_KINDS, normalizeSettings, cardCount, questionCount, examBacked } from './tools.js';
import { FILL_SCHEMA, fillInstructions, uncoveredConcepts, inheritRefs } from './study.js';
import { studyItems, studyGuide, followupQuestions, studyMap, storedMap } from './studyrun.js';
import { INSTRUCTIONS_MISSING } from '../../src/lib/tool-settings.js';
import { selectContext, needsRetrieval, formatExcerpts } from './retrieve.js';
import { askAcross, guideAcross } from './across.js';
import { requireCapability } from '../entitlements.js';
import { segmentsFromRow, modelLine, estimateTokens, normalizeRecordingType, RECORDING_TYPES, isNotFound, refersToPlayback, isFollowUp, fmtClock } from '../../src/lib/segments.js';
import { speakerTable, dominantSpeaker, codedLine, tokenizeSpeakers, transcriptBasis, sameBasis, speakerResolver, renderSpeakers, origCodes, origResolver } from '../../src/lib/speaker-refs.js';

const PART_TOKENS = 80_000;
// A request that started a generation and then died (function timeout, closed tab) leaves the row "generating".
// Another request may take it over only after the first could no longer be running, or the same result is paid
// for twice: api/insights and api/ask run at most 60 s, api/tools 300 s (vercel.json).
const INSIGHT_TAKEOVER_MS = 75_000;
const ARTIFACT_TAKEOVER_MS = 310_000;
// Per-user AI usage limits (database ledger: supabase/proposed/*_ai_usage_limits.sql). Every action that reaches
// the model reserves a slot first (cached results never do) and is settled with its real tokens and cost after the
// call. Whether anything is refused is decided in the database per plan (off until switched on). Without the
// database functions, everything runs unlimited, as before.
const EXPECTED_OUTPUT_TOKENS = { ask: 400, overview: 900, detailed_summary: 1800, notes: 2200, insights: 1800, grade: 150 };
export function estimateMicrousd(feature, promptTokens) {
  // Haiku 5.5 base rates: $0.10 / M input = 0.1 µ$ per token, $0.50 / M output = 0.5 µ$ per token
  const [head, tool] = String(feature).split(':');
  const last = String(feature).split(':').pop();
  const kind = head === 'tool' ? 'tool' : EXPECTED_OUTPUT_TOKENS[last] != null ? last : head; // e.g. quiz:grade -> grade
  // study engine 2 writes a knowledge map before the cards / questions (measured: ~5–9k output tokens)
  const out = head === 'tool' && (tool === 'flashcards' || tool === 'quiz') ? 9000 : EXPECTED_OUTPUT_TOKENS[kind] ?? 3000;
  return Math.round(Math.max(0, promptTokens) * 0.1 + out * 0.5);
}
// what one action sends: analyses read the whole transcript (in parts when long); Ask sends at most one part
const promptTokensOf = (segments, { whole = false } = {}) => {
  const t = estimateTokens(segments.map(modelLine).join('\n'));
  return whole ? Math.min(t, MAX_TRANSCRIPT_TOKENS) : Math.min(t, PART_TOKENS);
};
async function reserveAi(db, meter, promptTokens) {
  if (typeof db.reserveAi !== 'function') return null;
  const slot = await db.reserveAi(meter.feature, estimateMicrousd(meter.feature, promptTokens));
  if (slot && slot.allowed === false) {
    meter.refused(slot.reason);
    if (slot.reason === 'paused') { // the service-wide daily breaker (billing_settings.ai_daily_budget_microusd)
      throw new AIError("SparkScribe's AI tools are paused for a few hours because of unusually high demand. Transcription still works; please try the AI tools again later.", { status: 503, code: 'ai_paused' });
    }
    if (slot.reason === 'unavailable') {
      throw new AIError("SparkScribe's AI is briefly unavailable. Nothing was used; try again in a minute.", { status: 503, code: 'ai_unavailable' });
    }
    if (slot.reason === 'hourly') {
      const mins = Math.max(1, Math.ceil((slot.retry_after_s || 600) / 60));
      throw new AIError(`You've used SparkScribe's AI a lot in the last hour. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`, { status: 429, code: 'rate_limited' });
    }
    const when = slot.period_end ? new Date(slot.period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'next month';
    throw new AIError(`You've used this month's AI allowance on your plan. It renews on ${when}.`, { status: 429, code: 'quota_exceeded' });
  }
  meter.slot = slot?.id ?? null;
  if (meter.slot != null && typeof db.settleAi === 'function') meter.onSettle = (ok, totals) => db.settleAi(meter.slot ?? slot.id, ok, totals);
  return slot;
}
// The quiz grader reads the question from the user's own stored quiz, which the browser can write: bound every
// field so it can't be turned into a large, general-purpose prompt.
export function gradePromptFields(q, lines, given) {
  const cut = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    question: cut(q.question, 300), expected: cut(q.answer, 200),
    accept: (Array.isArray(q.accept) ? q.accept : []).slice(0, 8).map((a) => cut(a, 120)),
    explanation: cut(q.explanation, 400), evidence: cut([q.evidence, lines].filter(Boolean).join(' / '), 1200), answer: cut(given, 200),
  };
}
const MAX_TRANSCRIPT_TOKENS = 600_000; // ~30+ hours of speech; beyond this we refuse rather than run up cost
export const KINDS = ['overview', 'detailed_summary', 'notes', 'insights'];
const CHAPTER_MIN_MINUTES = 8;

function transcriptHeader(row, segments) {
  const speakers = [...new Set(segments.map((s) => s.speaker))].filter((s) => s !== 'Unknown');
  const mins = Math.round((row.duration_seconds || segments.at(-1)?.end || 0) / 60);
  return `Recording length: about ${mins} minute${mins === 1 ? '' : 's'}. Speakers: ${speakers.join(', ') || 'unknown'}.`;
}

// Create tools: the transcript with speaker codes. The model writes {{S1}} for a speaker; the result shows each
// speaker's current name (lib/speaker-refs.js), so renaming later needs no new generation.
function codedHeader(row, segments, { table, shares }) {
  const mins = Math.round((row.duration_seconds || segments.at(-1)?.end || 0) / 60);
  const who = Object.entries(table).map(([code, t]) => `${code} = "${t.name}" (${Math.round((shares[code] || 0) * 100)}% of the words)`).join(', ');
  return `Recording length: about ${mins} minute${mins === 1 ? '' : 's'}. Speakers, shown in the transcript by code: ${who || 'unknown'}. "Unknown" lines are from an unidentified speaker. Whenever your output refers to a speaker, write their code in double braces, e.g. {{S1}}; the app shows the speaker's current name there. Never write a speaker's name or code any other way.`;
}

// Split the transcript into parts that each fit one prompt.
function parts(segments) {
  const out = [];
  let cur = [], tokens = 0;
  for (const s of segments) {
    const t = estimateTokens(modelLine(s)) + 1;
    if (cur.length && tokens + t > PART_TOKENS) { out.push(cur); cur = []; tokens = 0; }
    cur.push(s);
    tokens += t;
  }
  if (cur.length) out.push(cur);
  return out;
}

const userMessage = (header, segs, instructions, line = modelLine) => ({
  role: 'user',
  content: [
    // No prompt caching: each analysis uses a different output schema, which changes the cached prefix, so
    // in testing cache writes (+25% input price) were never read back.
    { type: 'text', text: `${header}\n<transcript>\n${segs.map(line).join('\n')}\n</transcript>` },
    { type: 'text', text: instructions },
  ],
});

// One structured analysis over the whole transcript (map-reduce when it doesn't fit one prompt).
// `speakers` (Create tools): lines show speaker codes ("S1") instead of names, and the header says who is who.
async function analyze({ task, schema, instructions, row, segments, meter, speakers = null, mergeNote = '' }) {
  const ai = getProvider();
  const cfg = taskConfig(task);
  const header = speakers ? codedHeader(row, segments, speakers) : transcriptHeader(row, segments);
  const line = speakers ? (s) => codedLine(s, speakers.codeOf, fmtClock) : modelLine;
  const usage = { input: 0, output: 0 };
  const run = async (segs, extra = '') => {
    const r = await meter.call(task, () => ai.complete({ task, ...cfg, system: ANALYST_SYSTEM, schema, messages: [userMessage(header, segs, instructions + extra, line)] }));
    usage.input += r.usage.input; usage.output += r.usage.output;
    return r;
  };
  const chunks = parts(segments);
  if (chunks.length === 1) {
    const r = await run(segments);
    return { json: r.json, model: r.model, usage };
  }
  // long recording: analyse each part, then merge the partial results (small) in one more call
  const partial = [];
  for (const [i, p] of chunks.entries()) {
    const r = await run(p, `\n\n(This is part ${i + 1} of ${chunks.length} of a long recording; analyse this part only.)`);
    partial.push(r.json);
  }
  const reduce = taskConfig('reduce');
  const r = await meter.call(`${task}:merge`, () => ai.complete({
    task, ...reduce, system: ANALYST_SYSTEM, schema,
    messages: [{ role: 'user', content: `${header}\nA long recording was analysed in ${chunks.length} consecutive parts. Merge these partial results into one result for the whole recording, following the same instructions. Keep the line-number refs exactly as given (they refer to the full transcript), remove duplicates, and keep the most important items.${mergeNote}\n\nInstructions for the result:\n${instructions}\n\nPartial results in order:\n${partial.map((p, i) => `<part n="${i + 1}">\n${JSON.stringify(p)}\n</part>`).join('\n')}` }],
  }));
  usage.input += r.usage.input; usage.output += r.usage.output;
  return { json: r.json, model: r.model, usage };
}

async function generateOverview(row, segments, _type, meter, speakers) {
  const minutes = (row.duration_seconds || segments.at(-1)?.end || 0) / 60;
  const withChapters = minutes >= CHAPTER_MIN_MINUTES && segments.length >= 6;
  const r = await analyze({ task: 'overview', schema: OVERVIEW_SCHEMA, instructions: overviewInstructions({ minutes, withChapters }), row, segments, meter, speakers });
  const { content, dropped } = groundStructured({ short_summary: r.json.short_summary, key_points: r.json.key_points }, segments);
  const rawChapters = withChapters ? (r.json.chapters || []).length : 0;
  content.chapters = withChapters ? groundChapters(r.json.chapters, segments) : [];
  return { ...r, content, dropped: dropped + Math.max(0, rawChapters - content.chapters.length) };
}

async function generateDetailedSummary(row, segments, type, meter, speakers) {
  const r = await analyze({ task: 'detailed_summary', schema: DETAILED_SCHEMA, instructions: detailedInstructions(type), row, segments, meter, speakers });
  const { content, dropped } = groundStructured(r.json, segments);
  content.sections = content.sections.filter((s) => s.points.length);
  return { ...r, content, dropped };
}

async function generateInsights(row, segments, type, meter, speakers) {
  const spec = INSIGHT_SPECS[type] || INSIGHT_SPECS.general;
  const r = await analyze({ task: `insights:${type}`, schema: spec.schema, instructions: spec.instructions, row, segments, meter, speakers });
  const { content, dropped } = groundStructured(r.json, segments);
  let moved = 0;
  if (type === 'lecture' && Array.isArray(content.exam_points)) {
    // an exam point needs exam wording in its own quote or line; otherwise it is only worth reviewing
    const exam = [];
    for (const it of content.exam_points) {
      if (examBacked(it, segments)) exam.push(it);
      else { moved++; (content.worth_reviewing ||= []).push({ text: it.text, refs: it.refs }); }
    }
    content.exam_points = exam;
  }
  return { ...r, content, dropped: dropped + moved };
}

async function generateNotes(row, segments, type, meter, speakers) {
  const r = await analyze({ task: 'notes', schema: NOTES_SCHEMA, instructions: notesInstructions(type), row, segments, meter, speakers });
  const { content, dropped } = groundStructured(r.json, segments);
  const ids = new Set(segments.map((s) => s.id));
  content.sections = content.sections
    .filter((s) => s.items.length)
    // a section's timestamp must be a real line: otherwise use its first supported note
    .map((s) => ({ ...s, start_ref: ids.has(Number(s.start_ref)) ? Number(s.start_ref) : s.items[0].refs[0] }));
  return { ...r, content, dropped };
}

const GENERATORS = { overview: generateOverview, detailed_summary: generateDetailedSummary, notes: generateNotes, insights: generateInsights };

function publicArtifact(a) {
  return {
    id: a.id, kind: a.kind, settings: a.settings, settingsKey: a.settings_key, status: a.status,
    content: a.content ?? null, error: a.status === 'failed' ? a.error : null, sourceVersion: a.source_version,
    progress: a.progress ?? null, updatedAt: a.updated_at,
  };
}

function publicInsight(i) {
  return {
    // a failed update still carries the previous result (with that result's version), so it stays visible
    kind: i.kind, recordingType: i.recording_type, status: i.status, content: i.status === 'ready' || i.status === 'failed' ? i.content ?? null : null,
    error: i.status === 'failed' ? i.error : null, sourceVersion: i.source_version, updatedAt: i.updated_at,
  };
}

async function loadTranscript(db, transcriptionId) {
  const row = await db.getTranscription(transcriptionId);
  if (!row) throw new AIError("This transcript doesn't exist or isn't yours.", { status: 404, code: 'not_found' });
  const { segments, coarse } = segmentsFromRow(row);
  if (!segments.length) throw new AIError('This transcript has no text to analyse.', { status: 422, code: 'empty' });
  if (estimateTokens(segments.map(modelLine).join('\n')) > MAX_TRANSCRIPT_TOKENS) {
    throw new AIError('This transcript is too long to analyse.', { status: 422, code: 'too_long' });
  }
  return { row, segments, coarse };
}

// Everything already generated for a transcript (no model calls).
export async function getState(db, transcriptionId) {
  const row = await db.getTranscription(transcriptionId);
  if (!row) throw new AIError("This transcript doesn't exist or isn't yours.", { status: 404, code: 'not_found' });
  const [insights, questions, artifacts] = await Promise.all([db.listInsights(transcriptionId), db.listQuestions(transcriptionId), db.listArtifacts(transcriptionId)]);
  return {
    contentVersion: row.content_version,
    recordingType: RECORDING_TYPES.includes(row.recording_type) ? row.recording_type : null,
    insights: insights.map(publicInsight),
    questions: questions.map((q) => ({ id: q.id, question: q.question, answer: q.answer, refs: q.refs, found: q.found, sourceVersion: q.source_version, createdAt: q.created_at })),
    // the study map built ahead of time is internal (the study tools read it), never a result to show
    artifacts: artifacts.filter((a) => a.kind !== 'study_map').map(publicArtifact),
  };
}

// Phase 5: generate (or return the stored) output of one tool with given settings. Same cost rules as above:
// stored results are reused for the same (version, kind, settings); only an explicit force regenerates.
export async function generateArtifact(db, { transcriptionId, kind, settings, force = false, userId = null }) {
  if (!ARTIFACT_KINDS.includes(kind)) throw new AIError('Unknown tool.', { status: 400, code: 'bad_request' });
  const tool = TOOLS[kind];
  const { settings: normalized, key } = normalizeSettings(kind, settings);
  // a draft is about what the user asked for; without a request there is nothing to write
  if (INSTRUCTIONS_MISSING[kind] && !normalized.instructions) throw new AIError(INSTRUCTIONS_MISSING[kind], { status: 400, code: 'bad_request' });
  const meter = createMeter({ feature: key ? `tool:${kind}:${key}` : `tool:${kind}`, transcriptionId, userId });
  const { row, segments } = await loadTranscript(db, transcriptionId);
  const version = row.content_version;
  const fromStorage = async (a) => { await meter.finish({ cached: true }); return { artifact: publicArtifact(a), cached: true }; };

  const existing = await db.getArtifact(transcriptionId, kind, key);
  // a result is current for the transcript's version, or for any later version that only renamed speakers
  const basis = transcriptBasis(segments);
  const current = (a) => a.source_version === version || sameBasis(a.content?.basis, basis);
  if (existing) {
    if (existing.status === 'ready' && current(existing) && !force) return fromStorage(existing);
    if (existing.status === 'generating' && Date.now() - new Date(existing.updated_at).getTime() < ARTIFACT_TAKEOVER_MS) return fromStorage(existing);
  }
  await reserveAi(db, meter, promptTokensOf(segments, { whole: true }));
  // remembered before the row is claimed: a failed update falls back to the previous result and its version
  const previous = existing?.content ? existing.source_version : null;
  const claimed = await db.startArtifact(existing, { transcriptionId, kind, settings: normalized, settingsKey: key, version });
  if (!claimed) return fromStorage(await db.getArtifact(transcriptionId, kind, key));

  try {
    const started = Date.now();
    const minutes = (row.duration_seconds || segments.at(-1)?.end || 0) / 60;
    const speakers = speakerTable(segments);
    let count = kind === 'flashcards' ? cardCount(minutes, normalized.size) : kind === 'quiz' ? questionCount(minutes, normalized.size) : null;
    if (count && normalized.focus === 'essentials') count = Math.max(5, Math.round(count * 0.6));
    const ctx = {
      count,
      transcriptText: segments.map((s) => s.text).join(' '),
      settings: normalized,
      codeOf: speakers.codeOf,
      dominant: dominantSpeaker(speakers.shares),
    };
    let g, r, extra = 0;
    if (tool.engine === 3) {
      // study engine 3 (studyrun.js): several smaller calls, metered one by one, results summed here
      r = { usage: { input: 0, output: 0 }, model: null };
      const call = engineCall({ row, segments, speakers, meter, r });
      const args = { kind, tool, db, transcriptionId, segments, speakers, basis, ctx, call, started };
      const out = kind === 'study_guide' ? await studyGuide(args) : await studyItems(args);
      g = { content: out.content, dropped: 0 };
      extra = Object.entries(out.content.quality || {}).filter(([k]) => !['kept', 'selected', 'sections', 'map_reused', 'ideas', 'filled', 'core_uncovered', 'explanation_removed', 'speaker_reference_fixed', 'cautions', 'unseen_names', 'verify_fixed', 'unmapped'].includes(k)).reduce((n, [, v]) => n + (Number(v) || 0), 0);
    } else {
      const instructions = tool.instructions(ctx) + (tool.focusNote?.[normalized.focus] || '');
      r = await analyze({
        task: tool.task, schema: tool.schema, instructions, row, segments, meter, speakers,
        mergeNote: tool.engine ? ' Concept ids from different parts may clash: give every concept a unique id and update the items that point to it.' : '',
      });
      tool.beforeGrounding?.(r.json);
      if (tool.itemsKey) ctx.rawConceptIds = new Set((r.json?.concepts || []).map((k) => String(k?.id)));
      g = groundStructured(r.json, segments);
      g.content = tokenizeSpeakers(g.content, speakers.codeOf);
      const firstPass = tool.itemsKey ? structuredClone(g.content[tool.itemsKey] || []) : null;
      extra = tool.validate(g.content, segments, ctx) || 0;
      // coverage pass (study engine 2): core concepts still without an item get one more, small call
      if (tool.itemsKey) {
        // untested concepts while the ceiling allows: core first, then supporting (never minor or unreliable)
        const room = ctx.count - g.content[tool.itemsKey].length;
        const missing = uncoveredConcepts(g.content.concepts, g.content[tool.itemsKey], { supporting: true }).slice(0, Math.max(0, room));
        // only while time is left: api/tools may run 300 s in all (vercel.json), the main call up to 170 s
        if (missing.length && g.content[tool.itemsKey].length < ctx.count && Date.now() - started < 150_000) {
          const filled = await fillCoverage({ kind, tool, missing, row, segments, speakers, ctx, meter, usage: r.usage });
          if (filled.length) {
            // the whole set is checked again, so duplicates and limits apply across both passes
            g.content[tool.itemsKey] = [...firstPass, ...filled];
            delete g.content.quality;
            extra = tool.validate(g.content, segments, ctx) || 0;
            g.content.quality.filled = g.content[tool.itemsKey].filter((x) => missing.some((m) => String(m.id) === x.concept)).length;
          }
        }
      }
    }
    tool.after?.(g.content, segments, ctx);
    if (ctx.count) g.content.target = ctx.count;
    // what's needed to show current speaker names later, and to tell a rename from a real change
    g.content.speakers = speakers.table;
    g.content.basis = basis;
    if (tool.engine) g.content.engine = tool.engine;
    const saved = await db.finishArtifact(claimed.id, { content: g.content, model: r.model, usage: r.usage });
    await meter.finish({ groundingPassed: g.dropped + extra === 0, droppedItems: g.dropped + extra });
    return { artifact: publicArtifact(saved), cached: false, dropped: g.dropped + extra };
  } catch (err) {
    const message = err instanceof AIError ? err.message : 'Generation failed.';
    await meter.finish({ error: message });
    await db.failArtifact(claimed.id, message, previous).catch(() => {});
    throw err instanceof AIError ? err : new AIError(message);
  }
}

// one model call of study engine 3, metered on its own; the tokens add up in r (the result's usage and model)
function engineCall({ row, segments, speakers, meter, r }) {
  return async ({ task, schema, body, instructions }) => {
    const ai = getProvider();
    const x = await meter.call(task, () => ai.complete({
      task, ...taskConfig(task), system: ANALYST_SYSTEM, schema,
      messages: [{ role: 'user', content: [{ type: 'text', text: `${codedHeader(row, segments, speakers)}${body ? `\n${body}` : ''}` }, { type: 'text', text: instructions }] }],
    }));
    r.usage.input += x.usage.input; r.usage.output += x.usage.output; r.model = x.model;
    return x;
  };
}

// The study map ahead of time (owner decision 2026-10-27): the Create tab asks for it when it opens, so a quiz or
// flashcards started a moment later skip the slowest step. Saved as a 'study_map' row (never shown, see getState)
// that studyMap() reuses like the map of any engine-3 result, and a quiz started while it is being built waits for
// it. Nothing is done (and nothing reserved or paid) when a current map already exists or one is being built.
export const STUDY_MAP_KEY = 'g2';
export async function prepareStudyMap(db, { transcriptionId, userId = null }) {
  const { row, segments } = await loadTranscript(db, transcriptionId);
  // only where the study tools are what Create offers first: not for meetings, interviews, podcasts or voice notes
  if (['meeting', 'interview', 'podcast', 'voice_message'].includes(normalizeRecordingType(row.recording_type))) return { ready: false, skipped: true };
  const basis = transcriptBasis(segments);
  const arts = await db.listArtifacts(transcriptionId);
  if (storedMap(arts, basis)) return { ready: true, cached: true };
  const existing = arts.find((a) => a.kind === 'study_map' && a.settings_key === STUDY_MAP_KEY) || null;
  if (existing?.status === 'generating' && Date.now() - new Date(existing.updated_at).getTime() < ARTIFACT_TAKEOVER_MS) return { ready: false, building: true };
  const meter = createMeter({ feature: 'tool:study_map', transcriptionId, userId });
  await reserveAi(db, meter, promptTokensOf(segments, { whole: true }));
  let claimed;
  // a refused claim (e.g. the database doesn't know this kind yet) settles the reservation: nothing is counted
  try { claimed = await db.startArtifact(existing, { transcriptionId, kind: 'study_map', settings: {}, settingsKey: STUDY_MAP_KEY, version: row.content_version }); }
  catch (err) { await meter.finish({ error: 'The study map could not be saved.' }); throw err; }
  if (!claimed) { await meter.finish({ cached: true }); return { ready: false, building: true }; }
  try {
    const speakers = speakerTable(segments);
    const r = { usage: { input: 0, output: 0 }, model: null };
    const { map, sections } = await studyMap({ db, transcriptionId, segments, speakers, basis, call: engineCall({ row, segments, speakers, meter, r }), wait: false });
    const content = { engine: 3, map, basis, speakers: speakers.table, quality: { sections } };
    await db.finishArtifact(claimed.id, { content, model: r.model, usage: r.usage });
    await meter.finish({});
    return { ready: true, cached: false };
  } catch (err) {
    const message = err instanceof AIError ? err.message : 'The study map could not be built.';
    await meter.finish({ error: message });
    await db.failArtifact(claimed.id, message, existing?.content ? existing.source_version : null).catch(() => {});
    throw err instanceof AIError ? err : new AIError(message);
  }
}

// Coverage pass: items for concepts the first pass left untested, written from the lines that explain them
// (each concept's lines ± 2), so it costs a fraction of the first call. Returns grounded items with speaker codes.
async function fillCoverage({ kind, tool, missing, row, segments, speakers, ctx, meter, usage }) {
  const ids = new Set();
  for (const k of missing) for (const ref of k.refs || []) for (let d = -2; d <= 2; d++) ids.add(ref + d);
  const excerpt = segments.filter((s) => ids.has(s.id)).slice(0, 240);
  if (!excerpt.length) return [];
  try {
    const r = await analyze({
      task: `${tool.task}:fill`, schema: FILL_SCHEMA[kind], row, segments: excerpt, meter, speakers,
      instructions: fillInstructions(kind, { concepts: missing, settings: ctx.settings, dominant: ctx.dominant }),
    });
    usage.input += r.usage.input; usage.output += r.usage.output;
    const items = r.json?.[tool.itemsKey] || [];
    inheritRefs(items, { concepts: missing });
    const g = groundStructured({ [tool.itemsKey]: items }, segments);
    return tokenizeSpeakers(g.content, speakers.codeOf)[tool.itemsKey] || [];
  } catch {
    return []; // the first pass stands on its own; coverage is a bonus
  }
}

// Practice Quiz: grade one short answer by meaning. The browser sends only which stored question (quiz id +
// index) and the learner's answer; the question, expected answer and the recording's words come from the
// database (Row Level Security: the user's own quiz), so this can't be used as a general-purpose model.
// One small Haiku call; obvious matches are already accepted in the browser without calling this.
export async function gradeShortAnswer(db, { transcriptionId, artifactId, index, answer, userId = null }) {
  const given = String(answer || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!given) throw new AIError('Type an answer first.', { status: 400, code: 'bad_request' });
  const artifacts = await db.listArtifacts(transcriptionId);
  const quiz = artifacts.find((a) => a.id === artifactId && a.kind === 'quiz' && a.status === 'ready');
  // the quiz's own questions, then the follow-ups written for Focused Review (same indexes as the browser)
  const q = [...(quiz?.content?.questions || []), ...(quiz?.content?.followups || [])][Number(index)];
  if (!q || q.type !== 'short_answer') throw new AIError("That quiz question doesn't exist.", { status: 404, code: 'not_found' });
  const { segments } = await loadTranscript(db, transcriptionId);
  const lines = (q.refs || []).map((r) => segments.find((s) => s.id === r)).filter(Boolean).map((s) => s.text).join(' ');
  const meter = createMeter({ feature: 'quiz:grade', transcriptionId, userId });
  await reserveAi(db, meter, 600); // a bounded grading prompt (gradePromptFields)
  try {
    const ai = getProvider();
    // a quiz from study engine 2 refers to speakers by code: grade with the names the learner sees now
    const nowName = speakerResolver(quiz.content.speakers, segments);
    const named = (t) => renderSpeakers(t, (code) => (quiz.content.speakers?.[code] ? nowName(code) : 'the speaker'));
    const qNamed = { ...q, question: named(q.question), answer: named(q.answer), explanation: named(q.explanation || ''), accept: (q.accept || []).map(named) };
    const r = await meter.call('grade', () => ai.complete({
      task: 'grade', ...taskConfig('grade'), system: GRADE_SYSTEM, schema: GRADE_SCHEMA,
      messages: [{ role: 'user', content: gradeInstructions(gradePromptFields(qNamed, lines, given)) }],
    }));
    const j = r.json || {};
    const verdict = ['correct', 'close', 'incorrect'].includes(j.verdict) ? j.verdict : 'incorrect';
    await meter.finish({});
    return { verdict, feedback: String(j.feedback || '').slice(0, 240), corrected: typeof j.corrected === 'string' ? j.corrected.slice(0, 200) : null };
  } catch (err) {
    await meter.finish({ error: err?.message || 'failed' });
    throw err instanceof AIError ? err : new AIError("Your answer couldn't be checked.");
  }
}

// Focused Review: new practice questions for concepts a learner keeps missing in one of their quizzes. The browser
// sends only the quiz and the concept ids; the concepts, their passages and the questions already seen come from
// the stored quiz (the user's own, under Row Level Security). The new questions are added to the quiz as
// `followups` (its own questions and their indexes never change; progress is untouched).
export const MAX_FOLLOWUPS = 30;          // per quiz: bounds what one quiz can cost in follow-ups
const FOLLOWUP_CONCEPTS = 6;              // per request
export async function generateFollowups(db, { transcriptionId, artifactId, conceptIds, userId = null }) {
  // Bolt and up: checked first, before the quiz or transcript is read and before any AI call
  await requireCapability(db, 'followup_practice');
  const ids = [...new Set((Array.isArray(conceptIds) ? conceptIds : []).map((x) => String(x).slice(0, 20)))].slice(0, FOLLOWUP_CONCEPTS);
  if (!ids.length) throw new AIError('Choose what to practise first.', { status: 400, code: 'bad_request' });
  const quiz = (await db.listArtifacts(transcriptionId)).find((a) => a.id === artifactId && a.kind === 'quiz' && a.status === 'ready');
  if (!quiz?.content?.map?.concepts?.length) throw new AIError("This quiz can't be reviewed by concept.", { status: 404, code: 'not_found' });
  const { row, segments } = await loadTranscript(db, transcriptionId);
  const basis = transcriptBasis(segments);
  if (!(quiz.source_version === row.content_version || sameBasis(quiz.content.basis, basis))) {
    throw new AIError('The transcript changed after this quiz was written. Update the quiz first.', { status: 409, code: 'stale' });
  }
  const have = quiz.content.followups || [];
  if (have.length >= MAX_FOLLOWUPS) throw new AIError('This quiz already has as many practice questions as it can hold. Write new questions for the quiz to start fresh.', { status: 409, code: 'limit' });
  const concepts = quiz.content.map.concepts.filter((c) => ids.includes(String(c.id)) && c.clarity !== 'unreliable');
  if (!concepts.length) throw new AIError("Those concepts aren't in this quiz.", { status: 400, code: 'bad_request' });

  const meter = createMeter({ feature: 'tool:quiz:followup', transcriptionId, userId });
  // write (the concepts' passages) + check: a few thousand tokens each way
  const passage = estimateTokens(segments.filter((s) => concepts.some((c) => (c.refs || []).some((r) => Math.abs(r - s.id) <= 3))).map(modelLine).join('\n'));
  await reserveAi(db, meter, passage * 2 + 3000);
  try {
    const speakers = speakerTable(segments);
    const usage = { input: 0, output: 0 };
    let model = null;
    const call = async ({ task, schema, body, instructions }) => {
      const ai = getProvider();
      const x = await meter.call(task, () => ai.complete({
        task, ...taskConfig(task), system: ANALYST_SYSTEM, schema,
        messages: [{ role: 'user', content: [{ type: 'text', text: `${codedHeader(row, segments, speakers)}${body ? `\n${body}` : ''}` }, { type: 'text', text: instructions }] }],
      }));
      usage.input += x.usage.input; usage.output += x.usage.output; model = x.model;
      return x;
    };
    const settings = quiz.settings || {};
    const items = (await followupQuestions({
      concepts, map: quiz.content.map, segments, speakers, call,
      ctx: { settings: { ...settings, types: settings.types === 'true_false' ? 'true_false' : 'mixed' }, dominant: dominantSpeaker(speakers.shares) },
      existing: [...(quiz.content.questions || []), ...have],
    })).slice(0, MAX_FOLLOWUPS - have.length);
    let saved = items.length ? await db.appendFollowups(quiz, items) : quiz;
    if (!saved) { // the quiz changed while we wrote (another tab): add to the newest version once
      const latest = (await db.listArtifacts(transcriptionId)).find((a) => a.id === artifactId && a.status === 'ready');
      saved = latest && sameBasis(latest.content?.basis, quiz.content.basis) ? (await db.appendFollowups(latest, items)) || latest : quiz;
    }
    await meter.finish({ groundingPassed: true, droppedItems: 0 });
    void model;
    return { artifact: publicArtifact(saved), added: items.length, usage };
  } catch (err) {
    await meter.finish({ error: err?.message || 'failed' });
    throw err instanceof AIError ? err : new AIError("New questions couldn't be written. You can still practise with the same ones.");
  }
}

// Generate (or return the stored) result of one kind.
export async function generate(db, { transcriptionId, kind, recordingType, force = false, userId = null }) {
  if (!KINDS.includes(kind)) throw new AIError('Unknown analysis.', { status: 400, code: 'bad_request' });
  const type = kind === 'overview' ? 'general' : normalizeRecordingType(recordingType);
  const meter = createMeter({ feature: kind === 'overview' ? 'overview' : `${kind}:${type}`, transcriptionId, userId });
  const { row, segments } = await loadTranscript(db, transcriptionId);
  const version = row.content_version;
  const fromStorage = async (insight) => { await meter.finish({ cached: true }); return { insight: publicInsight(insight), cached: true }; };

  const existing = await db.getInsight(transcriptionId, kind, type);
  // as for Create results: current for this version, or for a later one that only renamed speakers
  const basis = transcriptBasis(segments);
  if (existing) {
    const fresh = existing.source_version === version || sameBasis(existing.content?.basis, basis);
    if (existing.status === 'ready' && fresh && !force) {
      // only speakers were renamed since: it is current for this version too (Ask context and Library search use the version)
      if (existing.source_version !== version) await db.bumpInsightVersion?.(existing.id, version).catch(() => {});
      return fromStorage(existing);
    }
    if (existing.status === 'generating' && Date.now() - new Date(existing.updated_at).getTime() < INSIGHT_TAKEOVER_MS) {
      return fromStorage(existing); // someone else is already generating it
    }
  }
  await reserveAi(db, meter, promptTokensOf(segments, { whole: true }));
  // remembered before the row is claimed: a failed update keeps the previous result and its version (as artifacts do)
  const previous = existing?.content ? existing.source_version : null;
  const claimed = await db.startInsight(existing, { transcriptionId, kind, recordingType: type, version });
  if (!claimed) return fromStorage(await db.getInsight(transcriptionId, kind, type));

  try {
    // speakers as codes ({{S1}}), shown with their current names (lib/speaker-refs.js)
    const speakers = speakerTable(segments);
    const r = await GENERATORS[kind](row, segments, type, meter, speakers);
    r.content = { ...tokenizeSpeakers(r.content, speakers.codeOf), speakers: speakers.table, basis };
    const saved = await db.finishInsight(claimed.id, { content: r.content, model: r.model, usage: r.usage });
    // "passed" = every item the model returned pointed at real lines (nothing had to be dropped)
    await meter.finish({ groundingPassed: r.dropped === 0, droppedItems: r.dropped });
    return { insight: publicInsight(saved), cached: false, dropped: r.dropped };
  } catch (err) {
    const message = err instanceof AIError ? err.message : 'Analysis failed.';
    await meter.finish({ error: message });
    await db.failInsight(claimed.id, message, previous).catch(() => {});
    throw err instanceof AIError ? err : new AIError(message);
  }
}

// Answers saved before the current Ask rules (Phase 5.6) stay in the history but are not reused for a repeated
// question: asking again gets an answer under the current rules.
const ASK_RULES_SINCE = Date.parse('2026-10-08T19:00:00Z');
const normQuestion = (q) => q.toLowerCase().replace(/\s+/g, ' ').replace(/[?.!\s]+$/, '').trim();
const INTENTS = [
  [/\b(decid|decision|agree|final|settled|go with)/i, ['decisions']],
  [/\b(action|task|to.?do|assign|responsib|follow.?up|need(s)? to do|next step|want|need|expect|supposed to|ask(ing)? (me|us|for))/i, ['action_items', 'requested_actions', 'follow_ups']],
  [/\b(clarif|unclear|confirm|missing|gap)/i, ['open_questions', 'follow_ups', 'concerns']],
  [/\b(deadline|due|date|when|schedule|appointment|by (mon|tues|wednes|thurs|fri|satur|sun)day)/i, ['important_dates', 'dates_times', 'action_items']],
  [/\b(question|unresolved|open issue)/i, ['open_questions', 'questions']],
  [/\b(priorit|goal|focus)/i, ['priorities']],
  [/\b(concern|worr|risk|problem|issue)/i, ['concerns']],
  [/\b(suggest|propos|idea|recommend)/i, ['suggestions']],
  [/\b(study|exam|test|concept|definition|important)/i, ['exam_points', 'key_concepts', 'definitions', 'important_topics']],
  [/\b(summar|main|overall|about|key point|takeaway)/i, ['key_points', 'key_takeaways', 'main_topics', 'major_topics']],
];

// Line ids behind already-extracted insights that match the question's intent: cheap, precise context
// for "what were the decisions?"-style questions on long recordings.
function intentRefs(question, insights) {
  const keys = INTENTS.filter(([re]) => re.test(question)).flatMap(([, k]) => k);
  if (!keys.length) return [];
  const ids = [];
  for (const i of insights) {
    if (i.status !== 'ready' || !i.content) continue;
    for (const k of keys) for (const item of i.content[k] || []) ids.push(...(item.refs || []));
  }
  return [...new Set(ids)].slice(0, 60);
}

// Grounded Q&A. Streams { delta } events through `emit`, then resolves with the stored answer.
export async function askTranscript(db, { transcriptionId, question, at = null, userId = null }, emit) {
  question = String(question || '').trim().slice(0, 500);
  if (!question) throw new AIError('Type a question first.', { status: 400, code: 'bad_request' });
  const { row, segments } = await loadTranscript(db, transcriptionId);
  const version = row.content_version;
  const deictic = at != null && refersToPlayback(question);
  const meter = createMeter({ feature: 'ask', transcriptionId, userId });
  // the last few turns, so follow-ups like "Why?" are understood (old generic "not found" replies left out)
  const history = (await db.listQuestions(transcriptionId)).filter((q) => q.answer && !isNotFound(q.answer)).slice(-3);
  const followUp = history.length > 0 && isFollowUp(question);

  // the same question about the same version of the transcript: answer from storage, no model call.
  // Not for follow-ups ("Why?" depends on what came before), and not for answers saved under older rules.
  if (!deictic && !followUp) {
    const prev = await db.findAnswer(transcriptionId, normQuestion(question), version, normQuestion);
    if (prev && !isNotFound(prev.answer) && Date.parse(prev.created_at) >= ASK_RULES_SINCE) {
      emit({ type: 'cached' });
      await meter.finish({ cached: true });
      return { id: prev.id, question: prev.question, answer: prev.answer, refs: prev.refs, found: prev.found, cached: true };
    }
  }

  await reserveAi(db, meter, promptTokensOf(segments));
  const ai = getProvider();
  const insights = await db.listInsights(transcriptionId);
  const current = insights.filter((i) => i.source_version === version);
  let keywords = [];
  let usageIn = 0, usageOut = 0;
  // a follow-up is searched together with the question it follows ("What about shipping?" after "What does he want?")
  const searchText = followUp ? `${history.at(-1).question} ${question}` : question;
  if (needsRetrieval(segments)) {
    emit({ type: 'status', status: 'searching' });
    try {
      const r = await meter.call('ask:keywords', () => ai.complete({ task: 'expand', ...taskConfig('expand'), system: 'You help search transcripts.', schema: EXPAND_SCHEMA, messages: [{ role: 'user', content: expandInstructions(searchText) }] }));
      keywords = (r.json?.keywords || []).slice(0, 20).map(String);
      usageIn += r.usage.input; usageOut += r.usage.output;
    } catch { /* retrieval still works on the question's own words */ }
  }
  const ctx = selectContext(segments, { question: searchText, keywords, at: deictic ? Number(at) : null, priorityIds: intentRefs(searchText, current) });

  const overview = current.find((i) => i.kind === 'overview' && i.status === 'ready')?.content;
  const outline = ctx.mode === 'retrieval' && overview
    ? `<outline note="orientation only — cite transcript lines, not this outline">\n${overview.short_summary}\n${(overview.chapters || []).map((c) => `- ${c.title} (from line ${c.start_ref})`).join('\n')}\n</outline>\n`
    : '';
  const scope = ctx.mode === 'full' ? 'The complete transcript' : 'Excerpts of the transcript selected as relevant to the question ("…" marks skipped parts)';
  // speakers by code, numbered from their original labels (kept through renames), so the stored answer can show
  // current names later without a table (lib/speaker-refs.js, origCodes)
  const askCodes = origCodes(segments);
  const nowName = origResolver(segments);
  const askLine = (s) => `[${s.id}] ${fmtClock(s.start)} ${askCodes.get(s.orig || s.speaker) || 'Unknown'}: ${s.text}`;
  const mins = Math.round((row.duration_seconds || segments.at(-1)?.end || 0) / 60);
  const askHeader = `Recording length: about ${mins} minute${mins === 1 ? '' : 's'}. Speakers, shown in the transcript by code: ${[...askCodes.values()].map((c) => `${c} = "${nowName(c)}"`).join(', ') || 'unknown'}. When your answer refers to a speaker, write their code in double braces, e.g. {{S1}}; the app shows the current name there.`;
  const position = deictic ? `\nThe user is currently at ${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')} in the recording; "this part" refers to the lines around that time.` : '';

  const messages = [];
  for (const h of history) messages.push({ role: 'user', content: `<question>\n${h.question}\n</question>` }, { role: 'assistant', content: h.answer });
  messages.push({
    role: 'user',
    content: `${askHeader}\n${outline}<excerpts>\n${scope}:\n${formatExcerpts(segments, ctx.ids, askLine)}\n</excerpts>${position}\n\n<question>\n${question}\n</question>`,
  });

  emit({ type: 'status', status: 'answering' });
  let r;
  try {
    r = await meter.call('ask', () => ai.stream({ task: 'ask', ...taskConfig('ask'), system: ASK_SYSTEM, messages }, (text) => emit({ type: 'delta', text })));
  } catch (err) {
    await meter.finish({ error: err?.message || 'failed' });
    throw err;
  }
  usageIn += r.usage.input; usageOut += r.usage.output;
  const g = groundAnswer(r.text, ctx.ids);
  // speakers as codes in the stored answer; "Speaker 2" written out by the model becomes its code too
  const labelCodes = new Map([...askCodes].map(([, code]) => [nowName(code), code]));
  g.answer = tokenizeSpeakers({ a: g.answer }, labelCodes).a;
  // "passed" = no citation of a line the model wasn't given, and a found answer cites at least one line
  await meter.finish({ groundingPassed: g.invalidCitations === 0 && !g.unsupported, droppedItems: g.invalidCitations });
  const saved = await db.saveQuestion({
    transcriptionId, question, answer: g.answer, refs: g.refs, found: g.found, version, model: r.model, usage: { input: usageIn, output: usageOut },
  });
  return { id: saved?.id, question, answer: g.answer, refs: g.refs, found: g.found, unsupported: g.unsupported, mode: ctx.mode, cached: false };
}

// Across recordings (server/ai/across.js), Thunder: the plan is checked before any recording is read, then the same
// usage reservation as every other AI action.
export async function askAcrossRecordings(db, args, emit) {
  await requireCapability(db, 'across_ask');
  return askAcross(db, args, emit, { reserveAi });
}
export async function guideAcrossRecordings(db, args) {
  await requireCapability(db, 'across_guide');
  return guideAcross(db, args, { reserveAi });
}
