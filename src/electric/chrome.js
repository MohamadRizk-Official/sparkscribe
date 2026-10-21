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

export function mountAmbient() {
  let bg = document.querySelector('body > .bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.className = 'bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<div class="bg-glow bg-glow-a"></div><div class="bg-glow bg-glow-b"></div><div class="bg-noise"></div>';
    document.body.prepend(bg);
  }
  if (bg.querySelector('.e-circuit')) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'e-circuit');
  svg.setAttribute('viewBox', '0 0 1440 900');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.innerHTML = '<defs><linearGradient id="ecGrad" x1="0" x2="1"><stop offset="0" stop-color="#20d4f4" stop-opacity="0"/><stop offset=".6" stop-color="#20d4f4"/><stop offset="1" stop-color="#8fb3ff"/></linearGradient></defs>'
    + TRACES.map((d) => `<path class="ec-trace" d="${d}"/>`).join('')
    + NODES.map(([x, y]) => `<circle class="ec-node" cx="${x}" cy="${y}" r="3"/>`).join('')
    + `<path class="ec-current" d="${TRACES[0]}"/><path class="ec-current b" d="${TRACES[2]}"/>`;
  bg.appendChild(svg);
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
