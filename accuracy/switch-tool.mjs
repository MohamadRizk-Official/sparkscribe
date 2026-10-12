// Builds a local tool for marking WHEN the speaker changes inside the "changes partway" moments of a truth file
// (accuracy/testset/private/coffee-truth-v2.json, type "change"): waveform, playback at 1x / 0.75x / 0.5x, context,
// and marks for a single switch instant, or "first speaker ends" + "second speaker starts" (silence, gradual hand-over,
// interruption), or "uncertain". Saves a new dated JSON file each time; the truth file is never modified.
//   node accuracy/switch-tool.mjs <recording.wav (16 kHz mono PCM)> [truth.json] [review-key.json for the words]
// Output (private, git-ignored): accuracy/testset/private/switch-marks.html + switch-clips/<id>.wav
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRIV = resolve(ROOT, 'accuracy/testset/private');
const [wavF, truthF = resolve(PRIV, 'coffee-truth-v2.json'), keyF = resolve(PRIV, 'speaker-check-2-key.json')] = process.argv.slice(2);
const PAD = 5; // seconds of audio around each moment
const BINS = 1200; // waveform resolution per clip

// ---------- audio ----------
const buf = readFileSync(wavF);
const fmt = buf.indexOf('fmt '), dataAt = buf.indexOf('data');
const sr = buf.readUInt32LE(fmt + 12), bits = buf.readUInt16LE(fmt + 22), ch = buf.readUInt16LE(fmt + 10);
if (bits !== 16 || ch !== 1) throw new Error('expected 16-bit mono PCM WAV');
const pcm = new Int16Array(buf.buffer, buf.byteOffset + dataAt + 8, Math.floor((buf.length - dataAt - 8) / 2));
const DUR = pcm.length / sr;

const truthRaw = readFileSync(truthF);
const truth = JSON.parse(truthRaw.toString('utf8'));
const words = (() => { try { return JSON.parse(readFileSync(keyF, 'utf8')); } catch { return []; } })();
const moments = truth.labels.filter((l) => l.type === 'change').map((l, i) => {
  const id = l.start.toFixed(2);
  const w = words.find((k) => Math.abs(k.start - l.start) < 0.01)?.words ?? '';
  const c0 = Math.max(0, l.start - PAD), c1 = Math.min(DUR, l.end + PAD);
  return { n: i + 1, id, start: l.start, end: l.end, first: l.first, then: l.then, words: w, c0: +c0.toFixed(3), c1: +c1.toFixed(3) };
});

// one uncompressed clip per moment: sample-accurate seeking in the browser
mkdirSync(resolve(PRIV, 'switch-clips'), { recursive: true });
const wavHeader = (n) => { const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40); return h; };
for (const m of moments) {
  const a = Math.round(m.c0 * sr), b = Math.round(m.c1 * sr);
  const seg = pcm.subarray(a, b);
  writeFileSync(resolve(PRIV, 'switch-clips', `${m.id}.wav`), Buffer.concat([wavHeader(seg.length), Buffer.from(seg.buffer, seg.byteOffset, seg.byteLength)]));
  const peaks = []; const per = seg.length / BINS;
  for (let k = 0; k < BINS; k++) { let lo = 0, hi = 0; for (let i = Math.floor(k * per); i < Math.min(seg.length, Math.floor((k + 1) * per)); i++) { const v = seg[i] / 32768; if (v < lo) lo = v; if (v > hi) hi = v; } peaks.push(+lo.toFixed(3), +hi.toFixed(3)); }
  m.peaks = peaks;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const meta = { format: 'sparkscribe-switch-marks/1', recording: truth.recording, truthFile: truthF.split(/[\\/]/).pop(), truthSha256: createHash('sha256').update(truthRaw).digest('hex').slice(0, 16), builtAt: new Date().toISOString(), numbering: truth.numbering };

const TYPES = [
  ['clean', 'Clean switch', 'one person stops, the other starts: mark the instant (S)'],
  ['gap', 'Silence between', 'mark where the first speaker ends (E) and the second starts (B)'],
  ['gradual', 'Gradual / overlapping hand-over', 'they briefly talk over each other: mark first ends (E) and second starts (B)'],
  ['interruption', 'Interruption', 'the second speaker cuts in (B); mark where the first stops (E) if you can hear it'],
  ['uncertain', 'Uncertain', 'you cannot place the change'],
];
const card = (m) => `<section class="m" data-id="${m.id}" id="m${m.n}">
<div class="head"><b>${m.n}. At ${clock(m.start)}</b> <span class="who">Speaker ${m.first} → Speaker ${m.then}</span> <span class="state"></span></div>
<div class="w">“${esc(m.words)}”</div>
<canvas height="96"></canvas>
<div class="ctl"><button data-a="play">▶ Moment</button><button data-a="ctx">▶ Context</button><button data-a="cur">▶ From cursor</button><button data-a="pause">⏸</button>
<span class="sp">Speed <button data-s="1" class="on">1×</button><button data-s="0.75">0.75×</button><button data-s="0.5">0.5×</button></span>
<span class="t">cursor <b class="ct"></b></span></div>
<div class="ctl"><button data-a="S">Switch here</button><button data-a="E">Speaker ${m.first} ends here</button><button data-a="B">Speaker ${m.then} starts here</button><button data-a="clear" class="clr">Clear marks</button></div>
<div class="types">${TYPES.map(([k, t, h]) => `<label title="${esc(h)}"><input type="radio" name="t${m.n}" value="${k}"> ${t}</label>`).join('')}</div>
<audio preload="none" src="switch-clips/${m.id}.wav"></audio></section>`;

const css = `body{font:15px/1.45 system-ui,sans-serif;background:#f6f5f1;color:#12183a;margin:0;padding:20px 16px}main{max-width:980px;margin:0 auto}h1{font-size:24px;margin:0 0 6px}p{color:#3c4470}
.bar{position:sticky;top:0;z-index:2;background:#f6f5f1;padding:8px 0;border-bottom:1px solid #d9dcef}
.m{background:#fff;border:1px solid #d9dcef;border-radius:14px;padding:12px 14px;margin:12px 0}.m.act{outline:3px solid #7c3aed}.m.done{border-left:5px solid #16a34a}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.who{background:#f0f1f8;border-radius:8px;padding:1px 8px}.state{color:#14532d;font-size:13px}
.w{font-style:italic;color:#3c4470;margin:2px 0 6px}canvas{width:100%;height:96px;background:#fbfbfe;border:1px solid #e3e5f3;border-radius:8px;cursor:crosshair;display:block}
button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid #c9cde6;background:#fff;padding:4px 10px;margin:2px}button:hover{border-color:#7c3aed}button.on{background:#12183a;color:#fff}
.clr{color:#8a1c1c;border-color:#efc4c4}.ctl{margin:4px 0}.sp,.t{margin-left:10px;color:#3c4470}.types label{margin-right:12px;white-space:nowrap}
kbd{border:1px solid #c9cde6;border-bottom-width:2px;border-radius:5px;padding:0 5px;background:#fff;font-size:12px}`;

const script = `const meta=${JSON.stringify(meta)};
const M=${JSON.stringify(moments)};
const KEY='switchMarks1';const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};const save=(o)=>{try{localStorage.setItem(KEY,JSON.stringify(o))}catch{}};
let act=0,speed=1;
const sec=(id)=>document.querySelector('.m[data-id="'+id+'"]');
const st=(m)=>{const all=load();return all[m.id]||(all[m.id]={})};
const put=(m,patch)=>{const all=load();all[m.id]={...(all[m.id]||{}),...patch};save(all);draw(m);status();};
const clock=(t)=>Math.floor(t/60)+':'+(t%60).toFixed(2).padStart(5,'0');
function draw(m){const el=sec(m.id),c=el.querySelector('canvas'),w=c.clientWidth,h=c.height;c.width=w;const g=c.getContext('2d');const span=m.c1-m.c0,x=(t)=>(t-m.c0)/span*w;
  g.fillStyle='#f0ecfb';g.fillRect(x(m.start),0,x(m.end)-x(m.start),h);
  g.strokeStyle='#8a90b8';g.beginPath();const n=m.peaks.length/2;for(let k=0;k<n;k++){const px=k/n*w;g.moveTo(px,h/2-m.peaks[2*k+1]*h/2);g.lineTo(px,h/2-m.peaks[2*k]*h/2);}g.stroke();
  g.fillStyle='#3c4470';g.font='11px system-ui';for(let t=Math.ceil(m.c0);t<=m.c1;t++){g.fillRect(x(t),h-6,1,6);if(t%2===0)g.fillText(clock(t).slice(0,-3),x(t)+2,h-8);}
  const s=st(m),line=(t,col,lab)=>{if(t==null)return;g.fillStyle=col;g.fillRect(x(t)-1,0,3,h);g.fillText(lab,x(t)+4,12);};
  line(s.firstEnds,'#0891b2','ends');line(s.thenStarts,'#db2777','starts');line(s.switchAt,'#7c3aed','switch');
  const cur=el._cur??m.start;g.fillStyle='#12183a';g.fillRect(x(cur),0,1,h);el.querySelector('.ct').textContent=clock(cur);}
function status(){const all=load();let done=0;for(const m of M){const s=all[m.id]||{},el=sec(m.id);const ok=s.type==='uncertain'||(s.type==='clean'&&s.switchAt!=null)||((s.type==='gap'||s.type==='gradual')&&s.firstEnds!=null&&s.thenStarts!=null)||(s.type==='interruption'&&s.thenStarts!=null);
  el.classList.toggle('done',ok);el.querySelector('.state').textContent=ok?'✓ marked':s.type?'needs '+(s.type==='clean'?'a switch mark':s.type==='interruption'?'"starts here"':'both "ends" and "starts"'):'';if(ok)done++;}
  document.getElementById('prog').textContent=done+' of '+M.length+' marked';}
const audioOf=(m)=>sec(m.id).querySelector('audio');
let stopAt=null,playing=null;
function play(m,from,to){for(const x of M)if(x!==m)audioOf(x).pause();const a=audioOf(m);
  // a clip that has not loaded yet ignores the seek: wait for its metadata first
  const go=()=>{a.playbackRate=speed;a.currentTime=Math.max(0,from-m.c0);stopAt=to;playing=m;a.play();};
  if(a.readyState>=1)go();else{a.preload='auto';a.addEventListener('loadedmetadata',go,{once:true});a.load();}}
function tick(){if(playing){const a=audioOf(playing),t=playing.c0+a.currentTime;const el=sec(playing.id);el._cur=t;draw(playing);if(stopAt!=null&&t>=stopAt){a.pause();stopAt=null;}if(a.paused)playing=null;}requestAnimationFrame(tick);}
function activate(i,scroll){act=Math.max(0,Math.min(M.length-1,i));document.querySelectorAll('.m').forEach((e,k)=>e.classList.toggle('act',k===act));if(scroll)sec(M[act].id).scrollIntoView({block:'center'});}
for(const [i,m] of M.entries()){const el=sec(m.id);el._cur=m.start;
  // stop at the end of the requested stretch even when animation frames are throttled (background tab)
  audioOf(m).addEventListener('timeupdate',()=>{const a=audioOf(m);if(playing===m&&stopAt!=null&&m.c0+a.currentTime>=stopAt){a.pause();stopAt=null;el._cur=m.c0+a.currentTime;draw(m);}});
  el.addEventListener('mousedown',()=>activate(i,false));
  el.querySelector('canvas').addEventListener('click',(e)=>{const r=e.target.getBoundingClientRect();el._cur=m.c0+(e.clientX-r.left)/r.width*(m.c1-m.c0);audioOf(m).pause();draw(m);});
  el.addEventListener('click',(e)=>{const b=e.target.closest('[data-a]');const sp=e.target.closest('[data-s]');
    if(sp){speed=+sp.dataset.s;document.querySelectorAll('[data-s]').forEach((x)=>x.classList.toggle('on',+x.dataset.s===speed));for(const x of M)audioOf(x).playbackRate=speed;return;}
    if(!b)return;const k=b.dataset.a;
    if(k==='play')play(m,m.start-1,m.end+0.5);else if(k==='ctx')play(m,m.start-4,m.end+3);else if(k==='cur')play(m,el._cur,m.c1);else if(k==='pause')audioOf(m).pause();
    else if(k==='S')put(m,{switchAt:+el._cur.toFixed(3),type:st(m).type||'clean'});else if(k==='E')put(m,{firstEnds:+el._cur.toFixed(3)});else if(k==='B')put(m,{thenStarts:+el._cur.toFixed(3)});
    else if(k==='clear')put(m,{switchAt:null,firstEnds:null,thenStarts:null});});
  el.querySelectorAll('input[type=radio]').forEach((r)=>r.addEventListener('change',()=>put(m,{type:r.value})));
  const s=st(m);if(s.type){const r=el.querySelector('input[value="'+s.type+'"]');if(r)r.checked=true;}
  draw(m);}
window.addEventListener('resize',()=>M.forEach(draw));
document.addEventListener('keydown',(e)=>{if(e.target.tagName==='INPUT'&&e.key!==' ')return;if(e.ctrlKey||e.metaKey||e.altKey)return;const m=M[act],el=sec(m.id),a=audioOf(m),k=e.key;
  const move=(d)=>{e.preventDefault();a.pause();el._cur=Math.max(m.c0,Math.min(m.c1,el._cur+d));draw(m);};
  if(k===' '){e.preventDefault();if(!a.paused)a.pause();else play(m,el._cur,m.c1);}
  else if(k==='ArrowLeft')move(e.shiftKey?-0.25:-0.05);else if(k==='ArrowRight')move(e.shiftKey?0.25:0.05);
  else if(k==='s'||k==='S'){e.preventDefault();el.querySelector('[data-a="S"]').click();}else if(k==='e'||k==='E'){e.preventDefault();el.querySelector('[data-a="E"]').click();}
  else if(k==='b'||k==='B'){e.preventDefault();el.querySelector('[data-a="B"]').click();}else if(k==='r'||k==='R'){e.preventDefault();play(m,m.start-1,m.end+0.5);}
  else if(k==='c'||k==='C'){e.preventDefault();play(m,m.start-4,m.end+3);}else if(k==='u'||k==='U'){e.preventDefault();el.querySelector('input[value="uncertain"]').click();}
  else if(k==='Enter'||k==='n'||k==='N'){e.preventDefault();a.pause();activate(act+1,true);}else if(k==='p'||k==='P'){e.preventDefault();a.pause();activate(act-1,true);}
  else if(k==='1'||k==='2'||k==='3'){e.preventDefault();document.querySelector('[data-s="'+({1:1,2:0.75,3:0.5})[k]+'"]').click();}});
document.getElementById('save').addEventListener('click',()=>{const all=load();
  const doc={...meta,savedAt:new Date().toISOString(),items:M.map((m)=>{const s=all[m.id]||{};return {id:m.id,start:m.start,end:m.end,first:m.first,then:m.then,type:s.type||null,switchAt:s.switchAt??null,firstEnds:s.firstEnds??null,thenStarts:s.thenStarts??null};})};
  const l=document.createElement('a');l.href=URL.createObjectURL(new Blob([JSON.stringify(doc,null,1)],{type:'application/json'}));l.download='switch-marks-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';l.click();});
activate(0,false);status();tick();`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Speaker switch marks</title><style>${css}</style></head><body><main>
<h1>When does the speaker change?</h1>
<p>${moments.length} moments you marked as "changes partway". For each one, find the change and mark it. Click the waveform to put the cursor anywhere (the shaded band is the moment). Pick what kind of change it is: a <b>clean switch</b> gets one mark; with <b>silence between</b>, a <b>gradual / overlapping hand-over</b> or an <b>interruption</b>, mark where the first speaker ends and where the second starts; choose <b>Uncertain</b> if you can't place it. Your marks are kept in this browser as you go; <b>Save</b> downloads a new dated file each time (your earlier answers are never changed).</p>
<div class="bar"><b id="prog"></b> · <button id="save">Save marks (new file)</button>
<div><kbd>Space</kbd> play/pause from cursor · <kbd>←</kbd>/<kbd>→</kbd> move 0.05 s (<kbd>Shift</kbd> 0.25 s) · <kbd>S</kbd> switch here · <kbd>E</kbd> first ends · <kbd>B</kbd> second starts · <kbd>U</kbd> uncertain · <kbd>R</kbd> replay moment · <kbd>C</kbd> context · <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> speed 1× / 0.75× / 0.5× · <kbd>Enter</kbd> next · <kbd>P</kbd> previous</div></div>
${moments.map(card).join('\n')}
<script>${script}</script></main></body></html>`;
writeFileSync(resolve(PRIV, 'switch-marks.html'), html);
console.log(`${moments.length} moments, clips in switch-clips/, page: accuracy/testset/private/switch-marks.html`);
