// In-memory stand-in for server/db.js (test harness only). Mirrors the content_version trigger and the
// unique (transcription, kind, type) constraint.
import { randomUUID } from 'node:crypto';

export function memoryStore() {
  const transcriptions = new Map();
  const insights = [];
  const questions = [];
  const artifacts = [];
  const now = () => new Date(Date.now() + insights.length + artifacts.length * 7 + Math.random()).toISOString();
  return {
    _t: transcriptions, _i: insights, _q: questions,
    seed(row) {
      const prev = transcriptions.get(row.id);
      const changed = prev && (prev.transcript_text !== row.transcript_text || JSON.stringify(prev.segments) !== JSON.stringify(row.segments ?? null));
      transcriptions.set(row.id, { recording_type: null, segments: null, duration_seconds: null, language: null, ...prev, ...row, content_version: prev ? prev.content_version + (changed ? 1 : 0) : 1 });
      return transcriptions.get(row.id);
    },
    async getTranscription(id) { return transcriptions.get(id) || null; },
    async listInsights(tid) { return insights.filter((i) => i.transcription_id === tid); },
    async getInsight(tid, kind, type) { return insights.find((i) => i.transcription_id === tid && i.kind === kind && i.recording_type === type) || null; },
    async startInsight(existing, { transcriptionId, kind, recordingType, version }) {
      if (existing) {
        const cur = insights.find((i) => i.id === existing.id);
        if (cur.updated_at !== existing.updated_at) return null;
        Object.assign(cur, { status: 'generating', error: null, source_version: version, updated_at: now() });
        return { ...cur };
      }
      if (insights.some((i) => i.transcription_id === transcriptionId && i.kind === kind && i.recording_type === recordingType)) return null;
      const row = { id: randomUUID(), transcription_id: transcriptionId, kind, recording_type: recordingType, status: 'generating', content: null, error: null, source_version: version, updated_at: now() };
      insights.push(row);
      return { ...row };
    },
    async finishInsight(id, { content, model, usage }) {
      const cur = insights.find((i) => i.id === id);
      Object.assign(cur, { status: 'ready', content, error: null, model, input_tokens: usage.input, output_tokens: usage.output, updated_at: now() });
      return { ...cur };
    },
    async failInsight(id, message) {
      const cur = insights.find((i) => i.id === id);
      Object.assign(cur, { status: 'failed', error: message, updated_at: now() });
    },
    async listArtifacts(tid) { return artifacts.filter((a) => a.transcription_id === tid); },
    async getArtifact(tid, kind, key) { return artifacts.find((a) => a.transcription_id === tid && a.kind === kind && a.settings_key === key) || null; },
    async startArtifact(existing, { transcriptionId, kind, settings, settingsKey, version }) {
      if (existing) {
        const cur = artifacts.find((a) => a.id === existing.id);
        if (cur.updated_at !== existing.updated_at) return null;
        Object.assign(cur, { status: 'generating', error: null, source_version: version, updated_at: now() });
        return { ...cur };
      }
      if (artifacts.some((a) => a.transcription_id === transcriptionId && a.kind === kind && a.settings_key === settingsKey)) return null;
      const row = { id: randomUUID(), transcription_id: transcriptionId, kind, settings, settings_key: settingsKey, status: 'generating', content: null, error: null, source_version: version, progress: null, updated_at: now() };
      artifacts.push(row);
      return { ...row };
    },
    async finishArtifact(id, { content, model, usage }) {
      const cur = artifacts.find((a) => a.id === id);
      Object.assign(cur, { status: 'ready', content, error: null, model, input_tokens: usage.input, output_tokens: usage.output, progress: null, updated_at: now() });
      return { ...cur };
    },
    async failArtifact(id, message, previousVersion) {
      const cur = artifacts.find((a) => a.id === id);
      Object.assign(cur, { status: 'failed', error: message, updated_at: now(), ...(previousVersion != null ? { source_version: previousVersion } : {}) });
    },
    async listQuestions(tid) { return questions.filter((q) => q.transcription_id === tid); },
    async findAnswer(tid, normalized, version, norm) {
      return [...questions].reverse().find((q) => q.transcription_id === tid && q.source_version === version && norm(q.question) === normalized) || null;
    },
    async saveQuestion({ transcriptionId, question, answer, refs, found, version, model, usage }) {
      const row = { id: randomUUID(), transcription_id: transcriptionId, question, answer, refs, found, source_version: version, model, input_tokens: usage.input, output_tokens: usage.output, created_at: new Date().toISOString() };
      questions.push(row);
      return { id: row.id };
    },
  };
}
