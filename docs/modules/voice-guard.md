# Same-voice guard (`src/engine/voice-guard.js`)

A check on the combined speaker result: the second speaker model sometimes invents a person by splitting one voice in
two. This module fingerprints each named speaker and merges people whose average voices are nearly identical. Covered by
`tests/voice-guard-test.mjs`.

## Steps
1. `voiceSamples(segments)` picks up to 8 stretches per speaker (≥ 1.0 s, longest first), cut to 4.0 s from the
   middle (edges are where another voice begins). `Unknown` is skipped.
2. The caller fingerprints each stretch with the first engine's voice model.
3. `centroidsOf(samples, embeddings)` averages each speaker's vectors and normalises to unit length. Speakers with no
   embeddings get no centroid.
4. `mergeSameVoices(segments, centroids, threshold)` repeatedly merges the most similar pair (cosine ≥ threshold). The
   speaker with more speech keeps the name; the merged voice is the speech-weighted mean. Adjacent segments of the same
   speaker that touch are joined. Returns `{ segments, merged: [{ from, into, similarity }] }`.

## Constants
`SAME_VOICE = 0.6`, `MAX_PEOPLE = 4`, `MIN_TALK_S = 5` (chosen on development data only).

## Using the result
`peopleIn(segments)` counts speakers (excluding Unknown) talking ≥ 5 s. `useCombined(guarded, chosen)`: if the student
chose a count, the combined result is used only for 2–4; otherwise only while it names at most 4 people. If not used,
the first engine's result is kept unchanged.
