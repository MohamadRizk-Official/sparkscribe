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

// The side margins: a calm pattern of flowing lines, so the background is never bare (owner request 2026-11-14,
// replacing the book outlines). One branching network per side: a line from the top of the page that gently curves and
// divides, and divides again, every branch growing out of another so the whole pattern is connected. Drawn once from a
// fixed seed (the same pattern on every visit), in soft muted strokes that thin and fade with each division. Now and
// then a soft light runs slowly down one of the lines from where it starts and fades out partway (runPulses).
// Drawn for the left margin (x 0 = the page edge, x W = the content side; lines that reach further fade out before it,
// base.css); the right one is mirrored in CSS.
const W = 300, H = 1000; // viewBox of a margin
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
// a branch walks in even steps, turning a little at each (with a slow overall bend), so it curves instead of zigzagging;
// then its own branches start from points along it, most leaning out toward the page edge, down to three levels
function grow(rand, lines, from, angle, len, depth) {
  const step = 42, pts = [from], bend = (rand() - 0.5) * 0.08;
  for (let i = 0, a = angle; i < Math.max(3, Math.round(len / step)); i++) {
    a = Math.max(-1.2, Math.min(1.2, a + bend + (rand() - 0.5) * 0.3));
    const [x, y] = pts[pts.length - 1];
    pts.push([x + Math.sin(a) * step, y + Math.cos(a) * step]);
  }
  (lines[depth] ||= []).push(pts);
  if (depth === 3) return;
  for (let k = 0; k < [6, 3, 2][depth]; k++) {
    const at = pts[1 + Math.floor(rand() * (pts.length - 2))];
    const turn = (0.3 + rand() * 0.45) * (rand() < 0.65 ? -1 : 1);
    grow(rand, lines, at, angle + turn, len * (0.32 + rand() * 0.3), depth + 1);
  }
}
// a smooth curve through the points (Catmull-Rom as cubic Béziers)
const f = (v) => v.toFixed(1);
function smooth(pts) {
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], [x1, y1] = pts[i], [x2, y2] = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    d += `C${f(x1 + (x2 - p0[0]) / 6)} ${f(y1 + (y2 - p0[1]) / 6)} ${f(x2 - (p3[0] - x1) / 6)} ${f(y2 - (p3[1] - y1) / 6)} ${f(x2)} ${f(y2)}`;
  }
  return d;
}
function patternMarkup(side, seed) {
  const rand = seeded(seed), lines = [];
  grow(rand, lines, [W * (0.5 + rand() * 0.15), -20], (rand() - 0.5) * 0.1, H + 60, 0);
  const curves = lines.map((group) => group.map(smooth));
  const html = `<div class="bg-bolt bg-bolt-${side}" aria-hidden="true"><svg class="bt-net" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" focusable="false">
  ${curves.map((group, i) => `<path class="ln${i}" d="${group.join('')}"/>`).join('')}
</svg><svg class="bt-live" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" focusable="false"></svg></div>`;
  // the lights run on the longer lines more often than on the smallest ones
  return { html, routes: curves.flatMap((group, i) => group.map((d) => [d, 4 - i])) };
}
function mountBolts(bg) {
  if (bg.querySelector('.bg-bolt')) return;
  const sides = [patternMarkup('l', 20261114), patternMarkup('r', 7340021)];
  bg.insertAdjacentHTML('beforeend', sides.map((x) => x.html).join(''));
  runPulses([...bg.querySelectorAll('.bt-live')].map((svg, i) => [svg, sides[i].routes]));
}

// The lights: every 1-2.8 s (at most four at a time) one starts at the top of a random line, runs slowly down it as a
// short soft glow and fades out somewhere between 40% and the end. Nothing runs with reduced motion, in a hidden tab, or
// while the pattern isn't displayed (narrow screens).
function runPulses(sides) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)'), shown = matchMedia('(min-width: 1680px)');
  let live = 0;
  const pick = (routes) => {
    let r = Math.random() * routes.reduce((t, [, w]) => t + w, 0);
    return routes.find(([, w]) => (r -= w) < 0)?.[0] || routes[0][0];
  };
  const pulse = () => {
    const [svg, routes] = sides[Math.floor(Math.random() * sides.length)], d = pick(routes);
    const g = document.createElementNS(SVG_NS, 'g');
    g.innerHTML = `<path class="glow" d="${d}"/><path class="core" d="${d}"/>`;
    svg.appendChild(g);
    // a comet: the soft glow and the bright core share a head, the glow trails further behind it
    const total = g.firstChild.getTotalLength(), dash = 120 + Math.random() * 100, run = total * (0.4 + Math.random() * 0.6) + dash;
    const timing = { duration: Math.max(4000, run * 16), easing: 'cubic-bezier(.35, 0, .65, 1)' };
    let done = 0;
    live++;
    [...g.children].forEach((path, i) => {
      const len = i ? dash * 0.45 : dash;
      path.style.strokeDasharray = `${len} ${total + dash * 2}`;
      path.animate([{ strokeDashoffset: len, opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.65 }, { strokeDashoffset: len - run, opacity: 0 }], timing)
        .onfinish = () => { if (++done === 2) { g.remove(); live--; } };
    });
  };
  const tick = () => {
    if (!calm.matches && shown.matches && !document.hidden && live < 4) pulse();
    setTimeout(tick, 1000 + Math.random() * 1800);
  };
  setTimeout(tick, 800);
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
