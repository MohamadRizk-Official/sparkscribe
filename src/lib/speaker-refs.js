// Stable speaker references in AI results (Create tools).
//
// The model never writes a speaker's display name into a result. It sees each speaker as a code (S1, S2…) and
// writes {{S1}} wherever it refers to one. The result stores, for every code, the transcript lines that speaker
// said when it was made. When the result is shown, each code becomes the name those lines carry NOW. So:
//   * renaming "Speaker 1" to "Professor Ahmad" (any number of times) shows the new name without regenerating;
//   * merging two speakers shows the merged name for both codes;
//   * lines moved to "Unknown" show "an unidentified speaker";
//   * transcript words, quotes and evidence are never touched (they are not names).
// Nothing is found by searching the text for a name, so a name that also occurs as an ordinary word, or a
// name another speaker had before, can't be replaced by mistake.
//
// The same module fingerprints a transcript (words + who-said-which-line, ignoring names), so a plain rename
// doesn't mark results "out of date" while a changed word or a reassigned paragraph does.
// Pure functions only (browser and server).

export const UNKNOWN = 'Unknown';
const TOKEN_RE = /\{\{\s*(S\d+)\s*\}\}/g;
export const hasTokens = (s) => typeof s === 'string' && /\{\{\s*S\d+\s*\}\}/.test(s);

// ---- line ranges: [12, 13, 14, 20] <-> [[12, 14], [20, 20]] ----
export function toRanges(ids) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out = [];
  for (const id of sorted) {
    const last = out[out.length - 1];
    if (last && id === last[1] + 1) last[1] = id;
    else out.push([id, id]);
  }
  return out;
}
export function fromRanges(ranges) {
  const out = [];
  for (const r of ranges || []) {
    const [a, b] = Array.isArray(r) ? r : [r, r];
    for (let i = Number(a); i <= Number(b) && out.length < 100000; i++) out.push(i);
  }
  return out;
}

// ---- the speaker table made when a result is generated ----
// segments [{ id, speaker, text }] -> { table: { S1: { name, lines } }, codeOf: Map(name -> code), shares }
// Codes follow the order in which speakers first speak; "Unknown" gets no code.
export function speakerTable(segments) {
  const order = [];
  const lines = new Map(), words = new Map();
  for (const s of segments || []) {
    const name = String(s.speaker || UNKNOWN);
    if (!lines.has(name)) { lines.set(name, []); words.set(name, 0); order.push(name); }
    lines.get(name).push(s.id);
    words.set(name, words.get(name) + String(s.text || '').split(/\s+/).filter(Boolean).length);
  }
  const total = [...words.values()].reduce((a, b) => a + b, 0) || 1;
  const table = {}, codeOf = new Map(), shares = {};
  let n = 0;
  for (const name of order) {
    if (name === UNKNOWN) continue;
    const code = `S${++n}`;
    table[code] = { name, lines: toRanges(lines.get(name)) };
    codeOf.set(name, code);
    shares[code] = words.get(name) / total;
  }
  return { table, codeOf, shares };
}

// The speaker who says nearly everything (a lecture, a monologue): the model should say "the lecturer" rather
// than naming them in every question. -> code or null
export function dominantSpeaker(shares, threshold = 0.8) {
  const top = Object.entries(shares || {}).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= threshold ? top[0] : null;
}

// What the model sees: "[12] 3:41 S1: text" (Unknown lines keep "Unknown")
export const codedLine = (s, codeOf, clock) => `[${s.id}] ${clock(s.start)} ${codeOf.get(s.speaker) || UNKNOWN}: ${s.text}`;

// Model output -> stored form: every way the model may have referred to a speaker becomes {{S1}}.
// Verbatim fields (quotes, evidence) are transcript words and are left exactly as they are.
const VERBATIM = new Set(['quote', 'evidence', 'anchor']);
export function tokenizeSpeakers(value, codeOf) {
  const codes = new Set(codeOf.values());
  // Only automatic labels ("Speaker 1") are converted when the model writes them out. A name the user gave
  // ("Grace") can also be an ordinary reference in the content ("Grace Hopper"), so it is never searched for.
  const labelCode = new Map([...codeOf].filter(([n]) => /^speaker \d+$/i.test(n)).map(([n, c]) => [n.toLowerCase(), c]));
  const fix = (s) => s
    // {S1}, [[S1]], {{ S1 }}, and a bare code word "S1"
    .replace(/\{\{\s*(S\d+)\s*\}\}|\{\s*(S\d+)\s*\}|\[\[\s*(S\d+)\s*\]\]/g, (m, a, b, c) => (codes.has(a || b || c) ? `{{${a || b || c}}}` : 'a speaker'))
    .replace(/(?<![\p{L}\p{N}{])(S\d+)(?![\p{L}\p{N}}])/gu, (m, c) => (codes.has(c) ? `{{${c}}}` : m))
    .replace(/(?<![\p{L}\p{N}])speaker \d+(?![\p{L}\p{N}])/giu, (m) => (labelCode.has(m.toLowerCase()) ? `{{${labelCode.get(m.toLowerCase())}}}` : m));
  const walk = (v, key) => {
    if (typeof v === 'string') return VERBATIM.has(key) ? v : fix(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x, k); return o; }
    return v;
  };
  return walk(value, '');
}

// ---- showing a result: codes -> the names the speakers have now ----
// table from the stored result, segments = the transcript as it is now ([{ id, speaker }])
export function speakerResolver(table, segments) {
  const byId = new Map((segments || []).map((s) => [s.id, s.speaker]));
  const cache = new Map();
  return (code) => {
    if (cache.has(code)) return cache.get(code);
    const entry = table?.[code];
    let name;
    if (!entry) name = 'a speaker';
    else {
      const counts = new Map();
      for (const id of fromRanges(entry.lines)) {
        const sp = byId.get(id);
        if (sp != null) counts.set(sp, (counts.get(sp) || 0) + 1);
      }
      const known = [...counts].filter(([sp]) => sp !== UNKNOWN).sort((a, b) => b[1] - a[1]);
      // the name most of that speaker's lines carry now; lines all moved to Unknown -> unidentified;
      // lines no longer there (the transcript was restructured) -> the name it had when generated
      name = known.length ? known[0][0] : counts.size ? 'an unidentified speaker' : entry.name;
    }
    cache.set(code, name);
    return name;
  };
}
export const renderSpeakers = (text, resolve) => (typeof text === 'string' ? text.replace(TOKEN_RE, (m, code) => resolve(code)) : text);

// A copy of a stored result with every code replaced by the current name (verbatim fields untouched; they
// never contain codes). Results without a speaker table (made before this existed) are returned as they are.
export function resolveContent(content, segments) {
  if (!content?.speakers) return content;
  const resolve = speakerResolver(content.speakers, segments);
  const walk = (v) => {
    if (typeof v === 'string') return renderSpeakers(v, resolve);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = k === 'speakers' || k === 'basis' ? x : walk(x); return o; }
    return v;
  };
  return walk(content);
}

// ---- transcript fingerprint ----
// text: the words of every line in order; parts: which lines were said by the same speaker (names ignored).
// A rename changes neither; editing words changes `text`; reassigning a paragraph or merging speakers changes
// `parts`. Whitespace is normalised so the browser's copy and the stored copy agree.
function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}
export function transcriptBasis(segments) {
  const segs = segments || [];
  const first = new Map();
  const parts = segs.map((s, i) => {
    const sp = String(s.speaker || UNKNOWN);
    if (!first.has(sp)) first.set(sp, i);
    return first.get(sp);
  });
  return {
    n: segs.length,
    text: fnv(segs.map((s) => String(s.text || '').replace(/\s+/g, ' ').trim()).join('\n')),
    parts: fnv(parts.join(',')),
  };
}
export const sameBasis = (a, b) => !!a && !!b && a.n === b.n && a.text === b.text && a.parts === b.parts;
