// Spaced review for flashcards. After seeing an answer the student says how well they knew it; the card comes back
// after a growing interval (1, 3, 7, 16, 35, 80 days) or the same day if they didn't know it. Cards never rated are
// not "due": we only schedule what the student has actually practised.
//
// Stored in the flashcard set's own `progress.srs` (transcription_artifacts.progress, user-writable, ≤ 4000 bytes):
//   { "<card index>": [dueDay, step] }   dueDay = whole days since 1970-01-01 (UTC); step = index into INTERVALS
// About 15 bytes per card, so a set of 100 cards stays far below the limit.
export const INTERVALS = [1, 3, 7, 16, 35, 80];
export const today = (now = Date.now()) => Math.floor(now / 86_400_000);

export function readSrs(progress) {
  const s = progress?.srs;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (/^\d{1,3}$/.test(k) && Array.isArray(v) && Number.isInteger(v[0]) && Number.isInteger(v[1])) out[k] = [v[0], Math.max(0, Math.min(v[1], INTERVALS.length - 1))];
  }
  return out;
}

// rating: 'again' (didn't know) | 'good' (knew it) | 'easy' -> the new srs object (input not changed)
export function rate(srs, index, rating, now = Date.now()) {
  const prev = srs[index];
  const step = prev ? prev[1] : -1;
  let next;
  if (rating === 'again') next = 0;
  else if (rating === 'easy') next = Math.min(step + 2, INTERVALS.length - 1);
  else next = Math.min(step + 1, INTERVALS.length - 1);
  next = Math.max(0, next);
  const due = rating === 'again' ? today(now) : today(now) + INTERVALS[next];
  return { ...srs, [index]: [due, next] };
}

// card indexes due today or earlier (only cards that have been rated at least once)
export function dueIndexes(srs, cardCount, now = Date.now()) {
  const t = today(now);
  return Object.entries(srs).filter(([k, v]) => Number(k) < cardCount && v[0] <= t).map(([k]) => Number(k)).sort((a, b) => a - b);
}

// when a card comes back, in words, for the rating buttons
export function nextLabel(srs, index, rating) {
  const r = rate(srs, index, rating);
  const days = r[index][0] - today();
  return days <= 0 ? 'again today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}
