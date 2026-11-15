// ELECTRIC — page chrome shared by every page (mounted from lib/account.js mountAccountMenu):
//  * the ambient canvas: two light sources (CSS) and a faint circuit with one slow current (SVG, drawn once)
//  * the header: sticky, gains depth once the page scrolls
//  * the nav's electric indicator: one line that sits under the current page and glides to the link you point at
// Everything here is decoration over real controls: aria-hidden, no layout shift, transforms only, and reduced motion
// keeps the static parts.

const SVG_NS = 'http://www.w3.org/2000/svg';
// right-angled traces near the edges of a 1440×900 room (never behind the reading column)
const TRACES = [
  'M1440 128H1262l-28 28H1120l-20 20v86',
  'M1440 214h-104l-24 24v132l-18 18h-62',
  'M0 664h126l26-26h92l22 22v120',
  'M0 742h70l20 20v138',
];
const NODES = [[1100, 262], [1232, 388], [266, 780], [90, 900]];

// The side margins: a quiet pattern of lightning, so the background is never bare (owner request 2026-11-14,
// replacing the book outlines). One branching network per side: a strike from the top of the page that forks, and forks
// again, every branch growing out of another so the whole pattern is connected. Drawn once from a fixed seed (the same
// pattern on every visit, nothing in it moves), in muted strokes that thin and fade with each fork. A few dim sparks
// drift down along it (CSS transforms and opacity only; none with reduced motion). base.css colours both themes.
// Drawn for the left margin (x 0 = the page edge, x W = the content side; branches that reach further fade out before
// it, base.css); the right one is mirrored in CSS.
const W = 300, H = 1000; // viewBox of a margin
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
// midpoint displacement: split every segment, push its middle sideways by a random amount that shrinks each pass
function zigzag(rand, from, to, spread, passes) {
  let pts = [from, to];
  for (let p = 0; p < passes; p++, spread *= 0.5) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay) || 1, off = (rand() - 0.5) * spread;
      next.push([(ax + bx) / 2 - ((by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off], [bx, by]);
    }
    pts = next;
  }
  return pts;
}
// a branch, then its forks from points along it (most reach out toward the page edge), down to three levels
function grow(rand, lines, from, angle, len, depth) {
  const pts = zigzag(rand, from, [from[0] + Math.sin(angle) * len, from[1] + Math.cos(angle) * len], len * 0.24, 7 - depth);
  (lines[depth] ||= []).push(pts);
  if (depth === 3) return;
  for (let k = 0; k < [5, 3, 2][depth]; k++) {
    const at = pts[Math.floor((0.1 + rand() * 0.75) * (pts.length - 1))];
    const turn = (0.35 + rand() * 0.55) * (rand() < 0.65 ? -1 : 1);
    grow(rand, lines, at, Math.max(-1.3, Math.min(1.3, angle + turn)), len * (0.26 + rand() * 0.3), depth + 1);
  }
}
const toPath = (pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L');
function boltMarkup(side, seed) {
  const rand = seeded(seed), lines = [];
  grow(rand, lines, [W * (0.55 + rand() * 0.15), -10], (rand() - 0.5) * 0.12, H + 20, 0);
  const d = lines.map((group) => group.map(toPath).join(''));
  // sparks: start somewhere on the strike or its first forks, fall 50-120px with a little sideways drift, staggered
  const near = [...lines[0], ...lines[1]];
  const sparks = Array.from({ length: 5 }, () => {
    const branch = near[Math.floor(rand() * near.length)], [x, y] = branch[Math.floor((0.2 + rand() * 0.7) * (branch.length - 1))];
    return `<i style="left:${((Math.max(4, x) / W) * 100).toFixed(1)}%;top:${((Math.max(60, y) / H) * 100).toFixed(1)}%;--s:${(1.6 + rand()).toFixed(1)}px;--fall:${Math.round(50 + rand() * 70)}px;--dx:${Math.round((rand() - 0.5) * 20)}px;--t:${(7 + rand() * 5).toFixed(1)}s;--d:-${(rand() * 12).toFixed(1)}s"></i>`;
  }).join('');
  return `<div class="bg-bolt bg-bolt-${side}" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" focusable="false">
  <path class="halo" d="${d[0]}${d[1]}"/>${d.map((x, i) => `<path class="ln${i}" d="${x}"/>`).join('')}
</svg>${sparks}</div>`;
}
function mountBolts(bg) {
  if (bg.querySelector('.bg-bolt')) return;
  bg.insertAdjacentHTML('beforeend', boltMarkup('l', 20261114) + boltMarkup('r', 7340021));
}

const NO_CIRCUIT = true;
export function mountAmbient() {
  let bg = document.querySelector('body > .bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.className = 'bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<div class="bg-glow bg-glow-a"></div><div class="bg-glow bg-glow-b"></div><div class="bg-noise"></div>';
    document.body.prepend(bg);
  }
  mountBolts(bg);
  // the background is one solid colour now (edges.css): the circuit lines and their moving current are not drawn
  if (NO_CIRCUIT || bg.querySelector('.e-circuit')) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'e-circuit');
  svg.setAttribute('viewBox', '0 0 1440 900');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.innerHTML = TRACES.map((d) => `<path class="ec-trace" d="${d}"/>`).join('')
    + NODES.map(([x, y]) => `<circle class="ec-node" cx="${x}" cy="${y}" r="3"/>`).join('')
    + '<g class="ec-live"></g>';
  bg.appendChild(svg);
  runCurrents(svg);
}

// The current: now and then one trace carries a pulse of energy from the edge of the room to its node. It ignites,
// accelerates, runs the WHOLE trace in one quick move (duration from the trace's measured length, ~450–800 ms), flashes
// at the node and dissipates; then the circuit rests for a few seconds. Dash lengths are normalised with pathLength, so
// every trace is covered completely whatever its geometry. (Before: a fixed 1490-unit dash pattern on ~400-unit traces
// crawled a third of the way over 9 s and faded out mid-path.) Nothing runs with reduced motion, in a hidden tab, or
// while the circuit isn't displayed (phones).
function runCurrents(svg) {
  const live = svg.querySelector('.ec-live');
  const traces = [...svg.querySelectorAll('.ec-trace')];
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let last = -1;
  const wait = (ms) => setTimeout(fire, ms);
  function fire() {
    if (calm.matches || document.hidden || !svg.isConnected || getComputedStyle(svg).display === 'none' || typeof live.animate !== 'function') return wait(4000);
    let i = Math.floor(Math.random() * traces.length);
    if (i === last) i = (i + 1) % traces.length;
    last = i;
    const d = traces[i].getAttribute('d');
    const len = traces[i].getTotalLength();
    const ms = Math.round(Math.min(800, Math.max(450, 300 + len * 1.1)));
    const end = traces[i].getPointAtLength(len);
    live.innerHTML = `<path class="ec-glow" d="${d}" pathLength="100"/><path class="ec-core" d="${d}" pathLength="100"/>`
      + `<circle class="ec-spark" cx="${end.x}" cy="${end.y}" r="7"/>`;
    // the dash is 16% of the trace; it enters from before the start and leaves past the end, so it crosses all of it
    const run = [
      { strokeDashoffset: 16, opacity: 0 },
      { strokeDashoffset: 10, opacity: 1, offset: 0.08 },
      { strokeDashoffset: -94, opacity: 1, offset: 0.9 },
      { strokeDashoffset: -100, opacity: 0 },
    ];
    const timing = { duration: ms, easing: 'cubic-bezier(.55, .05, .35, 1)', fill: 'forwards' };
    live.querySelectorAll('path').forEach((p) => p.animate(run, timing));
    live.querySelector('.ec-spark').animate([
      { opacity: 0, transform: 'scale(.3)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.35 },
      { opacity: 0, transform: 'scale(1.9)' },
    ], { duration: 420, delay: ms * 0.82, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'both' });
    wait(ms + 420 + 2600 + Math.random() * 2600);
  }
  wait(1800);
}

export function mountHeaderState() {
  const bar = document.querySelector('.topbar');
  if (!bar || bar.dataset.eState) return;
  bar.dataset.eState = '1';
  let raf = 0;
  const update = () => { raf = 0; bar.classList.toggle('is-scrolled', scrollY > 8); };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  update();
}

// One indicator per nav. It rests under the current page's link; hover/focus glides it to that link; leaving
// returns it. Positioned with transform + width (no layout reads on every frame: only on hover/resize).
export function mountNavIndicator(nav) {
  const links = nav.querySelector('.nav-links');
  if (!links) return;
  let bar = links.querySelector('.nav-indicator');
  if (!bar) {
    bar = document.createElement('span');
    bar.className = 'nav-indicator';
    bar.setAttribute('aria-hidden', 'true');
    links.appendChild(bar);
  }
  const place = (a, instant) => {
    if (!a || getComputedStyle(links).flexDirection === 'column') { bar.style.opacity = '0'; return; }
    const lr = links.getBoundingClientRect(), r = a.getBoundingClientRect();
    if (instant) bar.style.transition = 'none';
    bar.style.width = `${Math.max(16, r.width - 24)}px`;
    bar.style.transform = `translateX(${r.left - lr.left + 12}px)`;
    bar.style.opacity = a.matches('[aria-current="page"]') || links.matches(':hover, :focus-within') ? '1' : '.0';
    if (instant) { void bar.offsetWidth; bar.style.transition = ''; }
  };
  const current = () => links.querySelector('.nav-link[aria-current="page"]');
  links.querySelectorAll('.nav-link').forEach((a) => {
    a.addEventListener('pointerenter', () => place(a));
    a.addEventListener('focus', () => place(a));
  });
  links.addEventListener('pointerleave', () => place(current()));
  links.addEventListener('focusout', () => setTimeout(() => { if (!links.contains(document.activeElement)) place(current()); }, 0));
  addEventListener('resize', () => place(current(), true), { passive: true });
  document.fonts?.ready?.then(() => place(current(), true));
  place(current(), true);
}
