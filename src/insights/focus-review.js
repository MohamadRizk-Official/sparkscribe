// Focused Review: learning from a quiz's mistakes, concept by concept. Pure functions, no DOM, no AI.
//
// A quiz made by study engine 3 stores its study map (topics and concepts, each with what the recording says, the
// reasoning, the exact words and the lines) and every question names the concept it tests. So a missed question
// already points at the idea to review and at the passage that explains it: reviewing costs nothing.
//
// The review state lives in the quiz's own `progress` (user-owned, at most 4000 bytes; see compact()). It stores
// only ids: concept ids from the map and question indexes. Nothing is copied from the quiz, so renaming a
// speaker can't make it wrong (names are resolved when shown), and a new set of questions (regeneration clears
// `progress`) can't leave stale entries pointing at the wrong questions.
//
// Evidence rules (what counts as "you didn't know this"):
//   * only questions that were actually answered count; skipped or unanswered ones are no evidence;
//   * a "close" short answer counts as right, and so does "My answer was right";
//   * a question the learner flagged as wrong or unclear is not evidence about them, whatever they answered;
//   * a question carrying a transcription caution (a possibly misheard word) is "check the recording", not a
//     gap in understanding;
//   * a concept stays "to review" until a later answer about it is right; one right answer after a miss clears
//     it (the learner showed they now know it), any miss in that same run keeps it open.
// Counts are counts of concepts in each state. There is no mastery percentage: it would not be defensible from
// a handful of answers.

export const REVIEW_VERSION = 1;
const MAX_ENTRIES = 40;
const MAX_FLAGS = 30;
const MAX_QIS = 4;

// states of a concept
export const STATE = { REVIEW: 'review', REVIEWED: 'reviewed', CLEARED: 'cleared', CHECK: 'check' };

// progress.review -> a clean state object (anything malformed is ignored, never trusted)
export function readState(progress) {
  const r = progress?.review;
  const out = { v: REVIEW_VERSION, c: {}, flag: [] };
  if (!r || typeof r !== 'object' || r.v !== REVIEW_VERSION) return out;
  for (const [id, e] of Object.entries(r.c || {})) {
    if (!e || typeof e !== 'object' || !Object.values(STATE).includes(e.s)) continue;
    out.c[String(id).slice(0, 20)] = {
      s: e.s, m: Math.max(0, Number(e.m) | 0), ok: Math.max(0, Number(e.ok) | 0),
      q: (Array.isArray(e.q) ? e.q : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, MAX_QIS),
      t: Number(e.t) || 0,
    };
  }
  out.flag = (Array.isArray(r.flag) ? r.flag : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, MAX_FLAGS);
  return out;
}

const clone = (state) => ({ v: REVIEW_VERSION, c: Object.fromEntries(Object.entries(state.c).map(([k, e]) => [k, { ...e, q: [...e.q] }])), flag: [...state.flag] });
const nowS = () => Math.floor(Date.now() / 1000);

// The questions a review works with: the quiz's own, then any follow-up questions written for review.
// Indexes are positions in this combined list, so a question's index never changes when follow-ups are added.
export const allQuestions = (content) => [...(content?.questions || []), ...(content?.followups || [])];

// Can this quiz have a Focused Review? It needs the study map and questions that name their concept.
export const supportsReview = (content) => !!content?.map?.concepts?.length && (content.questions || []).some((q) => q?.concept);

/**
 * Fold one quiz run into the review state.
 * @param state      readState(...)
 * @param questions  allQuestions(content)
 * @param run        quiz-engine run ({ items: [{ qi }], answers: [{ correct, verdict? }] }); answered items only
 * @param conceptIds Set of concept ids that exist in the quiz's map (anything else is ignored)
 */
export function recordRun(state, questions, run, conceptIds) {
  const next = clone(state);
  const flagged = new Set(next.flag);
  const t = nowS();
  // per concept, what this run showed
  const seen = new Map(); // id -> { miss: [qi], right: n, caution: bool }
  (run?.items || []).forEach((it, k) => {
    const ans = run.answers?.[k];
    if (!ans) return;                                  // not answered: no evidence
    const q = questions[it.qi];
    const id = q?.concept != null ? String(q.concept) : null;
    if (!id || !conceptIds.has(id) || flagged.has(it.qi)) return;
    const s = seen.get(id) || { miss: [], right: 0, caution: false };
    if (ans.correct) s.right++;
    else { s.miss.push(it.qi); if (q.caution) s.caution = true; }
    seen.set(id, s);
  });
  for (const [id, s] of seen) {
    const e = next.c[id];
    if (s.miss.length) {
      // only cautioned questions were missed: the transcript there may be misheard, so it's "check", not a gap
      const onlyCaution = s.caution && s.miss.every((qi) => questions[qi]?.caution);
      const state = onlyCaution && (!e || e.s === STATE.CHECK) ? STATE.CHECK : STATE.REVIEW;
      next.c[id] = { s: state, m: (e?.m || 0) + s.miss.length, ok: e?.ok || 0, q: [...new Set([...s.miss, ...(e?.q || [])])].slice(0, MAX_QIS), t };
    } else if (e && s.right && e.s !== STATE.CLEARED) {
      next.c[id] = { ...e, s: STATE.CLEARED, ok: e.ok + s.right, t };
    }
  }
  return compact(next);
}

// The learner read the review of a concept ("Got it"). It stays listed until a right answer clears it.
export function markReviewed(state, id) {
  const next = clone(state);
  const e = next.c[id];
  if (e && e.s === STATE.REVIEW) next.c[id] = { ...e, s: STATE.REVIEWED, t: nowS() };
  return next;
}

// "This question seems wrong": the question stops counting as evidence. A concept whose only misses came from
// flagged questions is no longer listed.
export function flagQuestion(state, qi) {
  const next = clone(state);
  if (!next.flag.includes(qi)) next.flag = [qi, ...next.flag].slice(0, MAX_FLAGS);
  for (const [id, e] of Object.entries(next.c)) {
    if (!e.q.includes(qi)) continue;
    const rest = e.q.filter((x) => x !== qi);
    if (!rest.length && e.s !== STATE.CLEARED) delete next.c[id];
    else next.c[id] = { ...e, q: rest, m: Math.max(rest.length, e.m - 1) };
  }
  return next;
}

// Keep the state small enough for `progress` (4000 bytes with the quiz score): newest first, cleared ones go first.
export function compact(state) {
  const entries = Object.entries(state.c);
  if (entries.length <= MAX_ENTRIES) return state;
  const rank = (e) => (e.s === STATE.CLEARED ? 1 : 0);
  entries.sort((a, b) => rank(a[1]) - rank(b[1]) || b[1].t - a[1].t);
  return { ...state, c: Object.fromEntries(entries.slice(0, MAX_ENTRIES)) };
}

// What to show: the concepts with their details from the map, in the order they are taught.
// content: the quiz content (map + questions + followups), already showing current speaker names.
export function reviewList(state, content) {
  const map = content?.map;
  if (!map?.concepts) return [];
  const topics = new Map((map.topics || []).map((t) => [t.id, t]));
  const order = new Map(map.concepts.map((c, i) => [c.id, i]));
  const qs = allQuestions(content);
  return Object.entries(state.c)
    .filter(([id]) => order.has(id))
    .map(([id, e]) => {
      const c = map.concepts[order.get(id)];
      return { id, state: e.s, missed: e.m, rightAfter: e.ok, questions: e.q.filter((qi) => qs[qi]), concept: c, topic: topics.get(c.topic)?.title || '' };
    })
    .sort((a, b) => order.get(a.id) - order.get(b.id));
}

export function counts(list) {
  const n = { review: 0, reviewed: 0, cleared: 0, check: 0 };
  for (const x of list) n[x.state]++;
  return n;
}
// still open = to review or reviewed but not yet answered right
export const openConcepts = (list) => list.filter((x) => x.state === STATE.REVIEW || x.state === STATE.REVIEWED);

/**
 * Practice for these concepts, from questions already written: questions not yet missed first (new to the
 * learner), then the missed ones again; flagged questions never. -> question indexes (into allQuestions)
 */
export function practiceItems(state, content, ids) {
  const want = new Set(ids);
  const flagged = new Set(state.flag);
  const qs = allQuestions(content);
  const missed = new Set(Object.values(state.c).flatMap((e) => e.q));
  const pool = qs.map((q, qi) => ({ q, qi })).filter(({ q, qi }) => q && want.has(String(q.concept)) && !flagged.has(qi));
  return [...pool.filter(({ qi }) => !missed.has(qi)), ...pool.filter(({ qi }) => missed.has(qi))].map(({ qi }) => qi);
}

// Concepts with no question left that the learner hasn't already missed: a follow-up question would help.
export function needsNewQuestions(state, content, ids) {
  const flagged = new Set(state.flag);
  const missed = new Set(Object.values(state.c).flatMap((e) => e.q));
  const qs = allQuestions(content);
  return ids.filter((id) => !qs.some((q, qi) => q && String(q.concept) === id && !missed.has(qi) && !flagged.has(qi)));
}

// The progress object to save: the review state merged into whatever else progress holds (score, attempts).
export const withState = (progress, state) => ({ ...(progress || {}), review: state });
