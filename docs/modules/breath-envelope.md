# Loudness envelope and click start points (`src/lib/breath.js`)

[sentences.md](sentences.md) covers how a line is split into sentences. This page covers the other half of the same file:
the loudness envelope and how a click finds a good moment to start playing. Test: `tests/breath-envelope-test.mjs`.

## The envelope
`envelopeFromSamples(samples, sampleRate = 16000, scale = 1)` turns decoded mono audio into a `Uint8Array` with **20 values
a second** (`ENV_HZ`), about 70 KB an hour. Each value is the frame's loudness in dB: `0` is silence (-90 dBFS or lower),
`225` is full scale (0 dBFS), `255` is the cap. Every 6 dB is 15 steps (a half-amplitude signal is `210`). `scale` converts
integer samples to -1…1 (`1 / 32768` for 16-bit). A final partial frame is dropped. The envelope is kept with the audio on
this device and never uploaded (see [audio-store.md](audio-store.md)).

## Finding breaths (internal, cached per envelope)
A *breath* is a stretch clearly quieter than the speaker's own level around it, or real silence:
- From the sorted values: `floor` is the 5th percentile and `speech` the 60th. If they are **less than 15 steps apart**
  (about 6 dB: constant noise, no real pauses) the recording has no usable breaths and every function falls back to
  fixed offsets.
- A frame is quiet when it is below `floor + 40 %` of that span, or 9 dB below the 80th percentile of the frames within
  1.5 s either side. A run of quiet frames counts when it is **at least two frames (0.1 s) long, or contains real
  silence** (below `floor + 15 %`). Each run is `{ s, e, len }`: `s` where the breath began, `e` where speech resumed.

## `breathBefore(env, target, { lead = 0.5, back = 0.7, fwd = 0.5, miss = 0.15 })`
Where to start so the first word at `target` is not clipped. It looks at breaths whose end falls between `target - back`
and `target + fwd` and picks the cheapest: ending **before** the target costs the distance, ending after costs 2.5 times
the distance (starting late would skip words). The start is `lead` seconds before the breath's end, but never earlier than
0.03 s after the breath began, and never below 0. With no envelope, no breaths nearby, or noise-only audio: `target - miss`.

## `paragraphStart(segs, i, env)`
`segs[i].start`, adjusted to a breath. Without usable breaths: 0.1 s before the start. If the paragraph was cut through
speech (same speaker as the previous, no gap, loud right at the cut) the first second was shown at the end of the previous
paragraph, so the target moves later: `min(start + 0.8, midpoint)`. A paragraph that does not exist starts at 0.

## `sentenceStarts(segs, i, env, options)` → seconds, one per sentence
The first start is `paragraphStart`. For the rest, the paragraph's speaking time (voiced frames only) is shared out by text
length (`weight`: letters plus 1.5 per word), and the sentence boundaries are matched **in order, each breath used at most
once, a boundary allowed to have none** to the breaths inside the paragraph by least total cost (distance in speaking
time against the expected position, minus a bonus for longer breaths). A boundary with no breath falls back to its
expected position, 0.3 s early. Without an envelope the paragraph's time is simply shared by text length. The result never
goes backwards. When the aligner has timed the words, `sentenceStartsTimed` is used instead (see [seek.md](seek.md)).

## `paragraphIndexAt(segs, t)`
The paragraph a time belongs to: the last whose start is at or before `t + 0.05` (stored times are rounded), `-1` before the
first or with no paragraphs.
