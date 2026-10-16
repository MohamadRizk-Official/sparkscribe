// POST /api/across — questions and study guides across several of the user's recordings (server/ai/across.js).
//   { action: 'status', ids }                → { recordings: [{ label, id, title, createdAt, duration, hasSummary, hasMap }], limits }
//   { action: 'ask', ids, question }         → Server-Sent Events, as /api/ask: status / delta / done / error
//   { action: 'guide', ids, focus? }         → { content } (or 409 needs_maps with details.needs: recordings to prepare)
// Requires a signed-in user; every recording is read as that user (Row Level Security), so ids that aren't theirs
// don't exist here (404 with details.missing).
import { authenticate, readJson, sendJson, sendError } from '../server/http.js';
import { askAcrossRecordings, guideAcrossRecordings } from '../server/ai/service.js';
import { collectionStatus } from '../server/ai/across.js';
import { AIError } from '../server/ai/provider.js';

export default async function handler(req, res) {
  let streaming = false;
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }
    const { db, user } = await authenticate(req);
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 50) : [];
    if (body.action === 'status') return sendJson(res, 200, await collectionStatus(db, ids));
    if (body.action === 'guide') return sendJson(res, 200, await guideAcrossRecordings(db, { ids, focus: body.focus === 'exam' ? 'exam' : 'balanced', userId: user.id }));
    if (body.action !== 'ask') throw new AIError('Unknown action.', { status: 400, code: 'bad_request' });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    streaming = true;
    const result = await askAcrossRecordings(db, { ids, question: body.question, userId: user.id }, (ev) => {
      if (ev.type === 'delta') send('delta', { text: ev.text });
      else if (ev.type === 'status') send('status', { status: ev.status });
    });
    send('done', result);
    res.end();
  } catch (err) {
    if (!streaming) return sendError(res, err);
    const known = err instanceof AIError;
    if (!known) console.error('[across] unexpected error:', err?.name || 'Error');
    send('error', { error: known ? err.code : 'server_error', message: known ? err.message : "The answer couldn't be generated. Try again.", ...(known && err.details ? { details: err.details } : {}) });
    res.end();
  }
}
