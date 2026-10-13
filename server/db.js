// Database access for the AI functions, through a Supabase client that carries the signed-in user's own
// access token. Every query therefore runs under Row Level Security as that user: the server can only
// read and write what the user could, and it never chooses user_id (the database fills it in).
// No service-role / secret key is used anywhere.
import { AIError } from './ai/provider.js';

const TRANSCRIPT_COLUMNS = 'id, title, duration_seconds, language, recording_type, transcript_text, segments, content_version';
const INSIGHT_COLUMNS = 'id, transcription_id, kind, recording_type, status, content, error, source_version, updated_at';
const ARTIFACT_COLUMNS = 'id, transcription_id, kind, settings, settings_key, status, content, error, source_version, progress, updated_at';

function check(error, what) {
  if (error) throw new AIError(`Couldn't ${what}.`, { status: 500, code: 'db_error' });
}

export function supabaseStore(sb) {
  return {
    async getTranscription(id) {
      const { data, error } = await sb.from('transcriptions').select(TRANSCRIPT_COLUMNS).eq('id', id).maybeSingle();
      check(error, 'load the transcript');
      return data;
    },
    async listInsights(transcriptionId) {
      const { data, error } = await sb.from('transcription_insights').select(INSIGHT_COLUMNS).eq('transcription_id', transcriptionId);
      check(error, 'load saved results');
      return data;
    },
    async getInsight(transcriptionId, kind, recordingType) {
      const { data, error } = await sb.from('transcription_insights').select(INSIGHT_COLUMNS)
        .eq('transcription_id', transcriptionId).eq('kind', kind).eq('recording_type', recordingType).maybeSingle();
      check(error, 'load saved results');
      return data;
    },
    // Mark a result as being generated. Returns the row, or null if another request claimed it first.
    async startInsight(existing, { transcriptionId, kind, recordingType, version }) {
      const fields = { status: 'generating', error: null, source_version: version };
      if (existing) {
        const { data, error } = await sb.from('transcription_insights').update(fields).eq('id', existing.id)
          .eq('updated_at', existing.updated_at) // only if nobody touched it since we read it
          .select(INSIGHT_COLUMNS);
        check(error, 'save progress');
        return data[0] || null;
      }
      const { data, error } = await sb.from('transcription_insights')
        .insert({ transcription_id: transcriptionId, kind, recording_type: recordingType, ...fields }).select(INSIGHT_COLUMNS);
      if (error?.code === '23505') return null; // unique (transcription, kind, type): someone else just started it
      check(error, 'save progress');
      return data[0];
    },
    async finishInsight(id, { content, model, usage }) {
      const { data, error } = await sb.from('transcription_insights')
        .update({ status: 'ready', content, error: null, model, input_tokens: usage.input, output_tokens: usage.output })
        .eq('id', id).select(INSIGHT_COLUMNS).single();
      check(error, 'save the result');
      return data;
    },
    // keeps the previous content (and its version) when an update fails, so it stays visible
    async failInsight(id, message, previousVersion) {
      const patch = { status: 'failed', error: String(message).slice(0, 500) };
      if (previousVersion != null) patch.source_version = previousVersion;
      await sb.from('transcription_insights').update(patch).eq('id', id);
    },
    // ---- Phase 5 artifacts (same pattern as insights; a failed regeneration keeps the previous content) ----
    async listArtifacts(transcriptionId) {
      const { data, error } = await sb.from('transcription_artifacts').select(ARTIFACT_COLUMNS).eq('transcription_id', transcriptionId);
      check(error, 'load saved tools');
      return data;
    },
    async getArtifact(transcriptionId, kind, settingsKey) {
      const { data, error } = await sb.from('transcription_artifacts').select(ARTIFACT_COLUMNS)
        .eq('transcription_id', transcriptionId).eq('kind', kind).eq('settings_key', settingsKey).maybeSingle();
      check(error, 'load saved tools');
      return data;
    },
    async startArtifact(existing, { transcriptionId, kind, settings, settingsKey, version }) {
      const fields = { status: 'generating', error: null, source_version: version };
      if (existing) {
        const { data, error } = await sb.from('transcription_artifacts').update(fields).eq('id', existing.id)
          .eq('updated_at', existing.updated_at).select(ARTIFACT_COLUMNS);
        check(error, 'save progress');
        return data[0] || null;
      }
      const { data, error } = await sb.from('transcription_artifacts')
        .insert({ transcription_id: transcriptionId, kind, settings, settings_key: settingsKey, ...fields }).select(ARTIFACT_COLUMNS);
      if (error?.code === '23505') return null;
      check(error, 'save progress');
      return data[0];
    },
    async finishArtifact(id, { content, model, usage }) {
      const { data, error } = await sb.from('transcription_artifacts')
        .update({ status: 'ready', content, error: null, model, input_tokens: usage.input, output_tokens: usage.output, progress: null })
        .eq('id', id).select(ARTIFACT_COLUMNS).single();
      check(error, 'save the result');
      return data;
    },
    // keeps the previous content (and its version) when an update fails, so it stays visible
    async failArtifact(id, message, previousVersion) {
      const patch = { status: 'failed', error: String(message).slice(0, 500) };
      if (previousVersion != null) patch.source_version = previousVersion;
      await sb.from('transcription_artifacts').update(patch).eq('id', id);
    },
    async listQuestions(transcriptionId) {
      const { data, error } = await sb.from('transcription_questions').select('id, question, answer, refs, found, source_version, created_at')
        .eq('transcription_id', transcriptionId).order('created_at', { ascending: true }).limit(100);
      check(error, 'load questions');
      return data;
    },
    async findAnswer(transcriptionId, normalized, version, norm) {
      const { data, error } = await sb.from('transcription_questions').select('id, question, answer, refs, found, created_at')
        .eq('transcription_id', transcriptionId).eq('source_version', version).order('created_at', { ascending: false }).limit(100);
      check(error, 'load questions');
      return data.find((q) => norm(q.question) === normalized) || null;
    },
    // AI usage ledger (supabase/proposed/*_ai_usage_limits.sql). Before that migration is applied the functions
    // don't exist: every request is allowed, exactly as before. Any other database error also allows the request
    // (an accounting problem must not take the AI features down); it is logged without data.
    // The usage check before every model call (supabase/proposed/*_ai_usage_limits.sql). Only one failure lets the
    // call through unmetered: the function not existing yet (migration not applied) while AI_LIMITS_REQUIRED is not
    // set — the rollout fallback. Once the migration is applied, AI_LIMITS_REQUIRED=1 turns that off too. Every other
    // failure (network, timeout, database error, an unexpected reply) refuses the call: a broken check must never
    // mean unlimited AI.
    async reserveAi(feature, estimateMicrousd) {
      let data, error;
      try {
        ({ data, error } = await sb.rpc('ai_reserve', { p_feature: String(feature).slice(0, 80), p_estimate_microusd: estimateMicrousd | 0 }));
      } catch (e) { error = { code: e?.name || 'exception' }; }
      if (error) {
        const notInstalled = ['PGRST202', '42883'].includes(error.code);
        if (notInstalled && process.env.AI_LIMITS_REQUIRED !== '1') return { allowed: true, id: null, unmetered: true };
        console.error('[ai-usage] reserve failed, refusing:', error.code || 'error');
        return { allowed: false, reason: 'unavailable' };
      }
      if (!data || typeof data !== 'object' || typeof data.allowed !== 'boolean') {
        console.error('[ai-usage] reserve returned an unexpected reply, refusing');
        return { allowed: false, reason: 'unavailable' };
      }
      return data;
    },
    async settleAi(id, ok, { input, output, costMicrousd }) {
      const secret = process.env.AI_DB_SECRET || process.env.BILLING_DB_SECRET;
      if (id && !secret && process.env.AI_LIMITS_REQUIRED === '1' && !globalThis.__aiSecretWarned) {
        globalThis.__aiSecretWarned = true; // costs then stay at their estimates: still limited, but not exact
        console.error('[ai-usage] AI_LIMITS_REQUIRED=1 but no AI_DB_SECRET/BILLING_DB_SECRET: real costs are not recorded');
      }
      if (!id || !secret) return;
      const { error } = await sb.rpc('ai_settle', { p_secret: secret, p_id: id, p_ok: !!ok, p_input_tokens: input | 0, p_output_tokens: output | 0, p_cost_microusd: costMicrousd | 0 });
      if (error) console.error('[ai-usage] settle failed:', error.code || 'error');
    },
    async saveQuestion({ transcriptionId, question, answer, refs, found, version, model, usage }) {
      const { data, error } = await sb.from('transcription_questions').insert({
        transcription_id: transcriptionId, question, answer, refs, found, source_version: version, model,
        input_tokens: usage.input, output_tokens: usage.output,
      }).select('id').single();
      if (error) return null; // the answer was still shown; failing to keep it isn't worth an error
      return data;
    },
  };
}
