import { writeFileSync } from 'node:fs';
const U = '11111111-1111-4111-8111-111111111111';
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function toText(name, dur, segs) {
  const groups = [];
  for (const s of segs) { const g = groups.at(-1); if (g && g.sp === s.sp) g.t += ' ' + s.t; else groups.push({ sp: s.sp, s: s.s, t: s.t }); }
  const sp = [...new Set(segs.map((s) => s.sp))].join(', ');
  return `${name}\nLength: ${fmt(dur)} · Speakers: ${sp}\n\n` + groups.map((g) => `[${fmt(g.s)}] ${g.sp}:\n${g.t}`).join('\n\n') + '\n';
}
function build(lines, gap = 6) {
  let t = 0;
  return lines.map(([sp, text]) => { const d = Math.max(2, text.split(' ').length * 0.4); const seg = { s: +t.toFixed(2), e: +(t + d).toFixed(2), sp, t: text }; t += d + gap * 0.1; return seg; });
}
const meeting = build([
  ['Speaker 1', 'Um, okay, let us get started. Today we need to settle the subscription price and the launch date.'],
  ['Speaker 2', 'I think we could charge nine ninety nine, but that might be too high for students.'],
  ['Speaker 3', 'The survey said most people would pay seven ninety nine.'],
  ['Speaker 1', 'After the survey results, we agreed the price will be seven ninety nine per month.'],
  ['Speaker 2', 'Great. Hadi, can you send the revised proposal by Friday?'],
  ['Speaker 3', 'Yes, I will send the the revised proposal by Friday.'],
  ['Speaker 1', 'The launch is planned for next Monday, after the database migration.'],
  ['Speaker 2', 'Supabase handles the user accounts and row level security.'],
  ['Speaker 3', 'What about the accuracy testing, who owns that?'],
  ['Speaker 1', 'We still need to decide who owns accuracy testing.'],
  ['Speaker 2', 'Maybe we could also add a yearly plan later, uh, but let us not decide that today.'],
  ['Speaker 1', 'Transcription reliability remains the priority for this release.'],
  ['Speaker 3', 'I will book a follow up call with the design team for Wednesday at three.'],
  ['Speaker 1', 'Okay, thanks everyone, that is it for today.'],
], 120).map((s, i) => ({ ...s, s: i * 52, e: i * 52 + 40 }));
const voice = build([
  ['Speaker 1', 'Hey, it is me. Um, so the plumber is coming tomorrow at nine, can you be home to let him in?'],
  ['Speaker 1', 'Also, please pick up the dry cleaning before six, the ticket is on the fridge.'],
  ['Speaker 1', 'And, uh, dinner with my parents moved to Saturday at seven. Call me back when you get this.'],
]);
const topics = ['photosynthesis and light reactions', 'the Calvin cycle', 'cellular respiration', 'glycolysis', 'the Krebs cycle', 'the electron transport chain'];
const lecture = [];
for (let i = 0; i < 420; i++) {
  const topic = topics[Math.floor(i / 70)];
  lecture.push({ s: i * 7, e: i * 7 + 6, sp: 'Speaker 1', t: `Now, continuing with ${topic}, point ${i % 70 + 1} is about how the energy is moved and stored in the cell.` });
}
lecture[95] = { ...lecture[95], t: 'Remember this, it will be on the exam: the Calvin cycle fixes carbon dioxide into sugar using ATP and NADPH.' };
lecture[300] = { ...lecture[300], t: 'Glycolysis is defined as the breakdown of glucose into two molecules of pyruvate.' };
lecture[401] = { ...lecture[401], t: 'The final exam covers chapters six through nine, and the lab report is due on the twentieth.' };
const rows = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Pricing meeting', duration_seconds: 14 * 52, language: 'en', recording_type: 'meeting', segments: meeting, transcript_text: toText('pricing.m4a', 14 * 52, meeting), created_at: '2026-10-07T15:20:00Z' },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Voice note from Sam', duration_seconds: 38, language: 'en', recording_type: 'voice_message', segments: voice, transcript_text: toText('note.m4a', 38, voice), created_at: '2026-10-07T12:00:00Z' },
  { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Biology lecture 7', duration_seconds: 420 * 7, language: 'en', recording_type: null, segments: lecture, transcript_text: toText('bio7.mp3', 2940, lecture), created_at: '2026-10-06T09:00:00Z' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Older save (no segments)', duration_seconds: 75, language: 'en', recording_type: 'upload', segments: null, transcript_text: 'old.m4a\nLength: 1:15 · Speakers: Speaker 1, Speaker 2\n\n[0:00] Speaker 1:\nWe agreed to ship on Thursday. Lina will write the release notes by Wednesday.\n\n[0:31] Speaker 2:\nSounds good, I will tell the support team.', created_at: '2026-10-05T09:00:00Z' },
].map((r) => ({ user_id: U, status: 'completed', updated_at: r.created_at, original_file_path: null, content_version: 1, ...r }));
writeFileSync(new URL('seed.json', import.meta.url), JSON.stringify(rows));
console.log('seed written', rows.length);
