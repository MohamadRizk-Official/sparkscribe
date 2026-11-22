// Ask answer rendering (src/insights/answer-format.js): whatever the model writes, the HTML that comes out contains only
// the documented tags with the documented attributes. Hostile and malformed inputs, plus citation edge cases.
import assert from 'node:assert/strict';
const { renderAnswer, extractCitations, bestExcerpt } = await import(new URL('../src/insights/answer-format.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const cite = (g) => `<sup>${g.n}</sup>`;
const html = (t, o = {}) => renderAnswer(t, { cite, ...o }).html;

const TAGS = new Set(['p', 'strong', 'em', 'code', 'h4', 'ul', 'ol', 'li', 'blockquote', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'sup']);
const ATTRS = /^(class="[\w -]+"|role="region"|aria-label="[^"<>]*"|tabindex="0"|scope="col")$/;
// every real tag in the output (escaped text uses &lt; and never produces one)
function problems(h) {
  const bad = [];
  for (const m of h.matchAll(/<\/?([a-zA-Z][\w-]*)([^<>]*)>/g)) {
    if (!TAGS.has(m[1].toLowerCase())) bad.push(`tag ${m[1]}`);
    for (const a of m[2].match(/[\w-]+(?:="[^"]*")?/g) || []) if (!ATTRS.test(a)) bad.push(`attribute ${a} on ${m[1]}`);
  }
  return bad;
}

const hostile = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '[x](javascript:alert(1))',
  '[x](data:text/html;base64,AAAA) and ![y](http://e/x.png)',
  '**<b onmouseover=alert(1)>bold</b>**',
  '`<svg onload=alert(1)>`',
  '> <iframe src=//evil></iframe>',
  '- <style>*{display:none}</style>\n- item',
  '| <b>h</b> | "q" |\n|---|---|\n| <i>c</i> | \'s\' |',
  '1. <object data=x>\n2. <embed src=x>',
  '"><script>x</script>',
  '&lt;script&gt; &amp; &#60;',
  '\u0001999\u0002 forged marker',
  '[1][2] [3, 4] <u>[5]</u>',
];
for (const t of hostile) {
  const out = html(t, { isValid: () => true });
  const p = problems(out);
  ok(p.length === 0, `only allowed tags and attributes for: ${JSON.stringify(t).slice(0, 48)}${p.length ? ' (' + p.join(', ') + ')' : ''}`);
}
ok(!/<script|<img|<iframe|<svg|<style|javascript:|onerror=/i.test(html('<script>x</script><img src=x onerror=1>').replace(/&lt;[^&]*&gt;/g, '')), 'raw HTML in the text only ever appears escaped');
ok(html('A & B < C > D "q"') === '<p>A &amp; B &lt; C &gt; D &quot;q&quot;</p>', 'the five HTML characters are escaped in plain text');

// ---- citations
ok(renderAnswer('').html === '' && renderAnswer(undefined).html === '' && renderAnswer(null).groups.length === 0, 'empty, undefined and null input render as nothing');
const same = extractCitations('One [3][1] and again [1, 3], then [2].');
ok(same.groups.length === 2 && same.groups[0].ids.join() === '1,3' && same.groups[1].ids.join() === '2', 'the same set of lines cited again reuses its number; ids are sorted');
ok(extractCitations('x [1, 1, 1]').groups[0].ids.join() === '1', 'a line cited twice in one cluster counts once');
const some = extractCitations('Claim [1][9].', (id) => id < 5);
ok(some.groups.length === 1 && some.groups[0].ids.join() === '1', 'invalid ids are dropped from a cluster, valid ones stay');
ok(extractCitations('Claim [9].', () => false).groups.length === 0, 'a cluster with no valid id disappears');
ok(!/\u0001|\u0002/.test(html('x \u00019\u0002 y [1]', { isValid: () => true })), 'a marker character forged by the model never survives into the HTML');
ok(!html('Only [7].', { isValid: () => false }).includes('<sup>'), 'with no valid citation the cite callback is never used');
ok(renderAnswer('Fact [2].', { isValid: () => true }).html === '<p>Fact.</p>', 'without a cite callback the markers are removed');

// ---- bestExcerpt
ok(bestExcerpt('', 'x') === '' && bestExcerpt(null, 'x') === '', 'an empty line gives an empty excerpt');
const long = 'Intro sentence about nothing. The mitochondria produce ATP through respiration. Closing words follow here. ' + 'Filler text goes on. '.repeat(30);
const ex = bestExcerpt(long, 'mitochondria produce ATP', 120);
ok(ex.includes('mitochondria produce ATP') && ex.length <= 130, 'a long line is cut to the sentence that matches the claim');
ok(ex.startsWith('… ') || ex.startsWith('Intro'), 'text cut from the front is marked with an ellipsis');
ok(bestExcerpt('A short line.', 'anything', 240) === 'A short line.', 'a line that already fits is returned whole');

console.log(`\n${pass} checks passed`);
