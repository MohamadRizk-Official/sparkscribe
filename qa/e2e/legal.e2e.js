// The published legal pages and the links to them. Run on any harness page.
import { waitFor, runTests, assert } from './lib.js';

const page = async (path) => new DOMParser().parseFromString(await (await fetch(path)).text(), 'text/html');
let frame;
async function open(path) {
  frame?.remove();
  frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:600px;opacity:.01;pointer-events:none';
  document.body.appendChild(frame);
  frame.src = path;
  await waitFor(() => frame.contentDocument?.readyState === 'complete' && frame.contentWindow.location.pathname === path.split('?')[0], { what: `load ${path}` });
  await new Promise((r) => setTimeout(r, 500));
  return frame.contentDocument;
}

export async function run() {
  const r = await runTests([
    ['/privacy and /terms are published: final text, effective date, no draft banner or review notes', async () => {
      for (const [path, heading] of [['/privacy', /Privacy Policy/], ['/terms', /Terms of Service/]]) {
        const d = await page(path);
        assert(heading.test(d.querySelector('h1')?.textContent || ''), `${path} heading`);
        assert(!d.querySelector('.legal-banner') && !/draft/i.test(d.title), `${path} no draft banner or title`);
        assert(!d.querySelectorAll('.legal-flag').length && !/\[(CONFIRM|LEGAL REVIEW)/.test(d.body.textContent), `${path} no review notes`);
        assert(/Effective date:\s*October \d+, 2026/.test(d.body.textContent), `${path} effective date`);
        assert(!/Draft for review, not legal advice/.test(d.body.textContent), `${path} internal reviewer note removed`);
      }
      const terms = await page('/terms');
      const tt = terms.body.textContent;
      assert(/Cancellation/.test(tt) && /Refunds/.test(tt) && /\$59 a year/.test(tt) && /doesn't apply to\s+yearly billing/.test(tt) && /Michigan/.test(tt), 'terms cover cancellation, refunds, yearly prices (no $1 offer on yearly) and Michigan law');
      const pp = (await page('/privacy')).body.textContent;
      assert(/Cloudflare \(Turnstile\)/.test(pp) && /Resend/.test(pp) && /exam date/.test(pp) && /monthly or yearly/.test(pp), 'privacy lists Turnstile and Resend, courses/exams, billing interval');
    }],
    ['every main page has the site footer (Pricing, Help, Contact, Privacy, Terms); sign-up asks for the age and Terms tick', async () => {
      const want = ['/pricing', '/help', 'mailto:contact.hrstudios@gmail.com', '/privacy', '/terms'];
      for (const path of ['/library', '/help']) { // served HTML (signed out, /library redirects)
        const hrefs = [...(await page(path)).querySelectorAll('.foot-links a')].map((a) => a.getAttribute('href'));
        assert(JSON.stringify(hrefs) === JSON.stringify(want), `${path} footer (served HTML): ${hrefs}`);
      }
      for (const path of ['/', '/settings', '/pricing']) {
        const d = await open(path);
        const hrefs = [...d.querySelectorAll('.foot-links a')].map((a) => a.getAttribute('href'));
        assert(want.every((h) => hrefs.includes(h)), `${path} footer links (${hrefs})`);
      }
      frame.remove();
      // the sign-up tick (served HTML; when it's shown is covered by auth.e2e.js, which runs signed out)
      const age = (await page('/auth')).getElementById('ageField');
      assert(age && /13 or older/.test(age.textContent) && age.querySelector('#ageOk[type="checkbox"]') && age.querySelector('a[href="/terms"]') && age.querySelector('a[href="/privacy"]'), 'sign-up: age + Terms/Privacy tick');
    }],
  ]);
  return r;
}
