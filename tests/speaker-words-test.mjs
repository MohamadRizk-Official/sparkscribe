// Speaker labels after transcription (src/engine/speaker-words.js): lines keep their text; the checked speaker result
// relabels them, and splits a line at its words' times only where it hears a speaker change.
//   node tests/speaker-words-test.mjs
import assert from 'node:assert/strict';
import { labelMap, planLines, runsIn, splitLine } from '../src/engine/speaker-words.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const seg = (start, end, speaker) => ({ start, end, speaker });

// first engine: one person (A) for everything; the checked result hears two people (X then Y)
const first = [seg(0, 20, 'A')];
const final = [seg(0, 6, 'X'), seg(6, 20, 'Y')];
const lines = [
  { start: 0, end: 4, speaker: 'A', text: 'Hello there.' },
  { start: 4.5, end: 9, speaker: 'A', text: 'How are you? Fine thanks.' },
  { start: 12, end: 15, speaker: 'A', text: 'Good to hear.' },
  { start: 30, end: 31, speaker: 'A', text: 'Later.' },
];
const map = labelMap(first, final);
ok(map.get('A') === 'Y', 'a first-engine label maps to the final label it overlaps most');
const plan = planLines(lines, final, { map });
ok(plan[0].speaker === 'X' && plan[0].runs.length === 1, 'a line one person covers is relabelled, nothing to time');
ok(plan[1].runs.length === 2, 'a line with a speaker change inside is found');
ok(plan[3].speaker === 'Y' && !plan[3].runs.length, 'a line the result says nothing about keeps its own label, mapped');
ok(runsIn([seg(0, 5, 'X'), seg(5, 5.3, 'Y'), seg(5.3, 9, 'X')], 0, 9).length === 1, 'a stretch shorter than 0.5 s joins its neighbour');

// split at the words' times: "How are you?" before 6 s, "Fine thanks." after
const times = [{ s: 4.6, e: 4.8 }, { s: 4.9, e: 5.0 }, { s: 5.1, e: 5.4 }, { s: 6.6, e: 6.9 }, { s: 7.0, e: 7.4 }];
const parts = splitLine(lines[1], times, plan[1].runs);
ok(parts.length === 2 && parts[0].speaker === 'X' && parts[1].speaker === 'Y', 'the line is split where the speaker changes');
ok(parts.map((p) => p.text).join(' ') === lines[1].text, 'every word kept, in order, unchanged');
ok(parts[0].start === 4.5 && parts[1].end === 9 && parts[0].end === parts[1].start && Math.abs(parts[1].start - 6.6) < 1e-9, 'pieces keep the line\'s edges and meet where the second piece\'s first word starts');
ok(splitLine(lines[1], [], plan[1].runs) === null, 'without word times nothing is split (the line keeps one label)');
const numbers = splitLine({ ...lines[1], text: 'How are you? 100 percent.' }, [times[0], times[1], times[2], null, times[4]], plan[1].runs, { snap: 0 });
ok(numbers[0].text === 'How are you? 100' && numbers[1].text === 'percent.', 'a word without a time goes with the word before it');
ok(numbers.map((p) => p.text).join(' ') === 'How are you? 100 percent.', '…and no word is lost');

// a change found one word after a sentence end moves to the sentence end ("What is this? I" / "don't know.")
{
  const l = { start: 0, end: 4, speaker: 'A', text: "What is this? I don't know." };
  const t = [{ s: 0.1, e: 0.3 }, { s: 0.35, e: 0.5 }, { s: 0.55, e: 0.9 }, { s: 1.6, e: 1.7 }, { s: 2.2, e: 2.5 }, { s: 2.6, e: 2.9 }];
  const r = [seg(0, 2, 'X'), seg(2, 4, 'Y')];
  const moved = splitLine(l, t, r);
  ok(moved[0].text === 'What is this?' && moved[1].text === "I don't know." && Math.abs(moved[1].start - 1.6) < 1e-9, 'a change one word from a sentence end moves there (the piece starts at that word)');
  ok(splitLine(l, t, r, { snap: 0 })[0].text === 'What is this? I', '(by word times alone "I" would stay behind)');
  const far = splitLine({ ...l, text: "What is this thing I don't know." }, [...t, { s: 3, e: 3.2 }], r);
  ok(far.map((p) => p.text).join(' ') === "What is this thing I don't know.", 'without a sentence end nearby nothing moves and no word is lost');
}

console.log(`\n${pass} checks passed`);
