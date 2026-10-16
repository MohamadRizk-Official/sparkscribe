// POST /api/across — questions and study guides across several of the user's recordings (server/ai/across.js).
//   { action: 'status', ids }                     → { recordings: [{ label, id, title, createdAt, duration, hasSummary, hasMap }], limits }
//   { action: 'ask', ids, question, requestId }   → Server-Sent Events, as /api/ask: names / status / delta / done / error  (Thunder)
//   { action: 'guide', ids, focus?, requestId }   → { item, saved } (or 409 needs_maps with details.needs: recordings to prepare)  (Thunder)
//   { action: 'history' }                         → { sets: the selections with saved work, newest first }
//   { action: 'thread', ids }                     → { items: saved answers and guides for this selection, newest first }
//   { action: 'delete', id }                      → { deleted: true }
// Requires a signed-in user; every recording is read as that user (Row Level Security), so ids that aren't theirs
// don't exist here (404 with details.missing). Asking and creating guides need Thunder (checked on the server before
// anything is read: 403 plan_required); saved work stays readable and deletable on every plan.
import { authenticate, readJson, sendJson, sendError } from '../server/http.js';
import { askAcrossRecordings, guideAcrossRecordings } from '../server/ai/service.js';
import { collectionStatus, historySets, threadFor, deleteItem } from '../server/ai/across.js';
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
    switch (body.action) {
      case 'status': return sendJson(res, 200, await collectionStatus(db, ids));
      case 'history': return sendJson(res, 200, await historySets(db));
      case 'thread': return sendJson(res, 200, await threadFor(db, ids));
      case 'delete': return sendJson(res, 200, await deleteItem(db, body.id));
      case 'guide': return sendJson(res, 200, await guideAcrossRecordings(db, { ids, focus: body.focus === 'exam' ? 'exam' : 'balanced', userId: user.id, requestId: body.requestId }));
      case 'ask': break;
      default: throw new AIError('Unknown action.', { status: 400, code: 'bad_request' });
    }

    // the plan (and everything else checkable before the model runs) fails as a plain JSON error, not a stream
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      streaming = true;
    };
    const result = await askAcrossRecordings(db, { ids, question: body.question, userId: user.id, requestId: body.requestId }, (ev) => {
      begin();
      if (ev.type === 'delta') send('delta', { text: ev.text });
      else if (ev.type === 'status') send('status', { status: ev.status });
      else if (ev.type === 'names') send('names', ev.names);
    });
    begin();
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
