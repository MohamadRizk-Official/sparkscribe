// Cloudflare Turnstile in front of Supabase Auth's CAPTCHA protection (email sign-up, password sign-in, password-reset
// and confirmation emails, and the password check before deleting an account). Google sign-in and setting a new
// password from a reset link don't need it.
//
// On only when the build has a public Site Key (VITE_TURNSTILE_SITE_KEY). Without one nothing is loaded and no token is
// sent, exactly as before. With one, every protected request carries a token; while CAPTCHA protection is still off in
// Supabase the token is simply ignored, so the site can ship before protection is switched on. The Secret Key lives
// only in Supabase (Authentication → Attack Protection); it never reaches this code.
//
// The widget is Cloudflare's Managed mode with appearance "interaction-only": usually invisible and finished in about
// a second; a checkbox appears only when Cloudflare wants a person to confirm. Tokens are single use and expire after
// five minutes, so a form asks for a fresh one per attempt (token()) and starts the next one right after (reset()).
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

// A widget in `container` (an empty element in the form). Returns { enabled, token(), reset(), remove() }; when Turnstile
// is off, token() resolves to undefined and nothing is shown.
export function createCaptcha(container, { action = 'auth' } = {}) {
  if (!captchaEnabled || !container) return { enabled: false, token: async () => undefined, reset() {}, remove() {} };
  let ts = null, id = null, token = null, state = 'loading', waiters = [];
  const wake = () => { for (const w of waiters.splice(0)) w(); };
  const restart = () => { token = null; state = 'loading'; try { ts?.reset(id); } catch { /* the next token() renders again */ } };
  container.classList.add('captcha-slot');
  const ready = loadTurnstile().then((t) => {
    ts = t;
    id = ts.render(container, {
      sitekey: SITE_KEY, action, appearance: 'interaction-only', size: 'flexible', theme: 'auto',
      'refresh-expired': 'auto', retry: 'auto',
      callback: (t2) => { token = t2; state = 'ready'; wake(); },
      // an unused token expired (five minutes): Turnstile fetches a new one by itself
      'expired-callback': () => { token = null; state = 'loading'; },
      // an interactive check left unanswered for too long: start over
      'timeout-callback': () => restart(),
      'error-callback': () => { token = null; state = 'error'; wake(); return true; },
      'before-interactive-callback': () => container.classList.add('is-interactive'),
      'after-interactive-callback': () => container.classList.remove('is-interactive'),
    });
  }, () => { state = 'load-error'; wake(); });

  return {
    enabled: true,
    // a fresh single-use token for one request; waits for the check to finish (or throws a CaptchaError to show)
    async token({ timeoutMs = 30000 } = {}) {
      await ready;
      if (state === 'load-error') { loading = null; throw new CaptchaError('load'); }
      if (state === 'error') restart(); // one more try on submit (e.g. a network blip earlier)
      const until = Date.now() + timeoutMs;
      while (!token && state !== 'error' && Date.now() < until) {
        await new Promise((r) => { waiters.push(r); setTimeout(r, 250); });
      }
      if (!token) {
        const code = state === 'error' ? 'failed' : 'timeout';
        restart();
        throw new CaptchaError(code);
      }
      const t = token;
      token = null; // used: never sent twice
      return t;
    },
    // after every attempt (success or not): start the next token in the background
    reset() { if (id != null) restart(); },
    remove() { try { if (id != null) ts?.remove(id); } catch { /* already gone */ } id = null; container.classList.remove('captcha-slot', 'is-interactive'); },
  };
}

// Supabase's reply when the token was missing, expired, reused or rejected by Cloudflare
export const isCaptchaRejection = (error) => error?.code === 'captcha_failed' || /captcha/i.test(error?.message || '');
export const CAPTCHA_REJECTED = 'The security check didn’t go through, so nothing was sent. Please try again.';
