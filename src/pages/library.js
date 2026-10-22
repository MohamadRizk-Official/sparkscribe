// /library — the signed-in user's personal archive: Recent / All / Favorites / Folders, filters, sorting,
// search across every transcript (with timestamps), favorites, folders, rename and bulk actions.
// Data comes a page at a time from the database (src/lib/library.js); nothing here calls an AI service.
import { isConfigured } from '../lib/supabase.js';
import { mountAccountMenu, requireUser, esc } from '../lib/account.js';
import { fmtDuration } from '../lib/transcripts.js';
import { fmtClock, RECORDING_TYPE_LABEL } from '../lib/segments.js';
import {
  PAGE_SIZE, SEARCH_PAGE_SIZE, listLibrary, searchLibrary, libraryStats, listFolders, renameTranscript, setFavorite,
  deleteTranscripts, removeFromFolder, renameFolder, deleteFolder, createFolder, highlight, fmtHours, courseLectureIds,
} from '../lib/library.js';
import { mountMascot } from '../mascot/mascot.js';
import { mascotSignal } from '../mascot/bus.js';
import { makeDialog, promptDialog, confirmDialog, confirmDeleteRecordings, folderPicker, toast, addRecordingsDialog } from '../library/dialogs.js';
import { courseTone } from '../lib/course-tone.js';
import { myPlan } from '../lib/billing.js';
import { openThunderDialog } from '../electric/thunder.js';

const $ = (id) => document.getElementById(id);
const TYPES = ['lecture', 'meeting', 'voice_message', 'interview', 'podcast', 'general'];
const TYPE_PLURAL = { lecture: 'Lectures', meeting: 'Meetings', voice_message: 'Voice Messages', interview: 'Interviews', podcast: 'Podcasts', general: 'General' };
const VIEWS = ['recent', 'all', 'favorites', 'folders'];
const SORTS = ['newest', 'oldest', 'longest', 'shortest', 'az'];

const EMPTY = {
  library: ['Your Library starts with one lecture', 'Upload a recording while you’re signed in and it’s saved here: searchable, and private to you.', true],
  favorites: ['Keep the good ones close', 'Star any recording and it’ll be right here when you need it.'],
  folder: ['Let’s give this course something to study', 'Add recordings you’ve already saved, or upload a new lecture.'],
  date: ['Nothing from this period', 'Try a longer time range.'],
  lecture: ['No lectures yet', 'Upload a lecture to start building your study library.', true],
  meeting: ['No meetings yet', 'Transcribe a meeting and its decisions and action items are one click away.', true],
  voice_message: ['No voice messages yet', 'Drop in a WhatsApp or voice note to keep it searchable.', true],
  interview: ['No interviews yet', 'Transcribe an interview to keep every question and answer searchable.', true],
  podcast: ['No podcasts yet', 'Transcribe an episode to search everything that was said.', true],
  general: ['No general recordings', 'Recordings without a type show up here.'],
};

const ICON = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9Z"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-5 5m5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
};
// one icon per kind of recording (the row's tile), drawn on the same 24px grid and stroke
const TYPE_ICON = {
  lecture: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-4 9 4-9 4Z"/><path d="M7 11v4.5c1.5 1.3 3.2 2 5 2s3.5-.7 5-2V11"/></svg>',
  meeting: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3 19c.6-3 2.6-4.6 5-4.6s4.4 1.6 5 4.6M14 15c2.4-.6 4.6.6 5.5 4"/></svg>',
  voice_message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8l-4 3Z"/><path d="M9 9v3M12 8v5M15 9v3"/></svg>',
  interview: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  podcast: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="11" r="2"/><path d="M8.5 14.5a5 5 0 1 1 7 0M6 17a8.5 8.5 0 1 1 12 0M12 13v8"/></svg>',
  general: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
};

// ---------- state (mirrored in the URL so Back / reload / sharing a link with yourself work) ----------
const st = {
  view: 'all', folder: null, type: null, date: '', sort: 'newest', q: '',
  rows: [], total: null, offset: 0, loading: false, done: false,
  results: [], resOffset: 0, resDone: false,
  folders: [], stats: null,
  selecting: false, selected: new Set(),
};
let token = 0; // ignore responses from requests that were superseded

function readUrl() {
  const p = new URLSearchParams(location.search);
  st.view = VIEWS.includes(p.get('view')) ? p.get('view') : 'all';
  st.folder = /^[0-9a-f-]{36}$/i.test(p.get('folder') || '') ? p.get('folder') : null;
  if (st.folder) st.view = 'folders';
  st.type = TYPES.includes(p.get('type')) ? p.get('type') : null;
  st.date = ['7', '30', '365'].includes(p.get('date')) ? p.get('date') : '';
  st.sort = SORTS.includes(p.get('sort')) ? p.get('sort') : 'newest';
  st.q = (p.get('q') || '').slice(0, 200);
}
function writeUrl(push = false) {
  const p = new URLSearchParams();
  if (st.view !== 'all' && !st.folder) p.set('view', st.view);
  if (st.folder) p.set('folder', st.folder);
  if (st.type) p.set('type', st.type);
  if (st.date) p.set('date', st.date);
  if (st.sort !== 'newest') p.set('sort', st.sort);
  if (st.q) p.set('q', st.q);
  const url = `/library${p.toString() ? `?${p}` : ''}`;
  if (url !== location.pathname + location.search) history[push ? 'pushState' : 'replaceState'](null, '', url);
  dispatchEvent(new Event('sparkscribe:route')); // the header marks Library or Courses (lib/account.js)
}

const searching = () => st.q.trim().length >= 2;
const sinceDate = () => (st.date ? new Date(Date.now() - Number(st.date) * 86400000) : null);
const folderName = (id) => st.folders.find((f) => f.id === id)?.name;
const listView = () => (st.folder ? 'all' : st.view === 'recent' ? 'recent' : st.view === 'favorites' ? 'favorites' : 'all');

function shortDate(iso) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
const badge = (type) => (type && type !== 'general' ? `<span class="type-badge t-${esc(type)}">${esc(RECORDING_TYPE_LABEL[type])}</span>` : '');
const openUrl = (id, extra = '') => `/transcript?id=${encodeURIComponent(id)}${extra}`;

// ---------- header stats + type chips ----------
function renderStats() {
  const s = st.stats;
  if (!s) return;
  const n = Number(s.recordings);
  $('libStats').textContent = n
    ? [`${n} recording${n === 1 ? '' : 's'}`, `${fmtHours(Number(s.seconds))} transcribed`, Number(s.this_month) ? `${s.this_month} this month` : null].filter(Boolean).join(' · ')
    : 'Nothing saved yet';
}
function renderTypeChips() {
  const by = st.stats?.by_type || {};
  const present = TYPES.filter((t) => by[t] > 0);
  // a type filter only helps once there is more than one kind of recording (or one is already chosen)
  if (present.length < 2 && !st.type) { $('typeChips').innerHTML = ''; return; }
  // the counts are for the whole Library: shown only when that's what the list is (not inside a course, a time range
  // or Favorites), so a number never describes something other than the list under it
  const scoped = !st.folder && !st.date && st.view === 'all';
  const opt = (t, label, n) => `<option value="${t || ''}"${st.type === t ? ' selected' : ''}>${esc(label)}${scoped && n != null ? ` (${n})` : ''}</option>`;
  $('typeChips').innerHTML = `<select class="lib-select" id="typeSel" aria-label="Recording type">${opt(null, 'All types')}${present.map((t) => opt(t, TYPE_PLURAL[t], by[t])).join('')}${st.type && !present.includes(st.type) ? opt(st.type, TYPE_PLURAL[st.type], 0) : ''}</select>`;
}

// ---------- chrome: tabs, toolbar, folder header ----------
function renderChrome() {
  const activeView = st.folder ? 'folders' : st.view;
  $('viewTabs').querySelectorAll('[data-view]').forEach((b) => {
    const on = !searching() && b.dataset.view === activeView;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  placeTabIndicator();
  const folderOverview = st.view === 'folders' && !st.folder;
  $('toolbar').hidden = searching() || folderOverview;
  $('sortSel').hidden = st.view === 'recent' && !st.folder; // Recent is always "recently opened"
  $('sortSel').value = st.sort;
  $('dateSel').value = st.date;
  $('selectBtn').textContent = st.selecting ? 'Done' : 'Select';
  $('selectBtn').setAttribute('aria-pressed', String(st.selecting));
  $('qClear').hidden = !st.q;
  renderTypeChips();

  const fh = $('folderHead');
  document.body.classList.toggle('lib-in-course', !!st.folder && !searching());
  if (st.folder && !searching()) {
    const f = st.folders.find((x) => x.id === st.folder);
    const name = f?.name || 'Course';
    const n = f?.count ?? null;
    fh.hidden = false;
    fh.className = `folder-head tone-${courseTone(st.folder)}`;
    fh.innerHTML = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/library">Library</a><span aria-hidden="true">/</span><a href="/library?view=folders" data-act="folders">Courses</a><span aria-hidden="true">/</span><span aria-current="page">${esc(name)}</span></nav>
      <div class="course-title-row"><span class="course-dot" aria-hidden="true"></span><h2 class="folder-title">${esc(name)}</h2>${n != null ? `<span class="course-count">${n} recording${n === 1 ? '' : 's'}</span>` : ''}</div>
      <div class="folder-actions"><button class="btn btn-primary" type="button" data-act="add-recordings">${ICON.plus}<span>Add recordings</span></button>
      <button class="btn btn-ghost" type="button" data-act="rename-folder">${ICON.pencil}<span>Rename</span></button>
      <button class="btn btn-ghost" type="button" data-act="delete-folder">Delete course</button></div>`;
  } else {
    fh.hidden = true;
    fh.innerHTML = '';
  }
  renderBulkBar();
}

// ---------- recordings list ----------
function cardHtml(r) {
  const sel = st.selected.has(r.id);
  const type = TYPES.includes(r.recording_type) ? r.recording_type : 'general';
  const meta = [shortDate(r.created_at), fmtDuration(r.duration_seconds), r.speaker_count > 1 ? `${r.speaker_count} speakers` : null, type !== 'general' ? RECORDING_TYPE_LABEL[type] : null]
    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  const preview = r.summary
    ? `<p class="lib-preview">${esc(r.summary)}</p>`
    : r.preview ? `<p class="lib-preview quote">“${esc(r.preview)}”</p>` : '';
  const courses = st.folder ? '' : (r.folder_ids || []).map((id) => [id, folderName(id)]).filter(([, n]) => n).slice(0, 3)
    .map(([id, n]) => `<span class="lib-course tone-${courseTone(id)}">${esc(n)}</span>`).join('');
  return `<article class="lib-card t-${type}${sel ? ' selected' : ''}${st.selecting ? ' selecting' : ''}${r.is_favorite ? ' is-fav' : ''}" data-id="${r.id}">
    ${st.selecting ? `<label class="lib-check"><input type="checkbox" ${sel ? 'checked' : ''} aria-label="Select ${esc(r.title)}" /></label>` : ''}
    <a class="lib-card-main" href="${openUrl(r.id)}" aria-label="Open ${esc(r.title)}"></a>
    <span class="lib-type-ic" aria-hidden="true">${TYPE_ICON[type]}</span>
    <div class="lib-card-body">
      <div class="lib-card-top"><span class="lib-title" data-act="title" title="Double-click to rename">${esc(r.title)}</span></div>
      <div class="lib-meta">${meta}${r.status !== 'completed' ? `<span class="warn">${esc(r.status)}</span>` : ''}</div>
      ${preview}
      ${courses ? `<div class="lib-folders">${courses}</div>` : ''}
    </div>
    <div class="lib-card-actions">
      <button class="icon-btn" type="button" data-act="rename" aria-label="Rename ${esc(r.title)}" title="Rename">${ICON.pencil}</button>
      <button class="icon-btn star${r.is_favorite ? ' on' : ''}" type="button" data-act="star" aria-pressed="${r.is_favorite}" aria-label="${r.is_favorite ? 'Remove from favorites' : 'Add to favorites'}" title="${r.is_favorite ? 'Favorite' : 'Add to favorites'}">${ICON.star}</button>
      <button class="icon-btn" type="button" data-act="menu" aria-label="More actions for ${esc(r.title)}" title="More">${ICON.more}</button>
    </div>
  </article>`;
}

function emptyHtml() {
  let key = 'library';
  if (st.folder) key = 'folder';
  else if (st.type) key = st.type;
  else if (st.view === 'favorites') key = 'favorites';
  else if (st.date) key = 'date';
  const [title, text, cta] = EMPTY[key];
  const art = key === 'favorites' ? ICON.star : key === 'folder' ? ICON.folder : TYPE_ICON[TYPES.includes(key) ? key : 'general'];
  const actions = key === 'folder'
    ? `<div class="lib-empty-actions"><button class="btn btn-primary" type="button" data-act="add-recordings">${ICON.plus}<span>Add recordings</span></button><a class="btn btn-ghost" href="/#upload">${ICON.upload}<span>Upload a lecture</span></a></div>`
    : cta ? `<div class="lib-empty-actions"><a class="btn btn-primary" href="/#upload">${ICON.upload}<span>Upload a recording</span></a></div>` : '';
  return `<div class="lib-empty e-empty k-${key}">
    <div class="e-empty-mark" aria-hidden="true"><span class="e-empty-ring"></span><div class="e-empty-art">${art}</div></div>
    <h2>${esc(title)}</h2><p>${esc(text)}</p>
    ${actions}
    ${st.type && st.type !== 'general' ? '<p class="lib-empty-hint">Tip: open a recording and set its type with the Type button at the top.</p>' : ''}
  </div>`;
}

function renderList() {
  const list = $('libList');
  if (!st.rows.length) {
    list.innerHTML = st.loading ? '<div class="lib-skel"></div><div class="lib-skel"></div><div class="lib-skel"></div>' : emptyHtml();
  } else {
    list.innerHTML = st.rows.map(cardHtml).join('');
  }
  renderMore();
}
function renderMore() {
  const more = $('libMore');
  if (searching()) {
    more.innerHTML = st.results.length && !st.resDone
      ? `<button class="btn btn-ghost" type="button" data-act="more-results"${st.loading ? ' disabled' : ''}>${st.loading ? 'Searching…' : 'More results'}</button>` : '';
    return;
  }
  if (st.view === 'folders' && !st.folder) { more.innerHTML = ''; return; }
  more.innerHTML = st.rows.length && !st.done
    ? `<button class="btn btn-ghost" type="button" data-act="more"${st.loading ? ' disabled' : ''}>${st.loading ? 'Loading…' : `Show more${st.total ? ` (${st.total - st.rows.length} left)` : ''}`}</button>`
    : st.rows.length > PAGE_SIZE ? `<p class="lib-end mono">${st.rows.length} recordings</p>` : '';
}

async function loadRows(reset = true) {
  const my = ++token;
  if (reset) { st.rows = []; st.offset = 0; st.done = false; st.total = null; }
  st.loading = true;
  renderList();
  try {
    const { rows, total } = await listLibrary({
      view: listView(), type: st.type, folder: st.folder, since: sinceDate(),
      sort: st.view === 'recent' && !st.folder ? 'recent' : st.sort, offset: st.offset, limit: PAGE_SIZE,
    });
    if (my !== token) return;
    st.rows = reset ? rows : [...st.rows, ...rows];
    if (total != null) st.total = total;
    st.offset += rows.length;
    st.done = rows.length < PAGE_SIZE || (st.total != null && st.rows.length >= st.total);
  } catch (err) {
    if (my !== token) return;
    st.loading = false;
    $('libList').innerHTML = `<div class="panel lib-empty"><h2>Couldn’t load your library</h2><p>${esc(err.message || err)}</p><button class="btn btn-primary" type="button" data-act="retry">Try again</button></div>`;
    $('libMore').innerHTML = '';
    return;
  }
  st.loading = false;
  renderList();
}

// ---------- folders overview ----------
function renderFolders() {
  const tiles = st.folders.map((f) => `<a class="folder-tile tone-${courseTone(f.id)}" href="/library?folder=${f.id}" data-folder="${f.id}">
      <span class="folder-tile-ic">${ICON.folder}</span>
      <span class="folder-tile-name">${esc(f.name)}</span>
      <span class="folder-tile-n">${f.count ? `${f.count} recording${f.count === 1 ? '' : 's'}` : 'Empty: add recordings'}</span></a>`).join('');
  $('libList').innerHTML = `<div class="folder-grid">
    <button class="folder-tile new" type="button" data-act="new-folder"><span class="folder-tile-ic">${ICON.plus}</span><span class="folder-tile-name">New course</span><span class="folder-tile-n">e.g. Biology 201</span></button>
    ${tiles}</div>
    ${st.folders.length ? '' : '<p class="lib-empty-hint center">Courses keep a class’s recordings together. A recording can be in more than one course, and deleting a course never deletes recordings.</p>'}`;
  $('libMore').innerHTML = '';
}
async function loadFolders() {
  try { st.folders = await listFolders(); } catch { st.folders = []; }
}

// ---------- search ----------
function hitTime(r, h) {
  if (h.start == null) return '';
  return r.coarse
    ? `<span class="sr-time coarse" title="Start of the paragraph (saved before line-level timestamps)">¶ ${fmtClock(h.start)}</span>`
    : `<span class="sr-time">${fmtClock(h.start)}</span>`;
}
function hitUrl(r, h) {
  if (h.start == null) return openUrl(r.transcription_id);
  return openUrl(r.transcription_id, `&t=${Math.floor(h.start * 100) / 100}${h.line != null ? `&line=${h.line}` : ''}`);
}
function resultHtml(r) {
  const transcriptHits = r.hits.filter((h) => h.source === 'transcript');
  const noteHits = r.hits.filter((h) => h.source === 'notes');
  const extra = r.match_count - transcriptHits.length;
  const why = [];
  if (r.title_match) why.push('Title');
  if (r.match_count) why.push(`${r.match_count} match${r.match_count === 1 ? '' : 'es'} in transcript`);
  else if (r.partial) why.push('Words found separately in transcript');
  if (!r.match_count && !r.partial && noteHits.length) why.push('Notes only');
  const hit = (h) => `<li class="sr-hit${h.source === 'notes' ? ' notes' : ''}"><a href="${hitUrl(r, h)}">
      ${h.source === 'notes' ? '<span class="sr-tag" title="AI-generated Notes, not the transcript">Notes</span>' : hitTime(r, h)}
      ${h.source === 'transcript' && h.speaker ? `<span class="sr-sp">${esc(h.speaker)}</span>` : ''}
      <span class="sr-snip">${highlight(h.snippet)}</span></a></li>`;
  return `<article class="panel sr-item">
    <div class="sr-head"><a class="sr-title" href="${openUrl(r.transcription_id)}">${r.title_match ? highlightTitle(r.title) : esc(r.title)}</a>${badge(r.recording_type)}</div>
    <div class="lib-meta mono"><span>${esc(shortDate(r.created_at))}</span><span>${esc(fmtDuration(r.duration_seconds))}</span><span class="sr-why">${esc(why.join(' · '))}</span></div>
    ${transcriptHits.length || noteHits.length ? `<ul class="sr-hits">${transcriptHits.map(hit).join('')}${noteHits.map(hit).join('')}</ul>` : ''}
    ${extra > 0 ? `<a class="sr-more" href="${hitUrl(r, transcriptHits[0])}">+ ${extra} more match${extra === 1 ? '' : 'es'} in this recording</a>` : ''}
  </article>`;
}
function highlightTitle(title) {
  const q = st.q.trim();
  const i = title.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(title);
  return esc(title.slice(0, i)) + '<mark>' + esc(title.slice(i, i + q.length)) + '</mark>' + esc(title.slice(i + q.length));
}
function renderResults() {
  const q = st.q.trim();
  const head = `<div class="sr-summary"><span>${st.loading && !st.results.length ? 'Searching' : st.results.length ? 'Results' : 'No matches'} for “${esc(q)}”</span>
    <button class="btn btn-ghost btn-sm" type="button" data-act="clear-search">Clear</button></div>`;
  let body;
  if (st.loading && !st.results.length) body = '<div class="lib-skel"></div><div class="lib-skel"></div>';
  else if (!st.results.length) body = `<div class="panel lib-empty"><h2>No matches</h2><p>Search looks in titles, transcripts, speaker names and your Notes. Try another word, or put an exact phrase in quotes.</p></div>`;
  else body = st.results.map(resultHtml).join('');
  $('libList').innerHTML = head + body;
  renderMore();
}
async function runSearch(reset = true) {
  const my = ++token;
  if (reset) { st.results = []; st.resOffset = 0; st.resDone = false; }
  st.loading = true;
  renderResults();
  try {
    const rows = await searchLibrary(st.q.trim(), { offset: st.resOffset, limit: SEARCH_PAGE_SIZE });
    if (my !== token) return;
    st.results = reset ? rows : [...st.results, ...rows];
    if (reset && rows.length) mascotSignal('search-found');
    st.resOffset += rows.length;
    st.resDone = rows.length < SEARCH_PAGE_SIZE;
  } catch (err) {
    if (my !== token) return;
    st.loading = false;
    $('libList').innerHTML = `<div class="panel lib-empty"><h2>Search didn’t work</h2><p>${esc(err.message || err)}</p><button class="btn btn-primary" type="button" data-act="retry">Try again</button></div>`;
    return;
  }
  st.loading = false;
  renderResults();
}

// ---------- refresh whatever is on screen ----------
async function refresh({ push = false } = {}) {
  writeUrl(push);
  renderChrome();
  if (searching()) return runSearch(true);
  if (st.view === 'folders' && !st.folder) { await loadFolders(); return renderFolders(); }
  return loadRows(true);
}
async function refreshStats() {
  try { st.stats = await libraryStats(); } catch { /* the header stays as it was */ }
  renderStats();
  renderTypeChips();
}

// ---------- selection / bulk actions ----------
function renderBulkBar() {
  const bar = $('bulkBar');
  bar.hidden = !st.selecting;
  document.body.classList.toggle('has-bulk', st.selecting);
  if (!st.selecting) return;
  const n = st.selected.size;
  $('bulkCount').textContent = n ? `${n} selected` : st.acrossHint ? 'Select 2 or more recordings' : 'Tap recordings to select';
  const allFav = n && [...st.selected].every((id) => st.rows.find((r) => r.id === id)?.is_favorite);
  bar.querySelector('[data-bulk=favorite]').textContent = allFav ? 'Unfavorite' : 'Favorite';
  bar.querySelectorAll('[data-bulk]:not([data-bulk=cancel])').forEach((b) => { b.disabled = !n; });
  // across recordings: 2–12 for a question, 2–10 for one study guide
  bar.querySelector('[data-bulk=across]').disabled = n < 2 || n > 12;
  bar.querySelector('[data-bulk=across-guide]').disabled = n < 2 || n > 10;
}
function setSelecting(on) {
  st.selecting = on;
  st.selected.clear();
  renderChrome();
  if (!searching() && !(st.view === 'folders' && !st.folder)) renderList();
}
function toggleSelected(id) {
  if (st.selected.has(id)) st.selected.delete(id); else st.selected.add(id);
  const card = $('libList').querySelector(`.lib-card[data-id="${id}"]`);
  card?.classList.toggle('selected', st.selected.has(id));
  const box = card?.querySelector('.lib-check input');
  if (box) box.checked = st.selected.has(id);
  renderBulkBar();
}

async function bulk(action) {
  const ids = [...st.selected];
  if (!ids.length && action !== 'cancel') return;
  if (action === 'cancel') { st.acrossHint = false; return setSelecting(false); }
  if (action === 'across' || action === 'across-guide') {
    location.href = `/across?ids=${ids.slice(0, 12).join(',')}${action === 'across-guide' ? '&tab=guide' : ''}`;
    return;
  }
  if (action === 'favorite') {
    const value = !ids.every((id) => st.rows.find((r) => r.id === id)?.is_favorite);
    try { await setFavorite(ids, value); toast(value ? `Added ${ids.length} to favorites` : `Removed ${ids.length} from favorites`); } catch (e) { return toast(e.message || 'That didn’t work'); }
  } else if (action === 'folder') {
    return folderPicker({ ids, onChange: async () => { await loadFolders(); toast('Courses updated'); setSelecting(false); refresh(); } });
  } else if (action === 'delete') {
    if (!(await confirmDeleteRecordings(ids.length))) return;
    try { const n = await deleteTranscripts(ids); toast(`Deleted ${n} recording${n === 1 ? '' : 's'}`); } catch (e) { return toast(e.message || 'Delete failed'); }
    refreshStats();
  }
  setSelecting(false);
  refresh();
}

// ---------- per-recording menu ----------
function recordingMenu(row) {
  const { dlg, dismiss } = makeDialog('menu-dlg', `<h3 class="menu-title">${esc(row.title)}</h3>
    <div class="menu-list">
      <button type="button" data-m="open">Open</button>
      <button type="button" data-m="rename">Rename</button>
      <button type="button" data-m="star">${row.is_favorite ? 'Remove from favorites' : 'Add to favorites'}</button>
      <button type="button" data-m="folders">Courses…</button>
      ${st.folder ? `<button type="button" data-m="unfolder">Remove from “${esc(folderName(st.folder) || 'this course')}”</button>` : ''}
      <button type="button" data-m="delete" class="danger">Delete…</button>
    </div>
    <div class="confirm-actions"><button class="btn btn-ghost" type="button" data-m="close">Cancel</button></div>`);
  dlg.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    dismiss();
    if (m === 'open') location.href = openUrl(row.id);
    else if (m === 'rename') renameRow(row);
    else if (m === 'star') toggleStar(row);
    else if (m === 'folders') folderPicker({ ids: [row.id], currentIds: row.folder_ids || [], onChange: async (ids) => { row.folder_ids = ids; await loadFolders(); toast('Courses updated'); if (st.folder && !ids.includes(st.folder)) refresh(); else renderList(); } });
    else if (m === 'unfolder') { try { await removeFromFolder(st.folder, row.id); toast('Removed from this course'); await loadFolders(); refresh(); } catch (ex) { toast(ex.message || 'That didn’t work'); } }
    else if (m === 'delete') {
      if (!(await confirmDeleteRecordings(1, row.title))) return;
      try { await deleteTranscripts(row.id); toast('Recording deleted'); refreshStats(); refresh(); } catch (ex) { toast(ex.message || 'Delete failed'); }
    }
  });
}
async function renameRow(row) {
  if ($('libList').querySelector(`.lib-card[data-id="${row.id}"] .lib-title`)) return startRename(row);
  const title = await promptDialog({ title: 'Rename recording', label: 'Name', value: row.title, submit: (v) => renameTranscript(row.id, v) });
  if (!title) return;
  row.title = title;
  toast('Renamed');
  renderList();
}
async function toggleStar(row) {
  const value = !row.is_favorite;
  row.is_favorite = value;
  renderList();
  const star = $('libList').querySelector(`.lib-card[data-id="${row.id}"] .star`);
  if (value) star?.classList.add('just-on'); // a quick charge as it fills (CSS)
  try {
    await setFavorite(row.id, value);
    if (st.stats) st.stats.favorites = Number(st.stats.favorites) + (value ? 1 : -1);
    if (!value && st.view === 'favorites' && !st.folder) refresh();
  } catch (e) { row.is_favorite = !value; renderList(); toast(e.message || 'That didn’t work'); }
}

// ---------- add recordings to the open course ----------
async function listAllRecordings() {
  const all = [];
  for (let offset = 0; offset < 600; offset += 100) {
    const { rows } = await listLibrary({ view: 'all', sort: 'newest', offset, limit: 100 });
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}
async function addRecordings() {
  const id = st.folder;
  if (!id) return;
  const n = await addRecordingsDialog({ folderId: id, folderName: folderName(id) || 'this course', listAll: listAllRecordings, memberIds: () => courseLectureIds(id) });
  if (!n) return;
  toast(`Added ${n} recording${n === 1 ? '' : 's'}`);
  await loadFolders();
  refresh();
}

// ---------- inline rename: double-click the title (or the pencil, F2) ----------
function startRename(row) {
  const card = $('libList').querySelector(`.lib-card[data-id="${row.id}"]`);
  const title = card?.querySelector('.lib-title');
  if (!title || card.classList.contains('renaming')) return;
  card.classList.add('renaming');
  const input = document.createElement('input');
  input.className = 'lib-title-input';
  input.value = row.title;
  input.maxLength = 300;
  input.setAttribute('aria-label', 'Recording name');
  title.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    card.classList.remove('renaming');
    if (!save || !v || v === row.title) return renderList();
    const before = row.title;
    row.title = v;
    renderList();
    try { await renameTranscript(row.id, v); toast('Renamed'); } catch (e) { row.title = before; renderList(); toast(e.message || 'Couldn’t rename. The old name is kept.'); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

// ---------- folder actions ----------
async function newFolder() {
  let created = null;
  const name = await promptDialog({ title: 'New course', label: 'Course name', placeholder: 'e.g. Biology 201', maxLength: 80, confirmLabel: 'Create', submit: async (v) => { created = await createFolder(v); } });
  if (!name) return;
  toast(`Created “${name}”`);
  await loadFolders();
  if (!created?.id) return renderFolders();
  st.folder = created.id; // straight into the new course, with Add recordings one click away
  st.view = 'folders';
  refresh({ push: true });
}
async function renameCurrentFolder() {
  const id = st.folder;
  const name = await promptDialog({ title: 'Rename course', label: 'Course name', value: folderName(id) || '', maxLength: 80, submit: (v) => renameFolder(id, v) });
  if (!name) return;
  await loadFolders();
  renderChrome();
  toast('Course renamed');
}
async function deleteCurrentFolder() {
  const id = st.folder;
  const f = st.folders.find((x) => x.id === id);
  const ok = await confirmDialog({
    title: 'Delete this course?',
    bodyHtml: `<p>“${esc(f?.name || 'This course')}” will be removed. ${f?.count ? (f.count === 1 ? 'The recording in it stays in your library' : `The ${f.count} recordings in it stay in your library`) + ' — only the course goes.' : 'It’s empty.'}</p>`,
    confirmLabel: 'Delete course', danger: true,
  });
  if (!ok) return;
  try { await deleteFolder(id); } catch (e) { return toast(e.message || 'Couldn’t delete the course'); }
  toast('Course deleted');
  st.folder = null;
  st.view = 'folders';
  await loadFolders();
  refresh({ push: true });
}

// the Library views' indicator: glides to the chosen tab (transform + width only)
let titleClick = 0;
function placeTabIndicator(instant = false) {
  const ind = $('viewTabs').querySelector('.tab-ind');
  const on = $('viewTabs').querySelector('.tab.on');
  if (!ind) return;
  if (!on) { ind.style.opacity = '0'; return; }
  if (instant) ind.style.transition = 'none';
  ind.style.opacity = '1';
  ind.style.width = `${on.offsetWidth}px`;
  ind.style.transform = `translateX(${on.offsetLeft}px)`;
  if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
}

// ---------- events ----------
function bind() {
  // "Ask across recordings": start selecting, with the hint in the bar
  // a Thunder feature: on another plan it explains what it does and offers Thunder (instead of a selection that leads
  // to a refusal); the mark stays on other plans only
  let plan = null;
  myPlan().then((p) => { plan = p; if (p?.features?.includes('across_ask') && $('acrossTag')) $('acrossTag').hidden = true; });
  $('acrossBtn')?.addEventListener('click', () => {
    if (plan && !plan.features.includes('across_ask')) { openThunderDialog({ feature: 'ask', back: '/library', planName: plan.planName }); return; }
    st.acrossHint = true; if (!st.selecting) setSelecting(true); else renderBulkBar();
  });
  $('viewTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    st.view = b.dataset.view;
    st.folder = null;
    st.q = '';
    $('q').value = '';
    if (st.selecting) { st.selecting = false; st.selected.clear(); }
    refresh({ push: true });
  });

  let debounce;
  $('q').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const before = searching();
      st.q = $('q').value;
      if (!searching() && !before) { $('qClear').hidden = !st.q; return; }
      refresh();
    }, 280);
  });
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(debounce); st.q = $('q').value; $('q').blur(); refresh(); });
  const clearSearch = () => { st.q = ''; $('q').value = ''; refresh(); };
  $('qClear').addEventListener('click', () => { clearSearch(); $('q').focus(); });
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.q) { e.preventDefault(); clearSearch(); } });

  $('typeChips').addEventListener('change', (e) => {
    if (e.target.id !== 'typeSel') return;
    st.type = e.target.value || null;
    refresh();
  });
  // "/" jumps to search (unless you're already typing somewhere); F2 renames the focused recording
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !document.querySelector('dialog[open]')) { e.preventDefault(); $('q').focus(); }
    if (e.key === 'F2' && !typing) {
      const card = document.activeElement?.closest?.('.lib-card');
      const row = card && st.rows.find((r) => r.id === card.dataset.id);
      if (row) { e.preventDefault(); startRename(row); }
    }
  });
  addEventListener('resize', () => placeTabIndicator(true), { passive: true });
  $('dateSel').addEventListener('change', () => { st.date = $('dateSel').value; refresh(); });
  $('sortSel').addEventListener('change', () => { st.sort = $('sortSel').value; refresh(); });
  $('selectBtn').addEventListener('click', () => setSelecting(!st.selecting));
  $('bulkBar').addEventListener('click', (e) => { const b = e.target.closest('[data-bulk]'); if (b) bulk(b.dataset.bulk); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.selecting && !document.querySelector('dialog[open]')) setSelecting(false); });

  $('folderHead').addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'folders') e.preventDefault();
    if (a === 'folders') { st.folder = null; st.view = 'folders'; refresh({ push: true }); }
    else if (a === 'rename-folder') renameCurrentFolder();
    else if (a === 'add-recordings') addRecordings();
    else if (a === 'delete-folder') deleteCurrentFolder();
  });

  $('libList').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'retry') return refresh();
    if (act === 'clear-search') return clearSearch();
    if (act === 'new-folder') return newFolder();
    if (act === 'add-recordings') return addRecordings();
    const tile = e.target.closest('[data-folder]');
    if (tile && !e.metaKey && !e.ctrlKey) { e.preventDefault(); st.folder = tile.dataset.folder; st.view = 'folders'; return refresh({ push: true }); }
    const card = e.target.closest('.lib-card');
    if (!card) return;
    const row = st.rows.find((r) => r.id === card.dataset.id);
    if (!row) return;
    if (act === 'star') { e.preventDefault(); return toggleStar(row); }
    if (act === 'rename') { e.preventDefault(); return startRename(row); }
    // the title: one click opens (a moment later, so a double-click can rename instead)
    if (act === 'title' && !st.selecting) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return window.open(openUrl(row.id), '_blank');
      clearTimeout(titleClick);
      if (e.detail >= 2) return startRename(row);
      titleClick = setTimeout(() => { location.href = openUrl(row.id); }, 240);
      return;
    }
    if (act === 'menu') { e.preventDefault(); return recordingMenu(row); }
    if (st.selecting) {
      // the checkbox keeps its native toggle (cancelling the click would undo the tick); the card toggles it by hand
      if (e.target.matches('.lib-check input')) { st.selected.has(row.id) !== e.target.checked && toggleSelected(row.id); return; }
      e.preventDefault(); toggleSelected(row.id);
    }
  });
  $('libMore').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'more' && !st.loading) loadRows(false);
    if (act === 'more-results' && !st.loading) runSearch(false);
  });
  // load the next page automatically when the end of the list comes into view
  new IntersectionObserver((entries) => {
    if (!entries.some((x) => x.isIntersecting) || st.loading) return;
    if (searching()) { if (st.results.length && !st.resDone) runSearch(false); }
    else if (st.rows.length && !st.done && !(st.view === 'folders' && !st.folder)) loadRows(false);
  }, { rootMargin: '400px' }).observe($('libMore'));

  window.addEventListener('popstate', () => { readUrl(); $('q').value = st.q; refresh(); });
  // coming back to this tab (e.g. after renaming a recording elsewhere): show current data
  window.addEventListener('pageshow', (e) => { if (e.persisted) { refreshStats(); refresh(); } });
}

(async () => {
  if (!isConfigured) return location.replace('/auth');
  await requireUser();
  mountAccountMenu($('accountSlot'));
  mountMascot({ page: 'library' });
  readUrl();
  $('q').value = st.q;
  bind();
  await Promise.all([refreshStats(), loadFolders()]);
  refresh();
})();
