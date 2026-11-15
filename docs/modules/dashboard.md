# Signed-in home (`src/home/dashboard.js`)

Renders the area below the upload card: Resume (latest lecture), Up next, Recent recordings and Courses. The greeting
(`#homeGreet`) sits above the upload card so starting a recording is first on the page. Needs a browser and Supabase,
so it has no plain-Node test; the pure helpers it uses (`srs.js`, `exam.js`, `course-tone.js`) do.

## Principles
- Everything comes from the student's own saved rows (RLS limits reads to their own).
- Nothing is invented. A suggestion appears only when a record supports it: a finished quiz with missed questions, a
  recent lecture with no study material yet, or flashcards rated earlier that are due again (`dueIndexes`).
- Courses are the Library's folders under the name students use. A course with an exam date adds the Exam prep card
  (`exam.js`).

## Data loaded (`loadData`)
Six most recent library rows, folders, and course exams (`null` if exams are unavailable, handled gracefully); then, for
those recordings, ready `transcription_artifacts` and `transcription_insights` kinds, `folder_items`, the 20 latest
quizzes with saved `progress`, and the 30 latest flashcard sets with a spaced-review schedule.

## Small helpers
`ago(iso)`: "just now", "N min ago", "N h ago", "yesterday", "N days ago", else a short date. `firstName(user)`: first word of
`full_name`/`name`, empty if longer than 24 characters. `lectureUrl(id, tab, tool)` builds `/transcript?id=…`. All text
inserted into HTML goes through `esc`.
