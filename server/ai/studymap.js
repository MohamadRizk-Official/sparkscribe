// Study engine 3: a study map built section by section, then items chosen to cover it.
//
// Engine 2 read a whole long lecture in one go and listed concepts from memory of it; whole debates could fall
// out of the map (and so out of every card and question). Engine 3:
//   1. cuts the recording into sections (~15–20 minutes of speech, at natural pauses, with a few lines of context on
//      each side) and lists the topics and concepts of each section separately, in parallel;
//   2. merges the section lists into one map for the whole recording (same idea in two sections → one concept),
//      grouped into topics and ranked; nothing a section found is dropped, and nothing a section rated core can
//      end up minor;
//   3. chooses which concepts get an item within the requested size: every major topic first, then the other
//      core ideas, then supporting ones; when the size can't cover every major topic, the result says so;
//   4. writes one item per chosen concept from the lines that explain it, then checks every item against those
//      lines (answer matches the question, supported, attribution, distractors, misheard words) and fixes or
//      drops what fails. Names the transcript doesn't contain are labelled, never silently "corrected".
// The map is stored with the result and reused by the other study tools for the same transcript (same concepts
// across flashcards, quiz and study guide; no second mapping cost).
// Everything here except the prompts is pure and tested (tests/studymap-test.mjs).
import { str, nullableStr, refs, evidence, obj, list } from './prompts.js';
import { CONCEPT_KINDS, STANCES, enumOf, STYLE_RULES, speakerNote, FOCUS, EXPLAIN, QUIZ_TYPES, FLASHCARD, QUESTION } from './study.js';

export const STUDY_ENGINE_3 = 3;
export const SECTION_TOKENS = 6000;
const OVERLAP_LINES = 4;
const MAJOR_TOPIC_LINES = 8;
const IMPORTANCE = ['core', 'supporting', 'minor'];
const int = (description) => ({ type: 'integer', ...(description && { description }) });
const bool = (description) => ({ type: 'boolean', ...(description && { description }) });

// ---------------- 1. sections ----------------
// segments -> [{ from, to, before, body, after }]: cut near `budget` tokens, preferring a pause of 6 s or more
// once three quarters of the budget is used; a very short last section joins the previous one.
export function sectionize(segments, tokensOf, budget = SECTION_TOKENS) {
  const cuts = [];
  let start = 0, tokens = 0;
  for (let i = 0; i < segments.length; i++) {
    tokens += tokensOf(segments[i]);
    const next = segments[i + 1];
    if (!next) break;
    const pause = (next.start ?? 0) - (segments[i].end ?? segments[i].start ?? 0);
    if (tokens >= budget || (tokens >= budget * 0.75 && pause >= 6)) { cuts.push([start, i, tokens]); start = i + 1; tokens = 0; }
  }
  cuts.push([start, segments.length - 1, tokens]);
  if (cuts.length > 1 && cuts.at(-1)[2] < budget * 0.25) { const last = cuts.pop(); cuts.at(-1)[1] = last[1]; }
  return cuts.map(([from, to]) => ({
    from, to,
    before: segments.slice(Math.max(0, from - OVERLAP_LINES), from),
    body: segments.slice(from, to + 1),
    after: segments.slice(to + 1, to + 1 + OVERLAP_LINES),
  }));
}

const SECTION_CONCEPT = obj({
  id: str('Short id: c1, c2, …'),
  topic: str('Title of the topic (from "topics") this concept belongs to'),
  name: str('The concept in a few words, as a student would name it'),
  kind: enumOf(CONCEPT_KINDS),
  importance: enumOf(IMPORTANCE, 'core = central teaching of the recording; supporting = needed to understand a core idea, or a debate/example the speaker spends minutes on; minor = trivia, a passing detail'),
  stance: enumOf(STANCES, 'own = the speaker teaches/holds it; attributed = the view of a school, scholar, group or participant; criticized = a view the speaker rejects; hypothetical; quotation; report = neutral history or fact'),
  held_by: nullableStr('Whose position or saying it is when stance is attributed, criticized or quotation (a participant: their code, e.g. {{S2}}); else null'),
  summary: str('What the recording establishes, in clear words, keeping qualifiers (sometimes, may, often, always) exactly'),
  reasoning: nullableStr('The reason, mechanism or argument the speaker gave; null if none was given'),
  clarity: enumOf(['clear', 'unreliable'], 'unreliable = the transcript here is too garbled or ambiguous to rely on'),
  exam_words: nullableStr('Only if the speaker tied it to an exam, test, quiz or assignment: those exact words; else null'),
  evidence: evidence('the concept'),
  refs,
});
export const SECTION_SCHEMA = obj({
  topics: list(obj({ title: str('2–6 word topic title'), start_ref: int('Line where the topic starts'), educational: bool('false for logistics, chat, administration, or talk with nothing to learn') }), 'Topics of this section, in order'),
  concepts: list(SECTION_CONCEPT, 'Concepts taught in this section, in order'),
});

export function sectionInstructions({ index, total, from, to }) {
  return `You are mapping one SECTION (${index + 1} of ${total}, ${from}–${to}) of a longer recording, for study materials.
Lines inside <section> belong to this section. Lines in <context_before> / <context_after> belong to the neighbouring sections: use them only to understand what is going on; do not list concepts that are taught only there.

topics: the topics of this section in order, each with the line where it starts. Mark educational = false for logistics, administration, small talk, or garbled stretches with nothing to learn.

concepts: what a student would need to understand and remember from this section:
- important concepts and terms (with their meaning as explained), arguments and the reasoning behind them, comparisons and distinctions, cause and effect, principles, processes, debates and the examples that carry them, and anything the speaker stressed.
- Leave out filler, repetition, side conversations, administration, personal remarks, garbled statements, and minor details (dates, counts, names) unless they matter for understanding. One concept per idea.
- A debate, argument, story or worked example the speaker spends several minutes on is at least "supporting", even if it is a digression from the section's main topic.
- Always include: every term the speaker tells students to remember or know, and every position a school, scholar or group is said to affirm or reject (each school's position is its own concept), even when it is stated briefly.
- stance / held_by: a view presented as a school's, scholar's, group's or participant's is "attributed" to it, never a general truth and never the speaker's own; a view the speaker argues against is "criticized"; a quoted saying is "quotation" (held_by = its source). Only "own" may be stated as the speaker's teaching.
- summary keeps qualifiers exactly. reasoning: only what the speaker actually gave.
- Names and terms: copy them as the transcript spells them. If a name or word looks misrecognized by the automatic transcription, do not correct it by guessing; keep the transcript's spelling and, if the passage is unusable, mark clarity "unreliable".
- evidence: exact words copied from one cited line. refs: the lines inside the section where the idea is EXPLAINED.
A section with nothing educational returns empty lists.`;
}

// ---------------- 2. one map for the whole recording ----------------
// Short output on purpose (the merge used to rewrite every concept): topics with the keys they hold, and only the
// groups of entries that are one idea. Names, importance and lines come from the sections.
export const CONSOLIDATE_SCHEMA = obj({
  topics: list(obj({
    title: str('Topic title, 2–6 words'),
    importance: enumOf(['major', 'minor'], 'major = a central topic of the recording that study materials must cover'),
    keys: list(str(), 'The keys of the entries in this topic'),
  }), 'The recording\'s topics, in order; every key in exactly one topic'),
  same: list(obj({ keys: list(str(), 'Two or more keys that are the same idea'), name: str('Name for the merged idea') }), 'Only groups of entries that are the SAME idea; empty if none'),
});

export function consolidateInstructions(entries) {
  return `These concepts were found section by section in one recording, in order. Organize them into ONE study map for the whole recording.
<entries>
${entries.map((e) => `${e.key} | ${e.topic} | ${e.importance} | ${e.kind} | ${e.stance}${e.held_by ? ` (${e.held_by})` : ''} | ${e.name}: ${e.summary}`).join('\n')}
</entries>
- topics: the coherent themes the speaker spent time on, in order (usually 4–12 for an hour-long lecture; fewer for a short recording), each listing the keys of its entries; every key in exactly one topic. A topic is "major" if it holds core material, or a debate or argument the speaker spent real time on.
- same: groups of entries that are the SAME idea (sections overlap, and speakers recap), with a name for it. Do not group different ideas just because they are related: two schools' positions on one question stay separate.`;
}

const rank = (i) => IMPORTANCE.indexOf(i);
const firstRef = (c) => Math.min(...(c.refs?.length ? c.refs : [Infinity]));

// sections: [{ topics, concepts }] (grounded; concept ids are the section's own) + consolidation -> map
// map = { topics: [{ id, title, importance, start_ref }], concepts: [{ id, topic, …concept fields }] }
export function buildMap(sections, consolidation) {
  const base = new Map();
  const sectionTopic = new Map();
  sections.forEach((sec, si) => {
    for (const c of sec.concepts || []) {
      const key = `s${si + 1}.${c.id}`;
      if (!base.has(key)) base.set(key, { ...c, key, section: si });
    }
    for (const t of sec.topics || []) sectionTopic.set(`${si}|${String(t.title).toLowerCase()}`, t);
  });
  // the topic each key was placed in (first placement wins)
  const topicOfKey = new Map();
  const given = (consolidation?.topics || []).map((t) => ({ title: String(t.title || '').trim(), importance: t.importance }));
  (consolidation?.topics || []).forEach((t, i) => { for (const k of t.keys || []) if (base.has(String(k)) && !topicOfKey.has(String(k))) topicOfKey.set(String(k), i); });

  const used = new Set();
  const groups = [];
  for (const g of consolidation?.same || []) {
    const keys = (g.keys || []).map(String).filter((k) => base.has(k) && !used.has(k));
    if (!keys.length) continue;
    keys.forEach((k) => used.add(k));
    groups.push({ keys, name: keys.length > 1 ? g.name : null });
  }
  // every other entry stays, as it was found
  for (const k of base.keys()) if (!used.has(k)) groups.push({ keys: [k], name: null });

  const concepts = groups.map((g) => {
    const src = g.keys.map((k) => base.get(k));
    const best = [...src].sort((a, b) => (a.clarity === 'clear' ? 0 : 1) - (b.clarity === 'clear' ? 0 : 1) || rank(a.importance) - rank(b.importance))[0];
    const held = src.find((s) => ['attributed', 'criticized', 'quotation'].includes(s.stance)) || best;
    const placed = g.keys.map((k) => topicOfKey.get(k)).find((i) => i !== undefined);
    return {
      // importance is the highest any section gave it: a merge never lowers an idea
      name: String(g.name || best.name), kind: best.kind, importance: IMPORTANCE[Math.min(...src.map((s) => rank(s.importance)).filter((r) => r >= 0), 2)],
      stance: held.stance, held_by: held.held_by ?? null,
      summary: best.summary, reasoning: src.map((s) => s.reasoning).find(Boolean) ?? null,
      clarity: src.some((s) => s.clarity === 'clear') ? 'clear' : 'unreliable',
      exam_words: src.map((s) => s.exam_words).find(Boolean) ?? null,
      evidence: best.evidence, refs: [...new Set(src.flatMap((s) => s.refs || []))].sort((a, b) => a - b).slice(0, 6),
      placed, section: best.section, sectionTopic: best.topic,
    };
  }).sort((a, b) => firstRef(a) - firstRef(b));

  // topics: the consolidation's, in recording order; a concept it did not place keeps its section's topic
  const topics = [];
  const topicOf = new Map();
  for (const c of concepts) {
    const key = c.placed !== undefined && given[c.placed]?.title ? `g${c.placed}` : `${c.section}|${String(c.sectionTopic || c.name).toLowerCase()}`;
    let t = topicOf.get(key);
    if (!t) {
      const g = c.placed !== undefined ? given[c.placed] : null;
      const st = sectionTopic.get(`${c.section}|${String(c.sectionTopic || '').toLowerCase()}`);
      t = { id: `t${topics.length + 1}`, title: g?.title || c.sectionTopic || c.name, importance: g?.importance === 'major' ? 'major' : 'minor', start_ref: Number.isInteger(st?.start_ref) ? st.start_ref : firstRef(c) };
      topics.push(t); topicOf.set(key, t);
    }
    c.topic = t.id;
    t.start_ref = Math.min(t.start_ref, firstRef(c));
  }
  // a topic is major (must be covered) when it holds a core idea, three or more ideas worth studying, or
  // substantial explaining: the model's label alone can rank a long debate as an aside
  for (const t of topics) {
    const mine = concepts.filter((c) => c.topic === t.id && c.clarity === 'clear' && c.importance !== 'minor');
    const lines = new Set(mine.flatMap((c) => c.refs || [])).size;
    if (mine.some((c) => c.importance === 'core') || mine.length >= 3 || lines >= MAJOR_TOPIC_LINES) t.importance = 'major';
  }
  topics.sort((a, b) => (a.start_ref ?? Infinity) - (b.start_ref ?? Infinity));
  const order = new Map(topics.map((t, i) => [t.id, `t${i + 1}`]));
  for (const t of topics) t.id = order.get(t.id);
  const out = concepts.map((c, i) => {
    const { placed, section, sectionTopic: _s, ...rest } = c;
    return { id: `c${i + 1}`, ...rest, topic: order.get(c.topic) };
  });
  for (const t of topics) if (!Number.isFinite(t.start_ref)) t.start_ref = null;
  return { topics, concepts: out };
}

// ---------------- 3. what gets an item ----------------
// Within `count` items: one for every major topic first (its most important concept), then the remaining core
// concepts, then supporting ones (not for Essentials), spread over topics in proportion to their key ideas.
export function selectConcepts(map, count, { focus = 'balanced' } = {}) {
  const eligible = (map.concepts || []).filter((c) => c.clarity === 'clear' && (c.importance === 'core' || (c.importance === 'supporting' && focus !== 'essentials')));
  const majors = (map.topics || []).filter((t) => t.importance === 'major');
  // within a topic: core before supporting, then what the speaker spent longer on (more explaining lines)
  const weight = (c) => (c.refs || []).length;
  const byTopic = new Map((map.topics || []).map((t) => [t.id, eligible.filter((c) => c.topic === t.id).sort((a, b) => rank(a.importance) - rank(b.importance) || weight(b) - weight(a))]));
  const picked = [];
  const take = (c) => { if (c && picked.length < count && !picked.includes(c)) picked.push(c); };
  for (const t of majors) take(byTopic.get(t.id)?.[0]);
  // the rest go where the share is lowest: a topic holding many key ideas (a long debate) gets proportionally
  // more items than a short one, instead of the same number each; ties go in recording order
  const rounds = (level) => {
    while (picked.length < count) {
      let best = null;
      let bestShare = Infinity;
      for (const t of map.topics || []) {
        const list = byTopic.get(t.id) || [];
        const c = list.find((x) => x.importance === level && !picked.includes(x));
        if (!c) continue;
        const share = list.filter((x) => picked.includes(x)).length / list.filter((x) => rank(x.importance) <= rank(level)).length;
        if (share < bestShare) { best = c; bestShare = share; }
      }
      if (!best) return;
      take(best);
    }
  };
  rounds('core');
  if (focus !== 'essentials') rounds('supporting');
  const selected = picked.sort((a, b) => firstRef(a) - firstRef(b));
  const coveredTopics = new Set(selected.map((c) => c.topic));
  const core = eligible.filter((c) => c.importance === 'core');
  return {
    selected,
    coverage: {
      topics: majors.length, topics_covered: majors.filter((t) => coveredTopics.has(t.id)).length,
      core: core.length, core_covered: core.filter((c) => selected.includes(c)).length,
      supporting_left: eligible.filter((c) => c.importance === 'supporting' && !selected.includes(c)).length,
      missing_topics: majors.filter((t) => !coveredTopics.has(t.id)).map((t) => t.title),
    },
  };
}

// lines the writer / checker sees for a set of concepts: their lines ± `pad`, in order
export function excerptIds(concepts, segments, pad = 3) {
  const valid = new Set(segments.map((s) => s.id));
  const ids = new Set();
  for (const c of concepts) for (const r of c.refs || []) for (let d = -pad; d <= pad; d++) if (valid.has(r + d)) ids.add(r + d);
  return [...ids].sort((a, b) => a - b);
}

// ---------------- 4. writing and checking ----------------
export const WRITE_SCHEMA = { flashcards: obj({ cards: list(FLASHCARD) }), quiz: obj({ questions: list(QUESTION) }) };

export function writeInstructions(kind, { concepts, topics, settings, dominant }) {
  const topicTitle = new Map((topics || []).map((t) => [t.id, t.title]));
  const brief = concepts.map((c) => ({ id: c.id, topic: topicTitle.get(c.topic) || '', name: c.name, kind: c.kind, importance: c.importance, stance: c.stance, held_by: c.held_by, summary: c.summary, reasoning: c.reasoning }));
  const what = kind === 'quiz' ? 'question' : 'flashcard';
  return `Write exactly one ${what} for each concept below, in the order given. Use only the transcript lines above: they are the passages that explain these concepts ("…" marks skipped parts).
<concepts>
${JSON.stringify(brief, null, 1)}
</concepts>
${kind === 'quiz' ? `- ${QUIZ_TYPES[settings?.types] || QUIZ_TYPES.mixed}
- ${settings?.difficulty === 'harder' ? 'Challenge level: reasoning, application, distinction and misconception questions, with close distractors.' : 'Standard level: the important ideas, clearly asked.'}
- Test understanding, reasoning, distinctions, cause and effect, application or misconceptions — not whether a sentence was said. "skill" says which.
- multiple_choice: exactly 4 options and ONE unambiguously correct answer according to the lines. Distractors must be plausible to someone who half-understood: the other school's position on the same question, a reversed cause and effect, a related idea from elsewhere in the lecture, a common misconception. Never absurd, joking or obviously wrong options ("only experts are allowed to use the formula"); no "all/none of the above"; all options similar in length, detail and grammar; no word in the question that gives the answer away.
- explanation: the principle or reasoning behind the right answer, from the lines; one sentence for a simple point. Don't restate the option.`
    : `- front: one clear question about the concept. back: answers exactly that question with the actual knowledge and makes sense on its own; never circular.
- ${FOCUS[settings?.focus] || FOCUS.balanced}
- ${EXPLAIN[settings?.explain] || EXPLAIN.helpful} The explanation must be supported by the lines; never invent a reason, and never repeat the answer.`}
- The question and the answer must match: the answer responds to what the question actually asks (who / what / why / how), not to a neighbouring point.
- "concept" = the concept's id. Keep its stance: an attributed, criticized or quoted position names who holds it; a criticized view is asked about through the criticism.
- Names and technical terms: use them as the transcript spells them. If one looks misrecognized, don't guess the "right" word: describe it instead ("the scholar the lecturer quotes") or keep the transcript's spelling.
- refs: the lines where the answer is explained.
- Plain, grammatical wording.
${STYLE_RULES}${speakerNote({ dominant })}`;
}

export const VERIFY_SCHEMA = obj({
  checks: list(obj({
    index: int('The item number'),
    matches: bool('The answer responds to what the question actually asks'),
    supported: bool('The answer is stated or clearly established by the item\'s lines'),
    explanation_supported: bool('The explanation (if any) is supported by the lines; true when there is none'),
    attribution_ok: bool('Positions are attributed correctly: a school\'s / person\'s view is not stated as fact or as the lecturer\'s own; a criticized view is presented as criticized'),
    distractors_ok: bool('Multiple choice: the wrong options are plausible, not absurd, and do not give the answer away; true for other items'),
    uncertain_terms: list(str(), 'Words or names in the item that look like transcription errors in the lines (keep their exact spelling); empty if none'),
    drop: bool('true when the item cannot be fixed from these lines'),
    fixed_question: nullableStr('A corrected question if needed; else null'),
    fixed_answer: nullableStr('A corrected answer if needed (for multiple choice: the exact text of the correct option); else null'),
    fixed_explanation: nullableStr('A corrected, supported explanation if needed; else null'),
    fixed_options: list(str(), 'Multiple choice only: four corrected options (including the correct one) if the distractors were weak; else empty'),
  })),
});

export function verifyInstructions(kind) {
  return `Check each ${kind === 'quiz' ? 'quiz question' : 'flashcard'} above against its own transcript lines, as a careful teacher would before handing it to students.
For each item return one check (same index):
- matches: does the answer respond to what the question asks? A question about why answered with what, or about one thing answered with another, does not match.
- supported: is the answer stated or clearly established in the lines?
- explanation_supported: is every claim in the explanation supported by the lines?
- attribution_ok: is each position attributed as in the lines (a school's or person's view not presented as fact or as the lecturer's own; a criticized view presented as criticized; the right participant named)?
- distractors_ok (multiple choice): plausible wrong options, none absurd, none giving the answer away by length or wording, exactly one correct.
- uncertain_terms: words or names from the lines that look misrecognized by the automatic transcription and appear in the item. Never correct them.
If an item can be fixed from the same lines, give only the corrected fields (keep the rest null / empty). If the lines don't support it, set drop = true. Plain, grammatical wording in any fix; never add facts that aren't in the lines.`;
}

// checks -> items with fixes applied, unfixable ones removed, cautions added; stats count what happened
export function applyChecks(kind, items, checks) {
  const byIndex = new Map((checks || []).map((c) => [Number(c.index), c]));
  const stats = { verify_dropped: 0, verify_fixed: 0, explanation_unsupported: 0, weak_distractors: 0, cautions: 0 };
  const out = [];
  items.forEach((it, i) => {
    const c = byIndex.get(i);
    if (!c) { out.push(it); return; }
    const fixedQ = c.fixed_question && String(c.fixed_question).trim();
    const fixedA = c.fixed_answer && String(c.fixed_answer).trim();
    if (c.drop || !c.supported || ((!c.matches || !c.attribution_ok) && !fixedQ && !fixedA)) { stats.verify_dropped++; return; }
    const next = { ...it };
    if (fixedQ) next[kind === 'quiz' ? 'question' : 'front'] = fixedQ;
    if (fixedA) next[kind === 'quiz' ? 'answer' : 'back'] = fixedA;
    if (fixedQ || fixedA) stats.verify_fixed++;
    if (!c.explanation_supported) { stats.explanation_unsupported++; next.explanation = c.fixed_explanation ? String(c.fixed_explanation).trim() : null; }
    if (kind === 'quiz' && next.type === 'multiple_choice') {
      const opts = (c.fixed_options || []).map((o) => String(o).trim()).filter(Boolean);
      if (opts.length >= 3 && opts.includes(next.answer)) { next.options = opts; if (!c.distractors_ok) stats.verify_fixed++; }
      else if (!c.distractors_ok) stats.weak_distractors++;
      if (!next.options.includes(next.answer)) { stats.verify_dropped++; return; }
    }
    const text = `${next.front || next.question || ''} ${next.back || next.answer || ''} ${next.explanation || ''} ${(next.options || []).join(' ')}`;
    const terms = [...new Set((c.uncertain_terms || []).map((t) => String(t).trim()).filter((t) => t && text.includes(t)))];
    if (terms.length) { next.caution = cautionFor(terms); stats.cautions++; }
    out.push(next);
  });
  return { items: out, stats };
}

export const cautionFor = (terms) => `Check the recording: ${terms.map((t) => `“${t}”`).join(', ')} may be misheard in the automatic transcript.`;

// Names an item uses that the transcript never contains (a guessed correction, or an invented name) -> list.
const flat = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ'’ʿʾ`]/g, '');
const COMMON = new Set('the a an in on of to for and or but if when why how what which who whose where is are was were be this that these those it its according lecture lecturer recording speaker true false yes no'.split(' '));
export function unseenNames(text, transcriptWords) {
  const found = new Set();
  const sentences = String(text || '').replace(/\{\{S\d+\}\}/g, ' ').split(/(?<=[.!?:;])\s+|\n/);
  for (const s of sentences) {
    const words = s.split(/\s+/);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '').replace(/['’]s$/u, '');
      // a capitalised word, or a name with a lowercase prefix ("al-Khaldun"); a sentence's first word only in that form
      const named = /-\p{Lu}/u.test(clean);
      if ((i === 0 && !named) || !(named || /^\p{Lu}/u.test(clean)) || clean.length < 4) return;
      const parts = flat(clean).split(/[-\s]+/).filter((p) => p.length >= 3 && !COMMON.has(p) && !/^(al|el|ibn|bin|abu)$/.test(p));
      if (parts.some((p) => !knownWord(p, transcriptWords))) found.add(clean);
    });
  }
  return [...found];
}
// the same word, or a close form of it ("Keynesian" / "Keynesians"), in the transcript
const knownWord = (p, words) => words.has(p) || (p.length >= 5 && [...words].some((w) => w.length >= 5 && (w.startsWith(p) || p.startsWith(w)) && Math.abs(w.length - p.length) <= 3));
export const transcriptWordSet = (segments) => new Set(flat(segments.map((s) => s.text).join(' ')).split(/[^\p{L}\p{N}]+/u).flatMap((w) => [w, ...w.split('-')]).filter(Boolean));
