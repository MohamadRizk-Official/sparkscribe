// A save whose answer is lost (the row was written, the response never arrived) and is then retried must not
// create a second recording or count the minutes twice: the transcript keeps one id across attempts.
// Run on any harness page: (await import('/qa/e2e/save-retry.e2e.js')).run()
import { runTests, assert, eq, knobs } from './lib.js';

export async function run() {
  const { saveTranscript } = await import('/src/lib/transcripts.js');
  const rows = () => window.__qaDb.rows;
  return runTests([
    ['a lost response, then Retry with the same id → one recording', async () => {
      const id = crypto.randomUUID();
      const before = rows().length;
      knobs({ loseSaveResponse: true });
      let lost = null;
      try { await saveTranscript({ id, title: 'Retry test', durationSeconds: 60, text: 'x', segments: [] }); } catch (e) { lost = e; }
      knobs({ loseSaveResponse: false });
      assert(lost, 'the first attempt looked like a failure to the page');
      const got = await saveTranscript({ id, title: 'Retry test', durationSeconds: 60, text: 'x', segments: [] });
      eq(got, id, 'the retry returns the recording that was already saved');
      eq(rows().length, before + 1, 'exactly one row was added');
    }],
    ['without an id (older database), a save still works', async () => {
      const before = rows().length;
      const got = await saveTranscript({ title: 'No id', durationSeconds: 5, text: 'y', segments: [] });
      assert(got && rows().length === before + 1, 'saved');
    }],
  ]);
}
