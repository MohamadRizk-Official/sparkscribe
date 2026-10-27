// Edge sweep: run edge-audit.js on the page as it is now, plus every tab and Create tool on a transcript page, and keep
// the findings in localStorage under "__edgeSweep" (navigation clears page state; storage survives it).
//   (await import('/qa/e2e/edge-sweep.js')).sweep('label')   then   (await import('/qa/e2e/edge-sweep.js')).report()
import { audit } from './edge-audit.js';

const KEY = '__edgeSweep';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
function keep(label, a) {
  const all = load();
  for (const kind of ['thin', 'gradient', 'pill']) for (const e of a[kind]) {
    const k = `${kind}|${e.key}`;
    const x = all[k] || { kind, key: e.key, what: e.what, text: e.text, where: [] };
    if (!x.where.includes(label)) x.where.push(label);
    all[k] = x;
  }
  localStorage.setItem(KEY, JSON.stringify(all));
}

export async function sweep(label = location.pathname) {
  keep(label, audit());
  // a transcript page: every tab, and every Create tool's view
  const tabs = [...document.querySelectorAll('#resTabs .tab[data-tab]')];
  for (const t of tabs) {
    t.click(); await sleep(700);
    keep(`${label} · ${t.dataset.tab}`, audit());
    if (t.dataset.tab === 'create') {
      const tools = [...document.querySelectorAll('[data-tool]')].map((b) => b.dataset.tool).filter((v, i, a) => a.indexOf(v) === i);
      for (const tool of tools) {
        const b = document.querySelector(`[data-tool="${tool}"]`); if (!b) continue;
        b.click(); await sleep(700);
        keep(`${label} · create · ${tool}`, audit());
        document.querySelector('[data-goto="create"], .study-crumb button, [data-act="tools"], .cr-back')?.click(); await sleep(500);
      }
    }
  }
}

export function report() {
  const all = Object.values(load());
  const by = (kind) => all.filter((x) => x.kind === kind).map((x) => `${x.key} | ${x.what} | "${x.text}" | ${x.where.slice(0, 3).join('; ')}${x.where.length > 3 ? ` (+${x.where.length - 3})` : ''}`).join('\n');
  return `THIN (${all.filter((x) => x.kind === 'thin').length})\n${by('thin')}\n\nGRADIENT (${all.filter((x) => x.kind === 'gradient').length})\n${by('gradient')}\n\nPILL (${all.filter((x) => x.kind === 'pill').length})\n${by('pill')}`;
}
export const reset = () => localStorage.removeItem(KEY);
