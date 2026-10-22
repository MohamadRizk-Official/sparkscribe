// Decoration audit (P13, 2026-10-22): lists what on the current page draws a masked/gradient outline, a border-image,
// or runs an endless animation, so leaked legacy decoration shows up. (await import('/qa/e2e/decor-audit.js')).audit()
export function audit() {
  const out = { masks: [], borderImages: [], endless: [] };
  const name = (el, pe = '') => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}${pe}`;
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length) continue;
    for (const pe of ['', '::before', '::after']) {
      const cs = getComputedStyle(el, pe || null);
      if (pe && (cs.content === 'none' || cs.content === 'normal')) continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const mask = cs.maskImage || cs.webkitMaskImage;
      if (mask && mask !== 'none' && /content-box|exclude|xor/.test(cs.mask || cs.webkitMask || '')) out.masks.push(name(el, pe));
      if (cs.borderImageSource && cs.borderImageSource !== 'none') out.borderImages.push(name(el, pe));
      if (cs.animationName !== 'none' && cs.animationIterationCount === 'infinite' && cs.animationPlayState === 'running') out.endless.push(`${name(el, pe)} (${cs.animationName})`);
    }
  }
  return out;
}
