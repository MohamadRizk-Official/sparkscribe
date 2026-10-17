-- Rollback for 20261017200000_course_exams.sql: removes the exam columns (and with them any exam dates and topics
-- students saved). Courses, their lectures and everything else stay. The app hides exam features when the columns
-- are missing, so this is safe to run with the current release.
revoke update (exam_date, exam_topics) on public.folders from authenticated;
alter table public.folders
  drop constraint if exists folders_exam_topics_len,
  drop constraint if exists folders_exam_date_range,
  drop column if exists exam_topics,
  drop column if exists exam_date;
