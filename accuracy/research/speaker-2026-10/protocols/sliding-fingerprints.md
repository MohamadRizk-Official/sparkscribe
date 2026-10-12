# Sliding-window change detection: feasibility protocol (written before any results)

Question: inside v1's continuous single-speaker runs, can short voice fingerprints find real speaker changes v1
missed, without inventing changes?

Detector (no engine change; evaluated offline on cached fingerprints)
- windows [t, t+W] on a fixed grid (hop H) inside each v1 run of speaker A; fingerprint at true length
- a window "votes B" when sim(window, voice of B) - sim(window, voice of A) >= mu, B = best other known speaker
  (voices = v1's own speakers, averaged from their 15 longest runs — information the engine already has)
- a change A -> B is detected at the first of >= k consecutive windows voting the same B; time = that window's centre
- grid: W in {1.0, 1.5, 2.0} s, H in {0.25, 0.5} s, mu in {0, 0.05, 0.1, 0.15, 0.2, 0.3}, k in {1, 2, 3}

Data
- tuning (dev): AMI ES2004a, AMI IS1009a (headset), synthetic one-speaker-everything (pitch +3/-3 st, far, turned,
  noise, quiet: every detection there is false)
- validation (never used to choose settings): AMI TS3003a, AMI ES2004a far microphone (quiet / distant),
  synthetic two-short-interruptions, the user's 23:22 recording (coffee-truth-v3: 33 hand-marked switch zones,
  52 single-speaker spans) — the user's recording is validation only

Measures
- recall: true changes that v1 missed (inside a v1 run, > 1 s from any v1 switch) found within ±1 s
- precision: detections within ±1 s of a real change / all detections
- false changes per minute of single-speaker speech; on one-speaker-everything per condition
- timing error (median |detected - true|) and identity accuracy (detected new speaker = the real one)
- brief changes (new speaker's turn < W) reported separately

Selection (dev only): the setting with the highest recall subject to precision >= 0.70, false changes <= 0.5 per
single-speaker minute on dev AMI AND <= 0.5 per minute on one-speaker-everything.

STOP condition: if no setting meets recall >= 25% of v1's missed changes with those limits on dev, short-window
fingerprints are too unstable for this purpose: stop, report, no implementation.

Validation gate for proposing an implementation: the chosen setting on the validation set reaches precision >= 0.60,
recall >= 20%, false changes <= 0.6/min, identity accuracy >= 80%, with no recording where false changes exceed 1/min.
