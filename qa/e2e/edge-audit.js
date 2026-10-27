// Edge audit (2026-10-27): what on the current page still draws a thin line, a gradient-filled small box, or a pill.
// The owner's rule: edges are at least 2px and solid, or absent; no pills; no faint gradient boxes.
//   (await import('/qa/e2e/edge-audit.js')).audit()  -> { thin: [...], gradient: [...], pill: [...] }
// Each entry: a short selector for the element, what was found, and a sample of its text. Focus rings are ignored.
const alphaOf = (c) => {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (!m) return c === 'transparent' ? 0 : 1;
  const p = m[1].split(/[ ,/]+/).filter(Boolean);
  return p.length >= 4 ? Number(p[3]) : 1;
};
// box-shadow list -> [{ inset, x, y, blur, spread, color }]
function shadows(v) {
  if (!v || v === 'none') return [];
  const out = [];
  for (const part of v.split(/,(?![^(]*\))/)) {
    const color = (part.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}|\b[a-z]+\b(?=\s|$)/i) || ['rgba(0,0,0,1)'])[0];
    const nums = (part.replace(/rgba?\([^)]*\)/g, '').match(/-?\d*\.?\d+px|\b0\b/g) || []).map((n) => parseFloat(n));
    out.push({ inset: /inset/.test(part), x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, color });
  }
  return out;
}
export function audit(root = document) {
  const res = { thin: new Map(), gradient: new Map(), pill: new Map() };
  const name = (el, pe = '') => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
    const parent = el.parentElement && typeof el.parentElement.className === 'string' && el.parentElement.className.trim() ? `${el.parentElement.className.trim().split(/\s+/)[0]} > ` : '';
    return `${parent}${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}${pe}`;
  };
  const add = (map, key, what, el) => {
    const e = map.get(key) || { key, what, n: 0, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) };
    e.n++;
    map.set(key, e);
  };
  for (const el of root.querySelectorAll('body *')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const rects = el.getClientRects();
    if (!rects.length) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    for (const pe of ['', '::before', '::after']) {
      const cs = getComputedStyle(el, pe || null);
      if (pe && (cs.content === 'none' || cs.content === 'normal')) continue;
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      const key = name(el, pe);
      // thin borders
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const w = parseFloat(cs[`border${side}Width`]);
        if (cs[`border${side}Style`] !== 'none' && w > 0 && w < 1.9 && alphaOf(cs[`border${side}Color`]) > 0.08) { add(res.thin, key, `border-${side.toLowerCase()} ${w}px`, el); break; }
      }
      // thin rings and hairlines drawn with box-shadow
      for (const s of shadows(cs.boxShadow)) {
        if (alphaOf(s.color) <= 0.08) continue;
        const ring = s.blur === 0 && s.x === 0 && s.y === 0 && Math.abs(s.spread) > 0 && Math.abs(s.spread) < 1.9;
        const hairline = s.blur === 0 && s.spread === 0 && (Math.abs(s.x) > 0 || Math.abs(s.y) > 0) && Math.abs(s.x) < 1.9 && Math.abs(s.y) < 1.9;
        if (ring) { add(res.thin, key, `ring ${s.spread}px${s.inset ? ' inset' : ''}`, el); break; }
        if (hairline) { add(res.thin, key, `hairline ${s.inset ? 'inset ' : ''}${s.x},${s.y}px`, el); break; }
      }
      if (!el.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && parseFloat(cs.outlineWidth) < 1.9) add(res.thin, key, `outline ${cs.outlineWidth}`, el);
      if (pe) continue;
      // gradient fills on boxes smaller than a panel (pills, chips, notices, cards' small parts)
      const bg = cs.backgroundImage;
      if (bg && /gradient/.test(bg) && r.height < 120 && r.width < 640 && !/^(img|svg|canvas|video)$/i.test(el.tagName)) add(res.gradient, key, 'gradient fill', el);
      // pills: fully rounded short boxes with a fill or an edge (buttons included)
      const rad = parseFloat(cs.borderTopLeftRadius);
      const filled = alphaOf(cs.backgroundColor) > 0.05 || (bg && bg !== 'none') || parseFloat(cs.borderTopWidth) > 0 || shadows(cs.boxShadow).some((s) => alphaOf(s.color) > 0.08 && s.blur === 0);
      if (filled && r.height <= 48 && r.width > r.height * 1.6 && rad >= r.height / 2 - 1) add(res.pill, key, `pill r${Math.round(rad)} h${Math.round(r.height)}`, el);
    }
  }
  const list = (m) => [...m.values()].sort((a, b) => b.n - a.n);
  return { url: location.pathname + location.search, theme: document.documentElement.dataset.theme, thin: list(res.thin), gradient: list(res.gradient), pill: list(res.pill) };
}
