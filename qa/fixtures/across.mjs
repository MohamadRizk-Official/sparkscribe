// Synthetic recordings for Focused Review and Across-recordings tests (written for testing; no real recordings).
// Built to have known ground truth:
//   * Lecture 2 claims osmosis needs ATP; Lecture 5 explicitly corrects it (a contradiction, resolved later);
//   * osmosis comes up in all three lectures; aquaporins only in Lecture 7; photosynthesis in none;
//   * "Biology Lecture 5 — review session" has a title close to "Biology Lecture 5" but different content;
//   * the launch moves from Monday (Oct 6 sync) to Wednesday (Oct 13 sync); Maya's pricing table is an action item
//     in both meetings (repeated, still open); the student discount is open in the first and decided in the second.
const U = '11111111-1111-4111-8111-111111111111';
const seg = (lines, step = 24) => lines.map(([sp, t], i) => ({ s: i * step, e: i * step + step - 2, sp, t }));
const row = (n, title, created_at, recording_type, lines) => ({
  id: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`, user_id: U, status: 'completed', title, created_at, updated_at: created_at,
  recording_type, language: 'en', content_version: 1, original_file_path: null, segments: seg(lines), duration_seconds: lines.length * 24, transcript_text: '',
});

export const LECTURE_2 = row(1, 'Biology Lecture 2', '2026-10-01T14:00:00Z', 'lecture', [
  ['Speaker 1', 'Good afternoon. Today is about how substances move across the cell membrane.'],
  ['Speaker 1', 'Diffusion is the movement of particles from an area of high concentration to an area of low concentration.'],
  ['Speaker 1', 'Osmosis is a special case: it is the movement of water across a selectively permeable membrane.'],
  ['Speaker 1', 'Water moves toward the side with more dissolved solute, which means toward the lower water concentration.'],
  ['Speaker 1', 'Now, osmosis uses energy from ATP, a bit like a pump pushing the water through.'],
  ['Speaker 2', 'So does diffusion need ATP as well?'],
  ['Speaker 1', 'No, simple diffusion needs no energy at all; the particles just spread out.'],
  ['Speaker 1', 'A selectively permeable membrane lets small molecules like water through but blocks larger ones.'],
  ['Speaker 1', 'Remember the definition of osmosis for the quiz on Friday.'],
  ['Speaker 1', 'Next time we will look at transport that really does need energy.'],
]);
export const LECTURE_5 = row(2, 'Biology Lecture 5', '2026-10-08T14:00:00Z', 'lecture', [
  ['Speaker 1', 'Before we start, a correction from Lecture 2.'],
  ['Speaker 1', 'I said osmosis uses ATP. That was wrong: osmosis is passive and needs no energy from ATP.'],
  ['Speaker 1', 'Water simply follows its concentration gradient across the membrane.'],
  ['Speaker 1', 'Active transport is different: it moves substances against their concentration gradient and that does need ATP.'],
  ['Speaker 1', 'The sodium-potassium pump is the classic example: it uses one ATP to move three sodium ions out and two potassium ions in.'],
  ['Speaker 2', 'Is the pump a kind of osmosis then?'],
  ['Speaker 1', 'No. The pump moves ions, not water, and it spends energy; osmosis moves water and spends none.'],
  ['Speaker 1', 'On the exam you will be asked to compare osmosis and active transport, so know both.'],
  ['Speaker 1', 'Facilitated diffusion uses channel proteins but is still passive.'],
]);
export const LECTURE_7 = row(3, 'Biology Lecture 7', '2026-10-15T14:00:00Z', 'lecture', [
  ['Speaker 1', 'Quick recap: osmosis is the passive movement of water across a membrane.'],
  ['Speaker 1', 'Today: how cells control water movement with aquaporins.'],
  ['Speaker 1', 'Aquaporins are channel proteins that let water cross the membrane much faster.'],
  ['Speaker 1', 'They do not use ATP either; they just make the membrane more permeable to water.'],
  ['Speaker 1', 'Tonicity describes the solution around a cell: hypertonic, hypotonic or isotonic.'],
  ['Speaker 1', 'In a hypotonic solution water flows into the cell, and an animal cell can burst.'],
  ['Speaker 1', 'Plant cells survive this because the cell wall resists the pressure.'],
  ['Speaker 2', 'Will tonicity be on the midterm?'],
  ['Speaker 1', 'Yes, tonicity will be on the midterm.'],
]);
export const LECTURE_5_REVIEW = row(4, 'Biology Lecture 5 — review session', '2026-10-10T16:00:00Z', 'lecture', [
  ['Speaker 1', 'This review session is only about cell organelles, not transport.'],
  ['Speaker 1', 'Mitochondria produce most of the cell\'s ATP through cellular respiration.'],
  ['Speaker 1', 'Ribosomes build proteins; the Golgi apparatus packages them.'],
  ['Speaker 1', 'The nucleus holds the DNA.'],
]);
export const SYNC_1 = row(5, 'Team sync — Oct 6', '2026-10-06T09:00:00Z', 'meeting', [
  ['Speaker 1', 'Let us lock the plan. We decided to launch the beta on Monday the 20th.'],
  ['Speaker 2', 'Agreed, Monday works for marketing.'],
  ['Speaker 3', 'I will send the pricing table to everyone by Friday.'],
  ['Speaker 1', 'Thanks Maya. Are we offering a student discount?'],
  ['Speaker 2', 'Not decided yet. Let us come back to that next week.'],
  ['Speaker 1', 'Jordan, please update the onboarding emails before launch.'],
]);
export const SYNC_2 = row(6, 'Team sync — Oct 13', '2026-10-13T09:00:00Z', 'meeting', [
  ['Speaker 1', 'Change of plan: QA found two blocking bugs, so we are moving the launch from Monday to Wednesday the 22nd.'],
  ['Speaker 2', 'Wednesday is fine, I will tell marketing.'],
  ['Speaker 1', 'Maya, the pricing table still has not gone out. Can you send it today?'],
  ['Speaker 3', 'Yes, sorry, I will send the pricing table today.'],
  ['Speaker 2', 'On the student discount: we agreed on twenty percent.'],
  ['Speaker 1', 'Good, twenty percent it is. Jordan, the onboarding emails are done, thank you.'],
]);
export const ALL = [LECTURE_2, LECTURE_5, LECTURE_7, LECTURE_5_REVIEW, SYNC_1, SYNC_2];
export const LECTURES = [LECTURE_2, LECTURE_5, LECTURE_7];
export const MEETINGS = [SYNC_1, SYNC_2];
// speaker names given in the meetings (the transcripts keep the automatic labels; the app lets users rename)
export const NAMES = { SYNC: { 'Speaker 3': 'Maya' } };
