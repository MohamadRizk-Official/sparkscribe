// Export builders (src/insights/export.js): every implemented format, Unicode, special characters, line breaks,
// long transcripts, empty input, subtitle timing. Node only: no browser, no network.
import assert from 'node:assert/strict';
const { toText, toMarkdown, toSrt, toVtt, fileBase, toDocx, toPdf, FORMATS } = await import(new URL('../src/insights/export.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const segs = [
  { start: 0, end: 2.5, speaker: 'Maya', text: 'Café menu: crème brûlée costs 5 € — “quoted” & <b>bold</b>' },
  { start: 2.5, end: 2.5, speaker: 'Unknown', text: 'Mm-hmm.' }, // zero-length line
  { start: 3, end: 9, speaker: 'Sam', text: 'Two lines\n\nwith a blank line --> and an arrow 🎉' },
  { start: 8, end: 12, speaker: 'Maya', text: 'Overlaps the next start.' },
  { start: 11, end: 15, speaker: 'Sam', text: '   ' }, // whitespace only: no cue
];

// ---- subtitles ----
const srt = toSrt(segs);
const srtCues = srt.trim().split(/\n\n/);
ok(srtCues.length === 4, 'SRT: one cue per non-empty line (whitespace-only line skipped)');
ok(srtCues.every((c) => /^\d+\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\n[^\n]+$/.test(c)), 'SRT: every cue is index / timing / exactly one text line');
ok(srtCues[2].includes('Sam: Two lines with a blank line -> and an arrow 🎉'), 'SRT: blank line collapsed, "-->" neutralised, emoji kept');
ok(srtCues[0].includes('Maya: Café menu: crème brûlée costs 5 € — “quoted” & <b>bold</b>'), 'SRT: Unicode and symbols kept verbatim');
ok(!srtCues[1].includes('Unknown:'), 'SRT: Unknown speaker not prefixed');
const t = (cue) => cue.split('\n')[1].split(' --> ').map((x) => { const [h, m, r] = x.split(':'); return +h * 3600 + +m * 60 + parseFloat(r.replace(',', '.')); });
ok(t(srtCues[1])[1] > t(srtCues[1])[0], 'SRT: zero-length line gets a positive duration');
ok(t(srtCues[2])[1] <= t(srtCues[3])[0], 'SRT: a cue never runs past the next cue start');

const vtt = toVtt(segs);
ok(vtt.startsWith('WEBVTT\n\n'), 'VTT: header');
const vttCues = vtt.slice(8).trim().split(/\n\n/);
ok(vttCues.length === 4 && vttCues.every((c) => /^\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}\n[^\n]+$/.test(c)), 'VTT: every cue is timing / one text line');
ok(vttCues[0].includes('&amp; &lt;b&gt;bold&lt;/b&gt;') && !/<b>/.test(vtt), 'VTT: & < > escaped (cue text is markup)');
ok(!/-->/.test(vttCues.map((c) => c.split('\n')[1]).join('\n')), 'VTT: no "-->" inside cue text');
ok(toSrt([]) === '' && toVtt([]) === 'WEBVTT\n\n', 'subtitles: empty transcript gives an empty (valid) file');

// ---- text / markdown ----
const doc = {
  title: 'Planning call — “bake sale” & co.',
  meta: ['Length: 1:02 · Speakers: Maya, Sam'],
  sections: [{ heading: 'Transcript', blocks: [{ t: 'h', text: '[0:00] Maya' }, { t: 'p', text: segs[0].text }, { t: 'h', text: '[0:03] Sam' }, { t: 'p', text: segs[2].text }, { t: 'li', text: 'A point', time: 65 }] }],
};
const txt = toText(doc);
ok(txt.startsWith('Planning call — “bake sale” & co.\nLength: 1:02 · Speakers: Maya, Sam\n'), 'TXT: title and meta first, Unicode intact');
ok(txt.includes(segs[0].text) && txt.includes('[0:03] Sam') && txt.includes('- A point [1:05]'), 'TXT: speaker headings, text and timestamps');
ok(!/\n{3,}/.test(txt) && txt.endsWith('\n'), 'TXT: no runs of blank lines, ends with newline');
const md = toMarkdown(doc);
ok(md.includes('Planning call') && md.includes('Maya') && md.includes('crème brûlée'), 'Markdown: content and Unicode');

// long transcript: 5,000 lines stay complete
const long = { title: 'Long', meta: [], sections: [{ heading: 'Transcript', blocks: Array.from({ length: 5000 }, (_, i) => ({ t: 'p', text: `Line ${i} text` })) }] };
const lt = toText(long);
ok(lt.includes('Line 0 text') && lt.includes('Line 4999 text') && (lt.match(/Line \d+ text/g) || []).length === 5000, 'TXT: 5,000-line transcript complete');
ok(toSrt(Array.from({ length: 3000 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5, speaker: 'A', text: `cue ${i}` }))).split('\n\n').length === 3000, 'SRT: 3,000 cues');

// empty AI section / empty document
ok(toText({ title: 'T', meta: [], sections: [] }) === 'T\n', 'TXT: document with no sections');
ok(toText({ title: 'T', meta: [], sections: [{ heading: 'Notes', blocks: [] }] }).includes('NOTES'), 'TXT: empty section keeps its heading');

// ---- file names ----
ok(fileBase('Biology Lecture 8', 'Study Guide') === 'Biology-Lecture-8-Study-Guide', 'file name: words joined with dashes');
ok(fileBase('Café résumé') === 'Cafe-resume', 'file name: accents folded');
ok(fileBase('اجتماع') === 'SparkScribe-export', 'file name: non-Latin title falls back to a safe default');
ok(fileBase('x'.repeat(200)).length <= 90, 'file name: length capped');
ok(Object.keys(FORMATS).sort().join() === 'docx,md,pdf,srt,txt,vtt', 'formats implemented: pdf, docx, md, txt, srt, vtt');

// ---- Word ----
const blob = await toDocx(doc);
const bytes = new Uint8Array(await blob.arrayBuffer());
ok(bytes[0] === 0x50 && bytes[1] === 0x4b && blob.size > 2000, 'DOCX: a real zip package is produced');

// ---- PDF: characters outside Windows-1252 (D23) ----
const { readFileSync } = await import('node:fs');
const fontDir = new URL('../public/fonts/', import.meta.url);
const localFont = async (name) => new Uint8Array(readFileSync(new URL(name, fontDir)));
const pdfOf = async (title, lines, opts) => {
  const info = {};
  const b = await toPdf({ title, meta: ['Exported test'], sections: [{ heading: 'Transcript', blocks: lines.map((text) => ({ t: 'p', text })) }] }, info, opts);
  return { info, text: Buffer.from(await b.arrayBuffer()).toString('latin1'), size: b.size };
};
const plain = await pdfOf('Weekly sync', ['Sam: the launch is on Monday → slides by Friday.'], { fetchFont: localFont });
ok(!plain.info.unicode && plain.info.replaced === 0 && /Helvetica/.test(plain.text) && !/NotoSans/.test(plain.text) && plain.size < 20000, `PDF: English text keeps the small built-in font (${plain.size} bytes, no font download)`);
const intl = await pdfOf('Spotkanie z Łukaszem', ['Łukasz: dziękuję', 'Αθηνά: ευχαριστώ', 'Иван: спасибо', 'Nguyễn Thị Ánh: cảm ơn', 'Ğül & Şükrü → ok'], { fetchFont: localFont });
ok(intl.info.unicode && intl.info.replaced === 0 && /NotoSans/.test(intl.text) && /FontFile2/.test(intl.text), `PDF: Polish, Greek, Cyrillic, Vietnamese and Turkish names embed Noto Sans and lose nothing (${Math.round(intl.size / 1024)} KB)`);
const cjk = await pdfOf('Mixed', ['Li Wei 李伟: hello 😀'], { fetchFont: localFont });
ok(cjk.info.unicode && cjk.info.replaced === 3, `PDF: characters no bundled font covers (李伟, 😀) are counted (${cjk.info.replaced}) so the user is told`);
const offline = await pdfOf('Łódź', ['Łukasz'], { fetchFont: async () => { throw new Error('offline'); } });
ok(!offline.info.unicode && offline.info.replaced === 3 && offline.size < 20000, 'PDF: if the font can’t load (offline), the export still works with "?" and says how many');
const { NOTO_RANGES } = await import('../src/insights/pdf-font-coverage.js');
const covers = (ch) => NOTO_RANGES.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);
ok([...'ŁĄęŻźĞşİ ΑΩαω АЯаяЁё ẠỹĐđ€–—…“”'].every(covers) && ![...'李😀ש'].some(covers), 'font coverage table matches the bundled subset (Latin Ext, Greek, Cyrillic, Vietnamese; not CJK/emoji/Hebrew)');

console.log(`\n${pass} checks passed`);
