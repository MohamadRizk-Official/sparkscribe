// Builds a local listening page (accuracy/testset/private/speaker-check-2.html) for the moments where two runs of
// the private 23:22 recording disagree: time, v1's label, the corrected engine's label, the words there (Whisper
// base, this machine), and buttons to say who is really talking. Speaker numbers follow the v1 run (the numbering
// the user already knows); the other run's labels are matched to it by shared time. Moments the user already
// answered (accuracy/testset/private/coffee-truth.json) show that answer; every other moment is marked unverified.
// Moments are grouped by review priority (see GROUPS).
//   node accuracy/diarize-review.mjs <v1-run.json> <candidate-run.json> [candidate name] [--words-from earlier-key.json]
// --words-from reuses the words of an earlier build of the same moments (no Whisper run).
// --referee <run.json>: an independent diarization of the same recording (e.g. pyannote community-1). Moments where it
// clearly sides with v1 or the candidate are settled (a fixed 1-in-4 sample is kept as spot checks of the referee);
// only the rest need listening.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const wordsFrom = argv.includes('--words-from') ? argv.splice(argv.indexOf('--words-from'), 2)[1] : null;
const refereeF = argv.includes('--referee') ? argv.splice(argv.indexOf('--referee'), 2)[1] : null;
const [aF, bF, candName = 'Corrected engine'] = argv;
const A = JSON.parse(readFileSync(aF, 'utf8')).segments;
const B = JSON.parse(readFileSync(bF, 'utf8')).segments;
const FR = 0.05, DUR = 1402.1;
const lab = (segs, t) => {
  const s = segs.filter((x) => x.start <= t && x.end > t);
  if (!s.length) return null;
  if (s.some((x) => x.overlap)) return 'OVERLAP';
  return s[0].speaker;
};
const num = { SPEAKER_00: 1, SPEAKER_01: 2, SPEAKER_02: 3 };

// B labels -> A numbers by shared time
const votes = new Map();
for (let t = 0; t < DUR; t += 0.25) {
  const a = lab(A, t), b = lab(B, t);
  if (num[a] && b && b !== 'Unknown' && b !== 'OVERLAP') votes.set(`${b}|${a}`, (votes.get(`${b}|${a}`) || 0) + 1);
}
const map = new Map();
for (const [k] of [...votes].sort((p, q) => q[1] - p[1])) {
  const [b, a] = k.split('|');
  if (!map.has(b) && ![...map.values()].includes(num[a])) map.set(b, num[a]);
}
const name = (l, side) => {
  if (l === 'OVERLAP') return 'Several people at once';
  if (l === 'Unknown' || l == null) return 'Unknown';
  return `Speaker ${side === 'a' ? num[l] : map.get(l) ?? '?'}`;
};

const rows = [];
let cur = null;
for (let t = 0; t < DUR; t += FR) {
  const la = lab(A, t), lb = lab(B, t);
  const a = name(la, 'a'), b = name(lb, 'b');
  const diff = la != null && lb != null && a !== b;
  if (diff && cur && cur.a === a && cur.b === b && t - cur.end <= 0.2) cur.end = t + FR;
  else if (diff) { cur = { start: t, end: t + FR, a, b }; rows.push(cur); }
}
const MIN_S = 0.5; // shorter disagreements are too brief to hear and judge
const list = rows.filter((r) => r.end - r.start >= MIN_S);
// the user's earlier answers (partial ground truth)
const sec = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
const truth = JSON.parse(readFileSync(resolve(ROOT, 'accuracy/testset/private/coffee-truth.json'), 'utf8')).spans.map(([s0, e0, who]) => ({ start: sec(s0), end: sec(e0), who }));
for (const r of list) {
  const t = truth.filter((x) => x.end > r.start && x.start < r.end);
  const whos = [...new Set(t.map((x) => x.who))];
  r.answer = whos.length === 1 ? `Speaker ${whos[0]}` : whos.length > 1 ? 'mixed (' + whos.map((w) => `Speaker ${w}`).join(', ') + ')' : null;
  r.verdict = !r.answer || whos.length > 1 ? null : r.b === r.answer ? 'agrees' : r.a === r.answer ? 'v1 was right' : 'neither';
}

// the words in each moment (rough, only to help find it): reused from an earlier build, or Whisper base here
const known = wordsFrom ? JSON.parse(readFileSync(wordsFrom, 'utf8')) : [];
for (const r of list) r.words = known.find((k) => Math.abs(k.start - r.start) < 0.01 && Math.abs(k.end - r.end) < 0.01)?.words ?? null;
if (list.some((r) => r.words == null)) {
  globalThis.self ??= globalThis;
  const dir = resolve(ROOT, 'node_modules/@ffmpeg/core/dist/esm');
  globalThis.location ??= { href: pathToFileURL(resolve(dir, 'ffmpeg-core.js')).href };
  const { default: cf } = await import(pathToFileURL(resolve(dir, 'ffmpeg-core.js')).href);
  const core = await cf({ wasmBinary: readFileSync(resolve(dir, 'ffmpeg-core.wasm')), locateFile: (p) => resolve(dir, p) });
  core.FS.writeFile('in.mp4', readFileSync(resolve(ROOT, 'accuracy/testset/private/coffee_qazzaz_23m.mp4')));
  core.exec('-i', 'in.mp4', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'o.raw');
  const raw = core.FS.readFile('o.raw');
  const audio = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  // same machine limits as the test runner: below-normal priority, pinned to 8 CPUs, 4 threads for Whisper
  const os = await import('node:os'); const { execFileSync } = await import('node:child_process');
  try { os.default.setPriority(0, os.default.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
  const n = os.default.cpus().length;
  if (process.platform === 'win32' && n > 8) execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${process.pid}).ProcessorAffinity = ${((1n << 8n) - 1n) << BigInt(n - 8)}`]);
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false; // the model is already on this machine; never download
  const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', { device: 'cpu', dtype: 'fp32', session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 } });
  for (const r of list) if (r.words == null) {
    const clip = audio.subarray(Math.floor(Math.max(0, r.start - 0.2) * 16000), Math.ceil((r.end + 0.2) * 16000));
    r.words = (await asr(clip, { language: 'en', task: 'transcribe' })).text.trim();
  }
}

// ---------- review priority ----------
// 1 a different named person over 1.5 s or more: one version confidently names the wrong person
// 2 overlapping speech in either version
// 3 Unknown in one version, a named person in the other
// 4 a different named person over a short stretch (< 1.5 s) right at a change of speaker (interruptions, hand-overs)
// 5 the rest: short differences inside one person's speech
const SHORT_S = 1.5;
const isPerson = (x) => /^Speaker \d$/.test(x);
const atSwitch = (r) => [[A, 'a', r.a], [B, 'b', r.b]].some(([segs, side, me]) =>
  [r.start - 0.6, r.end + 0.6].some((t) => { const l = lab(segs, t); return l != null && name(l, side) !== me; }));
for (const r of list) {
  r.group = isPerson(r.a) && isPerson(r.b) ? (r.end - r.start >= SHORT_S ? 1 : atSwitch(r) ? 4 : 5)
    : r.a.startsWith('Several') || r.b.startsWith('Several') ? 2 : 3;
  r.id = r.start.toFixed(2); // stable across rebuilds and re-orderings
}
const GROUPS = {
  1: ['Different person named (1.5 s or longer)', 'v1 and the candidate name two different people for a real stretch of speech: one of them is a confident wrong-speaker assignment.'],
  2: ['Overlapping speech', 'One version says several people talk at once. Is it really several people, or one person?'],
  3: ['Unknown vs a named person', 'One version could not tell who it is; the other names someone. Is the name right?'],
  4: ['Short interruptions and speaker switches', 'Brief stretches (under 1.5 s) right where the speaker changes: replies, interruptions, hand-overs.'],
  5: ['Other short differences', "Brief stretches inside one person's speech."],
};
// ---------- referee ----------
let refereeName = null;
if (refereeF) {
  const run = JSON.parse(readFileSync(refereeF, 'utf8'));
  refereeName = run.run?.engine || 'referee';
  const R = run.segments;
  const at = (t) => [...new Set(R.filter((x) => x.start <= t && x.end > t).map((x) => x.speaker))];
  // referee labels -> v1 numbers by shared single-speaker time
  const rv = new Map();
  for (let t = 0; t < DUR; t += 0.25) { const r = at(t), a = lab(A, t); if (r.length === 1 && num[a]) rv.set(`${r[0]}|${a}`, (rv.get(`${r[0]}|${a}`) || 0) + 1); }
  const rmap = new Map();
  for (const [k] of [...rv].sort((p, q) => q[1] - p[1])) { const [x, a] = k.split('|'); if (!rmap.has(x) && ![...rmap.values()].includes(num[a])) rmap.set(x, num[a]); }
  for (const r of list) {
    let n = 0, none = 0, multi = 0; const single = new Map();
    for (let t = r.start; t < r.end; t += FR) { n++; const s0 = at(t); if (!s0.length) none++; else if (s0.length > 1) multi++; else single.set(s0[0], (single.get(s0[0]) || 0) + 1); }
    const [top, c] = [...single].sort((p, q) => q[1] - p[1])[0] || [null, 0];
    r.referee = multi / n >= 0.5 ? 'Several people at once' : none / n >= 0.5 ? 'No speech' : top && c / Math.max(1, n - none) >= 0.7 ? (rmap.has(top) ? `Speaker ${rmap.get(top)}` : 'another voice') : 'unclear';
    r.refereeSides = r.referee === r.a ? 'v1' : r.referee === r.b ? 'candidate' : 'neither';
  }
  // spot checks: every 4th settled moment in time order (fixed, so the sample cannot be picked to flatter anyone)
  // Measured on AMI (ES2004a, IS1009a) where v1 and c3 disagree: the referee was right on 42 of 47 overlap moments
  // but only 3 of 12 one-person moments. So it may settle overlap questions only; every one-person moment needs ears.
  const isOverlapQuestion = (r) => [r.a, r.b, r.referee].some((x) => x.startsWith('Several'));
  for (const r of list) if (!isOverlapQuestion(r)) r.refereeSides = 'neither';
  const settled = list.filter((r) => !r.answer && r.refereeSides !== 'neither').sort((p, q) => p.start - q.start);
  settled.forEach((r, i) => { r.spot = i % 4 === 0; });
  for (const r of list) r.section = r.answer ? 'answered' : r.refereeSides === 'neither' ? 'ears' : r.spot ? 'spot' : 'settled';
}
const ordered = [...list].sort((p, q) => (p.answer ? 9 : p.group) - (q.answer ? 9 : q.group) || p.start - q.start);
if (!refereeF) for (const r of list) r.section = r.answer ? 'answered' : 'review';

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`;
const anchors = { 1: [[968.1, 976], [1101.1, 1109]], 2: [[223.3, 231], [914.8, 923]], 3: [[586.2, 594], [830, 838]] };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const css = `body{font:16px/1.5 system-ui,sans-serif;background:#f6f5f1;color:#12183a;margin:0;padding:24px 16px}
main{max-width:860px;margin:0 auto}h1{font-size:26px;margin:0 0 6px}h2{margin:28px 0 2px}p{color:#3c4470}.gp{margin:0 0 6px;font-size:15px}
.voices{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0 8px}
.voice{background:#fff;border:1px solid #d9dcef;border-radius:14px;padding:12px}.voice b{display:block;font-size:18px;margin-bottom:6px}
.c1{border-top:4px solid #0891b2}.c2{border-top:4px solid #7c3aed}.c3{border-top:4px solid #db2777}
button{font:inherit;cursor:pointer;border-radius:10px;border:1px solid #c9cde6;background:#fff;padding:6px 12px;margin:2px}
button:hover{border-color:#7c3aed}
.row{background:#fff;border:1px solid #d9dcef;border-radius:14px;padding:12px 14px;margin:10px 0}.t{font-weight:700}
.w{color:#3c4470;font-style:italic;margin:4px 0 6px}
.labels{display:flex;gap:14px;flex-wrap:wrap;font-size:14px;margin:6px 0}.labels span{background:#f0f1f8;border-radius:8px;padding:2px 8px}
.pick button.on{background:#12183a;color:#fff;border-color:#12183a}.pick .clr{color:#8a1c1c;border-color:#efc4c4}.mix{display:inline-block;background:#f0f1f8;border-radius:10px;padding:2px 8px;margin:2px}.mix button{padding:2px 10px}.mixtxt{color:#12183a;margin-left:6px}
.unv{background:#fff4d6!important;color:#7a4b00}.row.known{border-left:5px solid #16a34a}.row:not(.known){border-left:5px solid #f59e0b}.ans{background:#e6f4ea!important;color:#14532d}
.ref{background:#e8f0fe!important;color:#1a3d8f}.banner{border-radius:10px;padding:8px 12px;margin:4px 0;font-weight:600}.banner.warn{background:#fde8e8;color:#8a1c1c}.banner.ok{background:#e6f4ea;color:#14532d}.row.done{opacity:.72}.row.cur{outline:3px solid #7c3aed;opacity:1}.keys{font-size:14px;color:#3c4470}kbd{border:1px solid #c9cde6;border-bottom-width:2px;border-radius:5px;padding:0 5px;background:#fff;font-size:13px}details{margin:14px 0}summary{cursor:pointer;font-weight:700;font-size:20px}.bar{position:sticky;top:0;background:#f6f5f1;padding:8px 0;z-index:1;border-bottom:1px solid #d9dcef}
#out{white-space:pre-wrap;background:#fff;border:1px solid #d9dcef;border-radius:12px;padding:12px;font-family:monospace}
@media(max-width:600px){.voices{grid-template-columns:1fr}}`;

const runHash = (f) => { const r = JSON.parse(readFileSync(f, 'utf8')); return r.run?.engineHash || createHash('sha256').update(JSON.stringify(r.segments)).digest('hex'); };
const meta = { builtAt: new Date().toISOString(), numbering: 'Speaker numbers of the v1 run (the ones used in your first check)', v1Engine: runHash(aF).slice(0, 12), candidate: candName, candidateEngine: runHash(bF).slice(0, 12), minMomentS: MIN_S, groups: Object.fromEntries(Object.entries(GROUPS).map(([k, [t]]) => [k, t])) };
const STORE = 'speakerReview3';
const script = `const meta=${JSON.stringify(meta)};
const rows=${JSON.stringify(ordered.map((r) => ({ id: r.id, group: r.answer ? 'already answered' : r.group, section: r.section ?? null, referee: r.referee ?? null, start: +r.start.toFixed(2), end: +r.end.toFixed(2), v1: r.a, candidate: r.b, words: r.words, earlierAnswer: r.answer || null })))};
const STORE=${JSON.stringify(STORE)};const load=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch{return {}}};const store=(o)=>{try{localStorage.setItem(STORE,JSON.stringify(o))}catch{}};
const a=document.getElementById('a');let stop=0;
a.addEventListener('timeupdate',()=>{if(stop&&a.currentTime>=stop){a.pause();stop=0;}});
// Blinded spot checks of the referee: they sit among the other moments, unmarked. Any answer that is not the
// referee's label (including "can't tell" / "unsure") means its provisional labels can't be relied on: all of them
// then join the review.
const label=(v)=>v==null?null:v==='S'?'Several people at once':v==='U'?'unknown':v==='D'?'unsure':v[0]==='M'?'changes partway: Speaker '+v[1]+' then Speaker '+v[2]:'Speaker '+v;
const mark=(row,val)=>{row.querySelectorAll('[data-v]').forEach((b)=>b.classList.toggle('on',val!=null&&(b.dataset.v===val||(b.dataset.v==='M'&&val[0]==='M'))));
  const t=row.querySelector('.mixtxt');if(t)t.textContent=val&&val[0]==='M'?'Speaker '+val[1]+' then Speaker '+val[2]:'';};
const setAnswer=(row,val)=>{const ans=load();if(val==null)delete ans[row.dataset.id];else ans[row.dataset.id]=val;store(ans);mark(row,val);progress();};
const spotRows=rows.filter((r)=>r.section==='spot');
const spotState=()=>{const ans=load();const done=spotRows.filter((r)=>ans[r.id]);const agree=done.filter((r)=>label(ans[r.id])===r.referee).length;return {answered:done.length,total:spotRows.length,agree,disagree:done.length-agree};};
const provisionalReview=()=>spotState().disagree>0;
const needsYou=(r)=>!r.earlierAnswer&&(r.section!=='settled'||provisionalReview());
const progress=()=>{const ans=load();const todo=rows.filter(needsYou);
  const st=spotState(),b=document.getElementById('banner'),nProv=rows.filter((r)=>r.section==='settled').length;
  if(st.disagree>0){b.textContent='A hidden check disagreed with the referee, so its '+nProv+' provisional overlap labels cannot be trusted: they have been added to your review (and to Quick review).';b.className='banner warn';document.getElementById('prov').open=true;}
  else if(st.answered===st.total&&st.total){b.textContent='All hidden checks agreed with the referee. Its '+nProv+' overlap labels stay provisional (machine-assisted, not verified); reviewing them is optional.';b.className='banner ok';}
  else{b.textContent='';b.className='';}const n=todo.filter((r)=>ans[r.id]).length;document.getElementById('prog').textContent=n+' of '+todo.length+' moments that need you answered';
  document.querySelectorAll('.row').forEach((el)=>el.classList.toggle('done',!!ans[el.dataset.id]));};
document.addEventListener('click',(e)=>{
  const p=e.target.closest('[data-play]');
  if(p){const [s,t]=p.dataset.play.split(',').map(Number);a.currentTime=Math.max(0,s);stop=t;a.play();return;}
  // "changes partway": who speaks first, then who speaks second (stored as M + first + second, e.g. M32)
  const f=e.target.closest('[data-mf],[data-mt]');
  if(f){const row=f.closest('.row');if(f.dataset.mf)row.dataset.f=f.dataset.mf;else row.dataset.t=f.dataset.mt;
    row.querySelectorAll('[data-mf]').forEach((b)=>b.classList.toggle('on',b.dataset.mf===row.dataset.f));row.querySelectorAll('[data-mt]').forEach((b)=>b.classList.toggle('on',b.dataset.mt===row.dataset.t));
    if(row.dataset.f&&row.dataset.t)setAnswer(row,'M'+row.dataset.f+row.dataset.t);return;}
  const v=e.target.closest('[data-v]');
  if(v){const row=v.closest('.row');
    if(v.dataset.v==='M'){row.querySelector('.mix').hidden=false;return;}
    if(v.dataset.v==='X'){row.dataset.f='';row.dataset.t='';row.querySelectorAll('[data-mf],[data-mt]').forEach((b)=>b.classList.remove('on'));row.querySelector('.mix').hidden=true;setAnswer(row,null);return;}
    row.querySelector('.mix').hidden=true;setAnswer(row,v.dataset.v);}
});
for(const [id,v] of Object.entries(load())){const row=document.querySelector('.row[data-id="'+id+'"]');if(row)mark(row,v);}
progress();
// Quick review: plays each moment that needs you, one keypress answers it and moves on
let q = -1; const queue = () => rows.filter(needsYou).sort((x, y) => (x.section === 'settled') - (y.section === 'settled'));
const el = (r) => document.querySelector('.row[data-id="' + r.id + '"]');
const playRow = (r, wide) => { const s0 = wide ? r.start - 4 : r.start - 1.2, s1 = wide ? r.end + 3 : r.end + 0.5; a.currentTime = Math.max(0, s0); stop = s1; a.play(); };
const go = (i) => { const list = queue(); if (i < 0 || i >= list.length) { document.getElementById('qstat').textContent = i >= list.length ? 'Done — press Save my answers.' : ''; a.pause(); return; } q = i;
  document.querySelectorAll('.row.cur').forEach((x) => x.classList.remove('cur')); const e = el(list[i]); e.classList.add('cur'); e.scrollIntoView({ block: 'center' });
  document.getElementById('qstat').textContent = 'Moment ' + (i + 1) + ' of ' + list.length; playRow(list[i], false); };
document.getElementById('quick').addEventListener('click', () => { const ans = load(); const list = queue(); const first = list.findIndex((r) => !ans[r.id]); go(first < 0 ? 0 : first); });
const keys = { 1: '1', 2: '2', 3: '3', o: 'S', u: 'U', d: 'D' };
let mix = null; // M pressed: collecting "first, then" speaker numbers
document.addEventListener('keydown', (e) => {
  if (q < 0 || e.ctrlKey || e.metaKey || e.altKey) return; const list = queue(); const r = list[q]; if (!r) return; const k = e.key.toLowerCase();
  if (mix !== null) {
    e.preventDefault();
    if ('123'.includes(k) && k.length === 1) { mix += k; document.getElementById('qstat').textContent = 'Changes partway: Speaker ' + mix[0] + ' then … (press 1, 2 or 3)';
      if (mix.length === 2) { setAnswer(el(r), 'M' + mix); mix = null; go(q + 1); } }
    else if (k === 'escape') { mix = null; document.getElementById('qstat').textContent = 'Moment ' + (q + 1) + ' of ' + list.length; }
    return;
  }
  if (k === 'm') { e.preventDefault(); mix = ''; document.getElementById('qstat').textContent = 'Changes partway: who speaks first? (1, 2 or 3; Esc to cancel)'; return; }
  if (k === 'x') { e.preventDefault(); el(r).querySelector('[data-v="X"]').click(); return; }
  if (keys[k]) { e.preventDefault(); el(r).querySelector('[data-v="' + keys[k] + '"]').click(); go(q + 1); }
  else if (k === 'r') { e.preventDefault(); playRow(r, false); } else if (k === 'c') { e.preventDefault(); playRow(r, true); }
  else if (k === 'backspace') { e.preventDefault(); go(q - 1); } else if (k === 'n' || k === 'arrowdown') { e.preventDefault(); go(q + 1); }
});
// Save: a new, dated file each time (never overwrites earlier answers); the engines' fingerprints are inside
document.getElementById('save').addEventListener('click',()=>{
  const ans=load();
  const names={S:'several people at once',U:'unknown (cannot tell who)',D:'unsure / disputed'};
  for(const v of Object.values(ans))if(v[0]==='M')names[v]='changes partway: Speaker '+v[1]+' then Speaker '+v[2];
  const doc={format:'sparkscribe-speaker-review/1',...meta,savedAt:new Date().toISOString(),
    spotChecks:spotState(),provisionalLabelsNeedReview:provisionalReview(),
    items:rows.map((r)=>({...r,answer:ans[r.id]==null?null:(names[ans[r.id]]||'Speaker '+ans[r.id]),
      labelSource:ans[r.id]!=null?'human (this review)':r.earlierAnswer?'human (first review)':r.section==='settled'?'machine-assisted (provisional, not verified)':'unanswered',
      provisionalLabel:r.section==='settled'&&ans[r.id]==null?r.referee:null}))};
  const l=document.createElement('a');l.href=URL.createObjectURL(new Blob([JSON.stringify(doc,null,1)],{type:'application/json'}));
  l.download='speaker-review-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';l.click();
});
document.getElementById('copy').addEventListener('click',()=>{
  const ans=load();
  const txt=rows.map((r,i)=>(i+1)+' ('+r.id+'s): '+(ans[r.id]||'-')).join(', ');
  document.getElementById('out').textContent=txt;navigator.clipboard?.writeText(txt).catch(()=>{});
});`;

const voices = [1, 2, 3].map((n) => `<div class="voice c${n}"><b>Speaker ${n}</b>${anchors[n].map((x, i) => `<button data-play="${x[0]},${x[1]}">▶ Sample ${i + 1}</button>`).join('')}</div>`).join('');
let num2 = 0;
const card = (r) => `<div class="row${r.answer ? ' known' : ''}" data-id="${r.id}"><span class="t">${++num2}. At ${fmt(r.start)} (${(r.end - r.start).toFixed(1)} s)</span> <button data-play="${Math.max(0, r.start - 0.4).toFixed(2)},${(r.end + 0.4).toFixed(2)}">▶ Play</button><button data-play="${Math.max(0, r.start - 4).toFixed(2)},${(r.end + 3).toFixed(2)}">▶ With context</button>
<div class="labels"><span>v1: <b>${esc(r.a)}</b></span><span>${esc(candName)}: <b>${esc(r.b)}</b></span>${r.referee && r.section === 'settled' ? `<span class="ref">Provisional label (referee): <b>${esc(r.referee)}</b> · not verified</span>` : ''}${refereeF && !r.answer ? `<span>${GROUPS[r.group][0]}</span>` : ''}${r.answer ? `<span class="ans">Your earlier answer: <b>${esc(r.answer)}</b>${r.verdict ? ` · ${r.verdict === 'agrees' ? 'new label agrees' : r.verdict === 'v1 was right' ? 'v1 was right, new label is not' : 'neither matches'}` : ''}</span>` : '<span class="unv">Not yet verified</span>'}</div>
<div class="w">“${esc(r.words)}”</div>
<div class="pick">Who is talking? ${[1, 2, 3].map((n) => `<button data-v="${n}">Speaker ${n}</button>`).join('')}<button data-v="S">Several people at once</button><button data-v="U">Can't tell who</button><button data-v="D">Unsure / disputed</button><button data-v="M">Changes partway…</button><button data-v="X" class="clr">Clear</button>
<span class="mix" hidden>First: ${[1, 2, 3].map((n) => `<button data-mf="${n}">${n}</button>`).join('')} then: ${[1, 2, 3].map((n) => `<button data-mt="${n}">${n}</button>`).join('')}</span> <b class="mixtxt"></b></div></div>`;
const bySection = (k) => ordered.filter((r) => r.section === k).sort((p, q) => p.group - q.group || p.start - q.start);
const needEars = [...bySection('ears'), ...bySection('spot')].sort((p, q) => p.group - q.group || p.start - q.start); // spot checks blinded among them
const refSections = refereeF ? `<h2>Needs your ears (${needEars.length})</h2><p class="gp">Every one of these needs a human answer. They decide the comparison.</p>${needEars.map(card).join('\n')}
<details id="prov"><summary>Provisional machine-assisted labels (${bySection('settled').length}) — not verified</summary><p class="gp">An independent speaker model run on this computer (${esc(refereeName)}) marked these as several people talking at once. They are <b>not</b> verified and are counted separately from your answers. If any of the hidden checks above disagrees with it, all of these join your review automatically. Your answer always replaces the provisional label.</p>${bySection('settled').map(card).join('\n')}</details>` : null;
const sections = refSections ?? Object.entries(GROUPS).map(([g, [title, help]]) => {
  const rs = ordered.filter((r) => !r.answer && r.group === +g);
  return rs.length ? `<h2>${g}. ${title} (${rs.length})</h2><p class="gp">${help}</p>${rs.map(card).join('\n')}` : '';
}).join('\n');
const answered = ordered.filter((r) => r.answer);
const unverified = list.filter((r) => !r.answer).length;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Speaker check 2</title><style>${css}</style></head><body><main>
<h1>Who is talking? (round 2)</h1>
<p>Every moment (at least ${MIN_S} s) where ${esc(candName)} labels your recording differently from v1, most important first. Listen to the three voices first. For each moment press <b>Play</b> (or <b>With context</b> for 4 s before and 3 s after) and click who you really hear. "Not yet verified" means nobody has checked it by ear: neither label is known to be right. Your clicks are kept in this browser as you go; <b>Save my answers</b> downloads a new dated file each time, so earlier answers are never overwritten.</p>
<audio id="a" src="coffee_qazzaz_23m.mp4" preload="auto"></audio>
<div class="voices">${voices}</div>
<div class="bar"><div id="banner"></div><b id="prog"></b> · <button id="quick">▶ Quick review (keyboard)</button> <span id="qstat"></span> · <button id="save">Save my answers (new file)</button>
<div class="keys">Quick review plays each moment that needs you. Press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> for the speaker, <kbd>O</kbd> several people at once, <kbd>U</kbd> can't tell, <kbd>D</kbd> unsure, <kbd>M</kbd> then two numbers if the speaker changes partway (e.g. <kbd>M</kbd> <kbd>3</kbd> <kbd>2</kbd> = Speaker 3 then Speaker 2) — it moves to the next one. <kbd>X</kbd> clears an answer. <kbd>R</kbd> replay, <kbd>C</kbd> with context, <kbd>Backspace</kbd> back, <kbd>N</kbd> skip.</div></div>
<p>${refereeF ? `${bySection('ears').length + bySection('spot').length} moments need you; ${bySection('settled').length} have provisional machine-assisted labels (not verified, reviewed only if a hidden check fails); ${answered.length} you answered in the first round.` : `${unverified} moments to check, in ${Object.keys(GROUPS).length} groups, plus ${answered.length} you answered in the first round (at the end, for reference).`}</p>
${sections}
<h2>Already answered in the first round (${answered.length})</h2><p class="gp">For reference: your earlier answer is shown. You can answer again if you hear it differently.</p>
${answered.map(card).join('\n')}
<p><button id="copy">Copy my answers as text</button></p><div id="out"></div>
<script>${script}</script></main></body></html>`;

writeFileSync(resolve(ROOT, 'accuracy/testset/private/speaker-check-2.html'), html);
writeFileSync(resolve(ROOT, 'accuracy/testset/private/speaker-check-2-key.json'), JSON.stringify(ordered, null, 1));
const count = (g) => list.filter((r) => !r.answer && r.group === g).length;
if (refereeF) console.log('referee sections:', ['ears', 'spot', 'settled', 'answered'].map((k) => `${k}=${list.filter((r) => r.section === k).length}`).join(' '));
console.log(list.length, 'moments;', unverified, 'unverified by group:', Object.keys(GROUPS).map((g) => `${g}=${count(+g)}`).join(' '), '; already answered:', answered.length);
