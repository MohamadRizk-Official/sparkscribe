// "Add related material" row (src/lib/related-material.js) and the logo pulse (src/lib/brand.js), with small stand-ins
// for the page. Loaded through tests/vite-env-hook.mjs because details-pop.js imports account.js (and so Supabase).
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);

const docListeners = [];
globalThis.addEventListener = () => {};
globalThis.document = { addEventListener: (type, fn) => docListeners.push([type, fn]), querySelectorAll: () => [] };
const RM = await import(new URL('../src/lib/related-material.js', import.meta.url).href);
const B = await import(new URL('../src/lib/brand.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- relatedMaterialHtml ----
const proc = RM.relatedMaterialHtml('processing');
const res = RM.relatedMaterialHtml('result');
ok(proc.includes('Add slides or PDF') && !proc.includes('Add related material'), 'while processing the button says "Add slides or PDF"');
ok(res.includes('Add related material') && !res.includes('Add slides or PDF'), 'a finished recording says "Add related material"');
ok(RM.relatedMaterialHtml().includes('Add related material'), 'any other mode reads as a finished recording');
ok(proc.includes('data-related') && proc.includes('class="related-add"') && proc.includes('aria-haspopup="dialog"') && proc.includes('aria-expanded="false"'), 'the row is marked for binding and the button announces its popup');
ok(proc.includes('Coming soon') && proc.includes('PowerPoint · PDF · optional'), 'the row says it is not live yet and what it will take');
ok(proc.includes('<svg') && proc.includes('aria-hidden="true"'), 'the plus icon is hidden from assistive technology');

// ---- bindRelatedMaterial ----
const added = [];
const btn = (i) => ({ addEventListener: (type, fn) => added.push([i, type, typeof fn]) });
RM.bindRelatedMaterial({ querySelectorAll: (sel) => { added.push(['selector', sel]); return [btn(1), btn(2)]; } });
ok(added[0][1] === '[data-related] .related-add', 'binding looks for the add button inside the related row');
ok(added.filter((a) => a[1] === 'click' && a[2] === 'function').length === 2, 'every button gets a click handler');
let threw = false;
try { RM.bindRelatedMaterial(null); RM.bindRelatedMaterial(undefined); } catch { threw = true; }
ok(!threw, 'binding with no root does nothing');

// ---- sparkPulse ----
const marks = [0, 1].map(() => {
  const set = new Set(['spark-mark', 'is-sparking']);
  const m = { classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) }, getBoundingClientRect() { m.reflows = (m.reflows || 0) + 1; } };
  return m;
});
B.sparkPulse({ querySelectorAll: (sel) => (sel === '.spark-mark' ? marks : []) });
ok(marks.every((m) => m.classList.contains('is-sparking')), 'every logo mark is left sparking');
ok(marks.every((m) => m.reflows === 1), 'the animation is restarted by forcing a reflow once per mark');
B.sparkPulse({ querySelectorAll: () => [] });
ok(true, 'a page with no logo is fine');

// ---- the animationend listener ----
const ae = docListeners.find(([t]) => t === 'animationend');
ok(!!ae, 'the logo listens for animationend on the document');
const mark = marks[0];
ae[1]({ animationName: 'sp-light-o', target: { closest: (sel) => (sel === '.spark-mark' ? mark : null) } });
ok(!mark.classList.contains('is-sparking'), 'the outer bars finishing their light ends the pulse');
mark.classList.add('is-sparking');
ae[1]({ animationName: 'other', target: { closest: () => mark } });
ok(mark.classList.contains('is-sparking'), 'other animations do not end the pulse');
ae[1]({ animationName: 'sp-light-o', target: {} });
ok(true, 'a target that cannot find its mark is ignored');

console.log(`${pass} checks passed`);
