// Stable references in answers and study guides made across several recordings (Thunder).
//
// The model never writes a recording's title or a speaker's name into a result. It sees each recording as a label
// (R1, R2, … oldest first) and each speaker as a code scoped to its recording (R2.S1 = speaker S1 of R2, numbered
// from the speaker's ORIGINAL label, lib/speaker-refs.js origCodes), and writes {{R2}} or {{R2.S1}} where it refers
// to one. The stored result keeps those tokens plus a snapshot of which recording each label was. When it is shown,
// {{R2}} becomes the recording's title NOW and {{R2.S1}} the name that speaker's lines carry NOW, so renaming a
// recording or a speaker shows the new name without regenerating, and "Speaker 1" of one recording is never confused
// with "Speaker 1" of another. Nothing is found by searching the text for a name. Citations stay [R2:45].
// Pure functions only (browser and server).
import { origCodes, origResolver } from './speaker-refs.js';

const TOKEN = /\{\{\s*(R\d+)(?:\.(S\d+))?\s*\}\}/g;

// speaker codes of one recording, prefixed with its label: Map(code "R2.S1" -> current name)
export function acrossSpeakers(label, segments) {
  const codes = origCodes(segments);
  const now = origResolver(segments);
  return new Map([...codes.values()].map((c) => [`${label}.${c}`, now(c)]));
}

// An automatic label written out ("Speaker 3") belongs to whichever recording the sentence is about. When a sentence
// cites or names exactly one recording and that recording has a speaker currently called that, it becomes that
// speaker's code; otherwise it is left as written (never guessed). Names users gave are never searched for.
function scopeAutoLabels(text, names) {
  return text.split('\n').map((line) => line.split(/(?<=[.!?])(\s+)/).map((sentence) => {
    if (!/\bspeaker \d+\b/i.test(sentence)) return sentence;
    const labels = new Set([...sentence.matchAll(/\bR(\d+):\d+|\{\{R(\d+)(?:\.S\d+)?\}\}/g)].map((m) => `R${m[1] || m[2]}`));
    if (labels.size !== 1) return sentence;
    const map = names.get([...labels][0]);
    return map ? sentence.replace(/(?<![\p{L}\p{N}{.])speaker (\d+)(?![\p{L}\p{N}}])/giu, (m) => (map.has(m.toLowerCase()) ? `{{${map.get(m.toLowerCase())}}}` : m)) : sentence;
  }).join('')).join('\n');
}

// Model output -> stored form. Brace variants and bare codes become {{R2}} / {{R2.S1}}; a label the model wasn't
// given becomes "a recording" / "a speaker". Citations ([R2:45]) and concept references (R2.c5) are left alone.
// autoNames (optional): Map(label -> Map("speaker 3" -> "R2.S3")) of automatic labels as the speakers are named now.
// names (optional): Map(code -> current name), to drop a name the model repeated right after its code ("{{R2.S3}} (Maya)").
export function tokenizeAcross(text, { labels, speakers, titles = new Map(), autoNames = null, names = null }) {
  const lab = (l) => (labels.has(l) ? `{{${l}}}` : 'a recording');
  const spk = (c) => (speakers.has(c) ? `{{${c}}}` : 'a speaker');
  return String(text || '')
    // {{R2.S1}}, {R2.S1}, [[R2.S1]], {{R2}}, {R2}, [[R2]]
    .replace(/\{\{\s*(R\d+)(?:\.(S\d+))?\s*\}\}|\{\s*(R\d+)(?:\.(S\d+))?\s*\}|\[\[\s*(R\d+)(?:\.(S\d+))?\s*\]\]/g,
      (m, a, as, b, bs, c, cs) => { const l = a || b || c, s = as || bs || cs; return s ? spk(`${l}.${s}`) : lab(l); })
    // a bare speaker code: R2.S1
    .replace(/(?<![\w{.])(R\d+)\.(S\d+)(?![\w}])/g, (m, l, s) => (speakers.has(`${l}.${s}`) ? `{{${l}.${s}}}` : m))
    // "R1 (Lecture 2, Oct 1)" -> "{{R1}} (Oct 1)": the title the model repeated goes, any extra detail stays
    .replace(/(?<![\w{])(R\d+) \(([^)]*)\)/g, (m, l, inner) => {
      const t = titles.get(l);
      if (!labels.has(l) || !t || !inner.startsWith(t)) return m;
      const rest = inner.slice(t.length).replace(/^[,;]\s*/, '').trim();
      return rest ? `{{${l}}} (${rest})` : `{{${l}}}`;
    })
    // "Lecture 5 (R2)" -> "Lecture 5"
    .replace(/\s*\((R\d+)\)/g, (m, l) => (labels.has(l) ? '' : m))
    // a bare label, but never one inside a citation ("R2:45"), a concept reference ("R2.c5") or a token
    .replace(/(?<![\w{.])(R\d+)\b(?![:.]\w|\})/g, (m, l) => (labels.has(l) ? `{{${l}}}` : m))
    .replace(/^[\s\S]*$/, (all) => (autoNames ? scopeAutoLabels(all, autoNames) : all))
    // "Speaker {{R1.S1}}" would show as "Speaker Speaker 1" (or "Speaker Maya"): the token is the name
    .replace(/(?<!\b(?:the|a|an|another|each|one|that|this|which)\s)\bspeaker\s+(?=\{\{R\d+\.S\d+\}\})/gi, '')
    // the same name again in brackets right after the code: once is enough
    .replace(/(\{\{(R\d+\.S\d+)\}\})\s*\(([^()]{1,60})\)/g, (m, tok, code, inner) => (names?.get(code) && inner.trim().toLowerCase() === names.get(code).toLowerCase() ? tok : m));
}

// Stored form -> text to show. names = { title(label), speaker(code) }; an unknown token shows a neutral word.
export function renderAcross(text, { title, speaker }) {
  return String(text ?? '')
    // "{{R1}} (Oct 6)" when the title already says "Oct 6": the title alone
    .replace(/\{\{\s*(R\d+)\s*\}\} \(([^)]{1,40})\)/g, (m, l, inner) => (String(title(l) || '').toLowerCase().includes(inner.trim().toLowerCase()) ? `{{${l}}}` : m))
    .replace(TOKEN, (m, l, s) => (s ? speaker(`${l}.${s}`) || 'a speaker' : title(l) || 'a recording'));
}
// while an answer is streaming: tokens with the names sent at the start, and an unfinished token at the end hidden
export function renderAcrossStreaming(text, names) {
  return renderAcross(text, names).replace(/\{\{?[^{}]*\}?$/, (m) => (/^\{\{?\s*R?\d*(?:\.S?\d*)?\s*\}?$/.test(m) ? '' : m));
}

// apply a string transform to every string in a stored result, except snapshot / reference fields
const SKIP = new Set(['sources', 'recordings', 'refs', 'key', 'label', 'transcriptionId', 'concept']);
export function mapStrings(value, fn, key = '') {
  if (typeof value === 'string') return SKIP.has(key) ? value : fn(value);
  if (Array.isArray(value)) return value.map((x) => mapStrings(x, fn, key));
  if (value && typeof value === 'object') { const o = {}; for (const [k, x] of Object.entries(value)) o[k] = SKIP.has(k) && typeof x !== 'object' ? x : mapStrings(x, fn, k); return o; }
  return value;
}
