// Adds the synthetic recordings of qa/fixtures/across.mjs to the QA harness (browser mock + dev-server store).
// Run inside a harness page; reload afterwards.
import { ALL } from '/qa/fixtures/across.mjs';

export async function addFixtures(rows = ALL) {
  const db = window.__qaDb;
  for (const r of rows) {
    if (!db.rows.some((x) => x.id === r.id)) db.rows.push(structuredClone(r));
    await fetch('/__harness/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) });
  }
  sessionStorage.setItem('__db', JSON.stringify(db));
}
export { ALL };
