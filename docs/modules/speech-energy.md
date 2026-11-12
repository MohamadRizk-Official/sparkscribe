# Speech-energy helpers (`src/engine/diarize.js`)

Three small pure functions the speaker detector uses to find speech the speaker model missed.

- **`frameEnergy(audio)`**: RMS energy in 100 ms frames (1600 samples at 16 kHz). A trailing partial frame is dropped; audio shorter than one frame gives an empty array.
- **`energyRuns(rms)`**: turns frame energies into `{start, end}` runs in seconds. The threshold is `max(3 × the 20th-percentile energy, 0.008)`, so a recording that is quiet throughout produces no runs. A run ends after more than three consecutive quiet frames (pauses of up to 0.3 s do not split it) and runs shorter than `MIN_GAP_SPEECH_S` (1 s) are dropped.
- **`subtract(run, speech)`**: the parts of a run not covered by time-ordered speech segments, again keeping only gaps of at least 1 s. Speech that overlaps either edge is clipped; speech entirely after the run is ignored.

Covered by `tests/diarize-energy-test.mjs`.
