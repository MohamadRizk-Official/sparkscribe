// The Light / Dark switch in every page's top bar. One source of truth for the appearance is lib/theme.js
// (html[data-theme]); this button only flips between light and dark and repaints when the theme changes
// for any reason (Settings, another tab, the device's own setting while on "System").
import { resolvedTheme } from './theme.js';
import { setThemePref } from './prefs.js';

const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';

// `anchor` is the account slot; the button goes just before it in the same top-bar row.
export function mountThemeToggle(anchor) {
  const bar = anchor?.parentElement || document.querySelector('.topbar-right');
  if (!bar || bar.querySelector('.theme-btn')) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-btn';
  const paint = () => {
    const dark = resolvedTheme() === 'dark';
    btn.innerHTML = dark ? SUN : MOON;
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  btn.addEventListener('click', () => setThemePref(resolvedTheme() === 'dark' ? 'light' : 'dark'));
  window.addEventListener('sparkscribe:theme', paint);
  paint();
  if (anchor && anchor.parentElement === bar) bar.insertBefore(btn, anchor);
  else bar.appendChild(btn);
  return btn;
}
