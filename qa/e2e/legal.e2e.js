// Draft legal pages and the links to them. Run on any harness page.
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
    ['/privacy and /terms are served, clearly marked as drafts, with review notes highlighted', async () => {
      for (const [path, heading] of [['/privacy', /Privacy Policy/], ['/terms', /Terms of Service/]]) {
        const d = await page(path);
        assert(heading.test(d.querySelector('h1')?.textContent || ''), `${path} heading`);
        assert(/Draft, not yet in effect/.test(d.querySelector('.legal-banner')?.textContent || ''), `${path} draft banner`);
        assert(/\(draft\)/.test(d.title), `${path} title says draft`);
        assert(d.querySelectorAll('.legal-flag').length > 5, `${path} review notes highlighted`);
        assert(!/Draft for review, not legal advice/.test(d.body.textContent), `${path} internal reviewer note removed`);
      }
      const terms = await page('/terms');
      assert(/not available yet/.test(terms.body.textContent) && /Cancellation/.test(terms.body.textContent) && /Refunds/.test(terms.body.textContent), 'terms cover paid plans being unavailable, cancellation and refunds');
    }],
    ['every main page links to Privacy and Terms; sign-up points to them without asking to "agree" to drafts', async () => {
      const lib = await page('/library'); // signed out it redirects, so check its served HTML
      assert([...lib.querySelectorAll('.legal-links a')].length === 2, '/library footer links (served HTML)');
      for (const path of ['/', '/settings', '/pricing']) {
        const d = await open(path);
        const hrefs = [...d.querySelectorAll('.legal-links a')].map((a) => a.getAttribute('href'));
        assert(hrefs.includes('/privacy') && hrefs.includes('/terms'), `${path} footer links (${hrefs})`);
      }
      const d = await open('/auth?mode=signup');
      const line = d.getElementById('authLegal');
      assert(line && !line.classList.contains('hidden') && /Privacy Policy/.test(line.textContent) && !/agree/i.test(line.textContent), 'sign-up line shown, no "agree"');
      frame.remove();
    }],
  ]);
  return r;
}
