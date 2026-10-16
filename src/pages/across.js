// /across — Ask across recordings and the combined study guide (server/ai/across.js).
//
// The selection lives in the URL (?ids=…), so it survives a reload and can be bookmarked. Recordings are read as the
// signed-in user (Row Level Security): an id that isn't theirs, or was deleted, simply doesn't come back and is
// dropped with a notice. Questions, answers and the combined guide are kept in this browser only (per account, at
// most 10 sets of recordings); the server stores nothing new. Saved answers keep the recording versions they were
// made from, so a deleted or edited recording is flagged instead of silently pointing at the wrong place.
import { isConfigured, supabase } from '../lib/supabase.js';
import { mountAccountMenu, requireUser, esc } from '../lib/account.js';
import { fmtDuration } from '../lib/transcripts.js';
import { fmtClock, RECORDING_TYPE_LABEL } from '../lib/segments.js';
import { listLibrary, searchLibrary } from '../lib/library.js';
import { toast } from '../library/dialogs.js';
import { acrossStatus, acrossGuide, askAcross, requestInsight, requestTool } from '../insights/api.js';

const $ = (id) => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASK_MAX = 12, GUIDE_MAX = 10, MIN = 2;
const STORE_SETS = 10, STORE_QA = 20;

const st = {
  user: null, ids: [], meta: new Map(), tab: 'ask',
  thread: [], guide: null, pending: null, asking: false, askErr: null,
  prepared: new Set(), guideBusy: null, guideErr: null, focus: 'balanced',
  add: { open: false, q: '', rows: [], loading: false },
};

// ---------- saved work (this browser, this account) ----------
const storeKey = () => `sparkscribe.across.${st.user?.id || 'anon'}`;
const setKey = (ids) => [...ids].sort().join(',');
function readStore() { try { return JSON.parse(localStorage.getItem(storeKey()) || '{}') || {}; } catch { return {}; } }
function writeStore(mutate) {
  try {
    const s = readStore();
    s.sets ||= {};
    mutate(s);
    const keys = Object.keys(s.sets).sort((a, b) => (s.sets[b].at || 0) - (s.sets[a].at || 0));
    for (const k of keys.slice(STORE_SETS)) delete s.sets[k];
    localStorage.setItem(storeKey(), JSON.stringify(s));
  } catch { /* storage full or blocked: the work is still on screen */ }
}
function loadSaved() {
  const s = readStore().sets?.[setKey(st.ids)];
  st.thread = s?.thread || [];
  st.guide = s?.guide || null;
}
function saveSet() {
  writeStore((s) => { s.sets[setKey(st.ids)] = { at: Date.now(), thread: st.thread.slice(0, STORE_QA), guide: st.guide }; });
}

// ---------- selection ----------
function readUrl() {
  const raw = new URLSearchParams(location.search).get('ids') || '';
  st.ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, ASK_MAX);
}
function writeUrl() {
  const q = st.ids.length ? `?ids=${st.ids.join(',')}` : '';
  history.replaceState(null, '', `/across${q}`);
}
async function loadMeta(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('transcriptions').select('id, title, created_at, duration_seconds, content_version, recording_type').in('id', ids);
  if (error) throw error;
  for (const r of data || []) st.meta.set(r.id, r);
  return ids.filter((id) => !(data || []).some((r) => r.id === id)); // not theirs, or deleted
}
const ordered = () => st.ids.map((id) => st.meta.get(id)).filter(Boolean).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const typeLabel = (t) => (t && RECORDING_TYPE_LABEL[t] ? RECORDING_TYPE_LABEL[t] : '');

async function setIds(next, { quiet = false } = {}) {
  st.ids = [...new Set(next)].slice(0, ASK_MAX);
  writeUrl();
  const gone = await loadMeta(st.ids.filter((id) => !st.meta.has(id))).catch(() => []);
  if (gone.length) {
    const before = setKey(st.ids);
    st.ids = st.ids.filter((id) => !gone.includes(id));
    writeUrl();
    // work saved for the full selection stays with what is left, so its answers can say what was deleted
    writeStore((s) => {
      const old = s.sets[before], key = setKey(st.ids);
      if (!old || before === key) return;
      const cur = s.sets[key];
      s.sets[key] = { at: Date.now(), thread: [...(cur?.thread || []), ...(old.thread || [])].sort((a, b) => b.at - a.at).slice(0, STORE_QA), guide: cur?.guide || old.guide || null };
      delete s.sets[before]; // that selection can't come back (a recording in it is gone)
    });
    if (!quiet) toast(`${gone.length === 1 ? 'One recording is' : `${gone.length} recordings are`} no longer in your library, so ${gone.length === 1 ? 'it was' : 'they were'} removed.`, 4000);
  }
  st.askErr = null; st.guideErr = null;
  loadSaved();
  render();
}

function renderSide() {
  const recs = ordered();
  $('selCount').textContent = String(recs.length);
  $('selList').innerHTML = recs.length
    ? recs.map((r, i) => `<li class="ax-item"><span class="ax-label mono" aria-hidden="true">${i + 1}</span>
        <span class="ax-item-body"><a class="ax-item-title" href="/transcript?id=${encodeURIComponent(r.id)}">${esc(r.title || 'Untitled recording')}</a>
          <span class="ax-item-meta mono">${esc([shortDate(r.created_at), fmtDuration(r.duration_seconds), typeLabel(r.recording_type)].filter(Boolean).join(' · '))}</span></span>
        <button class="icon-btn ax-remove" type="button" data-remove="${r.id}" aria-label="Remove ${esc(r.title || 'recording')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></li>`).join('')
    : '<li class="ax-empty-sel">No recordings selected yet.</li>';
  const n = recs.length;
  $('selLimit').textContent = n < MIN ? `Choose at least ${MIN} recordings.` : n > GUIDE_MAX ? `Up to ${ASK_MAX} for questions · ${GUIDE_MAX} for a study guide` : `${n} of up to ${ASK_MAX}`;
  $('addBtn').setAttribute('aria-expanded', String(st.add.open));
  $('addPanel').hidden = !st.add.open;
  if (st.add.open) renderAdd();
}

// ---------- adding recordings ----------
async function loadAddRows() {
  st.add.loading = true;
  renderAdd();
  const my = (st.add.token = (st.add.token || 0) + 1);
  try {
    const q = st.add.q.trim();
    const rows = q.length >= 2
      ? (await searchLibrary(q, { limit: 20 })).map((r) => ({ id: r.transcription_id, title: r.title, created_at: r.created_at, duration_seconds: r.duration_seconds, recording_type: r.recording_type }))
      : (await listLibrary({ view: 'all', sort: 'newest', limit: 30 })).rows;
    if (my !== st.add.token) return;
    st.add.rows = rows;
    for (const r of rows) if (!st.meta.has(r.id)) st.meta.set(r.id, { ...r, content_version: null });
  } catch { st.add.rows = []; }
  st.add.loading = false;
  renderAdd();
}
function renderAdd() {
  const full = st.ids.length >= ASK_MAX;
  $('addList').innerHTML = st.add.loading && !st.add.rows.length
    ? '<li class="ax-pick-empty">Loading…</li>'
    : st.add.rows.length
      ? st.add.rows.map((r) => {
        const on = st.ids.includes(r.id);
        return `<li><button class="ax-pick-row${on ? ' on' : ''}" type="button" data-pick="${r.id}" aria-pressed="${on}"${!on && full ? ' disabled' : ''}>
          <span class="ax-pick-box" aria-hidden="true">${on ? '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19.5 7"/></svg>' : ''}</span>
          <span class="ax-item-body"><span class="ax-item-title">${esc(r.title || 'Untitled recording')}</span><span class="ax-item-meta mono">${esc([shortDate(r.created_at), fmtDuration(r.duration_seconds)].filter(Boolean).join(' · '))}</span></span></button></li>`;
      }).join('')
      : `<li class="ax-pick-empty">${st.add.q.trim().length >= 2 ? 'No recordings match.' : 'Your library is empty.'}</li>`;
}

// ---------- answers: [R2:45] → links to that passage ----------
const CITE = /\[((?:R\d+:\d+)(?:\s*,\s*(?:R\d+:)?\d+)*)\]/g;
function chipFor(ref, recs) {
  const live = st.meta.get(ref.transcriptionId);
  const n = recs.findIndex((r) => r.label === ref.label) + 1;
  const name = `${ref.title}`;
  if (!live) return `<span class="ax-chip gone" title="This recording was deleted">${esc(name)} · ${fmtClock(ref.start)}</span>`;
  return `<a class="ax-chip" href="/transcript?id=${encodeURIComponent(ref.transcriptionId)}&t=${Math.floor(ref.start * 100) / 100}&line=${ref.line}" title="Open ${esc(name)} at ${fmtClock(ref.start)}"><span class="ax-chip-n mono" aria-hidden="true">${n || ''}</span>${esc(name)} · <span class="mono">${fmtClock(ref.start)}</span></a>`;
}
function richAnswer(text, refs, recs) {
  const find = (label, line) => refs.find((r) => r.label === label && r.line === line);
  const inline = (t) => {
    let out = '', last = 0;
    for (const m of t.matchAll(CITE)) {
      out += esc(t.slice(last, m.index));
      let label = null;
      const chips = m[1].split(/\s*,\s*/).map((p) => { const x = /^(?:(R\d+):)?(\d+)$/.exec(p); if (!x) return ''; label = x[1] || label; const r = find(label, Number(x[2])); return r ? chipFor(r, recs) : ''; }).join('');
      out += chips ? `<span class="ax-cites">${chips}</span>` : '';
      last = m.index + m[0].length;
    }
    return out + esc(t.slice(last));
  };
  const lines = String(text || '').split('\n');
  const html = [];
  let list = null;
  for (const l of lines) {
    if (/^\s*[-•]\s+/.test(l)) { (list ||= []).push(`<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`); continue; }
    if (list) { html.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (l.trim()) html.push(`<p>${inline(l)}</p>`);
  }
  if (list) html.push(`<ul>${list.join('')}</ul>`);
  return html.join('');
}
// what changed since an answer was made: deleted or edited recordings
function staleNote(versions) {
  const gone = [], edited = [];
  for (const v of versions || []) {
    const m = st.meta.get(v.id);
    if (!m) gone.push(v.title);
    else if (m.content_version != null && v.version != null && m.content_version !== v.version) edited.push(m.title);
  }
  const parts = [];
  if (gone.length) parts.push(`${gone.map((t) => `“${esc(t)}”`).join(', ')} ${gone.length === 1 ? 'was' : 'were'} deleted; ${gone.length === 1 ? 'its' : 'their'} links are disabled.`);
  if (edited.length) parts.push(`${edited.map((t) => `“${esc(t)}”`).join(', ')} ${edited.length === 1 ? 'was' : 'were'} edited after this was made; ask again for an up-to-date answer.`);
  return parts.length ? `<p class="ax-stale" role="note">${parts.join(' ')}</p>` : '';
}

function sourcesHtml(refs, recs) {
  const by = new Map();
  for (const r of refs) { if (!by.has(r.transcriptionId)) by.set(r.transcriptionId, []); by.get(r.transcriptionId).push(r); }
  if (!by.size) return '';
  return `<details class="ax-sources"><summary>Sources · ${by.size} recording${by.size === 1 ? '' : 's'}</summary><ul>${[...by.values()].map((list) => `<li><b>${esc(list[0].title)}</b> <span class="ax-cites">${list.sort((a, b) => a.start - b.start).map((r) => chipFor(r, recs)).join('')}</span></li>`).join('')}</ul></details>`;
}

// ---------- Ask ----------
const SUGGEST = {
  study: ['Which concepts came up in more than one of these?', 'What changed between the first and the last recording?', 'Summarize what I need to know for an exam on these.'],
  work: ['What decisions were made across these meetings?', 'Which action items came up more than once?', 'Where did people disagree, and how was it resolved?'],
};
function renderAsk() {
  const p = $('askPanel');
  const recs = ordered();
  if (recs.length < MIN) {
    p.innerHTML = `<div class="panel ax-empty"><h2>Choose recordings to ask about</h2><p>Select at least two recordings. You can add them here, or select them in My Library and choose <b>Ask across</b>.</p>
      <div class="ax-empty-actions"><button class="btn btn-primary" type="button" data-act="open-add">Add recordings</button><a class="btn btn-ghost" href="/library">Open My Library</a></div></div>`;
    return;
  }
  const work = recs.filter((r) => ['meeting', 'interview', 'voice_message'].includes(r.recording_type)).length > recs.length / 2;
  const pend = st.pending;
  const busy = st.asking;
  p.innerHTML = `<form class="panel ax-ask" id="askForm" novalidate>
      <label class="ax-ask-label" for="askQ">Ask about these ${recs.length} recordings</label>
      <div class="ax-ask-row"><textarea id="askQ" maxlength="500" rows="2" placeholder="${work ? 'e.g. What decisions changed between these meetings?' : 'e.g. How did the explanation of this topic change between lectures?'}"${busy ? ' disabled' : ''}></textarea>
      <button class="btn btn-primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Answering…' : 'Ask'}</button></div>
      <div class="ax-suggest" role="group" aria-label="Suggestions">${(work ? SUGGEST.work : SUGGEST.study).map((s) => `<button class="chip-btn" type="button" data-suggest="${esc(s)}"${busy ? ' disabled' : ''}>${esc(s)}</button>`).join('')}</div>
      <p class="ax-fine">Answers use your saved transcripts (never audio) and cite the passages they come from. Each question uses a small amount of your AI allowance.</p>
    </form>
    ${st.askErr ? `<div class="ins-msg warn ax-err" role="alert"><span>${esc(st.askErr)}</span></div>` : ''}
    <div class="ax-thread" aria-live="polite">
      ${pend ? `<article class="panel ax-qa pending"><p class="ax-q">${esc(pend.question)}</p>
        <div class="ax-a" aria-busy="true">${pend.text ? `<p>${esc(pend.text.replace(CITE, '').replace(/\[R?\d*:?\d*$/, ''))}</p>` : `<p class="ax-status"><span class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></span>${esc(pend.status)}</p>`}</div></article>` : ''}
      ${st.thread.map((qa, i) => `<article class="panel ax-qa"><p class="ax-q">${esc(qa.question)}</p>
        <div class="ax-a">${richAnswer(qa.answer, qa.refs, qa.recordings)}</div>
        ${staleNote(qa.recordings)}
        ${sourcesHtml(qa.refs, qa.recordings)}
        <p class="ax-meta mono">${esc(`${qa.recordings.length} recordings · ${new Date(qa.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)}<button class="ax-del" type="button" data-del="${i}" aria-label="Remove this answer">Remove</button></p></article>`).join('')}
    </div>`;
}

// recordings with no summary yet are read once first (each summary is saved with its recording, as on its own page)
async function prepareSummaries() {
  const key = setKey(st.ids);
  if (st.prepared.has(key)) return;
  const s = await acrossStatus(st.ids);
  const todo = s.recordings.filter((r) => !r.hasSummary);
  for (const [i, r] of todo.entries()) {
    if (st.pending) { st.pending.status = `Reading ${todo.length === 1 ? `“${r.title}”` : `recordings for the first time (${i + 1} of ${todo.length})`}…`; renderAsk(); }
    try { await requestInsight(r.id, 'overview', 'general'); } catch { /* the answer can still use its passages */ }
  }
  st.prepared.add(key);
}

async function ask(question) {
  question = String(question || '').trim();
  if (!question || st.asking) return;
  st.asking = true; st.askErr = null;
  st.pending = { question, text: '', status: 'Finding the relevant passages…' };
  renderAsk();
  try {
    await prepareSummaries();
    st.pending.status = 'Finding the relevant passages…';
    renderAsk();
    const r = await askAcross(st.ids, question, {
      onStatus: (s) => { if (st.pending) { st.pending.status = s === 'answering' ? 'Writing the answer…' : 'Finding the relevant passages…'; renderAsk(); } },
      onDelta: (t) => { if (st.pending) { st.pending.text += t; renderAsk(); } },
    });
    st.thread.unshift({ question, answer: r.answer, refs: r.refs, recordings: r.recordings.map((x) => ({ label: x.label, id: x.id, title: x.title, version: x.version })), at: Date.now() });
    saveSet();
  } catch (err) {
    if (err.code === 'not_found' && err.details?.missing?.length) {
      st.askErr = err.message;
      await setIds(st.ids.filter((id) => !err.details.missing.includes(id)), { quiet: true });
    } else st.askErr = err.message || "The answer couldn't be generated. Try again.";
  }
  st.asking = false;
  st.pending = null;
  render();
  if (!st.askErr) $('askQ')?.focus();
}

// ---------- Combined study guide ----------
function guideItemSources(sources, recs) {
  return sources.length ? `<span class="ax-cites">${sources.map((s) => chipFor({ ...s, line: s.line ?? 0 }, recs)).join('')}</span>` : '';
}
function guideHtml(g) {
  const c = g.content, recs = c.recordings;
  const recBadge = (label) => { const i = recs.findIndex((r) => r.label === label); return `<span class="ax-rb mono" title="${esc(recs[i]?.title || '')}">${i + 1}</span>`; };
  return `<article class="panel ax-guide" aria-labelledby="gH">
    <header class="ax-guide-head"><h2 id="gH">Combined study guide</h2>
      <p class="ax-meta mono">${esc(`${recs.length} recordings · ${c.themes.length} themes${c.recurring ? ` · ${c.recurring} across several recordings` : ''} · ${new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)}</p></header>
    ${staleNote(recs)}
    ${c.overview ? `<p class="ax-overview">${esc(c.overview)}</p>` : ''}
    <ol class="ax-key" aria-label="Recordings">${recs.map((r, i) => `<li><span class="ax-rb mono" aria-hidden="true">${i + 1}</span>${esc(r.title)}</li>`).join('')}</ol>
    <section aria-labelledby="gThemes"><h3 id="gThemes">Themes</h3>
      ${c.themes.map((t) => `<div class="ax-theme"><div class="ax-theme-head"><h4>${esc(t.title)}</h4><span class="ax-in" aria-label="In recordings ${t.recordings.map((l) => recs.findIndex((r) => r.label === l) + 1).join(', ')}">${t.recordings.map(recBadge).join('')}${t.recordings.length >= 2 ? '<span class="ax-recurs">recurring</span>' : ''}</span></div>
        <p>${esc(t.summary)}</p>${t.comparison ? `<p class="ax-compare"><b>How the recordings differ:</b> ${esc(t.comparison)}</p>` : ''}${guideItemSources(t.sources, recs)}</div>`).join('')}
    </section>
    ${c.definitions.length ? `<section aria-labelledby="gDefs"><h3 id="gDefs">Definitions</h3><dl class="ax-defs">${c.definitions.map((d) => `<div><dt>${esc(d.term)}</dt><dd>${esc(d.definition)} ${guideItemSources(d.sources, recs)}</dd></div>`).join('')}</dl></section>` : ''}
    ${c.distinctions.length ? `<section aria-labelledby="gDist"><h3 id="gDist">Don’t confuse</h3><ul class="ax-list">${c.distinctions.map((d) => `<li>${esc(d.text)} ${guideItemSources(d.sources, recs)}</li>`).join('')}</ul></section>` : ''}
    ${c.self_check.length ? `<section aria-labelledby="gCheck"><h3 id="gCheck">Check yourself</h3>${c.self_check.map((q) => `<details class="ax-check"><summary>${esc(q.question)}</summary><p>${esc(q.answer)} ${guideItemSources(q.sources, recs)}</p></details>`).join('')}</section>` : ''}
    <div class="ax-guide-tools"><button class="btn btn-ghost btn-sm" type="button" data-act="guide-copy">Copy</button><button class="btn btn-ghost btn-sm" type="button" data-act="guide-new">Create again</button></div>
  </article>`;
}
function renderGuide() {
  const p = $('guidePanel');
  const recs = ordered();
  if (recs.length < MIN) { p.innerHTML = '<div class="panel ax-empty"><h2>Choose recordings first</h2><p>A combined study guide needs at least two recordings.</p><div class="ax-empty-actions"><button class="btn btn-primary" type="button" data-act="open-add">Add recordings</button></div></div>'; return; }
  if (recs.length > GUIDE_MAX) { p.innerHTML = `<div class="panel ax-empty"><h2>Too many for one study guide</h2><p>A combined study guide works with up to ${GUIDE_MAX} recordings. Remove ${recs.length - GUIDE_MAX} to continue.</p></div>`; return; }
  const busy = st.guideBusy;
  const intro = `<div class="panel ax-guide-setup">
      <p class="ax-lede2">One study guide for all ${recs.length} recordings: the themes they share, where each was taught, definitions, distinctions and questions to check yourself.</p>
      <div class="seg-toggle" role="group" aria-label="Focus">${[['balanced', 'Balanced'], ['exam', 'Exam review']].map(([v, l]) => `<button type="button" data-focus="${v}" class="${st.focus === v ? 'on' : ''}" aria-pressed="${st.focus === v}"${busy ? ' disabled' : ''}>${l}</button>`).join('')}</div>
      ${busy ? `<p class="ax-status" role="status"><span class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></span>${esc(busy)}</p>` : `<button class="btn btn-primary" type="button" data-act="guide">${st.guide ? 'Create again' : 'Create combined study guide'}</button>`}
      <p class="ax-fine">Built from each recording’s study map. Recordings without one get their own study guide first (saved with the recording, as if you had made it there).</p>
    </div>`;
  p.innerHTML = `${st.guideErr ? `<div class="ins-msg warn ax-err" role="alert"><span>${esc(st.guideErr)}</span></div>` : ''}${st.guide && !busy ? '' : intro}${st.guide && !busy ? guideHtml(st.guide) : ''}`;
}
async function makeGuide() {
  if (st.guideBusy) return;
  st.guideErr = null;
  st.guideBusy = 'Checking the recordings…';
  renderGuide();
  try {
    let content = null;
    for (let round = 0; round < 2 && !content; round++) {
      try { content = (await acrossGuide(st.ids, st.focus)).content; } catch (err) {
        if (err.code !== 'needs_maps' || round) throw err;
        const needs = err.details?.needs || [];
        for (const [i, id] of needs.entries()) {
          st.guideBusy = `Making a study map for “${st.meta.get(id)?.title || 'a recording'}” (${i + 1} of ${needs.length})…`;
          renderGuide();
          const r = await requestTool(id, 'study_guide', {});
          // another tab is already making it: wait for it rather than paying twice
          for (let t = 0; r.artifact?.status === 'generating' && t < 30; t++) { await new Promise((ok) => setTimeout(ok, 4000)); try { const again = await requestTool(id, 'study_guide', {}); if (again.artifact?.status !== 'generating') break; } catch { break; } }
        }
        st.guideBusy = 'Combining the recordings…';
        renderGuide();
      }
    }
    st.guide = { content, at: Date.now() };
    saveSet();
  } catch (err) {
    if (err.code === 'not_found' && err.details?.missing?.length) await setIds(st.ids.filter((id) => !err.details.missing.includes(id)), { quiet: true });
    st.guideErr = err.message || "The combined study guide couldn't be made. Try again.";
  }
  st.guideBusy = null;
  renderGuide();
}
function guideText(g) {
  const c = g.content, recs = c.recordings;
  const src = (s) => s.map((x) => `${x.title} ${fmtClock(x.start)}`).join('; ');
  return [`Combined study guide (${recs.map((r) => r.title).join(', ')})`, '', c.overview, '',
    'THEMES', ...c.themes.flatMap((t) => [`- ${t.title}: ${t.summary}${t.comparison ? ` (How they differ: ${t.comparison})` : ''} [${src(t.sources)}]`]), '',
    ...(c.definitions.length ? ['DEFINITIONS', ...c.definitions.map((d) => `- ${d.term}: ${d.definition} [${src(d.sources)}]`), ''] : []),
    ...(c.distinctions.length ? ["DON'T CONFUSE", ...c.distinctions.map((d) => `- ${d.text} [${src(d.sources)}]`), ''] : []),
    ...(c.self_check.length ? ['CHECK YOURSELF', ...c.self_check.map((q) => `- Q: ${q.question}\n  A: ${q.answer}`)] : [])].join('\n');
}

// ---------- tabs and events ----------
function render() {
  renderSide();
  $('tabAsk').classList.toggle('on', st.tab === 'ask'); $('tabAsk').setAttribute('aria-selected', String(st.tab === 'ask'));
  $('tabGuide').classList.toggle('on', st.tab === 'guide'); $('tabGuide').setAttribute('aria-selected', String(st.tab === 'guide'));
  $('askPanel').hidden = st.tab !== 'ask';
  $('guidePanel').hidden = st.tab !== 'guide';
  if (st.tab === 'ask') renderAsk(); else renderGuide();
}

function bind() {
  document.querySelectorAll('.ax-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; render(); }));
  $('addBtn').addEventListener('click', () => { st.add.open = !st.add.open; render(); if (st.add.open) { loadAddRows(); $('addQ').focus(); } });
  let t = 0;
  $('addQ').addEventListener('input', (e) => { st.add.q = e.target.value; clearTimeout(t); t = setTimeout(loadAddRows, 250); });
  $('addForm').addEventListener('submit', (e) => { e.preventDefault(); loadAddRows(); });
  $('addList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const id = b.dataset.pick;
    setIds(st.ids.includes(id) ? st.ids.filter((x) => x !== id) : [...st.ids, id]);
  });
  $('selList').addEventListener('click', (e) => { const b = e.target.closest('[data-remove]'); if (b) setIds(st.ids.filter((x) => x !== b.dataset.remove)); });
  document.querySelector('.ax-main').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'open-add') { st.add.open = true; render(); loadAddRows(); $('addQ').focus(); }
    else if (b.dataset.suggest) { const q = $('askQ'); if (q) q.value = b.dataset.suggest; ask(b.dataset.suggest); }
    else if (b.dataset.del != null) { st.thread.splice(Number(b.dataset.del), 1); saveSet(); renderAsk(); }
    else if (b.dataset.focus) { st.focus = b.dataset.focus; renderGuide(); }
    else if (b.dataset.act === 'guide') makeGuide();
    else if (b.dataset.act === 'guide-new') { st.guide = null; renderGuide(); }
    else if (b.dataset.act === 'guide-copy') navigator.clipboard.writeText(guideText(st.guide)).then(() => toast('Copied the study guide'), () => toast('Copy failed'));
  });
  document.querySelector('.ax-main').addEventListener('submit', (e) => { if (e.target.id === 'askForm') { e.preventDefault(); ask($('askQ').value); } });
  document.querySelector('.ax-main').addEventListener('keydown', (e) => {
    if (e.target.id === 'askQ' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); }
  });
}

async function main() {
  if (isConfigured) mountAccountMenu($('accountSlot'));
  st.user = await requireUser();
  readUrl();
  if (new URLSearchParams(location.search).get('tab') === 'guide') st.tab = 'guide';
  bind();
  await setIds(st.ids);
}
main();
