// The signed-in home, below the upload card: Resume (the latest lecture) + Up next + Recent recordings + Courses. The
// greeting goes above the upload card (#homeGreet), so starting a new recording is the first thing on the page.
// Everything shown comes from the student's own saved records (RLS: only their rows). Nothing is invented: a
// suggestion appears only when a record supports it (a finished quiz with missed questions, a recent lecture with no
// study material yet, flashcards the student rated that are due again). Courses are the Library's folders, shown under the name students use;
// a course can have an exam date, which adds the Exam prep card (exam.js).
import { supabase } from '../lib/supabase.js';
import { listLibrary, listFolders, createFolder, listCourseExams } from '../lib/library.js';
import { renderExamCard, examDialog, daysUntil, inDays } from './exam.js';
import { fmtDuration } from '../lib/transcripts.js';
import { readSrs, dueIndexes } from '../insights/srs.js';
import { courseTone } from '../lib/course-tone.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STUDY_KINDS = new Set(['flashcards', 'quiz', 'study_guide', 'exam_points', 'definitions']);
const KIND_LABEL = { notes: 'Notes', overview: 'Summary', flashcards: 'Flashcards', quiz: 'Quiz', study_guide: 'Study guide', exam_points: 'Exam points', definitions: 'Key terms' };
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  course: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6"/><path d="M20 12a8 8 0 0 0-14.5-4.7L4 10"/><path d="M20 20v-6h-6"/><path d="M4 12a8 8 0 0 0 14.5 4.7L20 14"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/></svg>',
  cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="14" height="14" rx="2.5"/><path d="M7 3h11.5A2.5 2.5 0 0 1 21 5.5V17"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19.5 7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  wave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
};

function ago(iso) {
  if (!iso) return '';
  const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 2) return 'yesterday';
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const firstName = (user) => {
  const m = user?.user_metadata || {};
  const n = (m.full_name || m.name || '').trim().split(/\s+/)[0];
  return n && n.length <= 24 ? n : '';
};
const lectureUrl = (id, tab, tool) => `/transcript?id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}${tool ? `&tool=${tool}` : ''}`;

async function loadData() {
  const [{ rows }, courses, exams] = await Promise.all([
    listLibrary({ view: 'all', sort: 'recent', limit: 6 }),
    listFolders().catch(() => []),
    listCourseExams().catch(() => null), // null: exams not available (yet)
  ]);
  const ids = rows.map((r) => r.id);
  const [arts, ins, items, quizzes, decks] = await Promise.all([
    ids.length ? supabase.from('transcription_artifacts').select('transcription_id, kind').in('transcription_id', ids).eq('status', 'ready') : { data: [] },
    ids.length ? supabase.from('transcription_insights').select('transcription_id, kind').in('transcription_id', ids).eq('status', 'ready') : { data: [] },
    ids.length ? supabase.from('folder_items').select('transcription_id, folder_id').in('transcription_id', ids) : { data: [] },
    // finished quizzes anywhere in the library (progress is written only when a quiz run ends)
    supabase.from('transcription_artifacts').select('transcription_id, progress, updated_at').eq('kind', 'quiz').eq('status', 'ready').not('progress', 'is', null).order('updated_at', { ascending: false }).limit(20),
    // flashcard sets with a spaced-review schedule (progress.srs is written when the student rates a card)
    supabase.from('transcription_artifacts').select('transcription_id, progress, updated_at').eq('kind', 'flashcards').eq('status', 'ready').not('progress', 'is', null).order('updated_at', { ascending: false }).limit(30),
  ]);
  const kinds = new Map(ids.map((id) => [id, new Set()]));
  for (const r of [...(arts.data || []), ...(ins.data || [])]) kinds.get(r.transcription_id)?.add(r.kind);
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  const courseOf = new Map();
  for (const it of items.data || []) if (!courseOf.has(it.transcription_id)) courseOf.set(it.transcription_id, courseName.get(it.folder_id) || '');
  // titles for quizzes outside the recent list
  const quizRows = (quizzes.data || []).filter((q) => Array.isArray(q.progress?.missed) && q.progress.missed.length);
  // due cards per lecture (a lecture can have more than one set: add them up)
  const dueBy = new Map();
  for (const r of decks.data || []) {
    const n = dueIndexes(readSrs(r.progress), Infinity).length;
    if (n) dueBy.set(r.transcription_id, (dueBy.get(r.transcription_id) || 0) + n);
  }
  const dueDecks = [...dueBy].map(([id, n]) => ({ transcription_id: id, due: n }));
  const missingIds = [...new Set([...quizRows, ...dueDecks].map((q) => q.transcription_id))].filter((id) => !ids.includes(id));
  const extraTitles = missingIds.length ? (await supabase.from('transcriptions').select('id, title').in('id', missingIds)).data || [] : [];
  const titleOf = new Map([...rows.map((r) => [r.id, r.title]), ...extraTitles.map((r) => [r.id, r.title])]);
  return { rows, courses, exams, kinds, courseOf, quizRows, dueDecks, titleOf };
}

// Suggestions backed by a record; at most three, most useful first
function suggestions({ rows, kinds, quizRows, dueDecks, titleOf }) {
  const out = [];
  const seen = new Set();
  const decks = dueDecks.filter((x) => titleOf.has(x.transcription_id)).sort((x, y) => y.due - x.due).slice(0, 1);
  for (const x of decks) {
    out.push({ icon: ICON.cards, tone: 'cyan', title: `Review ${x.due} flashcard${x.due === 1 ? '' : 's'}`, sub: titleOf.get(x.transcription_id), href: lectureUrl(x.transcription_id, 'create', 'flashcards'), why: 'Due today in your spaced review' });
  }
  for (const q of quizRows) {
    if (seen.has(q.transcription_id) || !titleOf.has(q.transcription_id)) continue;
    seen.add(q.transcription_id);
    const n = q.progress.missed.length;
    out.push({ icon: ICON.retry, tone: 'pink', title: `Retake ${n} missed question${n === 1 ? '' : 's'}`, sub: titleOf.get(q.transcription_id), href: lectureUrl(q.transcription_id, 'create', 'quiz'), why: `From your last quiz score, ${Number(q.progress.last_score) || 0}/${Number(q.progress.total) || 0}` });
    if (out.length >= 3) break;
  }
  const fortnight = Date.now() - 14 * 86400 * 1000;
  for (const r of rows) {
    if (out.length >= 3 || out.some((o) => o.kind === 'make')) break; // one "make something" prompt is enough
    const k = kinds.get(r.id) || new Set();
    if ([...k].some((x) => STUDY_KINDS.has(x)) || new Date(r.created_at).getTime() < fortnight) continue;
    out.push({ kind: 'make', icon: ICON.spark, tone: 'violet', title: 'Make flashcards or a practice quiz', sub: r.title, href: lectureUrl(r.id, 'create'), why: 'No study material yet for this lecture' });
  }
  return out;
}

// What's ready for a lecture, said as plain text ("Summary · Flashcards ready"), not a row of chips
function materialLine(set) {
  const order = ['overview', 'notes', 'flashcards', 'quiz', 'study_guide', 'exam_points', 'definitions'];
  const got = order.filter((k) => set?.has(k)).map((k) => KIND_LABEL[k]);
  return got.length ? `<p class="dash-mats">${ICON.check}<span>${esc(got.join(' · '))} ready</span></p>` : '<p class="dash-mats is-none">No study material yet. Open it to make notes, flashcards or a quiz.</p>';
}


const GREETINGS = ['Ready to turn another lecture into something useful?', 'Your next study session starts here.', 'Let’s make today’s lecture count.'];

export async function mountDashboard(root, session) {
  if (!root) return;
  const greet = document.getElementById('homeGreet');
  const name = firstName(session?.user);
  if (greet) {
    greet.hidden = false;
    greet.innerHTML = `<h1 class="dash-title" id="dashTitle">${name ? `Welcome back, ${esc(name)}` : 'Welcome back'}</h1><p class="dash-sub">${GREETINGS[new Date().getDay() % GREETINGS.length]}</p>`;
  }
  root.hidden = false;
  root.setAttribute('aria-busy', 'true');
  root.innerHTML = '<div class="dash-skel" aria-hidden="true"><span></span><span></span></div>';
  let data;
  try { data = await loadData(); } catch {
    root.innerHTML = '<p class="dash-error">We couldn’t load your library just now. <a href="/library">Open your Library</a></p>';
    root.removeAttribute('aria-busy');
    return;
  }
  root.removeAttribute('aria-busy');
  const { rows, courses, exams, kinds, courseOf } = data;
  // the nearest exam still to come (today counts)
  const examOf = (c) => { const e = exams?.get(c.id); return e?.date && daysUntil(e.date) >= 0 ? e : null; };
  const nextExam = courses.filter(examOf).sort((x, y) => examOf(x).date.localeCompare(examOf(y).date))[0] || null;

  if (!rows.length) {
    if (greet) greet.innerHTML = `<h1 class="dash-title" id="dashTitle">${name ? `Welcome, ${esc(name)}` : 'Welcome to SparkScribe'}</h1><p class="dash-sub">Your Library starts with one lecture. Drop it below.</p>`;
    root.innerHTML = `<ol class="dash-firststeps" aria-label="How it works">
      <li><span class="fs-n">1</span><b>Upload a lecture</b><span>Transcribed on your device, with speakers and timestamps.</span></li>
      <li><span class="fs-n">2</span><b>Get it organized</b><span>A summary and notes, saved to your Library.</span></li>
      <li><span class="fs-n">3</span><b>Study it</b><span>Flashcards, practice quizzes and a study guide.</span></li></ol>`;
    return;
  }
  const top = rows[0];
  const next = suggestions(data);
  const course = courseOf.get(top.id);
  const courseIdOf = new Map(courses.map((c) => [c.name, c.id]));
  root.innerHTML = `
    <div class="dash-grid">
      <article class="dash-continue" aria-labelledby="dashContinueTitle">
        <p class="dash-eyebrow">${top.last_opened_at ? 'Pick up where you left off' : 'Your latest recording'}</p>
        <h2 id="dashContinueTitle" class="dash-lecture"><a href="${lectureUrl(top.id)}">${esc(top.title)}</a></h2>
        <p class="dash-meta">${course ? `<span class="dash-course tone-${courseTone(courseIdOf.get(course) || course)}">${esc(course)}</span>` : ''}${top.duration_seconds ? `<span>${fmtDuration(top.duration_seconds)}</span>` : ''}<span>${top.last_opened_at ? `Opened ${ago(top.last_opened_at)}` : `Saved ${ago(top.created_at)}`}</span></p>
        ${materialLine(kinds.get(top.id))}
        <a class="btn btn-primary dash-go" href="${lectureUrl(top.id)}">${ICON.play}Resume</a>
      </article>
      <section class="dash-next" aria-labelledby="dashNextTitle">
        <h2 id="dashNextTitle" class="dash-h">Up next</h2>
        ${next.length ? `<ul class="dash-next-list">${next.map((n) => `<li><a class="dash-next-item tone-${n.tone}" href="${n.href}"><span class="dn-ic">${n.icon}</span><span class="dn-body"><b>${esc(n.title)}</b><span>${esc(n.sub)}</span><small>${esc(n.why)}</small></span><span class="dn-go" aria-hidden="true">${ICON.arrow}</span></a></li>`).join('')}</ul>`
          : `<div class="dash-caught"><span class="dc-ic">${ICON.check}</span><b>All caught up for now.</b><span>Finish a quiz or rate some flashcards, and what’s worth practising again shows up here.</span></div>`}
      </section>
    </div>
    ${nextExam ? '<section class="dash-exam" aria-labelledby="dashExamTitle"></section>' : ''}
    <div class="dash-grid dash-grid-2">
      <section class="dash-recent" aria-labelledby="dashRecentTitle">
        <div class="dash-row-head"><h2 id="dashRecentTitle" class="dash-h">Recent recordings</h2><a class="dash-all" href="/library">View all</a></div>
        <ul class="dash-list">${rows.slice(0, 5).map((r) => `<li><a class="dash-item" href="${lectureUrl(r.id)}"><span class="di-ic" aria-hidden="true">${ICON.wave}</span><span class="di-title">${esc(r.title)}</span><span class="di-meta">${courseOf.get(r.id) ? `${esc(courseOf.get(r.id))} · ` : ''}${r.duration_seconds ? `${fmtDuration(r.duration_seconds)} · ` : ''}${esc(ago(r.last_opened_at || r.created_at))}</span></a></li>`).join('')}</ul>
      </section>
      <section class="dash-courses" aria-labelledby="dashCoursesTitle">
        <div class="dash-row-head"><h2 id="dashCoursesTitle" class="dash-h">Courses</h2>${courses.length ? '<a class="dash-all" href="/library?view=folders">All courses</a>' : ''}</div>
        ${courses.length ? `<ul class="dash-course-list">${courses.map((c) => {
          const e = examOf(c);
          return `<li class="dash-course-row tone-${courseTone(c.id)}"><a class="dash-course-item" href="/library?folder=${encodeURIComponent(c.id)}"><span class="dc-dot" aria-hidden="true"></span><span class="dc-name">${esc(c.name)}</span><small>${c.count} recording${c.count === 1 ? '' : 's'}${e ? ` · <b class="exam-when">Exam ${inDays(daysUntil(e.date))}</b>` : ''}</small></a>${exams ? `<button type="button" class="dash-exam-btn" data-exam="${esc(c.id)}" aria-label="${e ? 'Edit' : 'Add'} exam for ${esc(c.name)}">${e ? 'Edit exam' : 'Add exam'}</button>` : ''}</li>`;
        }).join('')}</ul>`
          : '<p class="dash-quiet">Group recordings by class, like “Biology 201”. Optional: you can upload without one.</p>'}
        <form class="dash-new-course" novalidate><label class="sr-only" for="dashCourseName">New course name</label>
          <input id="dashCourseName" name="name" maxlength="80" autocomplete="off" placeholder="New course, e.g. Chemistry 101" />
          <button class="btn" type="submit">${ICON.plus}Add</button></form>
        <p class="dash-form-msg" role="status"></p>
      </section>
    </div>`;
  const editExam = async (c) => { if (await examDialog(c, exams?.get(c.id))) mountDashboard(root, session); };
  root.querySelectorAll('[data-exam]').forEach((b) => b.addEventListener('click', () => editExam(courses.find((c) => c.id === b.dataset.exam))));
  const examEl = root.querySelector('.dash-exam');
  if (examEl) renderExamCard(examEl, nextExam, examOf(nextExam), { onEdit: () => editExam(nextExam) });
  const form = root.querySelector('.dash-new-course');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const msg = root.querySelector('.dash-form-msg');
    const nameV = input.value.trim();
    if (!nameV) { msg.textContent = 'Type a course name first.'; input.focus(); return; }
    form.querySelector('button').disabled = true;
    try { await createFolder(nameV); mountDashboard(root, session); } catch (err) {
      msg.textContent = (err?.message || 'Couldn’t add that course.').replace(/folder/gi, 'course');
      form.querySelector('button').disabled = false;
    }
  });
}
