// Objective quality measures for flashcards and quizzes (any engine). Pure functions.
// Text checks reuse the study engine's helpers, so for engine 2 "circular" / "vague" measure what slipped past
// its own filter (0 by construction); the planted-truth measures (coverage, traps, attribution) are independent.
import { contentWords, isCircular, vagueStart } from '../../server/ai/study.js';
import { renderSpeakers } from '../../src/lib/speaker-refs.js';

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
};
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const SAY = /\b(say|said|says|mention(?:ed)?|state(?:d)?|told)\b/i;
const SPEAKER = /\b(speaker \d+|according to the (?:speaker|lecturer)|did the (?:speaker|lecturer) (?:say|mention|state))\b/i;

// a stored result -> [{ q, a, x, opts, type, refs }] with speaker codes shown as the names they had
export function itemsOf(kind, content) {
  const names = (t) => (content?.speakers ? renderSpeakers(t, (c) => content.speakers[c]?.name || 'a speaker') : t);
  if (kind === 'flashcards') return (content?.cards || []).map((k) => ({ q: names(k.front), a: names(k.back), x: names(k.explanation || ''), opts: [], type: 'card', refs: k.refs || [] }));
  return (content?.questions || []).map((q) => ({ q: names(q.question), a: names(q.answer), x: names(q.explanation || ''), opts: (q.options || []).map(names), type: q.type, skill: q.skill, refs: q.refs || [] }));
}

// every word of the group, as whole words or word starts ("monetar" matches "monetarist"; "cat" doesn't match "location")
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, group) => group.every((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escRe(w.toLowerCase())}`, 'u').test(text));

export function measure(kind, content, kase = {}) {
  const items = itemsOf(kind, content);
  const n = items.length;
  const text = (it) => `${it.q} ${it.a} ${it.x} ${it.opts.join(' ')}`.toLowerCase();
  const m = { n };
  m.circular = items.filter((it) => it.type !== 'true_false' && it.type !== 'multiple_choice' && isCircular(it.q, it.a)).length;
  m.vague = items.filter((it) => vagueStart(it.q)).length;
  let dup = 0;
  items.forEach((it, i) => { if (items.slice(0, i).some((o) => jaccard(contentWords(o.q), contentWords(it.q)) >= 0.6)) dup++; });
  m.duplicates = dup;
  m.speakerRefs = items.filter((it) => SPEAKER.test(it.q)).length;
  m.sentenceRecall = items.filter((it) => SAY.test(it.q)).length;            // "What did X say about…"
  const tf = items.filter((it) => it.type === 'true_false');
  m.trueFalse = tf.length;
  m.trueFalseRestating = tf.filter((it) => SAY.test(it.q) || SPEAKER.test(it.q)).length;
  m.giveaway = items.filter((it) => {
    if (it.type !== 'multiple_choice') return false;
    const others = it.opts.filter((o) => o !== it.a).map((o) => o.length);
    return others.length && it.a.length >= 1.8 * Math.max(...others) && it.a.length - Math.max(...others) >= 25;
  }).length;
  m.withExplanation = items.filter((it) => it.x.trim()).length;
  m.answerWords = n ? Math.round((items.reduce((s, it) => s + words(it.a), 0) / n) * 10) / 10 : 0;
  m.questionWords = n ? Math.round((items.reduce((s, it) => s + words(it.q), 0) / n) * 10) / 10 : 0;
  m.withRefs = items.filter((it) => it.refs.length).length;
  // planted truth
  if (kase.traps) m.trapHits = items.filter((it) => kase.traps.some((g) => has(text(it), g))).length;
  if (kase.concepts?.length) {
    const covered = kase.concepts.filter(([, groups]) => groups.some((g) => items.some((it) => has(text(it), g))));
    m.coverage = `${covered.length}/${kase.concepts.length}`;
    m.missed = kase.concepts.filter((c) => !covered.includes(c)).map(([name]) => name);
  }
  if (kase.positions?.length) {
    const about = items.filter((it) => kase.positions.some((p) => p.about.some((re) => re.test(text(it)))));
    m.attributionChecked = about.length;
    m.attributionLost = about.filter((it) => kase.positions.some((p) => p.about.some((re) => re.test(text(it))) && !p.holder.test(text(it)))).length;
  }
  if (kind === 'quiz') m.skills = Object.entries(items.reduce((o, it) => ((o[it.skill || it.type] = (o[it.skill || it.type] || 0) + 1), o), {})).map(([k, v]) => `${k} ${v}`).join(', ');
  return m;
}
