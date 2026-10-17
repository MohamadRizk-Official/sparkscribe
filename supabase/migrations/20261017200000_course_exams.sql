-- Exam prep: a course (a Library folder) can carry the date of its exam and the topics the student expects.
-- The study home counts down to it and builds a plan from the student's own lectures in that course.
--
-- Safety review (2026-10-17)
--   * Additive only: two nullable columns with no default -> a catalog-only change in Postgres 17, no table
--     rewrite and no long lock. Both CHECKs are validated against existing rows, which are all NULL.
--   * Production code is unaffected: every folders query in the app names its columns
--     (src/lib/library.js: 'id, name, created_at, folder_items(count)' and 'id, name'); nothing selects '*'.
--   * Access: users may update only these two columns besides name, still limited to their own rows by the
--     existing "folders: update own" RLS policy. Inserts are unchanged (name only). No new function, no
--     SECURITY DEFINER, nothing readable by anon.
--   * Data lifetime: the columns live on the folder row, so deleting a course or the account (cascade from
--     auth.users) removes them with it.
--   * Bounds: exam_topics at most 1000 characters; exam_date within a plausible range.
--   * Rollback: alter table public.folders drop column exam_topics, drop column exam_date;
alter table public.folders
  add column exam_date date,
  add column exam_topics text;

alter table public.folders
  add constraint folders_exam_date_range check (exam_date is null or exam_date between date '2020-01-01' and date '2100-12-31'),
  add constraint folders_exam_topics_len check (exam_topics is null or char_length(exam_topics) <= 1000);

grant update (exam_date, exam_topics) on public.folders to authenticated;
