// The social preview (Open Graph / X card), 1200×630: node scripts/og-image.mjs → public/og-image.png
// Composed in HTML with the brand fonts and mark, screenshotted by headless Chrome (CHROME=path to override), then
// compressed with sharp. Re-run after changing the brand or the line; the image is committed.
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BOLT = 'M22.8 1.5 16 21.4h4l-2.8 17.1 6.8-20.9h-4.2z';

const mark = `<svg viewBox="0 0 40 40" width="88" height="88">
  <defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a5f3fc"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
  <rect x="2" y="14" width="4" height="12" rx="2" fill="#22d3ee"/><rect x="9" y="9" width="4" height="22" rx="2" fill="#3b82f6"/>
  <path d="${BOLT}" fill="url(#b)"/><rect x="27" y="10" width="4" height="20" rx="2" fill="#a78bfa"/><rect x="34" y="15" width="4" height="10" rx="2" fill="#f472b6"/></svg>`;

// the recording, as a lit waveform
const bars = Array.from({ length: 27 }, (_, i) => {
  const h = Math.round(18 + 70 * Math.abs(Math.sin(i * 0.61) * Math.cos(i * 0.23)));
  return `<i style="height:${h}px"></i>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@500;600&family=Sora:wght@600;700;800&display=block">
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body { position: relative; font-family: Geist, system-ui, sans-serif; color: #f5f8ff;
    background: radial-gradient(70% 90% at 0% 0%, rgba(32,212,244,.22), transparent 60%), radial-gradient(60% 80% at 100% 100%, rgba(161,107,255,.24), transparent 62%), linear-gradient(180deg, #0a1724, #07111b); }
  .trace { position: absolute; inset: 0; }
  .trace path { fill: none; stroke: rgba(150,200,255,.16); stroke-width: 2; }
  .trace path.hot { stroke: #5fe2f8; stroke-width: 3; }
  .brand { position: absolute; left: 80px; top: 74px; display: flex; align-items: center; gap: 20px; }
  .word { font-family: Sora; font-weight: 700; font-size: 54px; letter-spacing: -0.03em; }
  .word b { font-weight: 700; background: linear-gradient(100deg, #22d8f6, #3f8cff 60%, #5b6dff); -webkit-background-clip: text; color: transparent; }
  .word span { font-weight: 600; color: #f5f8ff; }
  h1 { position: absolute; left: 80px; top: 214px; width: 760px; font-family: Sora; font-weight: 800; font-size: 66px; line-height: 1.04; letter-spacing: -0.035em; }
  h1 em { font-style: normal; background: linear-gradient(100deg, #5fe2f8, #8aa9ff 55%, #c3a3ff); -webkit-background-clip: text; color: transparent; }
  .sub { position: absolute; left: 80px; top: 478px; font-size: 28px; font-weight: 500; color: #bdc9da; }
  .sub2 { position: absolute; left: 80px; top: 524px; font-size: 24px; font-weight: 600; color: #8aa9ff; }
  .wave { position: absolute; right: 70px; top: 150px; width: 300px; height: 330px; display: flex; flex-wrap: nowrap; align-items: center; justify-content: center; gap: 5px; padding: 26px; border-radius: 26px;
    background: linear-gradient(180deg, #13284a, #0e1d33); box-shadow: 0 0 0 2px rgba(160,200,255,.38), 0 30px 70px -30px rgba(0,0,0,.9), 0 0 60px -20px rgba(32,212,244,.5); }
  .wave i { display: block; width: 3px; border-radius: 2px; background: linear-gradient(180deg, #7af0ff, #20d4f4); }
</style></head><body>
<svg class="trace" viewBox="0 0 1200 630"><path d="M1200 96H1010l-22 22H900"/><path d="M0 560h120l24-24h90"/><path class="hot" d="M900 560h70l18-30 14 46 14-34 12 18h172"/></svg>
<div class="brand">${mark}<div class="word"><b>Spark</b><span>Scribe</span></div></div>
<h1>Turn lectures into <em>notes, flashcards and quizzes.</em></h1>
<p class="sub">Transcribed on your device · Free to start</p>
<p class="sub2">For students · www.spark-scribe.com</p>
<div class="wave">${bars}</div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'og-'));
const page = join(dir, 'og.html'), shot = join(dir, 'og.png');
writeFileSync(page, html);
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=4000', `--screenshot=${shot}`, `file:///${page.replace(/\\/g, '/')}`], { stdio: 'ignore' });
const out = join(ROOT, 'public', 'og-image.png');
await sharp(shot).resize(1200, 630).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out);
rmSync(dir, { recursive: true, force: true });
console.log('wrote', out);
