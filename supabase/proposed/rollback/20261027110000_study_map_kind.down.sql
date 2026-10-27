-- Rollback of 20261027110000_study_map_kind.sql: the stored study maps are only a cache (the study tools rebuild a
-- map when none is stored), so they are deleted, and the kind list goes back to what it was.
delete from public.transcription_artifacts where kind = 'study_map';
alter table public.transcription_artifacts drop constraint if exists transcription_artifacts_kind_check;
alter table public.transcription_artifacts add constraint transcription_artifacts_kind_check check (kind in (
  'study_guide', 'flashcards', 'quiz', 'definitions', 'exam_points',
  'meeting_recap', 'action_plan', 'followup_email', 'reply_draft',
  'interview_qa', 'episode_notes'));
