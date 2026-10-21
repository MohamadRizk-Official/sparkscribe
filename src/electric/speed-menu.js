// ELECTRIC — the playback speed selector. Clicking the current speed (e.g. "1×") opens a small menu of speeds instead
// of silently cycling through them; picking one applies it at once and closes the menu. Keyboard: arrows move,
// Enter/Space pick, Escape closes and returns focus. Used by both players (main.js results, pages/transcript.js).
export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const label = (r) => `${r}×`;

export function attachSpeedMenu(button, audio, { onChange } = {}) {
  let menu = null;
  const paint = () => {
    const r = audio.playbackRate || 1;
    button.textContent = label(r);
    button.setAttribute('aria-label', `Playback speed ${label(r)}. Change speed`);
    button.title = 'Playback speed';
  };
  const close = (focus = false) => {
    if (!menu) return;
    menu.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focus) button.focus();
  };
  const outside = (e) => { if (menu && !menu.contains(e.target) && e.target !== button) close(); };
  const pick = (r) => {
    audio.playbackRate = r;
    paint();
    onChange?.(r);
    close(true);
  };
  const open = () => {
    menu = document.createElement('div');
    menu.className = 'e-speed-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Playback speed');
    const cur = audio.playbackRate || 1;
    menu.innerHTML = SPEED_OPTIONS.map((r) => `<button type="button" role="menuitemradio" aria-checked="${r === cur}" data-r="${r}"><span>${label(r)}</span>${r === 1 ? '<small>Normal</small>' : ''}</button>`).join('');
    document.body.appendChild(menu);
    // above the button (players sit at the bottom of the screen), kept inside the viewport
    const b = button.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(b.left + b.width / 2 - w / 2, innerWidth - w - 8))}px`;
    menu.style.top = `${b.top - h - 10 < 8 ? b.bottom + 10 : b.top - h - 10}px`;
    button.setAttribute('aria-expanded', 'true');
    menu.addEventListener('click', (e) => { const it = e.target.closest('[data-r]'); if (it) pick(Number(it.dataset.r)); });
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('[data-r]')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); }
    });
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('[data-r]')).focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  };
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', (e) => { e.stopImmediatePropagation(); if (menu) close(); else open(); });
  addEventListener('scroll', () => close(), { passive: true });
  audio.addEventListener('ratechange', paint);
  paint();
  return { close };
}
