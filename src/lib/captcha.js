// Cloudflare Turnstile in front of Supabase Auth's CAPTCHA protection (email sign-up, password sign-in, password-reset
// and confirmation emails, and the password check before deleting an account). Google sign-in and setting a new
// password from a reset link don't need it.
//
// On only when the build has a public Site Key (VITE_TURNSTILE_SITE_KEY). Without one nothing is loaded and no token is
// sent, exactly as before. With one, every protected request carries a token; while CAPTCHA protection is still off in
// Supabase the token is simply ignored, so the site can ship before protection is switched on. The Secret Key lives
// only in Supabase (Authentication → Attack Protection); it never reaches this code.
//
// The widget is Cloudflare's Managed mode with appearance "always": a small box that is always there (no layout jumps),
// shows "Success" when Cloudflare is satisfied without a click, and a "Verify you are human" checkbox when it wants one.
// Tokens are single use and expire after five minutes, so each request takes the current token (take()) and the widget
// starts the next challenge at once (reset()).
//
// States (state(), and onChange(fn)):
//   loading      script or widget starting
//   verifying    Cloudflare is checking, no input needed (usually about a second)
//   interactive  Cloudflare shows its checkbox and waits for the person
//   ready        a fresh, unused token is available
//   expired      the token ran out unused; Cloudflare is fetching a new one
//   error        the challenge failed (retry() starts again)
//   unavailable  the script could not load (blocked, offline)
// A form never waits on "interactive": it tells the person to complete the check. It waits briefly on loading /
// verifying / expired (settle()), and on error / unavailable it sends without a token so Supabase decides.
const SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
export const captchaEnabled = /^[0-9A-Za-z_-]{10,}$/.test(SITE_KEY);
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export class CaptchaError extends Error {
  constructor(code) {
    super({
      load: 'The security check couldn’t load. Check your connection (and any content blocker for challenges.cloudflare.com), then try again.',
      timeout: 'The security check is taking longer than usual. Please try again.',
      failed: 'We couldn’t complete the security check. Please try again.',
    }[code] || 'We couldn’t complete the security check. Please try again.');
    this.code = code;
  }
}

let loading = null;
function loadTurnstile(timeoutMs = 15000) {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return (loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    const fail = () => { clearTimeout(timer); loading = null; s.remove(); reject(new CaptchaError('load')); };
    const timer = setTimeout(fail, timeoutMs);
    s.onload = () => { clearTimeout(timer); if (window.turnstile) resolve(window.turnstile); else fail(); };
    s.onerror = fail;
    document.head.appendChild(s);
  }));
}

// A widget in `container` (an empty element in the form). When Turnstile is off, state() is 'off' and take() gives undefined.
export function createCaptcha(container, { action = 'auth', onChange } = {}) {
  const off = { enabled: false, state: () => 'off', take: () => undefined, settle: async () => 'off', reset() {}, retry() {}, remove() {}, onChange() {} };
  if (!captchaEnabled || !container) return off;
  let ts = null, id = null, token = null, state = 'loading';
  const listeners = new Set(onChange ? [onChange] : []);
  const set = (next) => {
    if (state === next) return;
    state = next;
    container.dataset.captcha = next;
    container.classList.toggle('is-interactive', next === 'interactive');
    for (const fn of listeners) { try { fn(next); } catch { /* a listener's problem stays there */ } }
  };
  container.classList.add('captcha-slot');
  container.dataset.captcha = state;
  const render = () => {
    id = ts.render(container, {
      sitekey: SITE_KEY, action, appearance: 'always', size: 'flexible', theme: 'auto',
      'refresh-expired': 'auto', 'refresh-timeout': 'auto', retry: 'auto',
      callback: (t) => { token = t; set('ready'); },
      'expired-callback': () => { token = null; set('expired'); },
      'timeout-callback': () => { token = null; set('interactive'); },
      'error-callback': () => { token = null; set('error'); return true; },
      'unsupported-callback': () => { token = null; set('unavailable'); },
      'before-interactive-callback': () => { token = null; set('interactive'); },
      'after-interactive-callback': () => { if (!token) set('verifying'); },
    });
    if (!token && state === 'loading') set('verifying');
  };
  loadTurnstile().then((t) => { ts = t; render(); }, () => set('unavailable'));

  const api = {
    enabled: true,
    state: () => state,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // the current token for ONE request; it is never handed out twice
    take() {
      if (state !== 'ready' || !token) return undefined;
      const t = token;
      token = null;
      set('verifying');
      return t;
    },
    // wait (at most timeoutMs) until the check needs nothing more from Cloudflare: ready, interactive, error or unavailable
    settle(timeoutMs = 10000) {
      const done = (s) => s === 'ready' || s === 'interactive' || s === 'error' || s === 'unavailable';
      if (done(state)) return Promise.resolve(state);
      return new Promise((resolve) => {
        const stop = api.onChange((s) => { if (done(s)) { clearTimeout(timer); stop(); resolve(s); } });
        const timer = setTimeout(() => { stop(); resolve(state); }, timeoutMs);
      });
    },
    // after every request (success or not): drop whatever token is left and start the next challenge
    reset() {
      token = null;
      if (!ts || id == null) return;
      set('verifying');
      try { ts.reset(id); } catch { api.retry(); }
    },
    // start over after an error (or a script that has since loaded)
    retry() {
      token = null;
      if (!ts) { loading = null; set('loading'); loadTurnstile().then((t) => { ts = t; render(); }, () => set('unavailable')); return; }
      try { if (id != null) ts.remove(id); } catch { /* already gone */ }
      id = null;
      set('loading');
      render();
    },
    remove() { try { if (id != null) ts?.remove(id); } catch { /* already gone */ } id = null; listeners.clear(); container.classList.remove('captcha-slot', 'is-interactive'); },
  };
  return api;
}

// Supabase's reply when the token was missing, expired, reused or rejected by Cloudflare
export const isCaptchaRejection = (error) => error?.code === 'captcha_failed' || /captcha/i.test(error?.message || '');
export const CAPTCHA_REJECTED = 'The security check didn’t go through, so nothing was sent. Please try again.';
