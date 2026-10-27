// Study engine 3 runs (flashcards, practice quiz, study guide): map → select → write → check.
// See studymap.js for the steps and why. AI calls go through `call` (service.js), which adds the transcript header,
// the shared analyst rules and metering.
import { groundStructured } from './grounding.js';
import { tokenizeSpeakers, codedLine, sameBasis } from '../../src/lib/speaker-refs.js';
import { fmtClock, estimateTokens } from '../../src/lib/segments.js';
import { inheritRefs, keepsAttribution, validateQuiz, sameQuestion, pickTrueFalse, shuffledKeys } from './study.js';
import { examBacked } from './tools.js';
import { str, obj, list } from './prompts.js';
import {
  sectionize, SECTION_SCHEMA, sectionInstructions, CONSOLIDATE_SCHEMA, consolidateInstructions, buildMap, selectConcepts,
  excerptIds, WRITE_SCHEMA, writeInstructions, VERIFY_SCHEMA, verifyInstructions, applyChecks, optionsLine, lectureOverview, unseenNames, transcriptWordSet,
} from './studymap.js';

const lineOf = (speakers) => (s) => codedLine(s, speakers.codeOf, fmtClock);
function excerpt(segments, ids, line) {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const out = [];
  let prev = null;
  for (const id of ids) { if (prev != null && id !== prev + 1) out.push('…'); out.push(line(byId.get(id))); prev = id; }
  return out.join('\n');
}

// One study map per transcript: reused from any other engine-3 result for the same words and speakers.
export async function studyMap({ db, transcriptionId, segments, speakers, basis, call }) {
  const stored = (await db.listArtifacts(transcriptionId))
    .filter((a) => a.status === 'ready' && a.content?.engine >= 3 && a.content?.map?.concepts && sameBasis(a.content.basis, basis))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  if (stored) return { map: stored.content.map, reused: true, sections: stored.content.quality?.sections ?? null };

  const line = lineOf(speakers);
  const secs = sectionize(segments, (s) => estimateTokens(line(s)) + 1);
  const results = await Promise.all(secs.map(async (sec, i) => {
    const block = (tag, segs) => (segs.length ? `<${tag}>\n${segs.map(line).join('\n')}\n</${tag}>\n` : '');
    const body = `${block('context_before', sec.before)}${block('section', sec.body)}${block('context_after', sec.after)}`;
    const r = await call({
      task: 'studymap:section', schema: SECTION_SCHEMA, body,
      instructions: sectionInstructions({ index: i, total: secs.length, from: fmtClock(sec.body[0].start), to: fmtClock(sec.body.at(-1).end ?? sec.body.at(-1).start) }),
    });
    const g = groundStructured(r.json || {}, segments);
    // a concept belongs to the section that explains it (context lines are the neighbours')
    const lo = sec.body[0].id, hi = sec.body.at(-1).id;
    g.content.concepts = (g.content.concepts || []).filter((c) => c.refs.some((x) => x >= lo && x <= hi));
    return tokenizeSpeakers(g.content, speakers.codeOf);
  }));
  let consolidation = null;
  if (secs.length > 1) {
    const entries = results.flatMap((sec, si) => (sec.concepts || []).map((c) => ({ ...c, key: `s${si + 1}.${c.id}` })));
    if (entries.length) consolidation = (await call({ task: 'studymap:merge', schema: CONSOLIDATE_SCHEMA, body: '', instructions: consolidateInstructions(entries) })).json;
  }
  return { map: buildMap(results, consolidation), reused: false, sections: secs.length };
}

// Flashcards / practice quiz
export async function studyItems({ kind, tool, db, transcriptionId, segments, speakers, basis, ctx, call, started }) {
  const key = tool.itemsKey;
  const { map, reused, sections } = await studyMap({ db, transcriptionId, segments, speakers, basis, call });
  const { selected, coverage } = selectConcepts(map, ctx.count, { focus: ctx.settings?.focus });
  // a few spare concepts are written alongside, so an item the writer skips or a check drops is replaced without a
  // second round of calls; the spares are the first to go when there are more items than asked for
  const spares = selectConcepts(map, ctx.count + Math.ceil(ctx.count / 4), { focus: ctx.settings?.focus }).selected.filter((x) => !selected.includes(x));
  const primary = new Set(selected.map((x) => x.id));
  const line = lineOf(speakers);
  const overview = kind === 'quiz' ? lectureOverview(map) : '';
  const vctx = { ...ctx, rawConceptIds: new Set(map.concepts.map((c) => c.id)) };
  const validate = (items) => { const c = { concepts: map.concepts, [key]: items }; tool.validate(c, segments, vctx); return c; };

  const write = async (concepts, tfLimit) => {
    const ids = excerptIds(concepts, segments);
    const r = await call({
      task: `${tool.task}:write`, schema: WRITE_SCHEMA[kind], body: `<transcript>\n${excerpt(segments, ids, line)}\n</transcript>`,
      instructions: writeInstructions(kind, { concepts, topics: map.topics, settings: ctx.settings, dominant: ctx.dominant, tfLimit }),
    });
    const items = kind === 'quiz' ? pickTrueFalse(r.json?.[key], (q) => tfKeyOf(q.concept)) : r.json?.[key] || [];
    inheritRefs(items, { concepts });
    return tokenizeSpeakers(groundStructured({ [key]: items }, segments).content, speakers.codeOf)[key] || [];
  };

  // check every item against its own lines (and the concept's other lines, where its distractors may come from)
  const stats = {};
  const byId = new Map(map.concepts.map((x) => [x.id, x]));
  const blockOf = (it, i) => {
    const con = byId.get(it.concept);
    const lines = excerptIds([{ refs: [...new Set([...(it.refs || []), ...(con?.refs || [])])] }], segments, 2);
    const fields = kind === 'quiz'
      ? `Question (${it.type}): ${it.question}\n${optionsLine(it)}Answer: ${it.answer}`
      : `Question: ${it.front}\nAnswer: ${it.back}`;
    return `<item index="${i}">\n${fields}\nExplanation: ${it.explanation || '(none)'}\nPosition: ${con ? `${con.stance}${con.held_by ? `, held by ${con.held_by}` : ''}` : 'own'}\nLines:\n${excerpt(segments, lines, line)}\n</item>`;
  };
  // fixes are written with the speaker labels the model sees: turn them into speaker codes like everything else
  const tokenized = (items) => tokenizeSpeakers({ [key]: items }, speakers.codeOf)[key] || [];
  const addStats = (s) => { for (const [k, v] of Object.entries(s)) stats[k] = (stats[k] || 0) + v; };
  // one batch's items: checked, anything repaired checked once more (no further fixes); no time left = not shipped
  const check = async (batch) => {
    if (!batch.length) return [];
    if (Date.now() - started >= 200_000) { addStats({ verify_skipped: 1 }); return batch; }
    let applied = null;
    try {
      const r = await call({ task: `${tool.task}:verify`, schema: VERIFY_SCHEMA, body: batch.map(blockOf).join('\n'), instructions: verifyInstructions(kind, { overview }) });
      applied = applyChecks(kind, batch, r.json?.checks || []);
    } catch (err) {
      // a failed check must not throw away the paid work, nor ship choices nobody checked: keep only items without options
      console.warn('[study] verify failed:', err?.code || err?.name || 'error');
      const keep = batch.filter((it) => !(kind === 'quiz' && (it.type === 'multiple_choice' || it.type === 'true_false')));
      applied = { items: keep, stats: { verify_failed: 1, ambiguous_dropped: batch.length - keep.length }, recheck: [] };
    }
    addStats(applied.stats);
    let items = tokenized(applied.items.map((x) => ({ ...x })));
    if (applied.recheck.length) {
      const again = applied.recheck.map((i) => items[i]);
      let final = null;
      if (Date.now() - started < 240_000) {
        try {
          const r2 = await call({ task: `${tool.task}:recheck`, schema: VERIFY_SCHEMA, body: again.map(blockOf).join('\n'), instructions: verifyInstructions(kind, { final: true, overview }) });
          final = applyChecks(kind, again, r2.json?.checks || [], { final: true });
        } catch (err) { console.warn('[study] recheck failed:', err?.code || err?.name || 'error'); }
      }
      if (final) { const { verify_dropped = 0, ambiguous_dropped = 0 } = final.stats; addStats({ recheck_dropped: verify_dropped + ambiguous_dropped }); }
      else addStats({ recheck_dropped: again.length });
      const kept = new Set(applied.recheck);
      items = items.filter((it, i) => !kept.has(i)).concat(final ? final.items : []);
    }
    return items;
  };

  // Written and checked in small batches that run at the same time: one long call writing (then checking) every
  // item took minutes on a long lecture, and each batch only needs its own concepts' lines. The whole set is
  // validated together at the end (duplicates across batches, the question count).
  const BATCH = 2;
  const toWrite = [...selected, ...spares].sort((a, b) => (a.refs?.[0] ?? 0) - (b.refs?.[0] ?? 0));
  const batches = [];
  for (let i = 0; i < toWrite.length; i += BATCH) batches.push(toWrite.slice(i, i + BATCH));
  // a mixed quiz has at most two true/false questions in all: one each in the first two batches
  const tfOf = (b) => (kind === 'quiz' && !['multiple_choice', 'true_false'].includes(ctx.settings?.types) ? (b < 2 ? 1 : 0) : undefined);
  // true or false: each concept gets its answer from a shuffled, balanced run (about half True, in random order);
  // every statement is written true with a false version, and pickTrueFalse asks the one this says
  const tfKeys = shuffledKeys(toWrite.length);
  const tfIndex = new Map(toWrite.map((c, i) => [String(c.id), i]));
  const tfKeyOf = (concept) => tfKeys[tfIndex.get(String(concept))] ?? (Math.random() < 0.5 ? 'True' : 'False');
  const firstQuality = {};
  const sumFirst = (q) => { for (const [k, v] of Object.entries(q || {})) if (!['kept', 'core_uncovered'].includes(k)) firstQuality[k] = (firstQuality[k] || 0) + v; };
  const runBatch = async (concepts, b) => {
    const v = validate(await write(concepts, tfOf(b)));
    sumFirst(v.quality);
    return check(v[key]);
  };
  let checked = (await Promise.all(batches.map(runBatch))).flat();
  // more than asked for: spares go first, then the last ones
  if (checked.length > ctx.count) {
    const extra = checked.filter((it) => !primary.has(it.concept));
    const drop = new Set(extra.slice(0, checked.length - ctx.count));
    checked = checked.filter((it) => !drop.has(it)).slice(0, ctx.count);
  }
  checked.sort((a, b) => (a.refs?.[0] ?? 0) - (b.refs?.[0] ?? 0));
  let c = validate(checked);
  // drop reasons from both rounds of checks; what is kept is the final count
  const quality = { ...firstQuality };
  for (const [k, v] of Object.entries(c.quality || {})) quality[k] = ['kept', 'core_uncovered'].includes(k) ? v : (quality[k] || 0) + v;

  // a name the transcript never contains is a guess or an invention: say so on the item
  const words = transcriptWordSet(segments);
  // each part on its own line: the first word of an answer or an option starts a sentence, it is not a name
  for (const it of c[key]) {
    const names = unseenNames([it.front || it.question, it.back || it.answer, it.explanation, ...(it.options || [])].filter(Boolean).join('\n'), words);
    if (names.length) {
      it.caution = [it.caution, `Spelled differently in the transcript: ${names.map((n) => `“${n}”`).join(', ')}.`].filter(Boolean).join(' ');
      stats.unseen_names = (stats.unseen_names || 0) + 1;
    }
  }
  const coveredNow = new Set(c[key].map((x) => x.concept));
  const majors = map.topics.filter((t) => t.importance === 'major');
  const topicsCovered = majors.filter((t) => map.concepts.some((x) => x.topic === t.id && coveredNow.has(x.id)));
  return {
    content: {
      [key]: c[key], map,
      coverage: { ...coverage, topics_covered: topicsCovered.length, missing_topics: majors.filter((t) => !topicsCovered.includes(t)).map((t) => t.title) },
      quality: { ...quality, ...stats, sections, map_reused: reused ? 1 : 0, selected: selected.length },
    },
  };
}

// Study guide: built from the map (topics, ideas, definitions, distinctions, exam mentions), plus a small call for
// the overview, a summary per topic and a few self-check questions. No transcript is re-read.
export const COMPOSE_SCHEMA = obj({
  overview: str('2–4 sentences: what the recording teaches'),
  topic_summaries: list(obj({ topic: str('Topic id, e.g. t2'), summary: str('One or two sentences') })),
  self_check: list(obj({ concept: str('Concept id'), question: str(), answer: str('Short, self-contained answer') }), 'One or two per major topic'),
});
export function composeInstructions(map, focus) {
  const topics = map.topics.map((t) => ({ id: t.id, title: t.title, importance: t.importance, concepts: map.concepts.filter((c) => c.topic === t.id && c.importance !== 'minor').map((c) => ({ id: c.id, name: c.name, stance: c.stance, held_by: c.held_by, summary: c.summary, reasoning: c.reasoning })) }));
  return `This is the study map of a recording (topics, and the ideas in each, as the recording presents them):
<map>
${JSON.stringify(topics, null, 1)}
</map>
Write, using only this map:
- overview: 2–4 sentences on what the recording teaches.
- topic_summaries: one or two sentences for each topic that has ideas.
- self_check: one or two questions per major topic that check understanding (not recall of a sentence), each with a short self-contained answer. A school's, person's or participant's view must say whose it is; a criticized view is asked about through the criticism.${focus === 'exam' ? ' Favour what a student would most likely be examined on, but never claim something will be on an exam.' : ''}
Never add facts the map doesn't contain.`;
}

export async function studyGuide({ db, transcriptionId, segments, speakers, basis, ctx, call }) {
  const { map, reused, sections } = await studyMap({ db, transcriptionId, segments, speakers, basis, call });
  const focus = ctx.settings?.focus || 'balanced';
  const r = await call({ task: 'study_guide:compose', schema: COMPOSE_SCHEMA, body: '', instructions: composeInstructions(map, focus) });
  const j = tokenizeSpeakers(r.json || {}, speakers.codeOf);
  const keep = (c) => c.clarity === 'clear' && (c.importance === 'core' || (c.importance === 'supporting' && focus !== 'concepts') || (focus === 'detailed' && c.importance === 'minor'));
  const ideas = map.concepts.filter(keep);
  // an idea that belongs to a school or person says so
  const owned = (c, text) => (['attributed', 'criticized', 'quotation'].includes(c.stance) && c.held_by && !keepsAttribution({ front: text }, c)
    ? `${c.stance === 'criticized' ? 'Criticized view' : c.stance === 'quotation' ? 'Saying' : 'View'} of ${c.held_by}: ${text}` : text);
  const summaries = new Map((j.topic_summaries || []).map((t) => [String(t.topic), t.summary]));
  const byId = new Map(map.concepts.map((c) => [c.id, c]));
  const lineText = (refs) => (refs || []).map((x) => segments.find((s) => s.id === x)?.text || '').join(' ');
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const content = {
    overview: j.overview || '',
    topics: map.topics.filter((t) => ideas.some((c) => c.topic === t.id)).map((t) => ({ title: t.title, summary: summaries.get(t.id) || '', start_ref: t.start_ref })),
    concepts: ideas.filter((c) => !['definition'].includes(c.kind)).map((c) => ({ term: c.name, explanation: owned(c, `${c.summary}${c.reasoning ? ` Reason given: ${c.reasoning}` : ''}`), refs: c.refs })),
    definitions: ideas.filter((c) => c.kind === 'definition').map((c) => ({ term: c.name, definition: owned(c, c.summary), evidence: c.evidence, refs: c.refs })),
    examples: [], processes: [],
    relationships: ideas.filter((c) => ['distinction', 'cause_effect'].includes(c.kind)).map((c) => ({ text: owned(c, `${c.name}: ${c.summary}`), refs: c.refs })),
    emphasis: [],
    // exam information only where the speaker's own words in the cited lines mention an assessment
    exam_info: map.concepts.filter((c) => c.exam_words && norm(lineText(c.refs)).includes(norm(c.exam_words)) && examBacked({ evidence: c.exam_words, refs: c.refs }, segments))
      .map((c) => ({ text: c.name, evidence: c.exam_words, refs: c.refs })),
    review: [],
    self_check: (j.self_check || []).filter((q) => byId.has(String(q.concept)) && q.question && q.answer).map((q) => ({ question: q.question, answer: q.answer, refs: byId.get(String(q.concept)).refs })),
    map,
  };
  const majors = map.topics.filter((t) => t.importance === 'major');
  content.coverage = { topics: majors.length, topics_covered: majors.filter((t) => content.topics.some((x) => x.title === t.title)).length, core: map.concepts.filter((c) => c.importance === 'core' && c.clarity === 'clear').length, core_covered: ideas.filter((c) => c.importance === 'core').length, missing_topics: [] };
  content.quality = { sections, map_reused: reused ? 1 : 0, ideas: ideas.length };
  return { content };
}

// ---------------- Focused Review: follow-up questions ----------------
// New practice questions for concepts a learner missed, written from the same passages as the quiz (the concept's
// lines ± 3) and put through the same checks as every quiz question: the quiz validator, then the verification
// pass (answer supported, one defensible option, attribution kept), with a final re-check of anything repaired.
// Questions the learner has already seen on these concepts are given to the writer as "don't repeat", and any
// near-duplicate that still comes back is dropped. One call to write, one to check (one more if something was
// repaired); no map is built, so it costs a fraction of a quiz.
export async function followupQuestions({ concepts, map, segments, speakers, ctx, existing, call }) {
  const line = lineOf(speakers);
  const seen = (existing || []).filter((q) => concepts.some((c) => String(c.id) === String(q.concept)));
  const avoid = seen.map((q) => `- ${q.question}`).join('\n');
  const r = await call({
    task: 'quiz:write', schema: WRITE_SCHEMA.quiz,
    body: `<transcript>\n${excerpt(segments, excerptIds(concepts, segments), line)}\n</transcript>`,
    instructions: `${writeInstructions('quiz', { concepts, topics: map.topics, settings: ctx.settings, dominant: ctx.dominant })}
- These are FOLLOW-UP questions for a learner who already answered the questions below and got them wrong. Test the same idea from a different angle (another skill: application, a distinction, cause and effect, a misconception). Never reword these questions and never reuse their answer or options:
${avoid || '- (none)'}`,
  });
  let items = pickTrueFalse(r.json?.questions, () => (Math.random() < 0.5 ? 'True' : 'False'));
  inheritRefs(items, { concepts });
  items = tokenizeSpeakers(groundStructured({ questions: items }, segments).content, speakers.codeOf).questions || [];
  const validate = (list) => {
    const c = { concepts: map.concepts, questions: list };
    validateQuiz(c, segments, { count: Math.max(1, list.length), settings: ctx.settings, dominant: ctx.dominant, rawConceptIds: new Set(map.concepts.map((x) => x.id)) });
    return c.questions;
  };
  const fresh = (list) => list.filter((q) => !seen.some((s) => sameQuestion(s.question, q.question)));
  items = fresh(validate(items));
  if (!items.length) return [];
  const byId = new Map(map.concepts.map((x) => [x.id, x]));
  const blockOf = (it, i) => {
    const con = byId.get(it.concept);
    const lines = excerptIds([{ refs: [...new Set([...(it.refs || []), ...(con?.refs || [])])] }], segments, 2);
    const opts = optionsLine(it);
    return `<item index="${i}">\nQuestion (${it.type}): ${it.question}\n${opts}Answer: ${it.answer}\nExplanation: ${it.explanation || '(none)'}\nPosition: ${con ? `${con.stance}${con.held_by ? `, held by ${con.held_by}` : ''}` : 'own'}\nLines:\n${excerpt(segments, lines, line)}\n</item>`;
  };
  const tokenized = (list) => tokenizeSpeakers({ questions: list }, speakers.codeOf).questions || [];
  let applied;
  try {
    const v = await call({ task: 'quiz:verify', schema: VERIFY_SCHEMA, body: items.map(blockOf).join('\n'), instructions: verifyInstructions('quiz', { overview: lectureOverview(map) }) });
    applied = applyChecks('quiz', items, v.json?.checks || []);
  } catch {
    return []; // unchecked choices are never shipped (the same rule as the quiz itself)
  }
  let out = tokenized(applied.items.map((x) => ({ ...x })));
  if (applied.recheck.length) {
    const again = applied.recheck.map((i) => out[i]);
    let final = null;
    try {
      const v2 = await call({ task: 'quiz:recheck', schema: VERIFY_SCHEMA, body: again.map(blockOf).join('\n'), instructions: verifyInstructions('quiz', { final: true, overview: lectureOverview(map) }) });
      final = applyChecks('quiz', again, v2.json?.checks || [], { final: true });
    } catch { /* not re-checked: not shipped */ }
    const kept = new Set(applied.recheck);
    out = out.filter((_, i) => !kept.has(i)).concat(final ? final.items : []);
  }
  return fresh(validate(out)).map((q) => ({ ...q, followup: true }));
}
