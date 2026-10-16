// Which model does what. One place to change models or providers; nothing else calls an AI API.
//
// Defaults: Claude Haiku 5.5 for everything (fast, and about $0.10 / $0.50 per million input/output
// tokens for prompts under 100k tokens). Each task can be moved to another model with an environment
// variable, e.g. AI_MODEL_ASK=claude-sonnet-5-5, without code changes.
import { anthropicProvider, AIError } from './anthropic.js';
import { mockProvider } from './mock.js';

const DEFAULT_MODEL = 'claude-haiku-5-5';

// effort: how much the model may think. Extraction/summaries benefit from "medium"; Ask and keyword
// expansion are quick lookups → "low" for speed. max_tokens includes thinking, so it is a ceiling, not a
// target; the prompts ask for short outputs.
const TASKS = {
  overview: { env: 'AI_MODEL_SUMMARY', effort: 'medium', maxTokens: 8000 },
  detailed_summary: { env: 'AI_MODEL_SUMMARY', effort: 'medium', maxTokens: 10000 },
  notes: { env: 'AI_MODEL_SUMMARY', effort: 'medium', maxTokens: 10000 },
  insights: { env: 'AI_MODEL_INSIGHTS', effort: 'medium', maxTokens: 10000 },
  reduce: { env: 'AI_MODEL_SUMMARY', effort: 'medium', maxTokens: 10000 },
  // Phase 5 tools (Create tab): same default model; long structured outputs get more room
  study_guide: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 16000 },
  // study engine 2 writes a knowledge map before the cards / questions: more room
  // and takes longer: up to ~2 minutes for a 90-minute lecture (api/tools may run 300 s; a coverage pass may follow)
  flashcards: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 24000, timeoutMs: 170_000 },
  quiz: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 24000, timeoutMs: 170_000 },
  // study engine 3: one call per section of the recording (in parallel), then merging the sections' maps
  studymap: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 16000, timeoutMs: 120_000 },
  // checking written items: short prompts and outputs; a short timeout so a slow check can't outlive the function
  'flashcards:verify': { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 12000, timeoutMs: 75_000 },
  'quiz:verify': { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 12000, timeoutMs: 75_000 },
  'flashcards:recheck': { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 6000, timeoutMs: 45_000 },
  'quiz:recheck': { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 6000, timeoutMs: 45_000 },
  definitions: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 8000 },
  exam_points: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 8000 },
  meeting_recap: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 12000 },
  action_plan: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 8000 },
  followup_email: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 8000 },
  reply_draft: { env: 'AI_MODEL_TOOLS', effort: 'low', maxTokens: 4000 },
  interview_qa: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 12000 },
  episode_notes: { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 12000 },
  ask: { env: 'AI_MODEL_ASK', effort: 'low', maxTokens: 3000 },
  // across recordings (Thunder): one answer from excerpts of several recordings; one combined study guide from their maps
  'across:ask': { env: 'AI_MODEL_ASK', effort: 'low', maxTokens: 4000, timeoutMs: 50_000 },
  'across:guide': { env: 'AI_MODEL_TOOLS', effort: 'medium', maxTokens: 16000, timeoutMs: 170_000 },
  grade: { env: 'AI_MODEL_TOOLS', effort: 'low', maxTokens: 1500 },   // quiz short answers: tiny prompts
  expand: { env: 'AI_MODEL_ASK', effort: 'low', maxTokens: 600 },
};

export function taskConfig(task) {
  const base = TASKS[task] || TASKS[task.split(':').slice(0, 2).join(':')] || TASKS[task.split(':')[0]] || TASKS.insights;
  return { model: process.env[base.env] || process.env.AI_MODEL || DEFAULT_MODEL, effort: base.effort, maxTokens: base.maxTokens, ...(base.timeoutMs && { timeoutMs: base.timeoutMs }) };
}

let cached;
export function getProvider() {
  if (cached) return cached;
  const wantMock = process.env.AI_PROVIDER === 'mock';
  if (wantMock && process.env.VERCEL_ENV !== 'production') return (cached = mockProvider());
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AIError("Summaries and Ask aren't switched on for this site yet.", { status: 503, code: 'not_configured' });
  return (cached = anthropicProvider(key));
}

export { AIError };
