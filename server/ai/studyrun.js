// Study engine 3 runs (flashcards, practice quiz, study guide): map → select → write → check.
// See studymap.js for the steps and why. AI calls go through `call` (service.js), which adds the transcript header,
// the shared analyst rules and metering.
import { groundStructured } from './grounding.js';
import { tokenizeSpeakers, codedLine, sameBasis } from '../../src/lib/speaker-refs.js';
import { fmtClock, estimateTokens } from '../../src/lib/segments.js';
import { inheritRefs, keepsAttribution } from './study.js';
import { examBacked } from './tools.js';
import { str, obj, list } from './prompts.js';
import {
  sectionize, SECTION_SCHEMA, sectionInstructions, CONSOLIDATE_SCHEMA, consolidateInstructions, buildMap, selectConcepts,
  excerptIds, WRITE_SCHEMA, writeInstructions, VERIFY_SCHEMA, verifyInstructions, applyChecks, unseenNames, transcriptWordSet,
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
  const line = lineOf(speakers);
  const vctx = { ...ctx, rawConceptIds: new Set(map.concepts.map((c) => c.id)) };
  const validate = (items) => { const c = { concepts: map.concepts, [key]: items }; tool.validate(c, segments, vctx); return c; };

  const write = async (concepts) => {
    const ids = excerptIds(concepts, segments);
    const r = await call({
      task: `${tool.task}:write`, schema: WRITE_SCHEMA[kind], body: `<transcript>\n${excerpt(segments, ids, line)}\n</transcript>`,
      instructions: writeInstructions(kind, { concepts, topics: map.topics, settings: ctx.settings, dominant: ctx.dominant }),
    });
    const items = r.json?.[key] || [];
    inheritRefs(items, { concepts });
    return tokenizeSpeakers(groundStructured({ [key]: items }, segments).content, speakers.codeOf)[key] || [];
  };

  let raw = selected.length ? await write(selected) : [];
  let c = validate(raw);
  let firstQuality = c.quality;
  // concepts the writer skipped (or whose item failed a check) get one more try, while time is left
  const missing = selected.filter((s) => !c[key].some((x) => x.concept === s.id));
  if (missing.length && Date.now() - started < 140_000) { raw = [...raw, ...await write(missing)]; c = validate(raw); firstQuality = c.quality; }

  // check every item against its own lines (and the concept's other lines, where its distractors may come from)
  const stats = {};
  const byId = new Map(map.concepts.map((x) => [x.id, x]));
  const blockOf = (it, i) => {
    const con = byId.get(it.concept);
    const lines = excerptIds([{ refs: [...new Set([...(it.refs || []), ...(con?.refs || [])])] }], segments, 2);
    const fields = kind === 'quiz'
      ? `Question (${it.type}): ${it.question}\n${it.options?.length ? `Options: ${it.options.map((o) => `[${o}]`).join(' ')}\n` : it.type === 'true_false' ? 'Options: [True] [False]\n' : ''}Answer: ${it.answer}`
      : `Question: ${it.front}\nAnswer: ${it.back}`;
    return `<item index="${i}">\n${fields}\nExplanation: ${it.explanation || '(none)'}\nPosition: ${con ? `${con.stance}${con.held_by ? `, held by ${con.held_by}` : ''}` : 'own'}\nLines:\n${excerpt(segments, lines, line)}\n</item>`;
  };
  // fixes are written with the speaker labels the model sees: turn them into speaker codes like everything else
  const tokenized = (items) => tokenizeSpeakers({ [key]: items }, speakers.codeOf)[key] || [];
  const addStats = (s) => { for (const [k, v] of Object.entries(s)) stats[k] = (stats[k] || 0) + v; };
  if (c[key].length && Date.now() - started < 200_000) {
    let applied = null;
    try {
      const r = await call({ task: `${tool.task}:verify`, schema: VERIFY_SCHEMA, body: c[key].map(blockOf).join('\n'), instructions: verifyInstructions(kind) });
      applied = applyChecks(kind, c[key], r.json?.checks || []);
    } catch (err) {
      // a failed check must not throw away the paid work, nor ship choices nobody checked: keep only items without options
      console.warn('[study] verify failed:', err?.code || err?.name || 'error');
      const keep = c[key].filter((it) => !(kind === 'quiz' && (it.type === 'multiple_choice' || it.type === 'true_false')));
      applied = { items: keep, stats: { verify_failed: 1, ambiguous_dropped: c[key].length - keep.length }, recheck: [] };
    }
    addStats(applied.stats);
    let items = tokenized(applied.items.map((x) => ({ ...x })));
    // anything repaired is checked once more, with no further fixes allowed; no time left = not shipped
    if (applied.recheck.length) {
      const again = applied.recheck.map((i) => items[i]);
      let final = null;
      if (Date.now() - started < 240_000) {
        try {
          const r2 = await call({ task: `${tool.task}:recheck`, schema: VERIFY_SCHEMA, body: again.map(blockOf).join('\n'), instructions: verifyInstructions(kind, { final: true }) });
          final = applyChecks(kind, again, r2.json?.checks || [], { final: true });
        } catch (err) { console.warn('[study] recheck failed:', err?.code || err?.name || 'error'); }
      }
      const passed = new Set((final?.items || []));
      if (final) { const { verify_dropped = 0, ambiguous_dropped = 0 } = final.stats; addStats({ recheck_dropped: verify_dropped + ambiguous_dropped }); }
      else addStats({ recheck_dropped: again.length });
      const kept = new Set(applied.recheck);
      items = items.filter((it, i) => !kept.has(i)).concat(final ? final.items : []);
      items.sort((a, b) => (a.refs?.[0] ?? 0) - (b.refs?.[0] ?? 0));
      void passed;
    }
    c = validate(items);
  } else stats.verify_skipped = 1;
  // drop reasons from both rounds of checks; what is kept is the final count
  const quality = { ...firstQuality };
  for (const [k, v] of Object.entries(c.quality || {})) quality[k] = ['kept', 'core_uncovered'].includes(k) ? v : (quality[k] || 0) + v;

  // a name the transcript never contains is a guess or an invention: say so on the item
  const words = transcriptWordSet(segments);
  // each part on its own line: the first word of an answer or an option starts a sentence, it is not a name
  for (const it of c[key]) {
    const names = unseenNames([it.front || it.question, it.back || it.answer, it.explanation, ...(it.options || [])].filter(Boolean).join('\n'), words);
    if (names.length) {
      it.caution = [it.caution, `Spelling not found in the transcript: ${names.map((n) => `“${n}”`).join(', ')}. Check the recording.`].filter(Boolean).join(' ');
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
