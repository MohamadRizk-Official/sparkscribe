# Nemotron-3-Diarization vs SparkScribe v1 — frozen protocol (written 2026-10-11, before any evaluation run)

## Candidate (frozen)
- Weights: nvidia/Nemotron-3-Diarization (OpenMDW-1.1), community ONNX conversion NealCaren/Nemotron-3-Diarization-ONNX
  (OpenMDW-1.1), exported from the official `transformers` modules. Files verified against the repo's LFS sha256:
  embed.onnx 2e8796e42286…, step_int8.onnx 1f18a5aed490… (103.3 MB, dynamic int8 = the actual candidate),
  mel_filters.bin bce5ec5f194a…, silence_embeds.bin d4417b3c0eab…
- Front end, chunking and Arrival-Order Speaker Cache: our own port of the Apache-2.0 reference
  (transformers: feature_extraction_nemotron_asr_streaming.py, modeling_nemotron3_diarization.py). The community JS
  (professorcaren/transcriber, no license) is NOT used.
- Mode: offline (as `model(**inputs)` without a cache): chunk 340 encoder frames, right context 40, FIFO 40,
  update period 300; speaker cache from streaming_config: 264 frames, 1 silence frame per speaker, prediction
  threshold 0.25, latest-frame boost 0.05, min positive rate 0.5, strong/weak boost rates 0.75/1.5.
- Output: sigmoid > 0.5 per speaker every 10 ms (as Nemotron3DiarizationProcessor.extract_speaker_dict);
  no other post-processing, no tuning of any value on any of our recordings. Raw 16 kHz audio (no app preprocessing).
- Faithfulness checks before evaluation: (1) front-end features vs the reference code (torch), (2) speaker-cache
  state replayed step by step through the reference class, (3) sanity run on a short clip.

## Baseline
- v1 = frozen engine var/v1.mjs (92b1b5f engine + test hook), Auto mode; chosen-count mode reported as secondary.

## Data
- Decisive (held-out): AMI test-split sessions IS1009c and EN2002d (headset mix, pyannote only_words RTTM).
  Not in Nemotron's training data (it trained on AMI train + dev; it was evaluated on AMI test).
  Never used to tune v1. They SHARE all four speakers with IS1009a / EN2002b (development sessions) — disclosed.
- Supporting (development, disclosed as such): AMI ES2004a, IS1009a, TS3003a, EN2002b (headset), ES2004a far mic;
  synthetic scenarios (two-short-interruptions, one-speaker-everything, similar-voices, five-speakers);
  the user's 23:22 recording (round-1 27 answers, round-2 72 scored answers, 33 hand-marked switch zones) —
  Nemotron has never seen it; nothing is tuned on it.
- Not usable as held-out for Nemotron: AMI train/dev, VoxConverse, DIHARD dev (in its training data).

## Scoring (identical for both systems)
accuracy/lab metrics (pyannote.metrics semantics, cross-checked): DER (collar 0, overlap scored), JER;
SparkScribe diagnostics: correct/wrong-person time, missed/false changes (±0.5/±1 s), short turns < 1 s,
false overlap (overlap marked on one-person speech), identity swaps, speaker count; CPU time, peak memory.
Nemotron overlap = two named speakers (it names both); v1 has no overlap output.

## Acceptance (decided on the held-out sessions, per recording; supporting data = warnings only)
- DER ≥ 15 % lower than v1 (relative) on each held-out session
- wrong-person time not higher; identity swaps not higher
- missed changes ≥ 25 % lower with false changes ≤ v1 × 1.10
- turns < 1 s correctly attributed ≥ 20 % more often
- user's recording: not worse than v1 on the human labels (round-1 score ≥ 24/27; round-2 head-to-head not lost)
- CPU time ≤ 3× v1 on this machine (8-CPU cap); peak memory ≤ 2 GB
- any meaningful regression on any critical recording = warning, reported even if averages improve
