# v1 + Nemotron hybrid: offline feasibility protocol (written 2026-10-11, before any hybrid result was computed)

Question: can saved Nemotron predictions add the speaker changes / short interruptions v1 misses, while v1 keeps
identities stable, without unacceptable regressions? Saved predictions only: no model is run, nothing downloaded.

## Inputs (all already on disk)
- v1: frozen engine var/v1.mjs, Auto mode (dev: scratchpad/rs/*-auto-v1.json; held-out: nemotron/v1runs/*-auto-v1.json;
  user's recording: diar/final/coffee-n3-v1.json, the run the human review was done on)
- Nemotron: nemotron/runs/*-nemotron.json (int8, offline, raw output)
- Cached v1 fingerprints (WeSpeaker, 1.5 s windows, 0.25 s hop, inside v1 runs) exist only for ES2004a and IS1009a
  (diar/slide/*-w1.5.json); acoustic verification is therefore assessed on those two dev sessions only.

## Data roles
- Development (rules formed here only): AMI ES2004a, IS1009a, TS3003a, EN2002b (headset), ES2004a far mic;
  synthetic two-short-interruptions, one-speaker-everything, similar-voices, five-speakers.
- Held-out (final assessment only, scored once, after this file and the chosen rule are frozen): AMI IS1009c, EN2002d.
- Supporting only (never used to choose anything): the user's 23:22 recording (human labels).
- Leakage disclosed: held-out sessions share all four speakers with IS1009a / EN2002b; v1 was developed on the dev AMI
  sessions; aggregate held-out scores of v1 and Nemotron were already seen in the previous experiment.

## Label alignment (no answer key)
Nemotron labels are mapped one-to-one to v1 labels (Hungarian on time where each system names exactly one speaker).
All outputs are 10 ms frame grids; v1 and Nemotron baselines are scored through the same grid (H0 / H1).

## Analyses
1. Every Nemotron change (lab definition: named runs, same-label gaps < 0.5 s merged) is classed correct (a reference
   change within ±0.5 s) or false; also whether the identities on both sides are right (ground-truth mapping, for
   measurement only).
2. Features available without the answer key: v1 change within ±0.5 / ±1 s; v1's labels on both sides agree with the
   mapped Nemotron labels; Nemotron run lengths before / after; gap; (dev ES2004a / IS1009a) fingerprint margin
   sim(window after t, v1 voice of B) - sim(window, v1 voice of A). Reported as AUC and precision when true / false,
   with the subset "v1 has no change within ±1 s" (the only changes a hybrid could add) shown separately.
3. Nemotron's unnamed reference speech: what v1 says there (right / wrong / nothing), by context (gap between the same
   Nemotron speaker, v1 agrees with a neighbour, v1 names a third person) and gap length.
4. Short turns (< 1 s reference turns, standalone vs said over) and identity consistency (swaps, wrong-person time,
   splits / merges) reported separately.

## Strategies (fixed grid)
- H0 v1; H1 Nemotron (mapped).
- H2 Nemotron where it names someone, v1 everywhere else.
- H3(G) as H2, but a Nemotron gap is filled from v1 only when v1's label there equals the Nemotron label just before or
  just after the gap and the gap is <= G s; G in {0.5, 1, 2, 5, inf}.
- H4(dmin, dmax, sandwich, fillGaps) v1 base; a Nemotron single-speaker run whose mapped label L differs from v1's
  majority there and lasts dmin..dmax s replaces v1's label; sandwich = only when v1 has the same label just before and
  after (an interruption v1 absorbed); fillGaps = also when v1 names nobody there.
  dmin in {0, 0.3}, dmax in {1, 2, 4, inf}, sandwich, fillGaps in {no, yes}.
- (dev-only diagnostic) acoustic verification of Nemotron changes inside v1 runs with cached fingerprints.

## Dev selection (pooled over the 5 dev AMI recordings)
Choose the candidate with the largest reduction in missed changes (±0.5 s) subject to, pooled:
DER <= v1, JER <= v1, wrong-person time <= v1, swaps <= v1, false changes <= 1.10 x v1, unnamed speech <= v1 + 1 pt;
and no synthetic recording with DER worse than v1 by > 2 pts. If none qualifies, the hybrid is rejected on dev.

## Held-out acceptance (each of IS1009c, EN2002d, vs v1 Auto)
Meaningful improvement: missed changes >= 25 % lower AND turns < 1 s with the right speaker >= 20 % more.
No unacceptable regression: DER <= v1 + 0.3 pt, JER <= v1 + 0.3 pt, wrong-person time <= v1 + 0.25 pt, swaps <= v1,
false changes <= 1.10 x v1, unnamed speech <= v1 + 1 pt.
User's recording: round-1 below 24/27 or a lost round-2 head-to-head = warning (reported, never tuned on).
Cost: download, CPU, memory and complexity estimated from measured runs; no new runs.
