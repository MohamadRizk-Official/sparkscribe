// Export through the real dialog after a speaker correction; downloads are captured (blob URLs), not saved.
// Run on /transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
import { $, $$, sleep, waitFor, runTests, assert, eq } from './lib.js';

const downloads = [];
function capture() {
  const origURL = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (b) => { downloads.push({ blob: b }); return origURL.call(URL, b); };
  HTMLAnchorElement.prototype.click = function () { const d = downloads.at(-1); if (d && this.download) d.name = this.download; else origClick.call(this); };
  return () => { URL.createObjectURL = origURL; HTMLAnchorElement.prototype.click = origClick; };
}
async function exportAs(fmt) {
  $('#exportBtn').click();
  const dlg = await waitFor(() => document.querySelector('dialog[open].export-dlg'), { what: 'export dialog' });
  const radio = dlg.querySelector(`input[name="fmt"][value="${fmt}"]`); assert(radio && !radio.disabled, `${fmt} available`);
  radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
  const before = downloads.length;
  dlg.querySelector('form').requestSubmit();
  await waitFor(() => downloads.length > before && downloads.at(-1).name, { timeout: 15000, what: `${fmt} download` });
  return downloads.at(-1);
}

export async function run() {
  const restore = capture();
  try {
    return await runTests([
      ['rename a speaker, then the exported TXT uses the new name everywhere', async () => {
        await waitFor(() => $$('#transcript .grp').length, { what: 'transcript' });
        const gi = $$('#transcript .grp').findIndex((g) => /Speaker 3/.test(g.querySelector('.who-name').textContent));
        assert(gi >= 0, 'a "Speaker 3" group exists');
        $$('#transcript .grp')[gi].querySelector('button.who').click();
        const item = await waitFor(() => [...($('.menu')?.querySelectorAll('button') || [])].find((b) => /^Rename Speaker 3 everywhere/.test(b.textContent)), { what: 'rename item' });
        item.click();
        const pd = await waitFor(() => document.querySelector('dialog[open] form'), { what: 'name dialog' });
        pd.querySelector('input').value = 'Nadia Ríos'; pd.requestSubmit();
        await waitFor(() => /saved/.test($('.toast')?.textContent || ''), { what: 'saved' });
        const d = await exportAs('txt');
        const text = await d.blob.text();
        eq(d.name, 'Pricing-meeting-Transcript.txt', 'file name');
        assert(text.includes('Nadia Ríos') && !/Speaker 3\b/.test(text), 'new name used, old label gone');
        assert(text.startsWith('Pricing meeting'), 'title first');
        assert(/\[\d+:\d{2}\]/.test(text), 'timestamps present');
        assert(text.includes('seven ninety nine'), 'transcript words present');
      }],
      ['SRT and VTT exports carry the corrected names and valid cues', async () => {
        const srt = await (await exportAs('srt')).blob.text();
        assert(/^1\n\d\d:\d\d:\d\d,\d{3} --> /.test(srt) && srt.includes('Nadia Ríos:'), 'SRT');
        const vtt = await (await exportAs('vtt')).blob.text();
        assert(vtt.startsWith('WEBVTT') && vtt.includes('Nadia Ríos:'), 'VTT');
      }],
      ['Markdown, Word and PDF exports are produced', async () => {
        const md = await exportAs('md'); assert((await md.blob.text()).includes('Nadia Ríos'), 'markdown has new name');
        const docx = await exportAs('docx'); const b = new Uint8Array(await docx.blob.arrayBuffer()); assert(b[0] === 0x50 && b[1] === 0x4b && docx.blob.size > 3000, 'docx zip');
        const pdf = await exportAs('pdf'); const head = await pdf.blob.slice(0, 5).text(); eq(head, '%PDF-', 'pdf header'); assert(pdf.blob.size > 2000, 'pdf size');
        assert(/\.docx$/.test(docx.name) && /\.pdf$/.test(pdf.name) && /\.md$/.test(md.name), 'extensions');
      }],
      ['PDF with a non-Latin-1 name embeds Noto Sans; a character no font covers is reported, not silently lost', async () => {
        const gi = $$('#transcript .grp').findIndex((g) => /Nadia Ríos/.test(g.querySelector('.who-name').textContent));
        $$('#transcript .grp')[gi].querySelector('button.who').click();
        const item = await waitFor(() => [...($('.menu')?.querySelectorAll('button') || [])].find((b) => /^Rename Nadia Ríos everywhere/.test(b.textContent)), { what: 'rename item' });
        item.click();
        const pd = await waitFor(() => document.querySelector('dialog[open] form'), { what: 'name dialog' });
        pd.querySelector('input').value = 'Łukasz 李'; pd.requestSubmit();
        await waitFor(() => /saved/.test($('.toast')?.textContent || ''), { what: 'saved' });
        const pdf = await exportAs('pdf');
        const raw = new TextDecoder('latin1').decode(await pdf.blob.arrayBuffer());
        assert(/NotoSans/.test(raw) && /FontFile2/.test(raw), 'Noto Sans embedded');
        assert(performance.getEntriesByType('resource').some((e) => /\/fonts\/NotoSans-Bold\.ttf$/.test(e.name)), 'font fetched from /fonts');
        const msg = await waitFor(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => /became/.test(t)), { what: 'export notice' });
        assert(/\d+ characters? PDF can.t show/.test(msg) && /Word or text keeps them/.test(msg), `notice: ${msg}`);
      }],
    ]);
  } finally { restore(); }
}
