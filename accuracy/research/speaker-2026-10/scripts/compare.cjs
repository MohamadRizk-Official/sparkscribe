// v1 vs Nemotron table from scored JSONs (same scorer, same RTTM, same mapping rules)
const fs = require('fs'), S = process.argv[2];
const rows = [
  ['IS1009c (held-out)', `${S}/nemotron/v1runs/IS1009c-auto-v1.json`, `${S}/nemotron/scored/IS1009c-nemotron.json`, `${S}/nemotron/v1runs/IS1009c-n4-v1.json`],
  ['EN2002d (held-out)', `${S}/nemotron/v1runs/EN2002d-auto-v1.json`, `${S}/nemotron/scored/EN2002d-nemotron.json`, `${S}/nemotron/v1runs/EN2002d-n4-v1.json`],
  ['ES2004a', `${S}/rs/ES2004a-auto-v1.json`, `${S}/nemotron/scored/ES2004a-nemotron.json`],
  ['IS1009a', `${S}/rs/IS1009a-auto-v1.json`, `${S}/nemotron/scored/IS1009a-nemotron.json`],
  ['TS3003a', `${S}/rs/TS3003a-auto-v1.json`, `${S}/nemotron/scored/TS3003a-nemotron.json`],
  ['EN2002b', `${S}/rs/EN2002b-auto-v1.json`, `${S}/nemotron/scored/EN2002b-nemotron.json`],
  ['ES2004a far mic', `${S}/rs/ES2004a-far-auto-v1.json`, `${S}/nemotron/scored/ES2004a-far-nemotron.json`],
  ['two-short-interruptions', `${S}/rs/two-short-interruptions-auto-v1.json`, `${S}/nemotron/scored/two-short-interruptions-nemotron.json`],
  ['one-speaker-everything', `${S}/rs/one-speaker-everything-auto-v1.json`, `${S}/nemotron/scored/one-speaker-everything-nemotron.json`],
  ['similar-voices', `${S}/rs/similar-voices-auto-v1.json`, `${S}/nemotron/scored/similar-voices-nemotron.json`],
  ['five-speakers', `${S}/rs/five-speakers-auto-v1.json`, `${S}/nemotron/scored/five-speakers-nemotron.json`],
];
const m = (f) => {
  const j = JSON.parse(fs.readFileSync(f, 'utf8')), L = j.lab, su = L.shortUtterances;
  let tot = 0, own = 0, oth = 0; for (const b of ['0-0.5s', '0.5-1s']) for (const k of ['standalone', 'saidOver']) { tot += su[b][k].total; own += su[b][k].own; oth += su[b][k].otherPerson; }
  return { der: +(100 * j.standard.der.der).toFixed(1), miss: +(100 * j.standard.der.missed / j.standard.der.total).toFixed(1),
    fa: +(100 * j.standard.der.falseAlarm / j.standard.der.total).toFixed(1), conf: +(100 * j.standard.der.confusion / j.standard.der.total).toFixed(1),
    jer: +(100 * j.standard.jer).toFixed(1), right: L.singleSpeech.correctPersonPct, wrong: L.singleSpeech.wrongPersonPct, noName: L.singleSpeech.noNamedLabelPct,
    mc: L.changes['within0.5s'].missed, fc: L.changes['within0.5s'].false, refc: L.changes['within0.5s'].reference,
    mc1: L.changes['within1s'].missed, fc1: L.changes['within1s'].false,
    shortOwn: own, shortTot: tot, shortWrong: oth, swaps: j.identitySwaps, spk: `${L.speakerCount.detected}/${L.speakerCount.reference}`,
    falseOv: L.overlapMarkedS.single, splits: L.splits.length, merges: L.merges.length, cpu: j.run?.cpuS, rss: j.run?.peakRssMB };
};
const out = rows.map(([n, a, b, c]) => ({ n, v1: m(a), ne: m(b), v1n: c ? m(c) : null }));
console.log(JSON.stringify(out));
