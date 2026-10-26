// Ask answers: model text -> safe HTML, with numbered citations.
//
// The model writes a small Markdown subset (headings, paragraphs, **bold**, *italic*, "- " lists, "1." steps, simple
// tables, "> " quotes) and cites transcript lines as [12] or [12][15] / [12, 15]. Nothing it writes is trusted as
// markup: every character is escaped first and only the tags below are ever produced (no links, no images, no raw
// HTML, no attributes taken from the text). Answers saved before this format (plain lines and "- " lists) render
// the same way.
//
// Citations: one bracket cluster ([12][15] or [12, 15]) is one claim's sources. Clusters are numbered [1], [2]… in
// reading order; the same set of lines cited again gets the same number. Numbers are derived from the stored text
// alone, so a saved answer reopened later shows the same numbers. Line ids the transcript doesn't have are dropped
// (the server already removed lines the model wasn't given), so no citation can point at an invented moment.

const CLUSTER_RE = /\[(\d+(?:\s*,\s*\d+)*)\](?:\s*\[(\d+(?:\s*,\s*\d+)*)\])*/g;
const IDS_RE = /\d+/g;
const MARK = (n) => `\u0001${n}\u0002`;

// -> { text (citations replaced by markers), groups: [{ n, ids }] }
export function extractCitations(text, isValid = () => true) {
  const groups = [];
  const byKey = new Map();
  const out = String(text || '').replace(CLUSTER_RE, (m) => {
    const ids = [];
    for (const x of m.match(IDS_RE)) { const id = Number(x); if (isValid(id) && !ids.includes(id)) ids.push(id); }
    if (!ids.length) return '';
    ids.sort((a, b) => a - b);
    const key = ids.join(',');
    let g = byKey.get(key);
    if (!g) { g = { n: groups.length + 1, ids }; groups.push(g); byKey.set(key, g); }
    return MARK(g.n);
  });
  // tidy spaces left before punctuation by removed citations ("Friday [99]." -> "Friday.")
  // and attach each number to the word before it, so a line never starts with one ("Friday [1]." -> "Friday[1].")
  return { text: out.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]+(\u0001)/g, '$1'), groups };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// inline: escape, then **bold**, *italic* / _italic_, `code`; [text](url) keeps only the text
function inline(s) {
  let h = escHtml(s.replace(/\[([^\]\u0001]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1'));
  h = h.replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)([^_]+?)__/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_(?=\S)([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  return h;
}

const isTableRow = (l) => /^\|.*\|$/.test(l);
const isTableSep = (l) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l);
const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// Markdown subset -> HTML. `cite(group)` returns the HTML for one citation marker.
export function renderAnswer(text, { isValid, cite } = {}) {
  const { text: body, groups } = extractCitations(text, isValid);
  const byN = new Map(groups.map((g) => [g.n, g]));
  // the number stays on the same line as the word before it (both in one unbreakable span)
  const fill = (h) => h.replace(/([^\s<>]*)\u0001(\d+)\u0002/g, (m, word, n) => {
    const c = byN.has(Number(n)) && cite ? cite(byN.get(Number(n))) : '';
    return c ? `<span class="aa-nw">${word}${c}</span>` : word;
  });
  const lines = body.split('\n');
  const out = [];
  let list = null; // { tag, items: [html], sub? }
  const closeList = () => {
    if (!list) return;
    out.push(`<${list.tag}${list.start > 1 ? ` start="${list.start}"` : ''}>${list.items.map((i) => `<li>${i.html}${i.sub.length ? `<ul>${i.sub.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k].replace(/\s+$/, '');
    const l = raw.trim();
    if (!l || /^(-{3,}|\*{3,}|_{3,})$/.test(l)) { closeList(); continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.+?)\s*#*$/))) {
      closeList();
      out.push(m[1].length <= 2 ? `<h4 class="aa-h">${inline(m[2])}</h4>` : `<h5 class="aa-h aa-h-sm">${inline(m[2])}</h5>`);
      continue;
    }
    if (isTableRow(l) && k + 1 < lines.length && isTableSep(lines[k + 1].trim())) {
      closeList();
      const head = cells(l);
      const rows = [];
      k += 2;
      while (k < lines.length && isTableRow(lines[k].trim())) rows.push(cells(lines[k++].trim()));
      k--;
      out.push(`<div class="aa-table" role="region" aria-label="Table" tabindex="0"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, i) => `<td>${inline(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const indented = /^\s{2,}/.test(raw);
    if ((m = l.match(/^[-•*]\s+(.*)$/))) {
      if (indented && list?.items.length) { list.items.at(-1).sub.push(inline(m[1])); continue; }
      if (list?.tag !== 'ul') { closeList(); list = { tag: 'ul', items: [] }; }
      list.items.push({ html: inline(m[1]), sub: [] });
      continue;
    }
    if ((m = l.match(/^(\d{1,3})[.)]\s+(.*)$/))) {
      if (indented && list?.items.length) { list.items.at(-1).sub.push(inline(m[2])); continue; }
      if (list?.tag !== 'ol') { closeList(); list = { tag: 'ol', items: [], start: Number(m[1]) }; }
      list.items.push({ html: inline(m[2]), sub: [] });
      continue;
    }
    if ((m = l.match(/^>\s?(.*)$/))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    closeList();
    out.push(`<p>${inline(l)}</p>`);
  }
  closeList();
  return { html: fill(out.join('')), groups };
}

// The sentence of a transcript line that best matches the claim it supports (for the source list), at most ~`max`
// characters, cut at word boundaries.
const WORD_RE = /[\p{L}\p{N}']+/gu;
const STOP = new Set('the a an and or but of to in on at for with is was are were be been it this that he she they we you i his her their our your as by from so do did does have has had not no yes'.split(' '));
const words = (t) => (String(t).toLowerCase().match(WORD_RE) || []).filter((w) => w.length > 2 && !STOP.has(w));
export function bestExcerpt(lineText, claim, max = 240) {
  const text = String(lineText || '').trim();
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const want = new Set(words(claim));
  let best = 0, score = -1;
  sentences.forEach((s, i) => { const sc = words(s).filter((w) => want.has(w)).length; if (sc > score) { score = sc; best = i; } });
  let a = best, b = best, len = sentences[best].length;
  while (true) { // grow around the best sentence while it fits
    const next = b + 1 < sentences.length ? sentences[b + 1].length : Infinity;
    const prev = a > 0 ? sentences[a - 1].length : Infinity;
    if (Math.min(next, prev) + len > max) break;
    if (next <= prev) { b++; len += next; } else { a--; len += prev; }
  }
  let out = sentences.slice(a, b + 1).join('').trim();
  let cut = b < sentences.length - 1;
  if (out.length > max) { out = out.slice(0, max).replace(/\s+\S*$/, ''); cut = true; }
  return `${a > 0 ? '… ' : ''}${out}${cut ? ' …' : ''}`;
}

// The claim a marker supports: the text of its block up to the marker (markers and tags stripped).
export function claimBefore(markerEl) {
  const block = markerEl.closest('p, li, td, blockquote, h4, h5') || markerEl.parentElement;
  if (!block) return '';
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEndBefore(markerEl);
  const t = range.toString();
  const parts = t.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
  return (parts.at(-1) || t).trim();
}
