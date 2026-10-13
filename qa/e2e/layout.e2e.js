// Phone-width layout check: each page in a 375×800 frame; reports horizontal overflow and elements that stick out.
//   (await import('/qa/e2e/layout.e2e.js')).check()  → [{ page, scrollWidth, offenders }]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function check({ width = 375, pages = ['/', '/library', '/settings', '/pricing', '/account', '/privacy', '/terms', '/auth?mode=signup', '/transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] } = {}) {
  const out = [];
  for (const p of pages) {
    const f = document.createElement('iframe');
    f.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:800px;opacity:.01;pointer-events:none;z-index:-1;border:0`;
    document.body.appendChild(f);
    f.src = p;
    for (let i = 0; i < 100 && f.contentDocument?.readyState !== 'complete'; i++) await sleep(100);
    await sleep(1800);
    const d = f.contentDocument;
    const st = d.createElement('style'); st.textContent = '*{transition:none!important;animation:none!important}'; d.head.appendChild(st);
    await sleep(100);
    const sw = d.documentElement.scrollWidth;
    const offenders = [...d.body.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= width + 1) return false;
      const cs = f.contentWindow.getComputedStyle(el);
      if (cs.position === 'fixed' || cs.visibility === 'hidden' || el.closest('[hidden], .hidden, dialog:not([open])')) return false;
      // inside a horizontal scroller is fine
      for (let a = el.parentElement; a && a !== d.body; a = a.parentElement) { const o = f.contentWindow.getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return false; }
      return true;
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} right=${Math.round(el.getBoundingClientRect().right)}`);
    out.push({ page: p, scrollWidth: sw, overflow: sw > width + 1, offenders });
    f.remove();
  }
  return out;
}
