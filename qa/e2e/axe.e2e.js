// Automated accessibility scan (axe-core, WCAG 2.1 A/AA rules) of every page in light and dark themes, plus the saved
// transcript's tabs. Reports serious/critical violations. Run on any harness page:
//   (await import('/qa/e2e/axe.e2e.js')).scan()   → { pages: [...], totals }
const AXE = '/qa/sql/node_modules/axe-core/axe.min.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function frameFor(path) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:900px;opacity:.01;pointer-events:none;z-index:-1';
  document.body.appendChild(f);
  f.src = path;
  for (let i = 0; i < 100 && !(f.contentDocument?.readyState === 'complete' && f.contentWindow.location.pathname !== 'blank'); i++) await sleep(100);
  await sleep(1500);
  const s = f.contentDocument.createElement('script');
  s.src = AXE;
  await new Promise((r) => { s.onload = r; f.contentDocument.head.appendChild(s); });
  // a hidden/background tab doesn't advance CSS transitions, so a theme switch would leave colours frozen half-way:
  // measure without transitions
  const st = f.contentDocument.createElement('style');
  st.textContent = '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }';
  f.contentDocument.head.appendChild(st);
  return f;
}
async function run(f, label, theme) {
  f.contentDocument.documentElement.dataset.theme = theme;
  await sleep(300);
  const res = await f.contentWindow.axe.run(f.contentDocument, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ page: label, theme, id: v.id, impact: v.impact, count: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any?.[0]?.message ? ` — ${n.any[0].message.slice(0, 120)}` : '')) }));
}

export async function scan({ pages = ['/', '/library', '/settings', '/pricing', '/account', '/privacy', '/terms', '/auth?mode=signup'], tabs = true } = {}) {
  const out = [];
  for (const p of pages) {
    const f = await frameFor(p);
    for (const t of ['light', 'dark']) out.push(...await run(f, p, t));
    f.remove();
  }
  if (tabs) {
    const f = await frameFor('/transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const d = f.contentDocument;
    for (const name of ['Transcript', 'Summary', 'Notes', 'Ask', 'Create']) {
      const b = [...d.querySelectorAll('#resTabs [role="tab"], #resTabs button')].find((x) => new RegExp(name, 'i').test(x.textContent));
      if (!b) { out.push({ page: '/transcript', theme: '-', id: `tab-missing:${name}`, impact: 'note', count: 0, sample: [] }); continue; }
      b.click(); await sleep(700);
      for (const t of ['light', 'dark']) out.push(...await run(f, `/transcript#${name}`, t));
    }
    f.remove();
  }
  const totals = {};
  for (const v of out) totals[v.id] = (totals[v.id] || 0) + v.count;
  return { violations: out, totals };
}
