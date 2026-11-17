# Accuracy lab: speaker metrics and ground truth (`accuracy/lab/`)

Pure ES modules used by the accuracy tools to score who-spoke-when output. They have no browser or Node-specific
imports, so they run in plain Node. For the wider accuracy workflow see [`accuracy/README.md`](../../accuracy/README.md).

## `metrics.mjs`: standard diarization metrics
Follows `pyannote.metrics` 4.1 semantics, computed exactly on segment boundaries (no frames). Inputs are lists of
`{ start, end, label }` in seconds. Covered by `tests/metrics-test.mjs` (DER, JER, Hungarian assignment) and
`tests/lab-metrics-parts-test.mjs` (the parts below).

- `normalize(segs)`: merges each label's overlapping or touching segments, drops empty or reversed ones, sorts by start. A speaker can therefore never be counted twice at the same instant.
- `standardHypothesis(segments, unknown = 'Unknown', { namedOverlap })`: SparkScribe segments → hypothesis. "Unknown" and overlap stretches are **not speakers**, so their time counts as missed speech. With `namedOverlap`, an overlap segment whose `voices` are known counts for each of them (reported separately, never as the headline).
- `evaluatedRegion(ref, hyp, { collar, skipOverlap, uem })`: the scored time. Default: from the first start to the last end of reference plus hypothesis. A `collar` removes half its width either side of every reference start and end; `skipOverlap` removes where two reference speakers overlap; `uem` replaces the default extent.
- `optimalMapping(ref, hyp, region)`: one-to-one mapping from hypothesis labels to reference labels maximising shared time (Hungarian algorithm). Only pairs that actually co-occur are kept, so a hypothesis label with no shared time is never "correct", and two reference speakers cannot share one hypothesis label.
- `der`: `(missed + false alarm + confusion) / total reference speech`. `jer`: mean over reference speakers of (miss + false alarm) / union with the mapped hypothesis speaker (1.0 when unmapped).
- `standardMetrics(ref, hyp)`: the reported set: DER with no collar, DER with a 0.25 s collar, DER skipping overlap, JER and JER per speaker, with the protocol name.

## `reference.mjs`: ground-truth readers
- `readRttm(text)`: NIST RTTM → segments. Only lines starting with `SPEAKER` are used; end is start + duration; the label is the 8th field.
- `toSeconds(t)`: a number, or `m:ss`, `m:ss.s`, `h:mm:ss`.
- `readSpans(json)`: partial human labels `{ spans: [[start, end, speakerNumber, note?]] }` → segments (label is the number, `note` is `null` when absent).

## `extras.mjs` and `diagnostics.mjs`
- `scoreSpans(segments, spans)`: for each human-labelled span, the named speaker with the most time in it is mapped to the span numbers (same Hungarian rule as DER); verdict `right`, `wrong` or `unsure` (Unknown, overlap, or no named speech). Returns counts, the mapping and a per-span detail.
- `frames(segments, dur)`, `hypRunsOf(segments)`, `summary(...)`: SparkScribe's own 10 ms-frame diagnostics. They are **not** benchmark metrics (they count Unknown separately); report them next to the standard ones, never mixed. `hypRunsOf` joins one speaker's segments separated by less than 0.5 s. Covered by `tests/lab-spans-diagnostics-test.mjs`; `tests/lab-reference-test.mjs` covers the readers.
