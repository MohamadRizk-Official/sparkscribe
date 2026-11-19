# Whisper decoding rules (`src/engine/decoding.js`)

Two logits processors that plug into Transformers.js generation, plus one helper. Covered by
`tests/whisper-control-test.mjs` (the processors, driven with fake logits) and `tests/compat-test.mjs`
(`compressionRatio`). The runaway-repetition rules they use live in `src/engine/loops.js`
([loop-detection.md](loop-detection.md)).

## `WhisperControl`: the rules one clip is decoded under
Constructed once per batch with `{ promptLen, forced, noSpeechId, suppress, eosId, budgets, timestamps, blankId }`.
`_call(input_ids, logits)` runs on every step and changes the logits **in place**, one row per clip. `pos` is how many
tokens the row has generated after the prompt. In order:

1. **Forced tokens** (`pos < forced.length`): only `forced[pos]` stays possible. These are the language
   (`<|en|>`), the task (`<|transcribe|>`, never translate) and, without timestamps, `<|notimestamps|>`. If the model's
   own config had suppressed a forced token (`-Infinity`), it is made finite again, otherwise nothing would be possible.
2. **No-speech probability**: at `pos === 0` the softmax probability of `<|nospeech|>` is stored in `noSpeech[row]`
   (read once per row).
3. **Finished rows**: once a row has emitted the end token, or has been stopped, every later step forces the end token
   again, because a finished row keeps being stepped until the whole batch is done.
4. **Suppression**: every id in `suppress` becomes impossible (Whisper's `suppress_tokens`; the library's own list
   would also hide `<|nospeech|>`, so it is applied here). At the first text position a blank (`blankId`) cannot be
   chosen, and without timestamps the clip cannot end immediately.
5. **Budget**: when a row's text tokens (timestamps excluded) reach `budgets[row]`, `stopped[row]` is `'budget'` and
   the end token is forced.
6. **Loop guard**: `tailRepetition` + `isLoopRun` on the text tokens. A detected run sets `stopped[row] = 'loop'`,
   records where it began in `loopAt[row]` (an index into that row's text tokens) and forces the end token. Ordinary
   emphasis (two to four repeats) never triggers it.
7. **Timestamp grammar** (only when `timestamps` is given; as OpenAI's `ApplyTimestampRules`, with two additions):
   no timestamp past the clip's real length (`maxIndex[row]`), and no new segment once a segment has closed at the end
   of the audio. A clip must start with a timestamp no later than `maxInitialIndex`; after a pair of timestamps comes
   text or the end; timestamps never go backwards; and if a timestamp is more likely than any single text token, a
   timestamp is emitted.

After generation, the decoder reads `noSpeech`, `stopped` and `loopAt` from the processor.

## `TokenLogprobRecorder`: Whisper's own confidence
Records the average log-probability of the tokens the model **chose** (the reference Whisper retries a segment when
`avg_logprob < -1.0`). Nothing is estimated: it is computed from the logits.

- Each step it saves the log-softmax of the new logits, and scores the token chosen at the previous step against the
  distribution saved then. It stops counting a row once the end token was chosen.
- `temperature`: when sampling, the library has already divided the logits by it before custom processors run, so the
  recorder multiplies it back to stay comparable with the greedy pass.
- `finish(sequences)` scores the last token (only known once generation returned) and returns one average per row;
  a row with no generated tokens scores `0`.
- Token ids in `input_ids` are `BigInt`s, as Transformers.js provides them.

## `compressionRatio(text)`
zlib-style ratio `utf-8 bytes / deflated bytes`. Whisper's reference treats `> 2.4` as repetitive hallucination
("the the the...") and retries. Text under 20 bytes returns `1`, and so does a browser without `CompressionStream`
(Safari before 16.4): the extra retry signal is skipped instead of failing the run.
