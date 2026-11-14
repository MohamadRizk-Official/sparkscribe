// Turnstile wrapper (src/lib/captcha.js) with no site key, as in a build without VITE_TURNSTILE_SITE_KEY: the widget is off and
// forms send no token. Also the error messages and the rejection check. Loaded through tests/vite-env-hook.mjs.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const C = await import(new URL('../src/lib/captcha.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

ok(C.captchaEnabled === false, 'without a site key the check is disabled');

// ---- the "off" widget
const w = C.createCaptcha({ dataset: {}, classList: { add() { throw new Error('must not touch the page'); } } });
ok(w.enabled === false && w.state() === 'off', 'a disabled widget reports state "off"');
ok(w.take() === undefined, 'a disabled widget gives no token');
ok(await w.settle() === 'off', 'settle() resolves at once with "off"');
w.reset(); w.retry(); w.remove(); w.onChange(() => {});
ok(true, 'reset, retry, remove and onChange are harmless no-ops');
ok(C.createCaptcha(null).enabled === false && C.createCaptcha(undefined, { action: 'x' }).state() === 'off', 'a missing container also gives the off widget');

// ---- CaptchaError
const msg = (code) => new C.CaptchaError(code).message;
ok(new C.CaptchaError('load').code === 'load' && new C.CaptchaError('timeout').code === 'timeout', 'the error keeps its code');
ok(new C.CaptchaError('load') instanceof Error, 'it is an Error');
ok(/challenges\.cloudflare\.com/.test(msg('load')), 'a load error points at the blocked host');
ok(/longer than usual/.test(msg('timeout')), 'a timeout says it is slow');
ok(/couldn’t complete/.test(msg('failed')), 'a failure says the check could not be completed');
ok(msg('anything-else') === msg('failed') && msg(undefined) === msg('failed'), 'an unknown code uses the failure message');
ok(new C.CaptchaError('anything-else').code === 'anything-else', '…but the code is kept as given');

// ---- isCaptchaRejection
ok(C.isCaptchaRejection({ code: 'captcha_failed' }) === true, 'the captcha_failed code is a rejection');
ok(C.isCaptchaRejection({ message: 'captcha verification process failed' }) === true, 'a message mentioning captcha is a rejection');
ok(C.isCaptchaRejection({ message: 'Invalid CAPTCHA response' }) === true, 'case does not matter');
ok(C.isCaptchaRejection({ code: 'invalid_credentials', message: 'Invalid login credentials' }) === false, 'a wrong password is not a rejection');
ok(C.isCaptchaRejection(null) === false && C.isCaptchaRejection(undefined) === false && C.isCaptchaRejection({}) === false, 'no error is not a rejection');
ok(/^The security check didn’t go through/.test(C.CAPTCHA_REJECTED) && /nothing was sent/.test(C.CAPTCHA_REJECTED), 'the rejection text says nothing was sent');
console.log(`${pass} checks passed`);
