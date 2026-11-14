// The local mock AI provider (server/ai/mock.js): deterministic output, deliberate bad items for the grounding checks,
// the grade verdicts, failure injection and streaming. Each call waits a fixed 0.4 s (or ~25 ms per streamed word).
import assert from 'node:assert/strict';
const { mockProvider } = await import(new URL('../server/ai/mock.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const lines = [
  '[1] 0:05 Alice: Photosynthesis converts light into chemical energy inside the chloroplast.',
  '[2] 0:20 Bob: The light reactions happen in the thylakoid membranes of the chloroplast.',
  '[3] 1:10 Alice: Then the Calvin cycle builds sugar from carbon dioxide.',
].join('\n');
const msg = (content) => [{ role: 'user', content }];
const p = mockProvider();

ok(p.name === 'mock', 'the provider calls itself "mock"');

// ---- overview
const r = await p.complete({ task: 'overview', messages: msg(lines) });
ok(r.model === 'mock' && typeof r.text === 'string' && JSON.parse(r.text).short_summary === r.json.short_summary, 'the result carries the model name, its JSON and the same JSON as text');
ok(r.json.short_summary.startsWith('[Mock] Photosynthesis converts light into chemical energy inside the chloroplast.'), 'the summary starts from the first line of the transcript');
ok(r.json.key_points.some((k) => k.refs.includes(99999)), 'one key point cites a made-up line number (99999) so grounding is always exercised');
ok(r.json.key_points.every((k) => k.refs.length === 1), 'every key point cites exactly one line');
ok(r.json.chapters.length === 0, 'fewer than 8 lines: no chapters');
ok(r.usage.output === 200 && r.usage.input === Math.ceil(lines.length / 3.2), 'usage is estimated from the prompt length');
const again = await p.complete({ task: 'overview', messages: msg(lines) });
ok(JSON.stringify(again.json) === JSON.stringify(r.json), 'the same prompt always gives the same answer');

// ---- message content may be an array of text parts
const parts = await p.complete({ task: 'overview', messages: msg([{ text: lines }]) });
ok(parts.json.short_summary === r.json.short_summary, 'array content is joined and read the same way');

// ---- detailed summary
const d = await p.complete({ task: 'detailed_summary', messages: msg(lines) });
ok(d.json.sections.length === 2 && d.json.sections[0].heading === 'Beginning' && d.json.sections[1].heading === 'Later', 'a detailed summary has a Beginning and a Later section');
ok(d.json.sections.every((s) => s.points.every((x) => x.refs.length === 1)), 'its points cite one line each');

// ---- grade: shared word → correct; broad place words → close; else incorrect
const grade = (expected, answer) => p.complete({ task: 'grade', messages: msg(`<expected_answer>${expected}</expected_answer>\n<learner_answer>${answer}</learner_answer>`) });
ok((await grade('Chloroplast pigments absorb sunlight', 'it uses chloroplast')).json.verdict === 'correct', 'sharing a significant word is "correct"');
ok((await grade('Spread across several continents', 'worldwide')).json.verdict === 'close', 'a broad place word is "close"');
ok((await grade('Chloroplast pigments absorb sunlight', 'no idea')).json.verdict === 'incorrect', 'otherwise "incorrect"');
ok((await grade('Chloroplast pigments', 'no idea')).json.corrected === null, 'the mock never proposes a corrected answer');

// ---- study tools include deliberately bad items
const cards = await p.complete({ task: 'flashcards', messages: msg(lines) });
ok(cards.json.concepts.length === 5 && cards.json.concepts.some((c) => c.clarity === 'unreliable'), 'flashcards: five concepts, one of them unreliable');
ok(cards.json.concepts.some((c) => c.evidence.includes('nobody ever said')), 'flashcards: one concept has invented evidence');
ok(cards.json.cards.length >= 5, 'flashcards: a mix of good and weak cards');
const uncovered = process.env.AI_MOCK_UNCOVERED;
process.env.AI_MOCK_UNCOVERED = '1';
const lacking = await p.complete({ task: 'flashcards', messages: msg(lines) });
ok(lacking.json.cards.every((c) => c.concept !== 'c1') && cards.json.cards.some((c) => c.concept === 'c1'), 'AI_MOCK_UNCOVERED=1 leaves out the first core concept');
if (uncovered === undefined) delete process.env.AI_MOCK_UNCOVERED; else process.env.AI_MOCK_UNCOVERED = uncovered;

// ---- failure injection
process.env.AI_MOCK_FAIL = '1';
await assert.rejects(() => p.complete({ task: 'overview', messages: msg(lines) }), (e) => e.status === 502 && /Mock provider failure/.test(e.message));
ok(true, 'AI_MOCK_FAIL=1 makes complete() fail with status 502');
await assert.rejects(() => p.stream({ task: 'ask', messages: msg('<question>x</question>') }, () => {}), (e) => e.status === 502);
ok(true, '…and stream() too');
delete process.env.AI_MOCK_FAIL;

// ---- streaming (Ask)
const ask = async (q) => { const got = []; const res = await p.stream({ task: 'ask', messages: msg(`${lines}\n<question>\n${q}\n</question>`) }, (t) => got.push(t)); return { res, got }; };
const hit = await ask('How does photosynthesis convert light into chemical energy?');
ok(hit.got.join('') === hit.res.text, 'the streamed pieces add up to the final text');
ok(hit.res.text.startsWith('[Mock] **Photosynthesis converts light into chemical energy inside the chloroplast.**') && hit.res.text.includes('[99999]'), 'a matching question quotes the best line, with one made-up citation');
ok(hit.res.truncated === false && hit.res.model === 'mock', 'the stream result is not truncated');
const miss = await ask('Who won the football match?');
ok(/^\[Mock\] The recording doesn't mention that \(Who won the football match\)\.$/.test(miss.res.text), 'a question with no matching words is answered "doesn\'t mention that"');
console.log(`${pass} checks passed`);
