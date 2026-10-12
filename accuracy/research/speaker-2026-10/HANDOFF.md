# Speaker detection research — handoff (2026-10-11)

Status: research closed. **v1 is the speaker-engine baseline.** Nothing from this research is in production.

## 1. Reference engine (v1)
| | |
|---|---|
| Code | `src/engine/diarize.js` git blob `7ce03f9a1003c30369adfb4896d825ce2a711f0d` |
| Commit | `92b1b5f` (local tag `speaker-v1-baseline`); the engine file last changed in `b07a9b3` |
| Frozen test copy | `engines/v1-frozen.mjs`, sha256 `f3a41ee02ee7…`: identical to the blob plus a 2-line test hook (`env.onChunks`) used only by the test runner |
| Pipeline | pyannote seg-3.0 on 10 s chunks → WeSpeaker ResNet34 fingerprints → clustering (AHC) → smoothing → verifySpeakers (about 4 s windows, Unknown when nothing matches) |

Branch caution: **neither branch tip carries v1's engine.**
- Local `speaker-fix` HEAD has c3 (blob `1ac4940`).
- `origin/speaker-fix` (`4d5b717`) has v3 (blob `c06a46d`).

Before merging any `speaker-fix` product work, `src/engine/diarize.js` must be restored to blob `7ce03f9` (needs approval).

## 2. Production
- `main` = `origin/main` = `95bf377`, unchanged.
- Production runs the older pre-v1 engine inside `src/worker.js`, called "before" in the results. v1 has only been on Preview.

## 3. Where everything is
| What | Where | In git? |
|---|---|---|
| Protocols (Nemotron, hybrid, sliding fingerprints) | `accuracy/research/speaker-2026-10/protocols/` | yes |
| Nemotron port, parity check, scorers, hybrid analysis | `accuracy/research/speaker-2026-10/scripts/` (paths inside point to the old temp scratchpad) | yes |
| All run outputs, scored results, engine variants (before, v1, v2, v3, c1, c2, c3 and others), caches, Nemotron ONNX weights (105 MB, OpenMDW-1.1 licence kept), review/referee tools | `accuracy/testset/research-2026-10-11/` (231 MB) | no: git- and Vercel-ignored |
| AMI audio and RTTMs (CC BY 4.0) | `accuracy/testset/ami/` | no: ignored |
| Synthetic scenarios | `accuracy/testset/diar-scenarios/` | no: ignored |
| User's manually verified labels: truth v1/v2/v3, review answers, switch marks | `accuracy/testset/private/` (+ `reviews/`) | no: private, ignored |
| Engine candidates | tags `speaker-v1-baseline`, `speaker-v3-research`, `speaker-c2-research`, `speaker-c3-research` (local) | yes |
| Lab scoring (DER/JER pyannote.metrics semantics, diagnostics), review page, switch-marking tool, safe runner | `accuracy/lab/`, `accuracy/diarize-*.mjs`, `accuracy/switch-tool.mjs` | yes |

## 4. Confirmed limitations of v1
1. **Missed speaker changes.** Within a 10 s chunk the segmentation model often merges two voices into one.
   - Held-out IS1009c: 139 of 207 changes missed (±0.5 s); EN2002d: 257 of 564.
   - Development AMI: 671 missed.
   - User's recording: 16 of 33 hand-marked switches missed, 7 on time.
2. **Short interruptions are absorbed.** Turns under 1 s get the right speaker 19% of the time on IS1009c (26/137), 15% on EN2002d (39/253) and 21% on development data (142/667). Most are given to the surrounding speaker.
3. **Pitch-related false split.** One person whose voice is shifted +3 semitones becomes a separate speaker (54 of 61 s on one-speaker-everything). This is a fingerprint limit: the shifted voice scores 0.41 similarity to itself, while two different real people in IS1009a score 0.413. No threshold separates the two cases. On that test v1 finds 4 speakers for 1 person (19.5% wrong-person time, 14 swaps).
4. **Over-counting in Auto on long meetings.** It found 8 people for 4 on EN2002d (DER 41.5%; 35.6% with the count chosen), 5 for 4 on IS1009c and EN2002b.
5. **No overlap output.** Simultaneous speech is never named.
6. **Unknown time.** Small: 4.8 s and 2.6 s on the held-out meetings (0.1–0.3% of audio), 96 s across the development AMI meetings (about 1.5%).
7. **Strengths, for balance:**
   - IS1009c DER 12.8%;
   - user's recording round 1: 24/27 right;
   - stable identities on clean headset audio.

## 5. What was tried (do not revisit without materially new evidence)
| Approach | Result |
|---|---|
| v3, c2, c3 engine candidates | Rejected. Human review on the user's recording: v1 better 37–19 vs c3 |
| Threshold tuning (merge 0.38 vs 0.45) | 0.38 merges real IS1009a speakers; the +3 st split is unreachable |
| E1 flip-point boundaries | Rejected (not better than v1 within ±0.3 s) |
| Sliding-window fingerprints | Infeasible (too many false changes) |
| Overlapping segmentation windows | Rejected |
| Nemotron-3-Diarization int8 alone | Failed the frozen protocol. Held-out DER +3 / −8 pts, 1.7–1.9× false changes, 12–32% of speech unnamed, lost the user's head-to-head 18–27 |
| v1 + Nemotron hybrid (43 rules) | Rejected on development data. Best (H2): DER 27.2 → 20.0 but false changes 314 → 743, IS1009a wrong-person 3.7 → 9.7%. User's head-to-head lost 17–24. The held-out meetings were not used for the hybrid |

## 6. Worth revisiting in a future release
1. **An end-to-end diarization model in the browser**, once a runtime supports one natively (transformers.js 4.3.1 has no `nemotron3_diarization`; onnx-community q4 is 83 MB). Nemotron was the only thing that fixed short interruptions (4–5×) and speaker counts. It would need a pre-registered test, with false changes and unnamed speech as gating measures.
2. **Safe gap filling.** Naming a gap from the speaker on both sides was 99.6% correct. Reusable if any second model is adopted.
3. **Product-side fixes for v1's limits (no engine change):**
   - ask for or confirm the number of speakers on long meetings (EN2002d 41.5 → 35.6% DER with the count given);
   - a "merge speakers" action next to the existing rename, which would repair the pitch split;
   - a "split here / change speaker" correction for missed short interruptions.
4. **Keep the lab:** standardized DER/JER, frozen-protocol practice, review page, switch-marking tool, the capped resumable runner.

## 7. Rules carried forward
- No tuning on the user's manual answers.
- No recording-specific rules.
- Protocols are frozen before results.
- Held-out data is used once.
- One heavyweight job at a time, 8-CPU cap, memory stop, resumable checkpoints.
- No downloads, long benchmarks or training without approval.
- Never merge to `main`, push or deploy without approval.
- Private recordings stay under the ignored `accuracy/testset/`, and `.vercelignore` must keep excluding it.
