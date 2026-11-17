# Sentence-click timing (`src/lib/sentence-timing.js`)

Decides where playback starts when a person clicks a sentence in a transcript paragraph. `createSentenceTiming({ getSegs,
getEnv, getBlob })` returns one object per page. `getSegs()` gives the paragraphs `[{ start, end, text, speaker }]`,
`getEnv()` the loudness envelope (or `null`), and `getBlob()` the recording's audio (or `null`). Covered, for the parts
that need no worker, by `tests/sentence-timing-test.mjs`; where the click lands once words are timed is
[seek.md](seek.md).

## What it does
1. **Word timing in the background.** Paragraphs on screen (the one under the pointer first) are queued. For each, the
   whole file is decoded once to 16 kHz mono 16-bit samples (`decodeForTiming`), the paragraph's clip is cut out (a little
   before, and with the previous paragraph's last 3 words as context when it ended less than a second earlier), and
   `src/align-worker.js` aligns the words ([word-timing.md](word-timing.md)). One paragraph is timed at a time.
2. **Saved with the audio.** Timings are stored on this device with the recording (`putAlign`), tagged with the model
   name `w2v-ctc-fp16-onset1`. `load(stored, key)` accepts only `v: 2` data written by that tag; anything older is ignored
   and made again. A paragraph is identified by its start time with two decimals (`"10.00"`).
3. **Estimates until then.** `startOf(i, k, text)` uses the timed words when it can (via `seekToSentence`). For an untimed
   paragraph, the first sentence (and any one-sentence paragraph) starts at the paragraph's own start; later sentences use
   the loudness envelope's estimate (`sentenceStarts` in `src/lib/breath.js`).

## Switching timing off
Timing is used only on devices that can afford it: no data-saver, at least 4 GB of memory, and a fine pointer (not a
phone or tablet). Audio over 150 MB, or over 40 MB on a device with under 4 GB, is not decoded. A worker error, a failed
job or a failed decode switches timing off for the page and the estimates stay in use. In Node none of this is available,
so `canTime()` is `false`.

## API
- `load(stored, key)`, `setKey(key)`: restore saved timings; set where new ones are saved.
- `observe(container)`, `prepare()`, `activate()`: start timing (when the page is idle, or when a paragraph is pointed at).
- `isTimed(i)`, `startOf(i, k, text)`, `canTime()`.
- `timeNow(i, ms = 1500)`: time a clicked paragraph now, but only wait if it can be ready within `ms` (the device's measured speed, in ms of work per second of audio, decides); otherwise resolve at once and time it next.
- `alignForSpeakers(clips)`: word times for speaker splits using the same worker; `null` per failed clip, or overall when timing is off.
- `forget(starts)`: drop timings of paragraphs whose lines were split.
- `reset()`: clear everything (a new recording).
