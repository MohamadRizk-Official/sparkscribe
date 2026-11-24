// insights/export.js document builders: toText, toMarkdown, fileBase and the subtitle time format on small inputs.
import assert from 'node:assert/strict';
const { toText, toMarkdown, toSrt, toVtt, fileBase, FORMATS } = await import(new URL('../src/insights/export.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; console.log('ok -', m); };

const doc = {
  title: 'Biology 8', meta: ['Saved 1 Jan'],
  sections: [{ heading: 'Notes', blocks: [{ t: 'h', text: 'Cells' }, { t: 'li', text: 'Nucleus', time: 75 }, { t: 'p', text: 'Plain *text*' }, { t: 'quote', text: 'Said it', time: 3600 }] }],
};
const txt = toText(doc);
ok(txt.startsWith('Biology 8\nSaved 1 Jan\n'), 'text starts with the title and meta lines');
ok(txt.includes('NOTES\n=====\n'), 'a section heading is upper-cased and underlined');
ok(txt.includes('- Nucleus [1:15]'), 'a list item with a time gets a [m:ss] suffix');
ok(txt.includes('Said it [1:00:00]'), 'times over an hour use h:mm:ss');
ok(txt.endsWith('\n') && !txt.endsWith('\n\n'), 'text ends with exactly one newline');
ok(!/\n{3,}/.test(txt), 'text never has more than one blank line in a row');

const md = toMarkdown(doc);
ok(md.startsWith('# Biology 8\n'), 'markdown starts with an h1 title');
ok(md.includes('*Saved 1 Jan*'), 'meta lines are italic');
ok(md.includes('## Notes') && md.includes('### Cells'), 'section and block headings use ## and ###');
ok(md.includes('- Nucleus *(1:15)*'), 'a list item keeps its time in italics');
ok(md.includes('Plain \\*text\\*'), 'markdown characters in text are escaped');
ok(md.includes('> Said it *(1:00:00)*'), 'a quote uses > and shows its time');
eq(toMarkdown({ title: '1. First', meta: [], sections: [] }), '# \\1. First\n', 'a title that looks like a numbered list has its number escaped');

eq(fileBase('Biology Lecture 8', 'Study Guide'), 'Biology-Lecture-8-Study-Guide', 'fileBase joins parts with dashes');
eq(fileBase('Café été'), 'Cafe-ete', 'fileBase strips accents');
eq(fileBase(null, '', undefined), 'SparkScribe-export', 'fileBase falls back to a default name');
eq(fileBase('???'), 'SparkScribe-export', 'a name with no letters or digits falls back too');
ok(fileBase('x'.repeat(200)).length <= 90, 'fileBase is at most 90 characters');
eq(toSrt([{ start: 3661.5, end: 3662, speaker: 'A', text: 'hi' }]), '1\n01:01:01,500 --> 01:01:02,000\nA: hi\n', 'SRT times use hh:mm:ss,mmm');
ok(toVtt([{ start: 1, end: 2, speaker: 'Unknown', text: 'x' }]).startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx'), 'VTT times use a dot, and an Unknown speaker has no prefix');
eq(toSrt([]), '', 'no segments give an empty SRT');
ok(FORMATS.srt.subtitles && FORMATS.vtt.subtitles && !FORMATS.pdf.subtitles, 'only SRT and VTT are flagged as subtitle formats');
console.log(`${pass} checks passed`);
