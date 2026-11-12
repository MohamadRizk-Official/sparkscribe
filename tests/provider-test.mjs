// Model selection (server/ai/provider.js): taskConfig and getProvider.
import assert from 'node:assert/strict';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
for (const k of ['AI_MODEL', 'AI_MODEL_SUMMARY', 'AI_MODEL_INSIGHTS', 'AI_MODEL_TOOLS', 'AI_MODEL_ASK', 'AI_PROVIDER', 'ANTHROPIC_API_KEY', 'VERCEL_ENV']) delete process.env[k];

const P = await import(new URL('../server/ai/provider.js', import.meta.url).href);

// ---- taskConfig ----
let c = P.taskConfig('ask');
ok(c.model === 'claude-haiku-5-5' && c.effort === 'low' && c.maxTokens === 3000, 'ask defaults to Haiku, low effort, 3000 tokens');
ok(!('timeoutMs' in c), 'a task without a timeout has no timeoutMs key');
c = P.taskConfig('flashcards');
ok(c.effort === 'medium' && c.maxTokens === 24000 && c.timeoutMs === 170000, 'flashcards get more room and a timeout');
ok(P.taskConfig('quiz:verify').timeoutMs === 75000 && P.taskConfig('quiz:recheck').maxTokens === 6000, 'verify and recheck have their own limits');
ok(P.taskConfig('across:guide').maxTokens === 16000 && P.taskConfig('across:ask').timeoutMs === 50000, 'across tasks have their own settings');
ok(P.taskConfig('studymap:section:3').maxTokens === 16000, 'a task with extra suffixes matches its two-part prefix');
ok(P.taskConfig('flashcards:extra:more').timeoutMs === 170000, 'a longer name falls back to its first part');
ok(P.taskConfig('no_such_task').maxTokens === 10000 && P.taskConfig('no_such_task').effort === 'medium', 'an unknown task uses the insights settings');

process.env.AI_MODEL = 'global-model';
ok(P.taskConfig('ask').model === 'global-model', 'AI_MODEL overrides the default for every task');
process.env.AI_MODEL_ASK = 'ask-model';
ok(P.taskConfig('ask').model === 'ask-model' && P.taskConfig('expand').model === 'ask-model', 'a per-group variable beats AI_MODEL');
ok(P.taskConfig('notes').model === 'global-model', 'other groups still use AI_MODEL');
process.env.AI_MODEL_TOOLS = 'tools-model';
ok(P.taskConfig('quiz:verify').model === 'tools-model' && P.taskConfig('grade').model === 'tools-model', 'the tools group covers study tools and grading');
process.env.AI_MODEL_SUMMARY = 'summary-model';
ok(['overview', 'detailed_summary', 'notes', 'reduce'].every((t) => P.taskConfig(t).model === 'summary-model'), 'the summary group covers overview, detailed summary, notes and reduce');
process.env.AI_MODEL_INSIGHTS = 'insights-model';
ok(P.taskConfig('insights').model === 'insights-model', 'insights has its own variable');
for (const k of ['AI_MODEL', 'AI_MODEL_SUMMARY', 'AI_MODEL_INSIGHTS', 'AI_MODEL_TOOLS', 'AI_MODEL_ASK']) delete process.env[k];

// ---- getProvider ----
let err = null;
try { P.getProvider(); } catch (e) { err = e; }
ok(err instanceof P.AIError && err.status === 503 && err.code === 'not_configured', 'no API key gives a 503 not_configured error');

process.env.VERCEL_ENV = 'production';
process.env.AI_PROVIDER = 'mock';
err = null;
try { P.getProvider(); } catch (e) { err = e; }
ok(err?.code === 'not_configured', 'the mock provider is refused in production');

delete process.env.VERCEL_ENV;
const mock = P.getProvider();
ok(mock && typeof mock === 'object', 'outside production AI_PROVIDER=mock returns the mock provider');
ok(P.getProvider() === mock, 'the provider is cached after the first call');

console.log(`${pass} checks passed`);
