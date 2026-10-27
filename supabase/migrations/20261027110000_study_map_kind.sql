-- Study map ahead of time (owner decision 2026-10-27): opening the Create tab builds the recording's study map in
-- the background, so a quiz or flashcards started a moment later only write and check their items. The map is kept
-- as one more kind of saved result, 'study_map' (one per recording, settings_key 'g2'), which the study tools reuse
-- like the map stored with any other engine-3 result. It is never shown as a result (server/ai/service.js getState
-- leaves it out) and goes away with the recording, like every saved result.
--
-- Safety review (2026-10-27)
--   * Only the kind check constraint changes: the same list plus 'study_map'. No rows are rewritten, no other
--     column, policy or grant changes; every existing row still satisfies the new check.
--   * The row is written by the server as the signed-in user, under the same Row Level Security as every saved
--     result, and costs AI only through the same metered, budgeted path (ai_reserve).
--   * Rollback: supabase/proposed/rollback/20261027110000_study_map_kind.down.sql (deletes 'study_map' rows, which
--     only cache what can be rebuilt, and restores the old list).
alter table public.transcription_artifacts drop constraint if exists transcription_artifacts_kind_check;
alter table public.transcription_artifacts add constraint transcription_artifacts_kind_check check (kind in (
  'study_guide', 'flashcards', 'quiz', 'definitions', 'exam_points',
  'meeting_recap', 'action_plan', 'followup_email', 'reply_draft',
  'interview_qa', 'episode_notes', 'study_map'));
