// Library data calls (src/lib/library.js): the requests sent to the database and how replies are shaped.
// Supabase is "configured" with a made-up address through a Node module hook, and global fetch is the database stand-in,
// so every request is recorded here and nothing leaves this machine.
import assert from 'node:assert/strict';
import { register } from 'node:module';
const hook = `export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (url.includes('/src/') && r.format === 'module' && r.source) {
    const env = '({NEXT_PUBLIC_SUPABASE_URL:"http://db.invalid",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_test"})';
    return { ...r, source: String(r.source).replace(/import\\.meta\\.env/g, env) };
  }
  return r;
}`;
register('data:text/javascript,' + encodeURIComponent(hook));
globalThis.indexedDB = undefined;

const sent = [];
let reply = () => ({ status: 200, body: [] });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
  sent.push({ method: init.method || 'GET', path: u.pathname, query: u.searchParams, body, headers: new Headers(init.headers) });
  const { status, body: out } = reply();
  return new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
};
const L = await import(new URL('../src/lib/library.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const last = () => sent.at(-1);
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };

// ---- listLibrary
reply = () => ({ status: 200, body: [{ id: 'a', total: 31 }, { id: 'b', total: 31 }] });
const page = await L.listLibrary({ view: 'favorites', type: 'lecture', folder: 'f1', since: new Date('2026-01-02T03:04:05Z'), sort: 'az', offset: 24 });
ok(last().path === '/rest/v1/rpc/library_list', 'listLibrary calls the library_list function');
ok(JSON.stringify(last().body) === JSON.stringify({ p_view: 'favorites', p_type: 'lecture', p_folder: 'f1', p_since: '2026-01-02T03:04:05.000Z', p_sort: 'az', p_limit: 24, p_offset: 24 }), 'it passes view, type, folder, date, sort and paging through');
ok(page.rows.length === 2 && page.total === 31, 'the total comes from the first row');
await L.listLibrary();
ok(last().body.p_view === 'all' && last().body.p_sort === 'newest' && last().body.p_limit === 24 && last().body.p_offset === 0 && last().body.p_since === null, 'the defaults are the whole library, newest first, 24 at a time');
reply = () => ({ status: 200, body: [] });
ok((await L.listLibrary()).total === 0, 'an empty first page has a total of 0');
ok((await L.listLibrary({ offset: 24 })).total === null, 'an empty later page has an unknown total (null), not 0');
reply = () => ({ status: 400, body: { code: 'PGRST000', message: 'bad' } });
ok((await fail(L.listLibrary()))?.message === 'bad', 'a database error is thrown to the caller');

// ---- searchLibrary / libraryStats
reply = () => ({ status: 200, body: [{ id: 'x' }] });
ok((await L.searchLibrary('mitosis')).length === 1 && last().path === '/rest/v1/rpc/search_library', 'searchLibrary calls search_library');
ok(last().body.p_query === 'mitosis' && last().body.p_limit === 10 && last().body.p_offset === 0, 'with the query and a page of 10');
reply = () => ({ status: 200, body: null });
ok((await L.searchLibrary('q')).length === 0, 'no data reads as no results');
reply = () => ({ status: 200, body: [] });
const stats = await L.libraryStats();
ok(stats.recordings === 0 && stats.seconds === 0 && stats.this_month === 0 && stats.favorites === 0 && Object.keys(stats.by_type).length === 0, 'empty stats are all zeros');
const monthStart = new Date(last().body.p_month_start);
const now = new Date();
ok(monthStart.getFullYear() === now.getFullYear() && monthStart.getMonth() === now.getMonth() && monthStart.getDate() === 1, 'stats count from the first of the user\'s own month');
reply = () => ({ status: 200, body: [{ recordings: 3, seconds: 600 }] });
ok((await L.libraryStats()).recordings === 3, 'real stats come back as the first row');

// ---- renameTranscript
reply = () => ({ status: 200, body: [{ id: 't1' }] });
ok((await L.renameTranscript('t1', '  Week 3 lecture  ')) === 'Week 3 lecture', 'a rename returns the trimmed title');
ok(last().method === 'PATCH' && last().body.title === 'Week 3 lecture' && last().query.get('id') === 'eq.t1', 'only that recording is updated');
await L.renameTranscript('t1', 'x'.repeat(500));
ok(last().body.title.length === 300, 'titles are cut to 300 characters');
const before = sent.length;
ok(/can.t be empty/.test((await fail(L.renameTranscript('t1', '   ')))?.message) && sent.length === before, 'a blank title is refused without calling the database');
ok(/can.t be empty/.test((await fail(L.renameTranscript('t1', null)))?.message), 'null is treated as blank');
reply = () => ({ status: 200, body: [] });
ok(/no longer exists/.test((await fail(L.renameTranscript('gone', 'x')))?.message), 'renaming a recording that is gone says so');

// ---- favorites and folders
reply = () => ({ status: 200, body: [] });
await L.setFavorite('t1', 1);
ok(last().method === 'PATCH' && last().body.is_favorite === true && last().query.get('id') === 'in.(t1)', 'setFavorite accepts one id and stores a boolean');
await L.setFavorite(['t1', 't2'], 0);
ok(last().body.is_favorite === false && last().query.get('id') === 'in.(t1,t2)', 'it also accepts a list');
reply = () => ({ status: 200, body: { id: 'f9', name: 'Biology' } });
const folder = await L.createFolder('  Biology ');
ok(folder.count === 0 && folder.id === 'f9' && last().body.name === 'Biology', 'createFolder trims the name and starts at 0 lectures');
reply = () => ({ status: 409, body: { code: '23505', message: 'dup' } });
ok(/already have a course/.test((await fail(L.createFolder('Biology')))?.message), 'a duplicate course name has a friendly message');
reply = () => ({ status: 400, body: { code: '23514', message: 'check' } });
ok(/1–80 characters/.test((await fail(L.renameFolder('f9', '')))?.message), 'a bad course name length has a friendly message');
reply = () => ({ status: 200, body: [] });
await L.addToFolder('f9', ['t1', 't2']);
ok(last().method === 'POST' && last().body.length === 2 && last().body[0].folder_id === 'f9' && last().body[1].transcription_id === 't2', 'addToFolder adds one row per recording');
ok(last().query.get('on_conflict') === 'folder_id,transcription_id' && /ignore-duplicates/.test(last().headers.get('prefer')), 'adding a recording twice is harmless');
await L.removeFromFolder('f9', 't1');
ok(last().method === 'DELETE' && last().query.get('folder_id') === 'eq.f9' && last().query.get('transcription_id') === 'in.(t1)', 'removeFromFolder removes only the membership');

// ---- listFolders / getRecordingMeta
reply = () => ({ status: 200, body: [{ id: 'f1', name: 'A', folder_items: [{ count: 4 }] }, { id: 'f2', name: 'B', folder_items: [] }, { id: 'f3', name: 'C' }] });
const folders = await L.listFolders();
ok(folders.map((f) => f.count).join() === '4,0,0', 'folder counts come from the nested count and default to 0');
reply = () => ({ status: 200, body: { is_favorite: true, folder_items: [{ folder_id: 'f1' }, { folder_id: 'f2' }] } });
const meta = await L.getRecordingMeta('t1');
ok(meta.isFavorite === true && meta.folderIds.join() === 'f1,f2', 'getRecordingMeta reports the favourite flag and folder ids');

// ---- course exams
reply = () => ({ status: 200, body: [{ id: 'f1', exam_date: '2026-12-01', exam_topics: 'cells' }, { id: 'f2', exam_date: null, exam_topics: null }] });
const exams = await L.listCourseExams();
ok(exams.get('f1').date === '2026-12-01' && exams.get('f2').date === null && exams.get('f2').topics === '', 'course exams map by course id with empty defaults');
reply = () => ({ status: 400, body: { code: '42703', message: 'no column' } });
ok((await L.listCourseExams()) === null, 'a database without the exam columns reads as "exams not offered" (null)');
reply = () => ({ status: 500, body: { code: 'XX000', message: 'boom' } });
ok((await fail(L.listCourseExams()))?.message === 'boom', 'any other error is thrown');
reply = () => ({ status: 200, body: [] });
await L.setCourseExam('f1', { date: '', topics: '  ' });
ok(last().body.exam_date === null && last().body.exam_topics === null, 'a blank date and topics are stored as null');
await L.setCourseExam('f1', { date: '2026-12-01', topics: 'x'.repeat(2000) });
ok(last().body.exam_date === '2026-12-01' && last().body.exam_topics.length === 1000, 'topics are cut to 1000 characters');
reply = () => ({ status: 400, body: { code: '23514', message: 'check' } });
ok(/between 2020 and 2100/.test((await fail(L.setCourseExam('f1', { date: '1999-01-01' })))?.message), 'an out-of-range date has a friendly message');

// ---- courseLectureIds
reply = () => ({ status: 200, body: [{ transcription_id: 'a' }, { transcription_id: 'b' }] });
ok((await L.courseLectureIds('f1')).join() === 'a,b' && last().query.get('limit') === '200' && last().query.get('order') === 'created_at.desc', 'lecture ids come newest first, at most 200');

console.log(`${pass} checks passed`);
