// Ask answers (src/insights/answer-format.js) and playback starts (src/lib/breath.js): safe rendering, citation
// numbering that is stable for saved answers, grouping, invalid ids, and seeks that start in a pause.
import { renderAnswer, extractCitations, bestExcerpt } from '../src/insights/answer-format.js';
import { envelopeFromSamples, breathBefore, paragraphStart, sentenceStartsTimed, splitSentences, ENV_HZ } from '../src/lib/breath.js';
import { alignWords } from '../src/lib/align-words.js';

let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log(`ok - ${msg}`); } else { failed++; console.log(`FAIL - ${msg}`); } };
const cite = (g) => `<C${g.n}:${g.ids.join(',')}>`;
const valid = (id) => id < 50;
const html = (t) => renderAnswer(t, { isValid: valid, cite }).html.replace(/<span class="aa-nw">([^<]*)(<C[^>]*>)<\/span>/g, '$1$2'); // drop the word + number wrapper

// ---- safety: nothing the model writes becomes markup
const evil = html('Hi <script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) <a href="https://evil">y</a> [3]');
ok(!/<script|<img|<a\b|onerror=|javascript:/i.test(evil.replace(/&lt;[^&]*&gt;/g, '')), 'model HTML, images and links are escaped or dropped');
ok(/&lt;script&gt;/.test(evil) && evil.includes('<C1:3>'), 'escaped text stays readable; the citation is kept');
ok(!/href=|src=|style=|on\w+=/i.test(html('**a** *b* `c` | x |\n|---|\n| y |\n> q\n## h\n1. one\n- two')), 'no attribute ever comes from the text');

// ---- formatting
const f = html('## The price\nThey agreed on **$7.99** [3][1].\n- Survey [2, 3]\n  - nested [3, 1]\n1. First\n2. Second\n\n| Option | Who |\n|---|---|\n| $9.99 | S2 [1] |\n> "the price" [3]');
ok(f.includes('<h4 class="aa-h">The price</h4>') && f.includes('<strong>$7.99</strong>'), 'heading and bold');
ok(/<ul><li>Survey<C\d:2,3><ul><li>nested<C1:1,3><\/li><\/ul><\/li><\/ul>/.test(f), 'bullets with a nested item');
ok(f.includes('<ol><li>First</li><li>Second</li></ol>'), 'numbered steps');
ok(f.includes('<table>') && f.includes('<th scope="col">Option</th>') && f.includes('<td>S2<C'), 'a simple table');
ok(f.includes('<blockquote>'), 'a quote');
ok(html('Unclosed **bold').includes('Unclosed **bold'), 'unfinished bold while streaming stays plain text');
ok(html('line one\nline two') === '<p>line one</p><p>line two</p>', 'older plain answers: one paragraph per line');
ok(html('- a [1]\n- b [2]') === '<ul><li>a<C1:1></li><li>b<C2:2></li></ul>', 'older "- " list answers render as before (with numbers)');

// ---- citations: grouping, numbering, validation
const g1 = extractCitations('A [5]. B [5][6]. C [6, 5]. D [7] [8].', valid).groups;
ok(JSON.stringify(g1) === JSON.stringify([{ n: 1, ids: [5] }, { n: 2, ids: [5, 6] }, { n: 3, ids: [7, 8] }]), 'one bracket cluster = one source group; the same lines cited again reuse the number');
const again = extractCitations('A [5]. B [5][6]. C [6, 5]. D [7] [8].', valid).groups;
ok(JSON.stringify(again) === JSON.stringify(g1), 'numbers are derived from the stored text alone (stable when reopened)');
const inv = extractCitations('Price [99]. Date [99, 4].', valid);
ok(inv.text === `Price. Date\u00011\u0002.` && inv.groups.length === 1 && inv.groups[0].ids.join() === '4', 'ids the transcript lacks are dropped; an all-invalid citation disappears');
ok(!/\d:\d\d/.test(html('It was decided [3].')), 'no timestamp is ever written by the renderer (times come from the transcript lines)');

// ---- excerpt
const long = 'First sentence about cats. Second about the price of seven ninety nine per month which the survey supported. Third sentence about dogs and other unrelated things that go on for a while. Fourth one too, filler text to make it long.';
const ex = bestExcerpt(long, 'the price was seven ninety nine', 120);
ok(ex.includes('seven ninety nine') && ex.length <= 130, `excerpt picks the matching sentence (${ex.length} chars)`);
ok(bestExcerpt('Short line.', 'x') === 'Short line.', 'short lines are shown whole');

// ---- breath: synthetic speech with pauses (20 Hz frames)
const SR = 16000, sec = 30, s = new Float32Array(SR * sec);
const pauses = [[4.0, 4.4], [9.6, 10.1], [15.2, 15.5], [22.0, 22.6]];
for (let i = 0; i < s.length; i++) {
  const t = i / SR;
  const quiet = pauses.some(([a, b]) => t >= a && t < b);
  s[i] = (quiet ? 0.0005 : 0.2) * Math.sin(i * 0.31);
}
const env = envelopeFromSamples(s, SR);
ok(env.length === sec * ENV_HZ, 'envelope: 20 values a second');
// starts are "half a second into the breath before the words", never before the breath began
const st = breathBefore(env, 10.5); // mid-word just after the 9.6–10.1 pause
ok(st >= 9.6 && st <= 9.7, `a seek just after a breath starts in that breath, ~0.5 s before the words (${st.toFixed(2)})`);
const st2 = breathBefore(env, 15.0); // just before a breath: the next words start at 15.5
ok(st2 >= 15.2 && st2 <= 15.3, `a cut right before a breath starts in that breath, not a sentence earlier (${st2.toFixed(2)})`);
const st3 = breathBefore(env, 19.0); // no breath within reach
ok(Math.abs(st3 - 18.85) < 0.01, `no breath nearby: a short lead-in only (${st3.toFixed(2)})`);
const segs = [{ start: 0, end: 9.8, speaker: 'A' }, { start: 9.8, end: 16, speaker: 'A' }, { start: 16, end: 30, speaker: 'B' }];
const ps = paragraphStart(segs, 1, env);
ok(ps >= 9.6 && ps <= 9.7, `a paragraph cut inside a breath starts in that breath (${ps.toFixed(2)})`);
const split = [{ start: 0, end: 12, speaker: 'A' }, { start: 12, end: 20, speaker: 'A' }];
const sp = paragraphStart(split, 1, env);
ok(sp >= 11.6 && sp <= 13.2, `a cut through speech starts near the cut, in the breath before its own words (${sp.toFixed(2)})`);
ok(paragraphStart(segs, 1, null).toFixed(2) === '9.70', 'without an envelope: the paragraph start with a 0.1 s lead-in');

// ---- sentences: splitting, word matching, timed starts
ok(splitSentences('Okay. Hello, everybody. I am Sarah.').length === 3, 'sentences are split at . ! ?');
ok(splitSentences('Mr. Smith said 3.5 percent, e.g. this. Fine!').map((x) => x.text.trim()).join('|') === 'Mr. Smith said 3.5 percent, e.g. this.|Fine!', 'abbreviations, initials and decimals don’t end a sentence');
const m = alignWords(['We', 'agreed', 'on', 'seven', 'ninety-nine.', 'Great.'], [{ w: 'we' }, { w: 'agree' }, { w: 'on' }, { w: 'seven' }, { w: 'ninety' }, { w: 'nine' }, { w: 'great' }]);
ok(m[0] === 0 && m[2] === 2 && m[3] === 3 && m[5] === 6, `text words find their timed counterparts despite spelling differences (${m.join(',')})`);
const tseg = [{ start: 4.4, end: 15.2, speaker: 'A', text: 'First sentence here. Second one starts after the breath.' }];
// timed words: "Second" at 10.25 (+0.15 aligner lateness): its breath is 9.6–10.1
const timedW = [['First', 4.6, 4.9], ['sentence', 4.9, 5.5], ['here.', 5.5, 9.5], ['Second', 10.25, 10.6], ['one', 10.6, 11], ['starts', 11, 11.5]];
const ts = sentenceStartsTimed(tseg, 0, env, timedW);
ok(ts.length === 2 && ts[1] >= 9.6 && ts[1] <= 10.1, `a timed sentence starts in the breath before its first word (${ts[1]?.toFixed(2)})`);
const ts2 = sentenceStartsTimed(tseg, 0, env, null);
ok(ts2.length === 2 && ts2[1] > tseg[0].start && ts2[1] < tseg[0].end, `without timings, the envelope estimate is used (${ts2[1]?.toFixed(2)})`);
const runOn = [{ start: 0, end: 4, speaker: 'A', text: 'One two three. Four five.' }];
const tsR = sentenceStartsTimed(runOn, 0, env, [['One', 0.5, 0.8], ['two', 0.8, 1.1], ['three.', 1.1, 2.1], ['Four', 2.25, 2.6], ['five.', 2.6, 3]]);
ok(tsR[1] >= 1.3 && tsR[1] < 2.1, `sentences that run together: starts after the previous word, not inside it (${tsR[1]?.toFixed(2)})`);

console.log(`\n${passed} checks passed${failed ? `, ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
