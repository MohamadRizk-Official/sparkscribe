// A speaker change inside a sentence (one person cut off, or two people finishing one sentence): the part that stops
// mid-sentence and the part that carries on are marked, and the page shows "…" at the cut (style.css .seg.cut / .cont).
// Only the display changes: the words, their order and who said them stay exactly as transcribed.
//   continuationMarks(lines) -> [{ cut, cont }] per line (lines: [{ start, end, speaker, text }] in order)
const ENDS_SENTENCE = /[.?!…]["')\]]*$/;
const CARRIES_ON = /^[a-z]/; // the next part starts with a lower-case word: the same sentence goes on

export function continuationMarks(lines) {
  const marks = lines.map(() => ({ cut: false, cont: false }));
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    if (a.speaker === b.speaker || Math.abs(b.start - a.end) > 0.05) continue; // a pause or the same person: not a cut
    if (ENDS_SENTENCE.test(String(a.text).trim()) || !CARRIES_ON.test(String(b.text).trim())) continue;
    marks[i - 1].cut = true;
    marks[i].cont = true;
  }
  return marks;
}
