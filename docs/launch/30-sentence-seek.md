# Clicking a sentence starts at that sentence (2026-10-27)

Branch `design/polish`. Follows [29-ask-rebuild.md](29-ask-rebuild.md) §1.

## Problem

Clicking a sentence usually started a sentence or more early, and rarely at the right place.

**Root cause:** a transcript paragraph is one piece of audio from the engine (up to 27.5 s), and it holds several
sentences. Only the paragraph has a start time. Clicking any sentence played from the paragraph's start. The
earlier fix (29, §1) only made that paragraph start land in a breath.

## How it was measured

- **Ground truth:** word start times from Whisper small (timestamped) on real meeting recordings. We used four AMI
  meetings, 10 minutes each. Whisper base and small agree on word starts within about 0.06 s (median).
- **Paragraphs:** cut exactly as the engine cuts them (energy runs merged within 1.5 s, split at the quietest point
  between 16 and 27.5 s).
- **A click counts as right** when playback starts before the sentence's first word (not clipping it) and does not
  replay the start of any earlier word.

## What was built

1. **Clickable sentences.** Each sentence is its own click target on both pages: a soft tint on hover and a brief lit
   tint when clicked. References (Summary, Notes, Ask) still go to the paragraph.
2. **Breaths as relative dips** (`lib/breath.js`). A moment counts as a breath when it is at least 9 dB under the
   speaker's own level over the surrounding 1.5 s, or is real silence. Before, only absolute quiet counted, and that
   missed most breaths over room noise.
3. **Lead-in.** Playback starts up to 0.5 s into the breath before the words, never before the breath began, and
   never before the previous word ended.
4. **Word timing** (`src/align-worker.js`, `lib/sentence-timing.js`, `lib/align-words.js`).
   - A small Whisper (tiny.en, timestamped export, about 41 MB quantized, downloaded once) times the words of one
     paragraph at a time.
   - It runs on the device, in a background worker. Audio and timings never leave the device.
   - The paragraph's own words are matched to the timed words, and each sentence takes its first word's time,
     corrected for the model's measured 0.15 s lateness.
   - Timing starts after the first play, sentence click or pointer over the transcript. Paragraphs in view are timed
     first, and the one under the pointer jumps the queue.
   - Each paragraph takes about 4 s on CPU. The audio is decoded once at 8 kHz, about 58 MB per hour; at that rate
     timing accuracy is unchanged.
   - Results are kept with the audio in IndexedDB (`rec.align`), so each paragraph is timed only once.
   - Not on touch-first devices, devices under 4 GB, or with Save-Data on. Those, and paragraphs not yet timed, use
     the envelope estimate: speaking time shared out by text length, with boundaries matched to breaths in order.

## Results (sentence clicks, real meetings)

| | right | sentences inside a paragraph | replays earlier words | clips the first word |
|---|---|---|---|---|
| before any fix | 40 % | 1 % | 52 % (≈20 words) | 8 % |
| envelope estimate | 64 % | 41 % | 18 % (≈4 words) | 18 % |
| **with word timing** | **80 %** | **71 %** | 9 % (≈2 words) | 11 % |

- 220 sentences across three meetings. Settings were tuned on IS1009a only; the two held-out meetings (TS3003a,
  ES2004a) scored 80 %.
- In the real browser, on the saved-recording page, sentences inside paragraphs scored 43 % with the estimate and
  74 % once timed. Saved timings were used instantly after a reload.
- Meetings with crosstalk are the hard case: the tiny model sometimes loops when several people talk. Single-speaker
  lectures should do better.

## Also fixed

`audio-store.js` reported every save as failed. IndexedDB resolves a put with the record's key, not `true`. So
"audio kept on this device" never showed after saving, and attaching a file never switched to "stored". The audio
itself was saved.

## Not changed

The transcription engine, its models and its text. Server, database, billing, auth.
