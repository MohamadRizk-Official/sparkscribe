# Testing code that talks to Supabase, fetch or the DOM

Most of SparkScribe's pure logic is tested by importing the module and calling it. Modules that talk to Supabase, call
`fetch` or touch the page need a *stand-in* for the outside world. The tests below use three, all plain Node, with no
test framework and no network.

## 1. Make `supabase.js` "configured" (module hook)

`src/lib/supabase.js` reads Vite's `import.meta.env`, which Node does not have. `tests/vite-env-hook.mjs` rewrites it to
an empty object, so Supabase reads as **not configured** (this is what `tests/prefs-test.mjs` and others use).

To test the code that runs when Supabase **is** configured, a test registers its own small hook as a `data:` URL, which
rewrites `import.meta.env` to a made-up address instead:

```js
import { register } from 'node:module';
const hook = `export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (url.includes('/src/') && r.format === 'module' && r.source) {
    const env = '({NEXT_PUBLIC_SUPABASE_URL:"http://db.invalid",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_test"})';
    return { ...r, source: String(r.source).replace(/import\\.meta\\.env/g, env) };
  }
  return r;
}`;
register('data:text/javascript,' + encodeURIComponent(hook));   // before importing anything from src/
```

`.invalid` is a reserved top-level domain, so even a stand-in that were forgotten cannot reach a real server.

## 2. Replace `fetch`

The Supabase client, `/api/...` calls and Stripe-style requests all go through `globalThis.fetch`. A test replaces it with
a function that records the request and returns a canned `Response`:

```js
const sent = [];
let reply = () => ({ status: 200, body: [] });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://app.invalid');
  sent.push({ method: init.method || 'GET', path: u.pathname, query: u.searchParams, body: init.body ? JSON.parse(init.body) : null });
  const r = reply();
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
```

What the tests then assert on is the *request*: the Supabase REST path (`/rest/v1/transcriptions`), the method (`PATCH`,
`DELETE`), PostgREST filters in the query string (`id=eq.t1`, `id=in.(a,b)`), and the JSON body. Changing the reply per
test (`reply = () => ({ status: 409, body: { code: '23505' } })`) exercises each error branch.

Streamed answers (server-sent events) are faked with a `ReadableStream` whose chunks can be split mid-event; see
`tests/insights-api-calls-test.mjs`.

## 3. Be signed in

Outside a browser the Supabase client keeps its session in memory. A test signs in by handing it a token:

```js
await supabase.auth.setSession({ access_token: token, refresh_token: 'r' });
```

The token only has to be three dot-separated base64url parts whose payload has `exp` in the future (and `amr` when a
test cares about the sign-in method, as in `tests/recovery-guard-test.mjs`). The client checks it with `/auth/v1/user`,
which the `fetch` stand-in answers. Call `supabase.auth.signOut({ scope: 'local' })` to test the signed-out path.

After signing in, clear the recorded requests (`sent.length = 0`) so the sign-in lookup does not count as a call under test.

## 4. Fake just enough DOM

`tests/speaker-names-dom-test.mjs` shows the smallest useful DOM stand-in: elements as plain objects with `children`,
`parentElement` and a `closest(selector)` that understands the handful of selectors the code uses, a
`document.createTreeWalker` that walks them, and `NodeFilter` constants. Prefer this to adding a DOM library; if a function
needs more than this, split its logic into a pure function first.

## Do not

- Do not point a stand-in at a real hostname, and never put a real key or token in a test.
- Do not leave timers running: a test that creates a Supabase client should still exit by itself (the existing ones do).
- Do not change `src/` just to make something testable; if a real bug shows up, write it up in `docs/FOUND-ISSUES.md`.

## Where these are used

| Test | Covers |
|---|---|
| `tests/billing-plans-lookup-test.mjs` | server plan catalogue, cache, price → plan lookup |
| `tests/http-authenticate-test.mjs` | server `authenticate` (token check, recovery sessions, origin header) |
| `tests/library-data-calls-test.mjs` | Library queries, paging, folders, course exams |
| `tests/transcripts-data-calls-test.mjs` | saving (with retry safety), updating, deleting, the sign-in hand-off |
| `tests/billing-client-calls-test.mjs` | browser billing calls and error shaping |
| `tests/account-actions-test.mjs` | account deletion, sign-out, consent, email change |
| `tests/insights-api-calls-test.mjs` | browser calls to `/api/insights`, `/api/ask`, `/api/across`, `/api/tools` |
| `tests/recovery-guard-test.mjs` | ending sessions and guarding password-reset sessions |
| `tests/speaker-names-dom-test.mjs` | renaming speakers in rendered results |

See also [indexeddb-stand-in.md](indexeddb-stand-in.md) for the in-memory IndexedDB used by `tests/audio-store-idb-test.mjs`.
