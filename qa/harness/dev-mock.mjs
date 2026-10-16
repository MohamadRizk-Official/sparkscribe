// QA HARNESS dev server: the real app + real /api code, with a fake signed-in user, an in-memory database
// and the mock AI provider. No Supabase or Anthropic calls leave this machine for /api/*, and the browser
// mock (browser-mock.js) answers the Supabase REST/auth calls the pages make.
//   node qa/harness/dev-mock.mjs [port]      (default 5190)
// Test-only endpoints under /__harness/: seed, artifact(s), state, fail (mock AI failure), model (model override), ai-limits.
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const { createServer } = await import(pathToFileURL(resolve(ROOT, 'node_modules/vite/dist/node/index.js')).href);
const { memoryStore } = await import(pathToFileURL(resolve(ROOT, 'tests/memory-store.mjs')).href);
const PORT = Number(process.argv[2]) || 5190;

mkdirSync(resolve(ROOT, 'qa/out'), { recursive: true });
process.env.SPARKSCRIBE_DEV_HARNESS = '1';
// mock AI: no Anthropic calls. HARNESS_REAL_AI=1 uses the real model instead (key from .env.local; synthetic recordings
// only), for demonstrating AI output; the database and sign-in stay mocked either way.
process.env.AI_PROVIDER = process.env.HARNESS_REAL_AI === '1' ? '' : 'mock';
process.env.VITE_ACCOUNT_DELETION = '1'; // show Settings > Delete account (its RPC is mocked in browser-mock.js)
process.env.AI_USAGE_LOG = resolve(ROOT, 'qa/out/ai-usage.jsonl');

const store = memoryStore();
globalThis.__sparkscribeDevHarness = { context: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' }, db: store }), store };

const seedRows = JSON.parse(readFileSync(resolve(HERE, 'seed.json'), 'utf8'));
const mockJs = readFileSync(resolve(HERE, 'browser-mock.js'), 'utf8');

const server = await createServer({
  root: ROOT,
  configFile: resolve(ROOT, 'vite.config.js'),
  server: { port: PORT, strictPort: true, hmr: false, host: '127.0.0.1' },
  plugins: [{
    name: 'qa-harness',
    configureServer(s) {
      // billing never runs here: it would call Supabase/Stripe for real (the browser mock answers /api/billing)
      s.middlewares.use((req, res, next) => {
        if (/^\/api\/(billing|stripe-webhook)/.test(req.url)) { res.statusCode = 501; res.setHeader('content-type', 'application/json'); return res.end('{"error":"not_in_harness"}'); }
        next();
      });
      s.middlewares.use('/__harness/seed', (req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => { store.seed(JSON.parse(raw)); res.end('ok'); });
      });
      s.middlewares.use('/__harness/artifact', (req, res) => { // seed a stored Create result (e.g. from an earlier engine)
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(store.seedArtifact(JSON.parse(raw)))); });
      });
      // the browser's own writes to a Create result: progress only (the column users may change), or delete
      s.middlewares.use('/__harness/artifact-write', (req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const { id, method, patch } = JSON.parse(raw || '{}');
          const i = store._a.findIndex((a) => a.id === id);
          if (i < 0) { res.statusCode = 404; return res.end('{}'); }
          if (method === 'DELETE') store._a.splice(i, 1);
          else if (patch && 'progress' in patch) store._a[i].progress = patch.progress;
          res.end('{}');
        });
      });
      s.middlewares.use('/__harness/artifacts', (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(store._a)); });
      s.middlewares.use('/__harness/model', (req, res) => {
        const q = new URL(req.url, 'http://x').searchParams;
        const k = q.get('task');
        if (!/^AI_MODEL(_SUMMARY|_ASK|_INSIGHTS)?$/.test(k || '')) { res.statusCode = 400; return res.end('bad'); }
        if (q.get('value')) process.env[k] = q.get('value'); else delete process.env[k];
        res.end(`${k}=${process.env[k] ?? '(default)'}`);
      });
      s.middlewares.use('/__harness/ai-limits', (req, res) => { // ?perHour=N&budget=µ$ (no params = unlimited); ledger count in the reply
        const q = new URL(req.url, 'http://x').searchParams;
        store.aiLimits = q.has('force') ? { force: q.get('force') } : q.has('perHour') ? { perHour: Number(q.get('perHour')), budget: Number(q.get('budget') ?? 1e9) } : null;
        if (q.has('clear')) store._ai.length = 0;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ limits: store.aiLimits, ledger: store._ai }));
      });
      s.middlewares.use('/__harness/fail', (req, res) => {
        process.env.AI_MOCK_FAIL = req.url.includes('on=1') ? '1' : '';
        res.end('fail=' + process.env.AI_MOCK_FAIL);
      });
      s.middlewares.use('/__harness/state', (req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ transcriptions: [...store._t.values()].map((t) => ({ id: t.id, v: t.content_version, type: t.recording_type, segments: t.segments?.length ?? 0 })), insights: store._i, questions: store._q }));
      });
    },
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n<script>window.__HARNESS_SEED = ${JSON.stringify(seedRows)};\n${mockJs}</script>`),
  }],
});
await server.listen();
console.log(`QA harness on http://127.0.0.1:${PORT}`);
