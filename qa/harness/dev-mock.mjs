// QA HARNESS dev server: the real app + real /api code, with a fake signed-in user, an in-memory database
// and the mock AI provider. No Supabase or Anthropic calls leave this machine for /api/*, and the browser
// mock (browser-mock.js) answers the Supabase REST/auth calls the pages make.
//   node qa/harness/dev-mock.mjs [port]      (default 5190)
// Test-only endpoints under /__harness/: seed, state, fail (mock AI failure), model (model override).
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
process.env.AI_PROVIDER = 'mock'; // mock AI: no Anthropic calls
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
      s.middlewares.use('/__harness/seed', (req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => { store.seed(JSON.parse(raw)); res.end('ok'); });
      });
      s.middlewares.use('/__harness/model', (req, res) => {
        const q = new URL(req.url, 'http://x').searchParams;
        const k = q.get('task');
        if (!/^AI_MODEL(_SUMMARY|_ASK|_INSIGHTS)?$/.test(k || '')) { res.statusCode = 400; return res.end('bad'); }
        if (q.get('value')) process.env[k] = q.get('value'); else delete process.env[k];
        res.end(`${k}=${process.env[k] ?? '(default)'}`);
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
