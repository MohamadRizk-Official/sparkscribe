// Study engine 2 (Flashcards, Practice Quiz).
//
// Engine 1 turned transcript sentences into questions one by one ("How did Speaker 1 say mitosis differs
// from meiosis?" / "Mitosis is different from meiosis"). Engine 2 works in two steps inside one model call:
//   1. a KNOWLEDGE MAP of the recording: the concepts, arguments, distinctions, causes, principles and
//      explanations a student should understand, each with its importance, whose position it is (the
//      lecturer's own, attributed to a school, criticised, hypothetical, a quotation), the reasoning the
//      speaker gave, the exact words that ground it, and whether the transcript there is reliable;
//   2. the cards / questions, written only from the important, reliable concepts of that map.
// Then the checks below drop what still slipped through (circular answers, duplicates, giveaway options,
// trivia true/false, positions stripped of who holds them…) and count why, so quality can be measured.
// The count asked for is a ceiling, never a quota: 15 strong cards beat 24 with nine weak ones.
import { str, nullableStr, refs, evidence, obj, list } from './prompts.js';

export const STUDY_ENGINE = 2;

const enumOf = (values, description) => ({ type: 'string', enum: values, ...(description && { description }) });
export const CONCEPT_KINDS = ['definition', 'distinction', 'cause_effect', 'principle', 'argument', 'process', 'example', 'fact'];
export const STANCES = ['own', 'attributed', 'criticized', 'hypothetical', 'quotation', 'report'];
export const QUIZ_SKILLS = ['understanding', 'reasoning', 'application', 'distinction', 'relationship', 'cause_effect', 'misconception', 'recall'];

const concept = obj({
  id: str('Short id: c1, c2, …'),
  name: str('The concept in a few words, as a student would name it'),
  kind: enumOf(CONCEPT_KINDS),
  importance: enumOf(['core', 'supporting', 'minor'], 'core = central to the recording; supporting = needed to understand a core idea; minor = trivia, a passing detail, logistics'),
  stance: enumOf(STANCES, 'own = the speaker teaches/holds it; attributed = presented as the view of a school, scholar or group; criticized = a view the speaker rejects or argues against; hypothetical = an illustration or imagined case; quotation = a quoted text or saying; report = neutral history or fact'),
  held_by: nullableStr('Whose position or saying it is (school, scholar, text, group) when stance is attributed, criticized or quotation; else null'),
  summary: str('What the recording establishes, in clear words, keeping qualifiers (sometimes, may, often, always) exactly'),
  reasoning: nullableStr('The reason, mechanism or argument the speaker gave for it; null if the recording gives none'),
  clarity: enumOf(['clear', 'unreliable'], 'unreliable = the transcript here is garbled, cut off or ambiguous'),
  evidence: evidence('the concept'),
  refs,
});

// ---------------- shared instructions ----------------
const MAP_RULES = `STEP 1 — KNOWLEDGE MAP (field "concepts"). Read the whole recording first. List what a student would need to understand and remember:
- important concepts and terms (with their meaning as explained), central arguments and the reasoning behind them, comparisons and distinctions, cause-and-effect relationships, principles, processes, the examples that illustrate a concept, and what the speaker explicitly stressed.
- Leave out: filler, repetition, side conversations, incomplete or garbled statements, organisational announcements (sign-ups, attendance, websites, homework logistics, scheduling), personal remarks, and minor details (dates, counts, names) unless they matter for understanding. One concept per idea: merge repeated explanations of the same idea.
- Go through the whole recording in order. A long lecture (an hour or more) usually has 20–35 concepts. Before you finish the map, check that every part of the recording (beginning, middle and end) is represented, including the debates, arguments and examples near the end.
- importance: core / supporting / minor (be strict: a date, a count or an aside is minor unless the speaker made it central). A debate, argument or worked example the speaker spends several minutes on is at least supporting.
- stance and held_by: keep positions apart. A view presented as a school's or scholar's (e.g. one theological or economic school's doctrine) is "attributed" to it, never a general truth and never the speaker's own view. A view the speaker argues against is "criticized". An imagined case is "hypothetical". A quoted saying is "quotation" (held_by = its source). Only "own" may be stated as the speaker's teaching.
- In a conversation with several participants (a meeting, a debate, an interview), a proposal, opinion or argument put forward by one participant is "attributed" with held_by = that participant's code, e.g. {{S2}} — especially when others disagree.
- summary: what the recording establishes, keeping qualifiers exactly ("sometimes" is not "always", "may" is not "will").
- reasoning: the reason or mechanism the speaker actually gave; null when none was given. Never supply your own.
- clarity: "unreliable" when the transcript there is garbled or ambiguous (automatic transcription makes mistakes).
- evidence: exact words copied from one cited line. refs: the lines where the idea is EXPLAINED, not merely where a keyword first appears.`;

const STYLE_RULES = `Writing rules for every question and answer:
- Self-contained: a student reading it later, without the recording, knows exactly what is asked. Name the subject explicitly; no vague pronouns ("he", "it", "this") and no "the thing discussed".
- Test understanding of an important idea, not the wording of a sentence. Do not turn a sentence into a question just because it exists.
- Clean wording: never copy transcription errors or spoken filler into a question; don't quote the speaker unless the exact words matter.
- Attribution: when participants disagree or make different proposals, say who held which view (with their code). When an idea belongs to a school, scholar, text or group, say so ("In the Keynesian view presented in the lecture, …", "According to the empiricist position the lecturer describes, …"). Never present an attributed or criticized position as a universal truth or as the speaker's own view. For a criticized view, ask about the criticism or the reason given against it.
- Every claim must be supported by the recording. Do not add facts, reasons or examples the speakers did not give.`;

function speakerNote({ dominant }) {
  return dominant
    ? `\nSpeakers: ${dominant ? `{{${dominant}}} gives almost all of the content.` : ''} Refer to them as "the lecturer" (or "the speaker"), and focus on the ideas: never write "According to {{${dominant}}}" or "What did {{${dominant}}} say…". Name another speaker only when their contribution differs (a question, an objection, a disagreement), using their code in double braces, e.g. {{S2}}.`
    : '\nSpeakers: refer to a speaker only when it matters for meaning (who argued what, a disagreement), using their code in double braces, e.g. {{S2}}; otherwise focus on the ideas.';
}

// ---------------- Flashcards ----------------
const FLASHCARD = obj({
  concept: str('id of the concept this card tests'),
  front: str('The question'),
  back: str('The answer: the actual knowledge, self-contained'),
  explanation: nullableStr('Optional extra understanding (why / how / why it matters / the reasoning given); null when the answer needs none or the recording gives none'),
  refs,
});
export const FLASHCARDS_SCHEMA = obj({
  concepts: list(concept, 'The knowledge map, in the order taught'),
  cards: list(FLASHCARD, 'The flashcards, in the order taught'),
});

const FOCUS = {
  essentials: 'FOCUS: essentials. Only core concepts; keep the deck short.',
  balanced: 'FOCUS: balanced. Core concepts first, then the supporting ideas needed to understand them.',
  deep: 'FOCUS: deep understanding. Prefer why / how / compare / apply questions on core and supporting concepts: reasons, mechanisms, distinctions, consequences, and applying a principle to a case the recording itself describes.',
};
const EXPLAIN = {
  helpful: 'explanation: only when it adds understanding (a mechanism, an argument, why a distinction matters, the reasoning the speaker gave). Simple definitions and facts get null.',
  every: 'explanation: give one for every card where the recording offers any reasoning or context; null only when it offers none.',
  brief: 'Keep answers as short as complete answers can be. explanation: null except for complex arguments or mechanisms.',
};

export function flashcardInstructions({ count, settings, dominant }) {
  return `Make FLASHCARDS that help a student genuinely understand and remember this recording.
${MAP_RULES}

STEP 2 — CARDS (field "cards"), written only from core and supporting concepts with clarity "clear".
- Cover the map from beginning to end: every core concept gets a card, and every supporting concept gets one when it is needed to understand a core idea, including concepts from the last part of the recording. Usually one strong card per concept; a second only when the concept has a genuinely separate thing to learn.
- At most ${count} cards. This is a ceiling, not a target: if the recording has 12 worthwhile ideas, write about 12 cards. Never pad with trivia.
- ${FOCUS[settings?.focus] || FOCUS.balanced}
- front: one clear question about the concept.
- back: answers the question directly with the actual knowledge, and makes sense on its own. Never circular: an answer that only repeats the question's words ("What distinguishes X from Y?" → "X is different from Y") is wrong; say WHAT the difference is. As short as possible, as long as necessary: one sentence for a simple definition, two or three for an argument.
- ${EXPLAIN[settings?.explain] || EXPLAIN.helpful} Never repeat the answer in the explanation, and never invent a reason the recording doesn't give.
- refs: the lines where the answer is explained.
- No two cards may test the same thing.
${STYLE_RULES}${speakerNote({ dominant })}

Examples of the standard (other subjects, for illustration only):
- Weak: "According to Speaker 1, what did the lecturer say about inflation?" / "Inflation is bad." → Better: "Why does the lecture argue that unexpected inflation hurts savers more than borrowers?" / "Because repayments are fixed in money terms, unexpected inflation lowers the real value of what borrowers repay, so savers and lenders lose purchasing power while borrowers gain."
- Weak: "How did the professor say mitosis differs from meiosis?" / "Mitosis is different from meiosis." → Better: "What is the key difference between mitosis and meiosis as explained in the lecture?" / "Mitosis produces two identical cells with the full chromosome number; meiosis produces four cells with half the chromosomes, for reproduction."`;
}

// ---------------- Practice Quiz ----------------
const QUESTION = obj({
  concept: str('id of the concept this question tests'),
  type: enumOf(['multiple_choice', 'short_answer', 'true_false']),
  skill: enumOf(QUIZ_SKILLS, 'What the question tests'),
  question: str(),
  options: list(str(), 'multiple_choice: exactly 4 options; true_false: ["True","False"]; short_answer: []'),
  answer: str('The exact text of the correct option, "True"/"False", or the short expected answer'),
  accept: list(str(), 'short_answer only: other acceptable answers'),
  explanation: nullableStr('Shown after answering: the principle or reasoning that makes the answer right (and, when useful, why a tempting option is wrong). null only for a trivial question'),
  refs,
});
export const QUIZ_SCHEMA = obj({
  concepts: list(concept, 'The knowledge map, in the order taught'),
  questions: list(QUESTION),
});

const QUIZ_TYPES = {
  mixed: 'Mostly multiple_choice, plus a few short_answer (answers of a few words). Use true_false only for a meaningful distinction or a common misconception the recording corrects — never to restate a sentence — and at most two.',
  multiple_choice: 'Only multiple_choice questions.',
  true_false: 'Only true_false questions. Each must test a meaningful distinction or a misconception (e.g. swapping two schools\' positions, reversing a cause and effect), never a sentence restated; a false statement must be clearly contradicted by the recording, not merely absent from it.',
};

export function quizInstructions({ count, settings, dominant }) {
  return `Write a PRACTICE QUIZ that checks whether a student really understood this recording.
${MAP_RULES}

STEP 2 — QUESTIONS (field "questions"), written only from core and supporting concepts with clarity "clear".
- At most ${count} questions — a ceiling, not a target. Fewer strong questions beat padding.
- Spread them over the whole recording: core concepts first (one question each, from beginning to end), then supporting ones while the ceiling allows.
- Test understanding, reasoning, applying a principle, important distinctions, relationships between ideas, cause and effect, and misconceptions — not whether a sentence was said. "skill" says which; use "recall" sparingly, only for something essential to know.
- ${QUIZ_TYPES[settings?.types] || QUIZ_TYPES.mixed}
- ${settings?.difficulty === 'harder' ? 'Challenge level: mostly reasoning, application, distinction and misconception questions, with close distractors.' : 'Standard level: the important ideas, clearly asked.'}
- multiple_choice: exactly 4 options and ONE unambiguously correct answer according to the recording. Distractors must be plausible to someone who half-understood: another school's position, a reversed cause and effect, a related idea from elsewhere in the recording, a common misconception. No absurd or joke options, no "all/none of the above", similar length and grammar for all options, and no words in the question that give the answer away.
- Never require information the recording doesn't contain, and never present an unsupported claim as fact.
- explanation: the principle or reasoning behind the right answer, proportional to the question (one sentence for a simple point). Don't just restate the question or the correct option. Only reasons the recording supports.
- No two questions may test the same thing.
${STYLE_RULES}${speakerNote({ dominant })}`;
}

// ---------------- coverage pass ----------------
// After the checks, core concepts of the map may still have no card / question (the model stopped early, or its
// item was rejected). If the ceiling allows, one small extra call writes items for exactly those concepts, from
// the lines that explain them; the result goes through the same checks.
export const FILL_SCHEMA = { flashcards: obj({ cards: list(FLASHCARD) }), quiz: obj({ questions: list(QUESTION) }) };
export function fillInstructions(kind, { concepts, settings, dominant }) {
  const what = kind === 'quiz' ? 'question' : 'flashcard';
  const map = concepts.map((k) => ({ id: k.id, name: k.name, kind: k.kind, stance: k.stance, held_by: k.held_by, summary: k.summary, reasoning: k.reasoning }));
  return `These concepts from the recording's knowledge map have no ${what} yet. Write exactly one ${what} for each, using only the transcript lines above (they are the passages that explain these concepts).
<concepts>
${JSON.stringify(map, null, 1)}
</concepts>
- "concept" = the concept's id. Keep its stance: an attributed, criticized or quoted position names who holds it ("held_by"); a criticized view is asked about through the criticism.
${kind === 'quiz'
    ? `- ${QUIZ_TYPES[settings?.types] || 'multiple_choice (4 plausible options, one correct, similar length) or short_answer; no true_false'}. explanation: the principle or reasoning behind the answer.`
    : `- back: the actual knowledge, self-contained, never circular. ${EXPLAIN[settings?.explain] || EXPLAIN.helpful}`}
- Skip a concept only if these lines don't really support it.
${STYLE_RULES}${speakerNote({ dominant })}`;
}

// ---------------- checks ----------------
const STOP = new Set(('a an the of to in on for and or is are was were be been being by with that this these those it its as at from into than then so such '
  + 'what which who whom whose why how when where does did do according lecture lecturer speaker recording said says explained explain described '
  + 'there their they them he she his her we our you your i not no can could would should may might will shall about also only just very').split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s|ly|ment|ness|ion|ions)$/, '').slice(0, 7);
export const contentWords = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/\{\{s\d+\}\}/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
const GENERIC = new Set(['differ', 'different', 'same', 'similar', 'important', 'thing', 'way', 'someth', 'many', 'good', 'bad', 'true', 'fals', 'yes', 'certain', 'kind', 'type', 'part', 'issu', 'matter', 'stuff', 'point'].map(stem));

// The answer adds nothing the question didn't already say ("What was said" / "X is different from Y").
export function isCircular(question, answer) {
  const q = new Set(contentWords(question));
  // a plain yes / no (or a number) answers the question; it can't be circular
  if (/^\s*(?:yes|no)\b/i.test(String(answer)) || /^\s*[\d.,%]+\s*$/.test(String(answer))) return false;
  // naming a term ("What is the term for the costs of changing prices…?" → "Menu costs") may echo the description
  if (/\b(?:term|name|called|call it|known as|word for|stand for|abbreviation)\b/i.test(String(question)) && String(answer).split(/\s+/).length <= 6) return false;
  // choosing between alternatives the question names ("…fixed or flexible?" → "Fixed")
  const pick = String(answer).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').trim();
  if (/\bor\b/i.test(String(question)) && pick && pick.split(/\s+/).length <= 4 && String(question).toLowerCase().includes(pick)) return false;
  const a = contentWords(answer);
  if (!a.length) return true;
  const novel = a.filter((w) => !q.has(w));
  if (!novel.length) return true;
  return novel.every((w) => GENERIC.has(w)) && a.length <= 8;
}
// "What did he say…", "It is…": the question leans on someone or something it never names
// ("this lecture", "that school" name something; a bare "this" / "it" / "he" doesn't)
const PRON = '(?:he|she|they|it|him|her|them|(?:this|that|these|those)(?=\\s*(?:[?,.]|$|(?:is|are|was|were|mean|means|refer|refers|do|does|did|say|says|said|show|shows)\\b)))';
const VAGUE_RE = new RegExp(`^(?:(?:how|what|why|when|where|which|who)\\s+(?:did|does|do|is|are|was|were|can|could|should)\\s+${PRON}(?![\\w-])|${PRON}\\s)`, 'i');
export const vagueStart = (q) => VAGUE_RE.test(String(q).trim());
// In a recording where one speaker says nearly everything, that speaker is simply "the lecturer".
export const lecturerWord = (text, dominant) => (dominant ? String(text).replace(new RegExp(`\\{\\{${dominant}\\}\\}`, 'g'), 'the lecturer') : text);
// Questions: "According to {{S1}}, …" / "…, as explained by {{S1}}?" lose the attribution altogether
export function dropNeedlessAttribution(text, dominant) {
  if (!dominant) return text;
  const tok = `\\{\\{${dominant}\\}\\}`;
  let t = String(text)
    .replace(new RegExp(`^according to ${tok},?\\s*`, 'i'), '')
    .replace(new RegExp(`,?\\s*(?:according to|as (?:explained|described|stated|said) by) ${tok}(?=[?.!,]|$)`, 'gi'), '')
    .replace(new RegExp(`\\b(?:as|what) ${tok} (?:said|explained|described)\\b`, 'gi'), (m) => (/^what/i.test(m) ? 'what the lecturer explained' : 'as the lecturer explained'))
    .replace(new RegExp(tok, 'g'), 'the lecturer');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
};
// An attributed / criticized / quoted position must keep who holds it (or, for a criticism, say it's criticized)
export function keepsAttribution(item, c) {
  if (!c || !['attributed', 'criticized', 'quotation'].includes(c.stance)) return true;
  // "True or false: adding indexes always makes queries faster" → False: testing the rejected claim IS the criticism
  if (c.stance === 'criticized' && item.type === 'true_false' && /^false$/i.test(String(item.answer))) return true;
  // "Does adding more indexes always make queries faster?" → "No. …": answering no is the criticism
  if (c.stance === 'criticized' && /^\s*no\b/i.test(String(item.back || item.answer || ''))) return true;
  const raw = `${item.front || item.question || ''} ${item.back || item.answer || ''} ${item.explanation || ''} ${(item.options || []).join(' ')}`;
  const text = raw.toLowerCase();
  // a participant's view: the item must say whose it is, by naming a participant (it may be about another
  // participant's reaction to it: "What concern did {{S2}} raise about {{S3}}'s proposal?")
  if (/\{\{S\d+\}\}/.test(String(c.held_by || ''))) return /\{\{S\d+\}\}/.test(raw);
  // the holder's name as a short stem, so spellings match ("Behaviourism" ~ "behaviorist", "O'Neill" ~ "ONeill", "Keynesian" ~ "Keynes")
  const flat = (t) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ'’ʿʾ`]/g, '');
  const hay = flat(text);
  const holder = flat(String(c.held_by || '')).replace(/[^\p{L}\p{N} ]+/gu, ' ').split(' ').filter((w) => w.length > 3 && !STOP.has(w));
  if (holder.some((w) => hay.includes(w.slice(0, Math.min(5, Math.max(4, w.length - 2)))))) return true;
  return c.stance === 'criticized' && /\b(reject|critici|argu(?:e|es|ed) against|object|disagree|refut|warn|wrong|mistaken|corrupt|false claim)/i.test(text);
}
export const restates = (explanation, answer, question) => {
  if (!explanation) return false;
  const e = contentWords(explanation);
  if (String(explanation).trim().length < 20) return true;
  const known = new Set([...contentWords(answer), ...contentWords(question)]);
  return e.filter((w) => !known.has(w)).length < 2;
};

function conceptIndex(c, segments) {
  const ids = new Set(segments.map((s) => s.id));
  const map = new Map();
  for (const k of c.concepts || []) if (k?.id) map.set(String(k.id), k);
  return { map, ids };
}
// items the model didn't give lines for inherit their concept's lines (before grounding checks them)
export function inheritRefs(items, content) {
  const byId = new Map((content.concepts || []).map((k) => [String(k.id), k]));
  for (const it of items || []) if (!it.refs?.length) it.refs = [...(byId.get(String(it.concept))?.refs || [])];
}

const bump = (q, k) => { q[k] = (q[k] || 0) + 1; };
// The item's concept. One the model mapped but grounding removed (its evidence isn't in the transcript) → null:
// the item is dropped. One the model wrote an item for but never listed in its map → kept as an ordinary,
// supporting idea of the speaker's own (the item still passes every other check and its lines are grounded).
function conceptOf(map, id, rawConceptIds, quality) {
  const con = map.get(String(id));
  if (con) return con;
  if (!rawConceptIds || rawConceptIds.has(String(id))) return null;
  bump(quality, 'unmapped');
  return { id: `u:${String(id || '?')}`, importance: 'supporting', clarity: 'clear', stance: 'own', held_by: null, evidence: null };
}
// STUDY_DEBUG_DROPS=1 (the evaluation harness): keep what was dropped and why, to audit false rejections
const dropper = (quality) => (reason, q, a) => {
  bump(quality, reason);
  if (globalThis.process?.env?.STUDY_DEBUG_DROPS === '1' && (quality.dropped ||= []).length < 60) quality.dropped.push({ reason, q: String(q || '').slice(0, 300), a: String(a || '').slice(0, 300) });
};
// core, reliable concepts of the map that no kept item tests (a coverage measure; nothing is dropped)
// reliable concepts no kept item tests: core ones only, or (for the coverage pass) core first, then supporting
export const uncoveredConcepts = (concepts, items, { supporting = false } = {}) => {
  const tested = new Set((items || []).map((x) => String(x.concept)));
  const open = (concepts || []).filter((k) => k.clarity !== 'unreliable' && !tested.has(String(k.id)));
  const core = open.filter((k) => k.importance === 'core');
  return supporting ? [...core, ...open.filter((k) => k.importance === 'supporting')] : core;
};
const uncoveredCore = (concepts, items) => uncoveredConcepts(concepts, items).length;
// Two questions are duplicates when their words mostly match, unless both name speakers and the speakers differ
// ("What did Speaker 2 propose?" and "What did Speaker 3 propose?" are two viewpoints, not one).
const dupWords = (t) => ({ w: contentWords(t), sp: [...new Set(String(t).match(/\{\{S\d+\}\}/g) || [])].sort().join() });
const isDup = (a, b) => jaccard(a.w, b.w) >= 0.7 && !(a.sp && b.sp && a.sp !== b.sp);

// -> number dropped; writes content.quality = { reason: count, …, kept }
export function validateFlashcards(c, segments, { count, dominant, rawConceptIds }) {
  const { map } = conceptIndex(c, segments);
  const quality = {};
  const drop = dropper(quality);
  const out = [], seen = [];
  const perConcept = new Map();
  for (const k of c.cards || []) {
    const rawFront = String(k.front || '').trim();
    const front = dropNeedlessAttribution(rawFront, dominant);
    const back = lecturerWord(String(k.back || '').trim(), dominant);
    const con = conceptOf(map, k.concept, rawConceptIds, quality);
    if (front.length < 10 || !back) { drop('empty', k.front, k.back); continue; }
    if (!con) { drop('ungrounded_concept', k.front, k.back); continue; }
    if (con.importance === 'minor') { drop('minor_concept', k.front, k.back); continue; }
    if (con.clarity === 'unreliable') { drop('unreliable_source', k.front, k.back); continue; }
    if (isCircular(front, back)) { drop('circular', k.front, k.back); continue; }
    if (vagueStart(front)) { drop('vague', k.front, k.back); continue; }
    if (!keepsAttribution({ ...k, front }, con)) { drop('attribution_lost', k.front, k.back); continue; }
    const w = dupWords(front);
    if (seen.some((x) => isDup(x, w))) { drop('duplicate', k.front, k.back); continue; }
    const n = perConcept.get(con.id) || 0;
    if (n >= 2) { drop('duplicate', k.front, k.back); continue; }
    let explanation = k.explanation ? lecturerWord(String(k.explanation).trim(), dominant) : null;
    if (explanation && restates(explanation, back, front)) { bump(quality, 'explanation_removed'); explanation = null; }
    if (front !== rawFront) bump(quality, 'speaker_reference_fixed');
    perConcept.set(con.id, n + 1);
    seen.push(w);
    out.push({ concept: con.id, front, back, explanation, refs: k.refs });
  }
  const over = Math.max(0, out.length - count);
  if (over) quality.over_limit = over;
  c.cards = out.slice(0, count);
  quality.kept = c.cards.length;
  quality.core_uncovered = uncoveredCore(c.concepts, c.cards);
  c.quality = quality;
  return Object.entries(quality).filter(([k]) => !['kept', 'explanation_removed', 'speaker_reference_fixed', 'core_uncovered'].includes(k)).reduce((a, [, v]) => a + v, 0);
}

const NOTA = /\b(all|none|both|neither) of (the )?(above|these|them)\b/i;
export function validateQuiz(c, segments, { count, settings, dominant, rawConceptIds }) {
  const { map } = conceptIndex(c, segments);
  const quality = {};
  const drop = dropper(quality);
  const out = [], seen = [];
  const perConcept = new Map();
  let tf = 0;
  const wanted = settings?.types && settings.types !== 'mixed' ? settings.types : null;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const q of c.questions || []) {
    const rawQuestion = String(q.question || '').trim();
    const question = dropNeedlessAttribution(rawQuestion, dominant);
    const answer = String(q.answer || '').trim();
    const con = conceptOf(map, q.concept, rawConceptIds, quality);
    if (question.length < 8 || !answer) { drop('empty', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    if (!con) { drop('ungrounded_concept', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    if (con.importance === 'minor') { drop('minor_concept', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    if (con.clarity === 'unreliable') { drop('unreliable_source', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    if (wanted && q.type !== wanted) { drop('wrong_type', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    if (vagueStart(question)) { drop('vague', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    const item = { concept: con.id, type: q.type, skill: QUIZ_SKILLS.includes(q.skill) ? q.skill : 'recall', question, answer, options: [], accept: [], explanation: q.explanation ? lecturerWord(String(q.explanation).trim(), dominant) : null, evidence: con.evidence, refs: q.refs };
    if (q.type === 'multiple_choice') {
      const opts = [...new Map((q.options || []).map((o) => String(o).trim()).filter(Boolean).map((o) => [norm(o), o])).values()];
      const correct = opts.filter((o) => norm(o) === norm(answer));
      if (opts.length < 3 || opts.length > 5 || correct.length !== 1) { drop('malformed', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
      if (opts.some((o) => NOTA.test(o))) { drop('all_none_option', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
      const others = opts.filter((o) => o !== correct[0]).map((o) => o.length);
      if (correct[0].length >= 1.8 * Math.max(...others) && correct[0].length - Math.max(...others) >= 25) { drop('giveaway_length', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
      item.answer = correct[0];
      item.options = shuffle(opts, question);
    } else if (q.type === 'true_false') {
      const a = /^true$/i.test(answer) ? 'True' : /^false$/i.test(answer) ? 'False' : null;
      if (!a) { drop('malformed', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
      // in a mixed quiz, true/false only for a distinction or a misconception, at most two
      if (!wanted && (!['distinction', 'misconception'].includes(item.skill) || tf >= 2)) { drop('trivial_true_false', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
      item.answer = a; item.options = ['True', 'False'];
      tf++;
    } else if (q.type === 'short_answer') {
      if (answer.length > 120) { drop('malformed', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
      if (isCircular(question, answer)) { drop('circular', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
      item.accept = (q.accept || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
    } else { drop('malformed', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    if (!keepsAttribution(item, con)) { drop('attribution_lost', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    const w = dupWords(question);
    if (seen.some((x) => isDup(x, w))) { drop('duplicate', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    const n = perConcept.get(con.id) || 0;
    if (n >= 2) { drop('duplicate', q.question, [q.answer, ...(q.options || [])].join(' | ')); continue; }
    if (item.explanation && restates(item.explanation, item.answer, question)) { bump(quality, 'explanation_removed'); item.explanation = null; }
    if (question !== rawQuestion) bump(quality, 'speaker_reference_fixed');
    perConcept.set(con.id, n + 1);
    seen.push(w);
    out.push(item);
  }
  const over = Math.max(0, out.length - count);
  if (over) quality.over_limit = over;
  c.questions = out.slice(0, count);
  quality.kept = c.questions.length;
  quality.core_uncovered = uncoveredCore(c.concepts, c.questions);
  c.quality = quality;
  return Object.entries(quality).filter(([k]) => !['kept', 'explanation_removed', 'speaker_reference_fixed', 'core_uncovered'].includes(k)).reduce((a, [, v]) => a + v, 0);
}

// Deterministic shuffle (the right answer isn't always first, yet the order stays stable)
export function shuffle(arr, seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
