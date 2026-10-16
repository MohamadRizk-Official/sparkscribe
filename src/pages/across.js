// /across — Ask across recordings and the combined study guide (server/ai/across.js). Thunder.
//
// The selection lives in the URL (?ids=…), so it survives a reload and can be bookmarked. Recordings are read as the
// signed-in user (Row Level Security): an id that isn't theirs, or was deleted, simply doesn't come back and is
// dropped with a notice. Answers and guides are saved to the account by the server as they are made, so they are the
// same on every device: this page always shows the server's copy (reloaded when the tab comes back into view), never
// a copy of its own. Saved work is shown with the recordings' current titles and speaker names; a deleted or edited
// recording is flagged instead of silently pointing at the wrong place.
// Asking and making guides need Thunder (the server checks; this page only explains). Saved work stays readable on
// every plan.
import { isConfigured, supabase } from '../lib/supabase.js';
import { mountAccountMenu, requireUser, esc } from '../lib/account.js';
import { fmtDuration } from '../lib/transcripts.js';
import { fmtClock, RECORDING_TYPE_LABEL } from '../lib/segments.js';
import { listLibrary, searchLibrary } from '../lib/library.js';
import { myPlan } from '../lib/billing.js';
import { renderAcrossStreaming } from '../lib/across-refs.js';
import { toast } from '../library/dialogs.js';
import { acrossStatus, acrossGuide, askAcross, acrossHistory, acrossThread, acrossDelete, requestInsight, requestTool } from '../insights/api.js';

const $ = (id) => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASK_MAX = 12, GUIDE_MAX = 10, MIN = 2;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

const st = {
  user: null, plan: null, ids: [], meta: new Map(), tab: 'ask',
  items: [], loading: false, loadErr: null, history: null,
  pending: null, asking: false, askErr: null, askPlan: null,
  prepared: new Set(), guideBusy: null, guideErr: null, focus: 'balanced', guideOpen: false,
  add: { open: false, q: '', rows: [], loading: false },
};
const can = (cap) => !!st.plan?.features?.includes(cap);
const asks = () => st.items.filter((x) => x.kind === 'ask');
const guide = () => st.items.find((x) => x.kind === 'guide') || null;

// ---------- selection ----------
function readUrl() {
  const raw = new URLSearchParams(location.search).get('ids') || '';
  st.ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, ASK_MAX);
}
function writeUrl() {
  const q = st.ids.length ? `?ids=${st.ids.join(',')}` : '';
  history.replaceState(null, '', `/across${q}${st.tab === 'guide' ? `${q ? '&' : '?'}tab=guide` : ''}`);
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
    st.ids = st.ids.filter((id) => !gone.includes(id));
    writeUrl();
    if (!quiet) toast(`${gone.length === 1 ? 'One recording is' : `${gone.length} recordings are`} no longer in your library, so ${gone.length === 1 ? 'it was' : 'they were'} removed.`, 4000);
  }
  st.askErr = null; st.guideErr = null; st.guideOpen = false;
  st.items = [];
  render();
  await loadThread();
}

// the server's saved answers and guides for this selection (newest first). Work saved for a larger selection whose
// other recordings were deleted is included (the server decides).
let threadToken = 0;
async function loadThread({ quiet = false } = {}) {
  const my = ++threadToken;
  if (ordered().length < MIN) { st.items = []; st.loading = false; render(); return; }
  if (!quiet) { st.loading = true; render(); }
  try {
    const r = await acrossThread(st.ids);
    if (my !== threadToken) return;
    st.items = r.items || [];
    st.loadErr = null;
  } catch (err) {
    if (my !== threadToken) return;
    st.loadErr = quiet && st.items.length ? null : (err.message || 'Your saved answers couldn’t be loaded.');
  }
  st.loading = false;
  render();
}
async function loadHistory() {
  try { st.history = (await acrossHistory()).sets || []; } catch { st.history = st.history || []; }
  renderSide();
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
  // saved work: every selection that has answers or a guide, on any device
  const key = [...st.ids].sort().join(',');
  const sets = (st.history || []).filter((s) => s.setKey !== key);
  $('histPanel').hidden = !sets.length;
  $('histList').innerHTML = sets.slice(0, 12).map((s) => {
    const live = s.recordings.filter((r) => r.available);
    const names = live.slice(0, 3).map((r) => r.title).join(', ') + (live.length > 3 ? ` +${live.length - 3}` : '');
    const gone = s.recordings.length - live.length;
    return `<li><button class="ax-hist-row" type="button" data-set="${esc(live.map((r) => r.id).join(','))}"${live.length < MIN ? ' disabled' : ''}>
      <span class="ax-hist-q">${esc(s.lastQuestion || 'Combined study guide')}</span>
      <span class="ax-hist-meta">${esc(names || 'Recordings deleted')}${gone ? ` · ${gone} deleted` : ''}</span>
      <span class="ax-hist-n mono">${esc([s.asks ? `${s.asks} answer${s.asks === 1 ? '' : 's'}` : '', s.guides ? `${s.guides} guide${s.guides === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}</span></button></li>`;
  }).join('');
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
const numberOf = (item, label) => item.recordings.findIndex((r) => r.label === label) + 1;
function chipFor(ref, item) {
  const n = numberOf(item, ref.label);
  if (ref.available === false) return `<span class="ax-chip gone" title="This recording was deleted">${esc(ref.title)} · ${fmtClock(ref.start)}</span>`;
  return `<a class="ax-chip" href="/transcript?id=${encodeURIComponent(ref.transcriptionId)}&t=${Math.floor(ref.start * 100) / 100}&line=${ref.line ?? 0}" title="Open ${esc(ref.title)} at ${fmtClock(ref.start)}"><span class="ax-chip-n mono" aria-hidden="true">${n || ''}</span>${esc(ref.title)} · <span class="mono">${fmtClock(ref.start)}</span></a>`;
}
function richAnswer(text, refs, item) {
  const find = (label, line) => refs.find((r) => r.label === label && r.line === line);
  const inline = (t) => {
    let out = '', last = 0;
    for (const m of t.matchAll(CITE)) {
      out += esc(t.slice(last, m.index));
      let label = null;
      const chips = m[1].split(/\s*,\s*/).map((p) => { const x = /^(?:(R\d+):)?(\d+)$/.exec(p); if (!x) return ''; label = x[1] || label; const r = find(label, Number(x[2])); return r ? chipFor(r, item) : ''; }).join('');
      out += chips ? `<span class="ax-cites">${chips}</span>` : '';
      last = m.index + m[0].length;
    }
    return out + esc(t.slice(last));
  };
  const html = [];
  let list = null;
  for (const l of String(text || '').split('\n')) {
    if (/^\s*[-•]\s+/.test(l)) { (list ||= []).push(`<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`); continue; }
    if (list) { html.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (l.trim()) html.push(`<p>${inline(l)}</p>`);
  }
  if (list) html.push(`<ul>${list.join('')}</ul>`);
  return html.join('');
}
// what changed since an answer was made: deleted or edited recordings (renames don't count: names are always current)
function staleNote(item) {
  const gone = item.recordings.filter((r) => r.status === 'deleted').map((r) => r.title);
  const edited = item.recordings.filter((r) => r.status === 'edited').map((r) => r.title);
  const parts = [];
  if (gone.length) parts.push(`${gone.map((t) => `“${esc(t)}”`).join(', ')} ${gone.length === 1 ? 'was' : 'were'} deleted; ${gone.length === 1 ? 'its' : 'their'} links are disabled.`);
  if (edited.length) parts.push(`${edited.map((t) => `“${esc(t)}”`).join(', ')} ${edited.length === 1 ? 'was' : 'were'} edited after this was made, so it may be out of date.`);
  return parts.length ? `<p class="ax-stale" role="note">${parts.join(' ')}</p>` : '';
}
function sourcesHtml(refs, item) {
  const by = new Map();
  for (const r of refs) { if (!by.has(r.transcriptionId)) by.set(r.transcriptionId, []); by.get(r.transcriptionId).push(r); }
  if (!by.size) return '';
  return `<details class="ax-sources"><summary>Sources · ${by.size} recording${by.size === 1 ? '' : 's'}</summary><ul>${[...by.values()].map((list) => `<li><b>${esc(list[0].title)}</b> <span class="ax-cites">${list.sort((a, b) => a.start - b.start).map((r) => chipFor(r, item)).join('')}</span></li>`).join('')}</ul></details>`;
}
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- the plan ----------
function lockedHtml(kind) {
  const what = kind === 'guide'
    ? 'One study guide from up to 10 of your recordings: the themes they share, where each was taught, how they differ, and questions to check yourself.'
    : 'Ask one question across up to 12 of your recordings. Each point names the recording it comes from and links to the exact passage; if the recordings don’t answer it, SparkScribe says so.';
  const back = `/across?ids=${st.ids.join(',')}${kind === 'guide' ? '&tab=guide' : ''}`;
  return `<div class="panel ax-locked" role="region" aria-label="Included with Thunder">
    <span class="ax-locked-badge mono">Thunder</span>
    <h2>${kind === 'guide' ? 'Combined study guides' : 'Ask across recordings'}</h2>
    <p>${what}</p>
    <p class="ax-fine">Included with Thunder${st.plan?.planName ? `. You’re on ${esc(st.plan.planName)}` : ''}. Your selection is kept, and everything you’ve saved stays available on every plan.</p>
    <div class="ax-empty-actions"><a class="btn btn-primary" href="/pricing?plan=thunder&next=${encodeURIComponent(back)}">See Thunder</a><a class="btn btn-ghost" href="/library">Back to My Library</a></div>
  </div>`;
}

// ---------- Ask ----------
const SUGGEST = {
  study: ['Which concepts came up in more than one of these?', 'What changed between the first and the last recording?', 'Summarize what I need to know for an exam on these.'],
  work: ['What decisions were made across these meetings?', 'Which action items came up more than once?', 'Where did people disagree, and how was it resolved?'],
};
function qaHtml(qa) {
  const c = qa.content;
  return `<article class="panel ax-qa${qa.unsaved ? ' unsaved' : ''}" data-item="${esc(qa.id)}"><p class="ax-q">${esc(qa.question)}</p>
    <div class="ax-a">${richAnswer(c.answer, c.refs || [], qa)}</div>
    ${staleNote(qa)}
    ${sourcesHtml(c.refs || [], qa)}
    ${qa.unsaved ? '<p class="ax-stale" role="note">This answer couldn’t be saved to your account, so it will be gone when you leave this page.</p>' : ''}
    <p class="ax-meta mono">${esc(`${qa.recordings.length} recordings · ${when(qa.createdAt)}`)}${qa.unsaved ? '' : `<button class="ax-del" type="button" data-del="${esc(qa.id)}" aria-label="Delete this answer">Delete</button>`}</p></article>`;
}
function renderAsk() {
  const p = $('askPanel');
  const recs = ordered();
  if (recs.length < MIN) {
    p.innerHTML = `<div class="panel ax-empty"><h2>Choose recordings to ask about</h2><p>Select at least two recordings. You can add them here, or select them in My Library and choose <b>Ask across</b>.${st.history?.length ? ' Or reopen something you saved: it’s listed on the left.' : ''}</p>
      <div class="ax-empty-actions"><button class="btn btn-primary" type="button" data-act="open-add">Add recordings</button><a class="btn btn-ghost" href="/library">Open My Library</a></div></div>`;
    return;
  }
  const work = recs.filter((r) => ['meeting', 'interview', 'voice_message'].includes(r.recording_type)).length > recs.length / 2;
  const pend = st.pending;
  const busy = st.asking;
  const form = st.plan && !can('across_ask') ? lockedHtml('ask') : `<form class="panel ax-ask" id="askForm" novalidate>
      <label class="ax-ask-label" for="askQ">Ask about these ${recs.length} recordings</label>
      <div class="ax-ask-row"><textarea id="askQ" maxlength="500" rows="2" placeholder="${work ? 'e.g. What decisions changed between these meetings?' : 'e.g. How did the explanation of this topic change between lectures?'}"${busy ? ' disabled' : ''}></textarea>
      <button class="btn btn-primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Answering…' : 'Ask'}</button></div>
      <div class="ax-suggest" role="group" aria-label="Suggestions">${(work ? SUGGEST.work : SUGGEST.study).map((s) => `<button class="chip-btn" type="button" data-suggest="${esc(s)}"${busy ? ' disabled' : ''}>${esc(s)}</button>`).join('')}</div>
      <p class="ax-fine">Answers use your saved transcripts (never audio), cite the passages they come from, and are saved to your account. Each question uses a small amount of your AI allowance.</p>
    </form>`;
  p.innerHTML = `${form}
    ${st.askErr ? `<div class="ins-msg warn ax-err" role="alert"><span>${esc(st.askErr)}</span>${st.askPlan ? `<a class="btn btn-ghost btn-sm" href="/pricing?plan=${esc(st.askPlan)}">See plans</a>` : ''}</div>` : ''}
    ${st.loadErr ? `<div class="ins-msg warn ax-err" role="alert"><span>${esc(st.loadErr)}</span><button class="btn btn-ghost btn-sm" type="button" data-act="reload">Try again</button></div>` : ''}
    <div class="ax-thread" aria-live="polite" aria-busy="${st.loading}">
      ${pend ? `<article class="panel ax-qa pending"><p class="ax-q">${esc(pend.question)}</p>
        <div class="ax-a" aria-busy="true">${pend.text ? `<p>${esc(renderAcrossStreaming(pend.text, pend.names).replace(CITE, '').replace(/\[R?\d*:?\d*$/, ''))}</p>` : `<p class="ax-status"><span class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></span>${esc(pend.status)}</p>`}</div></article>` : ''}
      ${st.loading && !st.items.length ? '<p class="ax-status" role="status"><span class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></span>Loading your saved answers…</p>' : ''}
      ${asks().map(qaHtml).join('')}
    </div>`;
}

// recordings with no summary yet are read once first (each summary is saved with its recording, as on its own page)
async function prepareSummaries() {
  const key = [...st.ids].sort().join(',');
  if (st.prepared.has(key)) return;
  const s = await acrossStatus(st.ids);
  const todo = s.recordings.filter((r) => !r.hasSummary);
  for (const [i, r] of todo.entries()) {
    if (st.pending) { st.pending.status = `Reading ${todo.length === 1 ? `“${r.title}”` : `recordings for the first time (${i + 1} of ${todo.length})`}…`; renderAsk(); }
    try { await requestInsight(r.id, 'overview', 'general'); } catch { /* the answer can still use its passages */ }
  }
  st.prepared.add(key);
}

const namesFns = (n) => ({ title: (l) => n?.titles?.[l], speaker: (c) => n?.speakers?.[c] });
async function ask(question) {
  question = String(question || '').trim();
  if (!question || st.asking) return;
  st.asking = true; st.askErr = null; st.askPlan = null;
  const requestId = newId(); // a retried request is stored once
  st.pending = { question, text: '', status: 'Finding the relevant passages…', names: namesFns(null) };
  renderAsk();
  try {
    await prepareSummaries();
    st.pending.status = 'Finding the relevant passages…';
    renderAsk();
    const r = await askAcross(st.ids, question, requestId, {
      onNames: (n) => { if (st.pending) st.pending.names = namesFns(n); },
      onStatus: (s) => { if (st.pending) { st.pending.status = s === 'answering' ? 'Writing the answer…' : 'Finding the relevant passages…'; renderAsk(); } },
      onDelta: (t) => { if (st.pending) { st.pending.text += t; renderAsk(); } },
    });
    st.items = [{ ...r.item, unsaved: !r.saved }, ...st.items.filter((x) => x.id !== r.item.id)];
    if (!r.saved) toast(r.saveError === 'full' ? 'Your saved answers are full (500). Delete older ones to keep new answers.' : 'This answer couldn’t be saved to your account.', 5000);
    loadHistory();
  } catch (err) {
    if (err.code === 'not_found' && err.details?.missing?.length) {
      st.askErr = err.message;
      await setIds(st.ids.filter((id) => !err.details.missing.includes(id)), { quiet: true });
    } else {
      st.askErr = err.message || "The answer couldn't be generated. Try again.";
      if (err.code === 'plan_required') { st.askPlan = err.details?.plan || 'thunder'; st.plan = await myPlan(); }
    }
  }
  st.asking = false;
  st.pending = null;
  render();
  if (!st.askErr) $('askQ')?.focus();
}

// ---------- Combined study guide ----------
function guideItemSources(sources, item) {
  return sources.length ? `<span class="ax-cites">${sources.map((s) => chipFor(s, item)).join('')}</span>` : '';
}
function guideHtml(g) {
  const c = g.content, recs = g.recordings;
  const recBadge = (label) => { const i = recs.findIndex((r) => r.label === label); return `<span class="ax-rb mono" title="${esc(recs[i]?.title || '')}">${i + 1}</span>`; };
  return `<article class="panel ax-guide" aria-labelledby="gH" data-item="${esc(g.id)}">
    <header class="ax-guide-head"><h2 id="gH">Combined study guide</h2>
      <p class="ax-meta mono">${esc(`${recs.length} recordings · ${c.themes.length} themes${c.recurring ? ` · ${c.recurring} across several recordings` : ''}${c.focus === 'exam' ? ' · exam review' : ''} · ${new Date(g.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)}</p></header>
    ${staleNote(g)}
    ${g.unsaved ? '<p class="ax-stale" role="note">This guide couldn’t be saved to your account, so it will be gone when you leave this page. Copy it to keep it.</p>' : ''}
    ${c.overview ? `<p class="ax-overview">${esc(c.overview)}</p>` : ''}
    <ol class="ax-key" aria-label="Recordings">${recs.map((r, i) => `<li${r.status === 'deleted' ? ' class="gone"' : ''}><span class="ax-rb mono" aria-hidden="true">${i + 1}</span>${esc(r.title)}${r.status === 'deleted' ? ' <span class="ax-gone">deleted</span>' : ''}</li>`).join('')}</ol>
    <section aria-labelledby="gThemes"><h3 id="gThemes">Themes</h3>
      ${c.themes.map((t) => `<div class="ax-theme"><div class="ax-theme-head"><h4>${esc(t.title)}</h4><span class="ax-in" aria-label="In recordings ${t.recordings.map((l) => numberOf(g, l)).join(', ')}">${t.recordings.map(recBadge).join('')}${t.recordings.length >= 2 ? '<span class="ax-recurs">recurring</span>' : ''}</span></div>
        <p>${esc(t.summary)}</p>${t.comparison ? `<p class="ax-compare"><b>How the recordings differ:</b> ${esc(t.comparison)}</p>` : ''}${guideItemSources(t.sources, g)}</div>`).join('')}
    </section>
    ${c.definitions.length ? `<section aria-labelledby="gDefs"><h3 id="gDefs">Definitions</h3><dl class="ax-defs">${c.definitions.map((d) => `<div><dt>${esc(d.term)}</dt><dd>${esc(d.definition)} ${guideItemSources(d.sources, g)}</dd></div>`).join('')}</dl></section>` : ''}
    ${c.distinctions.length ? `<section aria-labelledby="gDist"><h3 id="gDist">Don’t confuse</h3><ul class="ax-list">${c.distinctions.map((d) => `<li>${esc(d.text)} ${guideItemSources(d.sources, g)}</li>`).join('')}</ul></section>` : ''}
    ${c.self_check.length ? `<section aria-labelledby="gCheck"><h3 id="gCheck">Check yourself</h3>${c.self_check.map((q) => `<details class="ax-check"><summary>${esc(q.question)}</summary><p>${esc(q.answer)} ${guideItemSources(q.sources, g)}</p></details>`).join('')}</section>` : ''}
    <div class="ax-guide-tools"><button class="btn btn-ghost btn-sm" type="button" data-act="guide-copy">Copy</button>${can('across_guide') ? '<button class="btn btn-ghost btn-sm" type="button" data-act="guide-new">Create again</button>' : ''}${g.unsaved ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-del="${esc(g.id)}">Delete</button>`}</div>
  </article>`;
}
function renderGuide() {
  const p = $('guidePanel');
  const recs = ordered();
  if (recs.length < MIN) { p.innerHTML = '<div class="panel ax-empty"><h2>Choose recordings first</h2><p>A combined study guide needs at least two recordings.</p><div class="ax-empty-actions"><button class="btn btn-primary" type="button" data-act="open-add">Add recordings</button></div></div>'; return; }
  const g = guide();
  const locked = st.plan && !can('across_guide');
  if (recs.length > GUIDE_MAX && !g) { p.innerHTML = `<div class="panel ax-empty"><h2>Too many for one study guide</h2><p>A combined study guide works with up to ${GUIDE_MAX} recordings. Remove ${recs.length - GUIDE_MAX} to continue.</p></div>`; return; }
  const busy = st.guideBusy;
  const showSetup = !locked && (!g || st.guideOpen || busy);
  const intro = `<div class="panel ax-guide-setup">
      <p class="ax-lede2">One study guide for all ${recs.length} recordings: the themes they share, where each was taught, definitions, distinctions and questions to check yourself.</p>
      <div class="seg-toggle" role="group" aria-label="Focus">${[['balanced', 'Balanced'], ['exam', 'Exam review']].map(([v, l]) => `<button type="button" data-focus="${v}" class="${st.focus === v ? 'on' : ''}" aria-pressed="${st.focus === v}"${busy ? ' disabled' : ''}>${l}</button>`).join('')}</div>
      ${busy ? `<p class="ax-status" role="status"><span class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></span>${esc(busy)}</p>` : `<button class="btn btn-primary" type="button" data-act="guide">${g ? 'Create a new version' : 'Create combined study guide'}</button>`}
      <p class="ax-fine">Built from each recording’s study map. Recordings without one get their own study guide first (saved with the recording, as if you had made it there). The guide is saved to your account.</p>
    </div>`;
  p.innerHTML = `${st.guideErr ? `<div class="ins-msg warn ax-err" role="alert"><span>${esc(st.guideErr)}</span></div>` : ''}${locked && !g ? lockedHtml('guide') : ''}${showSetup ? intro : ''}${g && !busy ? guideHtml(g) : ''}${locked && g ? `<p class="ax-fine ax-locked-line">Making new combined guides is included with Thunder. <a href="/pricing?plan=thunder">See Thunder</a></p>` : ''}`;
}
async function makeGuide() {
  if (st.guideBusy) return;
  st.guideErr = null;
  st.guideBusy = 'Checking the recordings…';
  renderGuide();
  const requestId = newId();
  try {
    let r = null;
    for (let round = 0; round < 2 && !r; round++) {
      try { r = await acrossGuide(st.ids, st.focus, requestId); } catch (err) {
        if (err.code !== 'needs_maps' || round) throw err;
        const needs = err.details?.needs || [];
        for (const [i, id] of needs.entries()) {
          st.guideBusy = `Making a study map for “${st.meta.get(id)?.title || 'a recording'}” (${i + 1} of ${needs.length})…`;
          renderGuide();
          const t = await requestTool(id, 'study_guide', {});
          // another tab is already making it: wait for it rather than paying twice
          for (let k = 0; t.artifact?.status === 'generating' && k < 30; k++) { await new Promise((ok) => setTimeout(ok, 4000)); try { const again = await requestTool(id, 'study_guide', {}); if (again.artifact?.status !== 'generating') break; } catch { break; } }
        }
        st.guideBusy = 'Combining the recordings…';
        renderGuide();
      }
    }
    st.items = [{ ...r.item, unsaved: !r.saved }, ...st.items.filter((x) => x.id !== r.item.id)];
    st.guideOpen = false;
    if (!r.saved) toast('This guide couldn’t be saved to your account. Copy it to keep it.', 5000);
    loadHistory();
  } catch (err) {
    if (err.code === 'not_found' && err.details?.missing?.length) await setIds(st.ids.filter((id) => !err.details.missing.includes(id)), { quiet: true });
    st.guideErr = err.message || "The combined study guide couldn't be made. Try again.";
    if (err.code === 'plan_required') st.plan = await myPlan();
  }
  st.guideBusy = null;
  renderGuide();
}
function guideText(g) {
  const c = g.content, recs = g.recordings;
  const src = (s) => s.map((x) => `${x.title} ${fmtClock(x.start)}`).join('; ');
  return [`Combined study guide (${recs.map((r) => r.title).join(', ')})`, '', c.overview, '',
    'THEMES', ...c.themes.flatMap((t) => [`- ${t.title}: ${t.summary}${t.comparison ? ` (How they differ: ${t.comparison})` : ''} [${src(t.sources)}]`]), '',
    ...(c.definitions.length ? ['DEFINITIONS', ...c.definitions.map((d) => `- ${d.term}: ${d.definition} [${src(d.sources)}]`), ''] : []),
    ...(c.distinctions.length ? ["DON'T CONFUSE", ...c.distinctions.map((d) => `- ${d.text} [${src(d.sources)}]`), ''] : []),
    ...(c.self_check.length ? ['CHECK YOURSELF', ...c.self_check.map((q) => `- Q: ${q.question}\n  A: ${q.answer}`)] : [])].join('\n');
}

async function remove(id) {
  const item = st.items.find((x) => x.id === id);
  if (!item || !confirm(item.kind === 'guide' ? 'Delete this combined study guide from your account?' : 'Delete this answer from your account?')) return;
  try {
    await acrossDelete(id);
  } catch (err) {
    if (err.status !== 404) { toast(err.message || 'It couldn’t be deleted. Try again.', 4000); return; }
  }
  st.items = st.items.filter((x) => x.id !== id);
  render();
  loadHistory();
  toast('Deleted');
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
  document.querySelectorAll('.ax-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; writeUrl(); render(); }));
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
  $('histList').addEventListener('click', (e) => { const b = e.target.closest('[data-set]'); if (b) { st.tab = 'ask'; setIds(b.dataset.set.split(',')); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  document.querySelector('.ax-main').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'open-add') { st.add.open = true; render(); loadAddRows(); $('addQ').focus(); }
    else if (b.dataset.suggest) { const q = $('askQ'); if (q) q.value = b.dataset.suggest; ask(b.dataset.suggest); }
    else if (b.dataset.del) remove(b.dataset.del);
    else if (b.dataset.focus) { st.focus = b.dataset.focus; renderGuide(); }
    else if (b.dataset.act === 'guide') makeGuide();
    else if (b.dataset.act === 'guide-new') { st.guideOpen = true; renderGuide(); }
    else if (b.dataset.act === 'reload') loadThread();
    else if (b.dataset.act === 'guide-copy') navigator.clipboard.writeText(guideText(guide())).then(() => toast('Copied the study guide'), () => toast('Copy failed'));
  });
  document.querySelector('.ax-main').addEventListener('submit', (e) => { if (e.target.id === 'askForm') { e.preventDefault(); ask($('askQ').value); } });
  document.querySelector('.ax-main').addEventListener('keydown', (e) => {
    if (e.target.id === 'askQ' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); }
  });
  // another device may have added or deleted something: the server's copy wins whenever this tab comes back
  let last = Date.now();
  const resync = () => {
    if (document.visibilityState !== 'visible' || st.asking || st.guideBusy || Date.now() - last < 5000) return;
    last = Date.now();
    loadThread({ quiet: true });
    loadHistory();
  };
  document.addEventListener('visibilitychange', resync);
  window.addEventListener('focus', resync);
  window.addEventListener('online', () => { last = 0; resync(); });
}

async function main() {
  if (isConfigured) mountAccountMenu($('accountSlot'));
  st.user = await requireUser();
  readUrl();
  if (new URLSearchParams(location.search).get('tab') === 'guide') st.tab = 'guide';
  bind();
  // unknown plan (status unavailable): the forms stay, and the server's answer decides
  myPlan().then((p) => { st.plan = p; render(); });
  loadHistory();
  await setIds(st.ids);
}
main();
