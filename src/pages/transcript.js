// /transcript?id=…[&t=seconds&line=n] — one saved transcript, with Summary / Notes / Ask / Insights, rename,
// favorite, folders, copy / download / delete. t/line (from Library search) open it at that moment.
import { isConfigured } from '../lib/supabase.js';
import { mountAccountMenu, requireUser, esc } from '../lib/account.js';
import { mountMascot } from '../mascot/mascot.js';
import { mascotSignal } from '../mascot/bus.js';
import { getTranscript, updateRecordingType, updateTranscriptText, fmtDuration, fmtDate, langName } from '../lib/transcripts.js';
import { nameMapFromSegments } from '../lib/speaker-names.js';
import { renameTranscript, setFavorite, deleteTranscripts, markOpened, getRecordingMeta, listFolders } from '../lib/library.js';
import { promptDialog, confirmDialog, confirmDeleteRecordings, folderPicker, toast } from '../library/dialogs.js';
import { segmentsFromRow, segmentsToStored, fmtClock, RECORDING_TYPES, RECORDING_TYPE_LABEL } from '../lib/segments.js';
import { toggleDetails } from '../lib/details-pop.js';
import { relatedMaterialHtml, bindRelatedMaterial } from '../lib/related-material.js';
import { cleanText } from '../lib/clean.js';
import { getAudio, putAudio, putEnvelope, keepAudioPref } from '../lib/audio-store.js';
import { envelopeFromSamples, paragraphStart, paragraphIndexAt, splitSentences } from '../lib/breath.js';
import { createSentenceTiming } from '../lib/sentence-timing.js';
import { mountInsights } from '../insights/insights.js';
import { mountTransport } from '../electric/transport.js';
import { courseTone } from '../lib/course-tone.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#a3e635', '#fbbf24', '#fb7185', '#34d399', '#60a5fa', '#fb923c', '#e879f9'];
const UNKNOWN_COLOR = '#8a93b9';
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const RTL_LANGS = new Set(['ar', 'fa', 'ur', 'he', 'yi', 'ps', 'sd', 'ug']);
const params = new URLSearchParams(location.search);
const id = params.get('id') || '';
const startAt = Number.isFinite(parseFloat(params.get('t'))) ? Math.max(0, parseFloat(params.get('t'))) : null;
const startLine = /^\d+$/.test(params.get('line') || '') ? Number(params.get('line')) : null;

function notFound(message) {
  $('tTitle').textContent = 'Transcript not found';
  $('tMeta').innerHTML = '';
  $('viewToggle').classList.add('hidden');
  $('transcript').innerHTML = `<div class="empty">${esc(message)}<br><br><a class="btn btn-primary" href="/library">Back to My Library</a></div>`;
}

function initials(name) {
  if (name === 'Unknown') return '?';
  const m = /^speaker\s*(\d+)$/i.exec(name.trim());
  if (m) return 'S' + m[1];
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
}

(async () => {
  if (!isConfigured) return location.replace('/auth');
  await requireUser();
  mountAccountMenu($('accountSlot'));
  mountMascot({ page: 'transcript' });

  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound("That link doesn't point to a transcript.");

  let row;
  try {
    row = await getTranscript(id);
  } catch (err) {
    return notFound(`Couldn't load it: ${err.message || err}`);
  }
  // RLS returns nothing for other people's transcripts, so "not yours" looks exactly like "doesn't exist".
  if (!row) return notFound("It may have been deleted, or it belongs to a different account.");

  const showTitle = () => {
    document.title = `${row.title} — SparkScribe`;
    $('tTitle').textContent = row.title;
    $('tTitle').title = row.title;
  };
  showTitle();
  markOpened(row.id); // for the Library's "Recent" view

  const { segments, coarse } = segmentsFromRow(row);
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  // a speaker keeps the same color everywhere for the whole recording (renames carry it along)
  const colorOf = new Map();
  let n = 0;
  for (const s of speakers) colorOf.set(s, s === 'Unknown' ? UNKNOWN_COLOR : COLORS[n++ % COLORS.length]);
  const nextColor = () => COLORS.find((c) => ![...colorOf.values()].includes(c)) || COLORS[colorOf.size % COLORS.length];
  let recordingType = RECORDING_TYPES.includes(row.recording_type) ? row.recording_type : null;
  const words = segments.reduce((t, s) => t + s.text.split(/\s+/).filter(Boolean).length, 0);

  let uiRef = null; // the study panels (set once mounted below); the header redraws their type control
  function renderHeader() {
    // one line: length · speakers · type, and Details for the rest
    const real = new Set(segments.map((x) => x.speaker).filter((x) => x !== 'Unknown')).size;
    const primary = [fmtDuration(row.duration_seconds), segments.length && `${real} speaker${real === 1 ? '' : 's'}`, fmtDate(row.created_at)].filter(Boolean);
    $('tMeta').innerHTML = primary.map((v) => `<span class="ws-meta-item">${esc(v)}</span>`).join('')
      + '<span class="type-slot" id="typeSlot"></span>'
      + '<button type="button" class="meta-btn details-btn" id="detailsBtn" aria-expanded="false" aria-haspopup="dialog">Details</button>';
    uiRef?.refreshType(); // the type control lives in this line: redraw it (it was wiped with the line)
    $('detailsBtn').addEventListener('click', (e) => toggleDetails(e.currentTarget, 'Recording details', [
      ['Length', fmtDuration(row.duration_seconds)],
      segments.length && ['Speakers', String(real), segments.some((x) => x.speaker === 'Unknown') ? 'plus some unclear parts' : ''],
      ['Recording type', RECORDING_TYPE_LABEL[recordingType] || (document.getElementById('typeSlot')?.innerText.replace(/^Type\s*/i, '').replace(/\s+/g, ' ').trim() || 'Auto')],
      row.language && ['Language', langName(row.language)],
      ['Words', words.toLocaleString()],
      ['Saved', fmtDate(row.created_at)],
      ['Audio', audioSource ? 'On this device' : 'Not on this device', audioSource ? 'never uploaded; used only to play along' : 'attach the original file to play along'],
    ]));
  }
  renderHeader();
  $('relatedResult').innerHTML = relatedMaterialHtml('result');
  bindRelatedMaterial($('relatedResult'));

  // ---- transcript (Original / Clean) ----
  const rtl = RTL_LANGS.has(row.language);
  let view = 'original';
  const text = (s) => (view === 'clean' ? cleanText(s.text) : s.text);
  // each sentence is its own click target (lib/sentence-timing.js says where it starts)
  const sentencesHtml = (t) => splitSentences(t).map((p, k) => `<span class="snt" data-k="${k}">${esc(p.text)}</span>`).join('');
  function renderTranscript() {
    if (!segments.length) {
      // not in the usual format: show it as plain text
      $('viewToggle').classList.add('hidden');
      $('transcript').innerHTML = `<pre class="plain-transcript">${esc(row.transcript_text || '(empty)')}</pre>`;
      return;
    }
    const groups = [];
    for (const s of segments) {
      const g = groups[groups.length - 1];
      if (g && g.speaker === s.speaker) g.items.push(s);
      else groups.push({ speaker: s.speaker, items: [s] });
    }
    $('transcript').innerHTML = groups.map((g) => `
      <div class="grp" style="--c:${colorOf.get(g.speaker)}"${rtl ? ' dir="rtl"' : ''}>
        <div class="avatar">${esc(initials(g.speaker))}</div>
        <div class="grp-body">
          <div class="grp-head">${coarse ? `<span class="who static">${esc(g.speaker)}</span>` : `<button class="who" type="button" data-g="${g.items[0].id}" aria-haspopup="menu" title="Change or rename this speaker"><span class="who-name">${esc(g.speaker)}</span>${CHEVRON}</button>`}<span class="grp-time">${fmtClock(g.items[0].start)}</span></div>
          ${g.items.map((s) => `<p class="seg${player.getAttribute('src') ? '' : ' static'}" data-i="${s.id}" title="${fmtClock(s.start)}">${sentencesHtml(text(s))}</p>`).join('')}
        </div>
      </div>`).join('');
  }
  $('viewToggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    $('viewToggle').querySelectorAll('[data-view]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    renderTranscript();
  });

  // ---- play along: the original recording, kept on this device when it was transcribed (lib/audio-store.js) ----
  // It is never uploaded. If this device doesn't have it (another device, a cleared browser, an older save), the
  // user can attach the original file; it is then kept here for next time. Clicking a line plays from there.
  const player = $('attachPlayer');
  let audioSource = null; // 'stored' (on this device) | 'attached' (this visit only) | null
  let env = null; // loudness envelope of the open audio (lib/breath.js): links start in the pause before the words
  let pinned = null; // the clicked paragraph stays highlighted through the short lead-in
  let audioBlob = null;
  const timing = createSentenceTiming({ getSegs: () => segments, getEnv: () => env, getBlob: () => audioBlob });
  let following = true;
  let lastUserScroll = 0;
  player.addEventListener('play', () => mascotSignal('audio-play'));
  player.addEventListener('pause', () => mascotSignal('audio-pause'));
  player.addEventListener('error', () => { if (player.getAttribute('src')) toast("This audio couldn't be played in this browser. The transcript is still here.", 6000); });
  function paintAudioButton() {
    const b = $('audioBtn');
    b.hidden = false;
    const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    const CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.7 1.7 0 0 1-2.4-2.4L15 7.1"/></svg>';
    b.classList.toggle('btn-primary', !!audioSource);
    if (!audioSource) {
      b.innerHTML = `${CLIP}<span>Attach audio</span>`;
      b.title = 'Play along: choose the original recording from this device. It is not uploaded, and it is kept on this device for next time.';
    } else {
      b.innerHTML = `${PLAY}<span>Play</span>`;
      b.title = $('attachBar').classList.contains('hidden')
        ? (audioSource === 'stored' ? 'The original recording is on this device (never uploaded)' : 'Play the attached recording')
        : 'Play from here, or click any line of the transcript';
    }
  }
  function openAudio(blob, source, knownEnv = null) {
    if (player.src) URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(blob);
    audioSource = source;
    audioBlob = blob;
    env = knownEnv;
    // audio kept before envelopes existed: make it once, when the page is idle, and keep it with the audio
    if (!env) {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
      idle(async () => {
        const d = await timing.ensureDecoded();
        if (!d || audioBlob !== blob) return;
        env = envelopeFromSamples(d.pcm, d.rate, 1 / 32768);
        if (audioSource === 'stored') putEnvelope(row.id, env);
      });
    }
    if (startAt != null && !player.dataset.started) { player.dataset.started = '1'; player.currentTime = startAt; }
    $('attachBar').classList.remove('hidden');
    document.body.classList.add('has-attach');
    paintAudioButton();
    renderTranscript();
  }
  $('audioBtn').addEventListener('click', () => {
    if (!audioSource) return $('attachInput').click();
    if ($('attachBar').classList.contains('hidden')) { $('attachBar').classList.remove('hidden'); document.body.classList.add('has-attach'); paintAudioButton(); renderTranscript(); }
    player.play().catch(() => {});
    player.focus();
  });
  $('attachInput').addEventListener('change', () => {
    const f = $('attachInput').files[0];
    $('attachInput').value = '';
    if (!f) return;
    openAudio(f, 'attached');
    player.addEventListener('loadedmetadata', async function once() {
      player.removeEventListener('loadedmetadata', once);
      // the wrong file would not line up with the transcript: say so instead of keeping it
      const d = player.duration, expected = Number(row.duration_seconds) || 0;
      if (Number.isFinite(d) && expected && Math.abs(d - expected) > Math.max(3, expected * 0.03)) {
        toast(`This file is ${fmtDuration(d)} long, but this recording is ${fmtDuration(expected)}, so the timestamps won't line up.`, 8000);
        return;
      }
      if (keepAudioPref() && (await putAudio(row.id, f, env))) { audioSource = 'stored'; paintAudioButton(); renderHeader(); toast('Audio kept on this device, so it plays along next time too.'); }
    });
  });
  $('attachClose').addEventListener('click', () => {
    player.pause();
    $('attachBar').classList.add('hidden');
    document.body.classList.remove('has-attach');
    paintAudioButton();
    renderTranscript();
    $('audioBtn').focus();
  });
  mountTransport($('attachBar'), player, { duration: () => row.duration_seconds });
  $('attachFollow').addEventListener('click', () => {
    following = !following;
    $('attachFollow').classList.toggle('on', following);
    $('attachFollow').setAttribute('aria-pressed', String(following));
    if (following) { lastUserScroll = 0; showActiveLine(true); }
  });
  // scrolling by hand pauses auto-follow for a few seconds (a scroll the page made itself doesn't count)
  for (const ev of ['wheel', 'touchmove']) window.addEventListener(ev, () => { lastUserScroll = performance.now(); }, { passive: true });
  window.addEventListener('keydown', (e) => { if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(e.key) && !player.contains(e.target)) lastUserScroll = performance.now(); });
  $('transcript').addEventListener('click', (e) => {
    const who = e.target.closest('.who[data-g]');
    if (who) { openSpeakerMenu(who, Number(who.dataset.g)); return; }
    const p = e.target.closest('.seg');
    if (!p || !player.getAttribute('src') || window.getSelection()?.toString()) return;
    const sn = e.target.closest('.snt');
    playParagraph(Number(p.dataset.i), sn ? Number(sn.dataset.k) : 0, sn);
  });
  // a paragraph (k = 0) or one of its sentences: starts in the breath just before the words
  function playParagraph(i, k = 0, sentenceEl = null) {
    const s = segments[i];
    if (!s) return;
    timing.activate();
    const t = k > 0 ? timing.startOf(i, k, text(s)) : paragraphStart(segments, i, env);
    pinned = { id: s.id, from: t - 0.1, until: Math.max(s.start, t) + 1 };
    player.currentTime = t;
    player.play().catch(() => {});
    if (sentenceEl) { sentenceEl.classList.remove('snt-on'); void sentenceEl.offsetWidth; sentenceEl.classList.add('snt-on'); setTimeout(() => sentenceEl.classList.remove('snt-on'), 1900); }
  }
  player.addEventListener('play', () => timing.activate());
  timing.observe($('transcript'));
  player.addEventListener('seeking', () => { if (pinned && (player.currentTime < pinned.from || player.currentTime >= pinned.until)) pinned = null; });
  let lastActive = null;
  function showActiveLine(force) {
    const t = player.currentTime;
    let cur = null;
    for (const s of segments) { if (s.start <= t + 0.05) cur = s; else break; }
    if (pinned && t >= pinned.from && t < pinned.until) cur = segments.find((s) => s.id === pinned.id) || cur;
    const el = cur && $('transcript').querySelector(`.seg[data-i="${cur.id}"]`);
    if (el !== lastActive) {
      lastActive?.classList.remove('active');
      el?.classList.add('active');
      lastActive = el;
    } else if (!force) return;
    if (el && following && (force || (!player.paused && performance.now() - lastUserScroll > 4000))) {
      const r = el.getBoundingClientRect();
      if (force || r.top < 80 || r.bottom > innerHeight - 120) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  player.addEventListener('timeupdate', () => showActiveLine(false));

  // Timestamps in Summary / Notes / Ask / Insights: play from there if the audio is open, otherwise show the line.
  // `instant` (opening a link into the recording) positions without starting playback.
  function seekTo(seconds, ref, { instant = false } = {}) {
    if (player.getAttribute('src')) {
      const i = ref != null && segments[ref]?.id === Number(ref) ? Number(ref) : paragraphIndexAt(segments, seconds);
      if (!instant && i >= 0) { playParagraph(i); return; }
      player.currentTime = i >= 0 ? paragraphStart(segments, i, env) : seconds;
      if (!instant) { player.play().catch(() => {}); return; }
    }
    ui.showTab('transcript');
    const el = $('transcript').querySelector(`.seg[data-i="${ref}"]`) || [...$('transcript').querySelectorAll('.seg')].find((p) => segments[Number(p.dataset.i)].start >= seconds);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: instant ? 'auto' : 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ---- speakers: rename everywhere, or say who really said a paragraph ----
  // Changes are saved to the recording (transcript words are never touched). The database then bumps the
  // recording's version, so results made before show "out of date"; a plain rename also shows the new name
  // inside those results right away (lib/speaker-names.js).
  const groupOf = (firstId) => {
    const out = [];
    let i = segments.findIndex((s) => s.id === firstId);
    const sp = segments[i]?.speaker;
    while (i >= 0 && i < segments.length && segments[i].speaker === sp) out.push(segments[i++]);
    return out;
  };
  let menuEl = null;
  const closeMenu = () => { menuEl?.remove(); menuEl = null; document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  function openSpeakerMenu(anchor, firstId) {
    closeMenu();
    const group = groupOf(firstId);
    const cur = group[0]?.speaker;
    if (!cur) return;
    const others = [...new Set(segments.map((s) => s.speaker))].filter((s) => s !== cur && s !== 'Unknown');
    // renaming comes first: clicking a name is how people expect to change it
    const items = [...(cur !== 'Unknown' ? [{ label: 'Edit name…', run: async () => { const name = await askName(`Edit name: ${cur}`, cur); if (name && name !== cur) rename(cur, name); } }, 'hr'] : []),
      { title: 'This part was said by' }, ...others.map((s) => ({ label: s, color: colorOf.get(s), run: () => move(group, s) })),
      { label: 'Someone new…', color: nextColor(), run: async () => { const name = await askName('Who said this?', ''); if (name) move(group, name); } }];
    if (cur !== 'Unknown') items.push({ label: 'Unknown', color: UNKNOWN_COLOR, run: () => move(group, 'Unknown') });
    menuEl = document.createElement('div');
    menuEl.className = 'menu';
    menuEl.setAttribute('role', 'menu');
    for (const it of items) {
      if (it === 'hr') { menuEl.appendChild(document.createElement('hr')); continue; }
      if (it.title) { const t = document.createElement('div'); t.className = 'menu-title'; t.textContent = it.title; menuEl.appendChild(t); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (it.color) b.style.setProperty('--c', it.color);
      b.innerHTML = `${it.color ? '<span class="sw"></span>' : ''}<span>${esc(it.label)}</span>`;
      b.addEventListener('click', () => { closeMenu(); it.run(); });
      menuEl.appendChild(b);
    }
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    menuEl.style.position = 'fixed';
    menuEl.style.left = `${Math.max(12, Math.min(r.left, innerWidth - menuEl.offsetWidth - 12))}px`;
    menuEl.style.top = `${r.bottom + 6 + menuEl.offsetHeight > innerHeight - 12 ? Math.max(12, r.top - menuEl.offsetHeight - 6) : r.bottom + 6}px`;
    menuEl.querySelector('button')?.focus({ preventScroll: true });
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }
  const askName = (title, value) => promptDialog({ title, label: 'Name', value, submit: (v) => v.trim().slice(0, 60) });
  // the label a line's speaker had originally: moved lines take the target speaker's, so Ask attributes them to
  // the person they were moved to; someone new gets a fresh "Speaker N" no line has used
  function origFor(to) {
    if (to === 'Unknown') return 'Unknown';
    const counts = new Map();
    for (const s of segments) if (s.speaker === to && s.orig) counts.set(s.orig, (counts.get(s.orig) || 0) + 1);
    if (counts.size) return [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const used = segments.map((s) => /^speaker (\d+)$/i.exec(s.orig || s.speaker)).filter(Boolean).map((m) => Number(m[1]));
    return `Speaker ${Math.max(0, ...used) + 1}`;
  }
  function move(group, to) {
    if (!colorOf.has(to)) colorOf.set(to, to === 'Unknown' ? UNKNOWN_COLOR : nextColor());
    const orig = origFor(to);
    for (const s of group) { s.orig = orig; s.speaker = to; }
    afterSpeakerChange(`Moved to ${to}`);
  }
  function rename(from, to) {
    // naming someone after an existing speaker merges the two (same color)
    if (!colorOf.has(to)) colorOf.set(to, colorOf.get(from));
    for (const s of segments) if (s.speaker === from) { s.orig ??= s.speaker; s.speaker = to; }
    afterSpeakerChange(`Renamed to ${to}`);
  }
  function savedText() {
    // the saved text keeps its first block (title / length line) and is rebuilt from the segments below it
    const names = [...new Set(segments.map((s) => s.speaker).filter((s) => s !== 'Unknown'))];
    const head = (row.transcript_text || '').split(/\r?\n\r?\n/)[0]
      .replace(/^(Length: .*?· Speakers: )(.*)$/m, (_, pre, was) => pre + (/^\d+$/.test(was.trim()) ? names.length : names.join(', ')));
    const paras = [];
    for (const s of segments) {
      const last = paras[paras.length - 1];
      if (last && last.speaker === s.speaker) last.text += ' ' + s.text;
      else paras.push({ speaker: s.speaker, start: s.start, text: s.text });
    }
    return `${head}\n\n${paras.map((g) => `[${fmtClock(g.start)}] ${g.speaker}:\n${g.text}`).join('\n\n')}\n`;
  }
  // Speaker edits are saved one at a time, always with the latest state: two quick edits whose requests finished
  // out of order used to leave the older one in the database. A failed save stays "unsaved" and is retried with the
  // next change; leaving the page warns meanwhile.
  let saveChain = Promise.resolve();
  let unsaved = false, saving = false, lastMsg = '';
  addEventListener('beforeunload', (e) => { if (unsaved || saving) { e.preventDefault(); e.returnValue = ''; } });
  function afterSpeakerChange(msg) {
    const y = scrollY;
    renderTranscript();
    renderHeader();
    ui.refreshType();
    scrollTo({ top: y });
    unsaved = true; lastMsg = msg;
    saveChain = saveChain.then(async () => {
      if (!unsaved) return; // already saved by an earlier turn of the queue with this state
      const text = savedText(), stored = segmentsToStored(segments), msgNow = lastMsg;
      unsaved = false; saving = true;
      try {
        await updateTranscriptText(row.id, text, stored);
        row.transcript_text = text;
        if (!unsaved) toast(`${msgNow} · saved`);
        ui.transcriptChanged(); // results made before now show "out of date"
      } catch (err) {
        unsaved = true;
        toast(`Couldn't save your change: ${err.message || err}. It stays on this page and is saved with your next change.`, 6000);
      } finally { saving = false; }
    });
    return saveChain;
  }

  const ui = mountInsights({
    tabBar: $('resTabs'),
    transcriptEls: [$('transcriptCard')],
    host: $('insightsHost'),
    ctx: {
      getId: () => row.id,
      isSignedIn: () => true,
      getSegments: () => segments,
      seek: seekTo,
      playbackTime: () => (player.getAttribute('src') ? player.currentTime || 0 : null),
      getRecordingType: () => recordingType,
      nameMap: () => nameMapFromSegments(segments),
      setRecordingType: async (t) => { const prev = recordingType; recordingType = t; try { await updateRecordingType(row.id, t); } catch (e) { recordingType = prev; throw e; } },
      typeSlot: () => $('typeSlot'),
      duration: () => row.duration_seconds || segments.at(-1)?.end || 0,
      autoGenerate: false, // reopening a saved transcript never starts generation by itself
      coarse,
      title: () => row.title,
      createdAt: () => row.created_at,
      toast,
      confirm: (title, text, okLabel, danger) => confirmDialog({ title, bodyHtml: `<p>${esc(text)}</p>`, confirmLabel: okLabel, danger }),
    },
  });
  uiRef = ui;
  ui.setTranscription();
  renderTranscript();
  // deep link from the study home, e.g. ?tab=create&tool=quiz to retake missed questions
  const askedTab = params.get('tab');
  const askedTool = params.get('tool');
  if (askedTab === 'create' && ['flashcards', 'quiz'].includes(askedTool)) ui.openTool(askedTool);
  else if (['summary', 'notes', 'ask', 'create'].includes(askedTab)) ui.showTab(askedTab);
  // the original audio, if this device kept it when the recording was transcribed
  const stored = segments.length ? await getAudio(row.id) : null;
  if (stored) { timing.load(stored.align, row.id); openAudio(stored.blob, 'stored', stored.env || null); }
  else timing.load(null, row.id);
  if (segments.length) { paintAudioButton(); renderHeader(); }
  if (coarse && segments.length) {
    $('transcript').insertAdjacentHTML('beforebegin', '<p class="hint coarse-note">Saved before line-level timestamps were added, so links point to the start of each paragraph.</p>');
  }
  // opened from a Library search result: jump straight to that line (or, for older saves, that paragraph)
  if (startAt != null && segments.length) {
    const byLine = !coarse && startLine != null && segments[startLine] && Math.abs(segments[startLine].start - startAt) < 1 ? segments[startLine] : null;
    const target = byLine || [...segments].reverse().find((x) => x.start <= startAt + 0.01) || segments[0];
    seekTo(target.start, target.id, { instant: true });
  }

  $('tActions').classList.remove('hidden');
  const exportText = () => {
    if (view !== 'clean' || !segments.length) return row.transcript_text;
    // same layout as the saved text, with the clean wording
    const out = [];
    for (const s of segments) {
      const last = out[out.length - 1];
      if (last && last.speaker === s.speaker) last.text += ' ' + cleanText(s.text);
      else out.push({ speaker: s.speaker, start: s.start, text: cleanText(s.text) });
    }
    const head = row.transcript_text.split(/\r?\n\r?\n/)[0];
    return `${head}\n\n${out.map((g) => `[${fmtClock(g.start)}] ${g.speaker}:\n${g.text}`).join('\n\n')}\n`;
  };
  $('copyBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(exportText()); toast(view === 'clean' ? 'Copied (clean version)' : 'Copied to clipboard'); } catch { toast('Copy failed. Try Export instead'); }
  });
  // transcript, summary, notes, insights and anything created, as PDF / Word / Markdown / text / subtitles
  $('exportBtn').addEventListener('click', () => ui.openExport(view === 'clean' ? 'transcript_clean' : 'transcript'));

  const moreMenu = $('moreMenu');
  const closeMore = () => { moreMenu.hidden = true; $('moreBtn').setAttribute('aria-expanded', 'false'); };
  $('moreBtn').addEventListener('click', () => {
    const open = moreMenu.hidden;
    moreMenu.hidden = !open;
    $('moreBtn').setAttribute('aria-expanded', String(open));
    if (open) moreMenu.querySelector('[role="menuitem"]')?.focus();
  });
  document.addEventListener('pointerdown', (e) => { if (!moreMenu.hidden && !e.target.closest('.ws-more')) closeMore(); });
  moreMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMore(); $('moreBtn').focus(); } });
  $('deleteBtn').addEventListener('click', async () => {
    closeMore();
    if (!(await confirmDeleteRecordings(1, row.title))) return;
    $('deleteBtn').disabled = true;
    $('deleteBtn').textContent = 'Deleting…';
    try {
      await deleteTranscripts(row.id);
      location.replace('/library');
    } catch (err) {
      $('deleteBtn').disabled = false;
      $('deleteBtn').textContent = 'Delete recording…';
      toast(err.message || 'Delete failed');
    }
  });

  // ---- rename / favorite / folders ----
  $('renameBtn').hidden = false;
  const renameInline = () => {
    const h = $('tTitle');
    if (h.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'ws-title-input';
    input.value = row.title;
    input.maxLength = 300;
    input.setAttribute('aria-label', 'Recording name');
    h.textContent = '';
    h.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (!save || !v || v === row.title) return showTitle();
      const before = row.title;
      row.title = v;
      showTitle();
      try { await renameTranscript(row.id, v); toast('Renamed'); } catch (err) { row.title = before; showTitle(); toast(err.message || 'Couldn’t rename. The old name is kept.'); }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  };
  $('renameBtn').addEventListener('click', renameInline);
  $('tTitle').addEventListener('dblclick', renameInline);
  let meta = { isFavorite: !!row.is_favorite, folderIds: [] };
  let folders = [];
  const renderMeta = () => {
    $('favBtn').classList.toggle('on', meta.isFavorite);
    $('favBtn').setAttribute('aria-pressed', String(meta.isFavorite));
    $('favBtn').title = meta.isFavorite ? 'Remove from favorites' : 'Add to favorites';
    $('favBtn').setAttribute('aria-label', $('favBtn').title);
    $('tFolders').innerHTML = folders.filter((f) => meta.folderIds.includes(f.id))
      .map((f) => `<a class="lib-course tone-${courseTone(f.id)}" href="/library?folder=${encodeURIComponent(f.id)}">${esc(f.name)}</a>`).join('');
  };
  const loadMeta = async () => {
    try {
      const [m, list] = await Promise.all([getRecordingMeta(row.id), listFolders()]);
      if (m) meta = m;
      folders = list;
    } catch { /* favorites and folders are extras; the transcript still works without them */ }
    renderMeta();
  };
  renderMeta();
  loadMeta();
  $('favBtn').addEventListener('click', async () => {
    meta.isFavorite = !meta.isFavorite;
    renderMeta();
    if (meta.isFavorite) { $('favBtn').classList.remove('just-on'); void $('favBtn').offsetWidth; $('favBtn').classList.add('just-on'); }
    try { await setFavorite(row.id, meta.isFavorite); toast(meta.isFavorite ? 'Added to favorites' : 'Removed from favorites'); }
    catch (err) { meta.isFavorite = !meta.isFavorite; renderMeta(); toast(err.message || 'That didn’t work'); }
  });
  $('foldersBtn').addEventListener('click', () => folderPicker({ ids: [row.id], currentIds: meta.folderIds, onChange: () => loadMeta() }));
})();

