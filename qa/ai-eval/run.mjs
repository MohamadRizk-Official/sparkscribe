// Study-engine evaluation: the same recordings through the earlier engine (the code at a git commit) and the
// current one, with the real model, then objective measures (metrics.mjs) for each result.
//
//   node qa/ai-eval/run.mjs [--engines old,new] [--tools flashcards,quiz] [--cases id,…]
//                           [--private path/to/segments.json] [--out dir] [--old-commit 96a1ebc]
//
// Uses ANTHROPIC_API_KEY (from the environment or .env.local; never printed). Costs a few cents per full run.
// Results go to qa/out/ai-eval (git-ignored). A --private recording (a real transcript) is read from outside the
// repo and its results are written only to --out, which should be outside the repo too.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES, segmentsOf } from './fixtures.mjs';
import { measure } from './metrics.mjs';
import { memoryStore } from '../../tests/memory-store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const engines = arg('engines', 'old,new').split(',');
const tools = arg('tools', 'flashcards,quiz').split(',');
const only = arg('cases', '') ? arg('cases').split(',') : null;
const privatePath = arg('private', '');
const out = resolve(arg('out', resolve(ROOT, 'qa/out/ai-eval')));
const oldCommit = arg('old-commit', '96a1ebc');
mkdirSync(out, { recursive: true });

if (!process.env.ANTHROPIC_API_KEY) {
  const env = existsSync(resolve(ROOT, '.env.local')) ? readFileSync(resolve(ROOT, '.env.local'), 'utf8') : '';
  const m = /^ANTHROPIC_API_KEY=(.+)$/m.exec(env);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(2); }
delete process.env.AI_PROVIDER;
process.env.STUDY_DEBUG_DROPS = '1'; // keep what the checks dropped (and why), to audit false rejections

// the earlier engine: the app's server code exactly as it was at that commit
const OLD_REL = `qa/out/ai-eval/_engine-${oldCommit}`;
const OLD_DIR = resolve(ROOT, OLD_REL);
if (engines.includes('old') && !existsSync(resolve(OLD_DIR, 'server/ai/service.js'))) {
  mkdirSync(OLD_DIR, { recursive: true });
  execSync(`git archive ${oldCommit} server src/lib | tar -x -C "${OLD_REL}"`, { cwd: ROOT, stdio: 'inherit', shell: 'bash' });
}
const svcOf = {
  old: engines.includes('old') ? await import(pathToFileURL(resolve(OLD_DIR, 'server/ai/service.js')).href) : null,
  new: engines.includes('new') ? await import(pathToFileURL(resolve(ROOT, 'server/ai/service.js')).href) : null,
};

// usage lines ([ai-usage] {…}) carry tokens, latency and cost; collect them per run
let usage = [];
const log = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[ai-usage] ')) { try { usage.push(JSON.parse(a[0].slice(11))); } catch {} return; } log(...a); };

const cases = CASES.filter((c) => !only || only.includes(c.id)).map((c) => ({ ...c, segments: segmentsOf(c) }));
if (privatePath) {
  const segments = JSON.parse(readFileSync(privatePath, 'utf8'));
  cases.push({ id: 'private-lecture', title: 'Real 1:33 lecture (private)', type: 'lecture', minutes: (segments.at(-1)?.e || 0) / 60, segments, private: true });
}

const rows = [];
for (const c of cases) {
  for (const engine of engines) {
    for (const kind of tools) {
      const db = memoryStore();
      const T = '44444444-4444-4444-8444-444444444444';
      db.seed({ id: T, title: c.title, duration_seconds: Math.round(c.minutes * 60), transcript_text: 'x', segments: c.segments, recording_type: c.type });
      usage = [];
      const t0 = Date.now();
      let content = null, error = null;
      try { content = (await svcOf[engine].generateArtifact(db, { transcriptionId: T, kind })).artifact.content; } catch (e) { error = e.message; }
      const ms = Date.now() - t0;
      const calls = usage.filter((u) => !u.cached);
      const cost = calls.reduce((s, u) => s + (u.actualCostUsd ?? u.estimatedCostUsd ?? 0), 0);
      const tokens = { input: calls.reduce((s, u) => s + (u.inputTokens || 0), 0), output: calls.reduce((s, u) => s + (u.outputTokens || 0), 0) };
      const m = content ? measure(kind, content, c) : {};
      const row = { case: c.id, engine, kind, error, seconds: Math.round(ms / 100) / 10, costUsd: Math.round(cost * 1e6) / 1e6, ...tokens, ...m, quality: content?.quality || null };
      rows.push(row);
      writeFileSync(resolve(out, `${c.id}.${engine}.${kind}.json`), JSON.stringify({ row, content }, null, 1));
      log(`${c.id.padEnd(22)} ${engine} ${kind.padEnd(10)} ${error ? `ERROR ${error}` : `${String(m.n).padStart(2)} items · ${row.seconds}s · $${row.costUsd.toFixed(4)}`}`);
    }
  }
}
writeFileSync(resolve(out, 'summary.json'), JSON.stringify(rows, null, 1));
log(`\nwrote ${rows.length} results to ${out}`);
