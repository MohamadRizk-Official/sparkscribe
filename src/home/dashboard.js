// The signed-in home: "Welcome back" + Continue studying + What to study next + Recent lectures + My courses.
// Everything shown comes from the student's own saved records (RLS: only their rows). Nothing is invented: a
// suggestion appears only when a record supports it (a finished quiz with missed questions, a recent lecture with no
// study material yet). Courses are the Library's folders, shown under the name students use.
import { supabase } from '../lib/supabase.js';
import { listLibrary, listFolders, createFolder } from '../lib/library.js';
import { fmtDuration } from '../lib/transcripts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STUDY_KINDS = new Set(['flashcards', 'quiz', 'study_guide', 'exam_points', 'definitions']);
const KIND_LABEL = { notes: 'Notes', overview: 'Summary', flashcards: 'Flashcards', quiz: 'Quiz', study_guide: 'Study guide', exam_points: 'Exam points', definitions: 'Key terms' };
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  course: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6"/><path d="M20 12a8 8 0 0 0-14.5-4.7L4 10"/><path d="M20 20v-6h-6"/><path d="M4 12a8 8 0 0 0 14.5 4.7L20 14"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
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
const lectureUrl = (id, tab) => `/transcript?id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`;

async function loadData() {
  const [{ rows }, courses] = await Promise.all([
    listLibrary({ view: 'all', sort: 'recent', limit: 6 }),
    listFolders().catch(() => []),
  ]);
  const ids = rows.map((r) => r.id);
  const [arts, ins, items, quizzes] = await Promise.all([
    ids.length ? supabase.from('transcription_artifacts').select('transcription_id, kind').in('transcription_id', ids).eq('status', 'ready') : { data: [] },
    ids.length ? supabase.from('transcription_insights').select('transcription_id, kind').in('transcription_id', ids).eq('status', 'ready') : { data: [] },
    ids.length ? supabase.from('folder_items').select('transcription_id, folder_id').in('transcription_id', ids) : { data: [] },
    // finished quizzes anywhere in the library (progress is written only when a quiz run ends)
    supabase.from('transcription_artifacts').select('transcription_id, progress, updated_at').eq('kind', 'quiz').eq('status', 'ready').not('progress', 'is', null).order('updated_at', { ascending: false }).limit(20),
  ]);
  const kinds = new Map(ids.map((id) => [id, new Set()]));
  for (const r of [...(arts.data || []), ...(ins.data || [])]) kinds.get(r.transcription_id)?.add(r.kind);
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  const courseOf = new Map();
  for (const it of items.data || []) if (!courseOf.has(it.transcription_id)) courseOf.set(it.transcription_id, courseName.get(it.folder_id) || '');
  // titles for quizzes outside the recent list
  const quizRows = (quizzes.data || []).filter((q) => Array.isArray(q.progress?.missed) && q.progress.missed.length);
  const missingIds = [...new Set(quizRows.map((q) => q.transcription_id))].filter((id) => !ids.includes(id));
  const extraTitles = missingIds.length ? (await supabase.from('transcriptions').select('id, title').in('id', missingIds)).data || [] : [];
  const titleOf = new Map([...rows.map((r) => [r.id, r.title]), ...extraTitles.map((r) => [r.id, r.title])]);
  return { rows, courses, kinds, courseOf, quizRows, titleOf };
}

// Suggestions backed by a record; at most three, most useful first
function suggestions({ rows, kinds, quizRows, titleOf }) {
  const out = [];
  const seen = new Set();
  for (const q of quizRows) {
    if (seen.has(q.transcription_id) || !titleOf.has(q.transcription_id)) continue;
    seen.add(q.transcription_id);
    const n = q.progress.missed.length;
    out.push({ icon: ICON.retry, tone: 'pink', title: `Retake ${n} missed question${n === 1 ? '' : 's'}`, sub: titleOf.get(q.transcription_id), href: lectureUrl(q.transcription_id, 'create'), why: `From your last quiz score, ${Number(q.progress.last_score) || 0}/${Number(q.progress.total) || 0}` });
    if (out.length >= 2) break;
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

function materialChips(set) {
  const order = ['overview', 'notes', 'flashcards', 'quiz', 'study_guide', 'exam_points', 'definitions'];
  const got = order.filter((k) => set?.has(k));
  return got.length ? `<ul class="dash-mats" aria-label="Study material ready">${got.map((k) => `<li>${KIND_LABEL[k]}</li>`).join('')}</ul>` : '<p class="dash-mats-none">No study material yet. Open it to make notes, flashcards or a quiz.</p>';
}

export async function mountDashboard(root, session) {
  if (!root) return;
  root.hidden = false;
  root.setAttribute('aria-busy', 'true');
  const name = firstName(session?.user);
  root.innerHTML = `<div class="dash-head"><div><h1 class="dash-title" id="dashTitle">${name ? `Welcome back, ${esc(name)}` : 'Welcome back'}</h1><p class="dash-sub">Pick up where you left off.</p></div>
    <button type="button" class="btn btn-primary dash-upload" data-act="pick-file">Upload a lecture</button></div>
    <div class="dash-skel" aria-hidden="true"><span></span><span></span></div>`;
  root.querySelector('[data-act="pick-file"]').addEventListener('click', () => {
    document.getElementById('dropPanel')?.querySelector('.drop-card')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    document.getElementById('fileInput')?.click();
  });
  let data;
  try { data = await loadData(); } catch {
    root.querySelector('.dash-skel').outerHTML = '<p class="dash-error">We couldn’t load your library just now. <a href="/library">Open My Library</a></p>';
    root.removeAttribute('aria-busy');
    return;
  }
  root.querySelector('.dash-skel').remove();
  root.removeAttribute('aria-busy');
  const { rows, courses, kinds, courseOf } = data;

  if (!rows.length) {
    root.insertAdjacentHTML('beforeend', `<div class="dash-empty panel"><h2>Start with your first lecture</h2>
      <p>Upload a class recording below. It's transcribed on your device, then you can make notes, flashcards and a practice quiz from it.</p></div>`);
    return;
  }
  const top = rows[0];
  const next = suggestions(data);
  const course = courseOf.get(top.id);
  root.insertAdjacentHTML('beforeend', `
    <div class="dash-grid">
      <article class="dash-card dash-continue" aria-labelledby="dashContinueTitle">
        <p class="dash-eyebrow">Continue studying</p>
        <h2 id="dashContinueTitle" class="dash-lecture">${esc(top.title)}</h2>
        <p class="dash-meta">${course ? `<span class="dash-course">${ICON.course}${esc(course)}</span>` : ''}<span>${top.last_opened_at ? `Opened ${ago(top.last_opened_at)}` : `Saved ${ago(top.created_at)}`}</span>${top.duration_seconds ? `<span>${fmtDuration(top.duration_seconds)}</span>` : ''}</p>
        ${materialChips(kinds.get(top.id))}
        <a class="btn btn-primary dash-go" href="${lectureUrl(top.id)}">${ICON.play}Continue studying</a>
      </article>
      <section class="dash-card dash-next" aria-labelledby="dashNextTitle">
        <h2 id="dashNextTitle" class="dash-h">What to study next</h2>
        ${next.length ? `<ul class="dash-next-list">${next.map((n) => `<li><a class="dash-next-item tone-${n.tone}" href="${n.href}"><span class="dn-ic">${n.icon}</span><span class="dn-body"><b>${esc(n.title)}</b><span>${esc(n.sub)}</span><small>${esc(n.why)}</small></span></a></li>`).join('')}</ul>`
          : '<p class="dash-quiet">You’re up to date. When you finish a quiz, questions you missed show up here to practise again.</p>'}
      </section>
    </div>
    <div class="dash-grid dash-grid-2">
      <section class="dash-card dash-recent" aria-labelledby="dashRecentTitle">
        <div class="dash-row-head"><h2 id="dashRecentTitle" class="dash-h">Recent lectures</h2><a class="dash-all" href="/library">View all</a></div>
        <ul class="dash-list">${rows.slice(0, 5).map((r) => `<li><a class="dash-item" href="${lectureUrl(r.id)}"><span class="di-title">${esc(r.title)}</span><span class="di-meta">${courseOf.get(r.id) ? `${esc(courseOf.get(r.id))} · ` : ''}${r.duration_seconds ? `${fmtDuration(r.duration_seconds)} · ` : ''}${esc(ago(r.last_opened_at || r.created_at))}</span></a></li>`).join('')}</ul>
      </section>
      <section class="dash-card dash-courses" aria-labelledby="dashCoursesTitle">
        <div class="dash-row-head"><h2 id="dashCoursesTitle" class="dash-h">My courses</h2></div>
        ${courses.length ? `<ul class="dash-course-list">${courses.map((c) => `<li><a class="dash-course-item" href="/library?folder=${encodeURIComponent(c.id)}">${ICON.course}<span>${esc(c.name)}</span><small>${c.count} lecture${c.count === 1 ? '' : 's'}</small></a></li>`).join('')}</ul>`
          : '<p class="dash-quiet">Group lectures by class, like “Biology 201”. Optional: you can upload without one.</p>'}
        <form class="dash-new-course" novalidate><label class="sr-only" for="dashCourseName">New course name</label>
          <input id="dashCourseName" name="name" maxlength="80" autocomplete="off" placeholder="New course, e.g. Chemistry 101" />
          <button class="btn" type="submit">${ICON.plus}Add</button></form>
        <p class="dash-form-msg" role="status"></p>
      </section>
    </div>`);
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
