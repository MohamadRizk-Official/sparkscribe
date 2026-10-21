// ELECTRIC — the audio transport for a saved recording (pages/transcript.js): play/pause, back/forward 10 s, time,
// seek, mute + volume, speed (a selector, electric/speed-menu.js). The same controls and look as the player under a
// fresh transcript (main.js), driven by data-pb roles in the markup instead of page-specific ids.
import { attachSpeedMenu } from './speed-menu.js';

const ICON = {
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m16.5 9.5 5 5m0-5-5 5"/></svg>',
  low: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/></svg>',
  high: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M19 7a7 7 0 0 1 0 10"/></svg>',
};
const clock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

export function mountTransport(root, audio, { duration = () => audio.duration } = {}) {
  const q = (r) => root.querySelector(`[data-pb="${r}"]`);
  const play = q('play'), seek = q('seek'), time = q('time'), mute = q('mute'), vol = q('vol');
  const total = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(duration()) || 0);
  const paint = () => {
    const d = total(), t = audio.currentTime || 0;
    const p = d ? Math.min(100, (t / d) * 100) : 0;
    if (document.activeElement !== seek) seek.value = String(Math.round(p * 10));
    seek.style.setProperty('--fill', `${p}%`);
    seek.setAttribute('aria-valuetext', `${clock(t)} of ${clock(d)}`);
    time.textContent = `${clock(t)} / ${clock(d)}`;
  };
  const paintPlay = () => {
    const on = !audio.paused;
    play.classList.toggle('playing', on);
    root.classList.toggle('is-playing', on);
    play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    play.title = on ? 'Pause (space)' : 'Play (space)';
  };
  const paintVol = () => {
    const silent = audio.muted || audio.volume === 0;
    const level = Math.round(audio.volume * 100);
    if (vol) { vol.value = String(silent ? 0 : level); vol.style.setProperty('--fill', `${silent ? 0 : level}%`); vol.setAttribute('aria-valuetext', silent ? 'muted' : `${level}%`); }
    mute.innerHTML = ICON[silent ? 'muted' : level < 50 ? 'low' : 'high'];
    mute.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
    mute.title = silent ? 'Unmute (M)' : `Mute (M) · volume ${level}%`;
  };
  const jump = (dt) => { audio.currentTime = Math.max(0, Math.min(total() || Infinity, (audio.currentTime || 0) + dt)); paint(); };

  play.addEventListener('click', () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
  q('back').addEventListener('click', () => jump(-10));
  q('fwd').addEventListener('click', () => jump(10));
  seek.addEventListener('input', () => { const d = total(); if (d) { audio.currentTime = (Number(seek.value) / 1000) * d; paint(); } });
  mute.addEventListener('click', () => { if (audio.muted || audio.volume === 0) { audio.muted = false; if (audio.volume === 0) audio.volume = 0.5; } else audio.muted = true; });
  vol?.addEventListener('input', () => { audio.volume = Number(vol.value) / 100; audio.muted = audio.volume === 0; });
  for (const ev of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked']) audio.addEventListener(ev, paint);
  for (const ev of ['play', 'pause', 'ended']) audio.addEventListener(ev, paintPlay);
  audio.addEventListener('volumechange', paintVol);
  const speed = q('speed');
  if (speed) attachSpeedMenu(speed, audio);
  // keyboard: space plays/pauses, ←/→ jump 5 s, M mutes (not while typing or using another control)
  document.addEventListener('keydown', (e) => {
    if (root.classList.contains('hidden') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('input, select, textarea, button, a[href], summary, [contenteditable="true"], [role="menuitem"], [role="menuitemradio"], [role="tab"]')) return;
    if (e.key === ' ') { e.preventDefault(); play.click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); jump(5); }
    else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); mute.click(); }
  });
  paint(); paintPlay(); paintVol();
  return { paint };
}
