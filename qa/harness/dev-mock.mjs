// QA HARNESS dev server (auth release): the real pages with Supabase Auth imitated in the browser
// (browser-mock.js answers the auth and REST calls the pages make). No request reaches Supabase.
//   node qa/harness/dev-mock.mjs [port]                                      (default 5190)
//   VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA node qa/harness/dev-mock.mjs 5195   (with the Turnstile stand-in)
// Suites: open /qa/e2e/host.html, then import one, e.g. (await import('/qa/e2e/recovery.e2e.js')).run()
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const { createServer } = await import(pathToFileURL(resolve(ROOT, 'node_modules/vite/dist/node/index.js')).href);
const PORT = Number(process.argv[2]) || 5190;

const mockJs = readFileSync(resolve(HERE, 'browser-mock.js'), 'utf8');

const server = await createServer({
  root: ROOT,
  configFile: resolve(ROOT, 'vite.config.js'),
  server: { port: PORT, strictPort: true, hmr: false, host: '127.0.0.1' },
  plugins: [{
    name: 'qa-harness',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n<script>window.__HARNESS_SEED = [];\n${mockJs}</script>`),
  }],
});
await server.listen();
console.log(`QA harness on http://127.0.0.1:${PORT}`);
