// Renaming speakers inside rendered results (src/lib/speaker-names.js: applyNames, watchNames).
// There is no browser here: a tiny tree of fake elements and text nodes stands in for the DOM, with just the parts these two functions use.
import assert from 'node:assert/strict';

const el = (cls = '', children = [], tag = 'div') => {
  const n = { tag, cls: cls.split(' ').filter(Boolean), attrs: {}, children, parentElement: null };
  children.forEach((c) => { c.parentElement = n; });
  n.closest = (sel) => {
    const tests = sel.split(',').map((s) => s.trim());
    for (let x = n; x; x = x.parentElement) {
      if (tests.some((t) => (t.startsWith('.') ? x.cls.includes(t.slice(1)) : t.startsWith('[') ? t.slice(1, -1) in x.attrs : x.tag === t))) return x;
    }
    return null;
  };
  return n;
};
const text = (data) => ({ text: true, data, parentElement: null });
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
globalThis.document = {
  createTreeWalker(root, _what, filter) {
    const out = [];
    const visit = (n) => {
      if (n.text) { if (filter.acceptNode(n) === NodeFilter.FILTER_ACCEPT) out.push(n); return; }
      n.children.forEach(visit);
    };
    visit(root);
    let i = -1;
    return { nextNode() { i++; this.currentNode = out[i]; return !!out[i]; }, currentNode: null };
  },
};
globalThis.window = {};
const { applyNames, watchNames } = await import(new URL('../src/lib/speaker-names.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const map = new Map([['Speaker 1', 'Hadi'], ['Speaker 2', 'Dr. Lee']]);

const t1 = text('Speaker 1 asked about the exam. Speaker 2 answered.');
const t2 = text('Speaker 10 stayed quiet; Speaker 1, however, spoke.');
const results = el('results', [el('', [t1]), el('', [t2])]);
applyNames(results, map);
ok(t1.data === 'Hadi asked about the exam. Dr. Lee answered.', 'every speaker name in a result is replaced');
ok(t2.data === 'Speaker 10 stayed quiet; Hadi, however, spoke.', '"Speaker 1" is replaced but "Speaker 10" is left alone');

// places that must keep the original words
const tr = text('Speaker 1: raw transcript line');
const input = text('Speaker 1');
const keep = text('Speaker 2 keeps this');
const ta = text('Speaker 1 in a textarea');
const root = el('', [
  el('transcript', [el('', [tr])]),
  el('', [input], 'input'),
  el('', [ta], 'textarea'),
  el('', [], 'span'),
]);
const keepWrap = el('', [keep]);
keepWrap.attrs['data-keep-names'] = '';
root.children.push(keepWrap);
keepWrap.parentElement = root;
applyNames(root, map);
ok(tr.data === 'Speaker 1: raw transcript line', 'text inside the transcript is never touched');
ok(input.data === 'Speaker 1' && ta.data === 'Speaker 1 in a textarea', 'form fields are never touched');
ok(keep.data === 'Speaker 2 keeps this', 'anything marked data-keep-names is never touched');

// harmless calls
const t3 = text('Speaker 1 spoke');
const r3 = el('', [t3]);
applyNames(r3, new Map());
ok(t3.data === 'Speaker 1 spoke', 'an empty map changes nothing');
applyNames(null, map);
applyNames(undefined, map);
ok(true, 'a missing root is ignored without error');

// regex-looking names and unicode neighbours
const special = new Map([['Speaker (1)', 'Ann'], ['A.B', 'Bea']]);
const t4 = text('Speaker (1) and AxB and A.B');
applyNames(el('', [t4]), special);
ok(t4.data === 'Ann and AxB and Bea', 'names with regex characters are matched literally');
const t5 = text('éSpeaker 1 and Speaker 1é and (Speaker 1)');
applyNames(el('', [t5]), map);
ok(t5.data === 'éSpeaker 1 and Speaker 1é and (Hadi)', 'a name glued to a letter is not a whole name; punctuation around it is fine');

// applying twice is stable
const t6 = text('Speaker 1');
const r6 = el('', [t6]);
applyNames(r6, map); applyNames(r6, map);
ok(t6.data === 'Hadi', 'running it again on already renamed text changes nothing more');
const chain = new Map([['Speaker 1', 'Speaker 2'], ['Speaker 2', 'Speaker 1']]);
const t7 = text('Speaker 1 / Speaker 2');
applyNames(el('', [t7]), chain);
ok(t7.data === 'Speaker 2 / Speaker 1', 'a swap is done in one pass, not chained');

// ---- watchNames
watchNames(null, () => map);
ok(true, 'watchNames ignores a missing root');
const t8 = text('Speaker 1 here');
const r8 = el('', [t8]);
watchNames(r8, () => map);
ok(t8.data === 'Speaker 1 here', 'without MutationObserver support it does nothing');
let observed = null; let cb = null;
globalThis.window = { MutationObserver: true };
globalThis.MutationObserver = class { constructor(fn) { cb = fn; } observe(node, opts) { observed = { node, opts }; } };
let current = new Map([['Speaker 1', 'Hadi']]);
watchNames(r8, () => current);
ok(t8.data === 'Hadi here', 'it renames straight away');
ok(observed.node === r8 && observed.opts.childList && observed.opts.subtree, 'and watches the whole subtree for new content');
const t9 = text('Speaker 1 again');
r8.children.push(t9); t9.parentElement = r8;
current = new Map([['Speaker 1', 'Sam']]);
cb();
ok(t9.data === 'Sam again', 'when content changes it renames again, using the current map');

console.log(`${pass} checks passed`);
