// Ground-truth formats.
//   RTTM (NIST): "SPEAKER <file> 1 <start> <duration> <NA> <NA> <speaker> <NA> <NA>" -> [{ start, end, label }]
//   Spans (partial human labels, e.g. accuracy/testset/private/coffee-truth.json): { version, numbering, spans: [["m:ss.s","m:ss.s",speakerNumber]] }
export function readRttm(text) {
  return text.split('\n').filter((l) => l.startsWith('SPEAKER')).map((l) => l.trim().split(/\s+/))
    .map((p) => ({ start: +p[3], end: +p[3] + +p[4], label: p[7] }));
}

export const toSeconds = (t) => (typeof t === 'number' ? t : t.split(':').reduce((acc, x) => acc * 60 + Number(x), 0));

export function readSpans(json) {
  return (json.spans || []).map(([s, e, who, note]) => ({ start: toSeconds(s), end: toSeconds(e), label: who, note: note ?? null }));
}
