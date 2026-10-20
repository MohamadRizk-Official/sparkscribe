// A hidden terminal prompt: reads keystrokes itself (raw mode), prints only "*", never echoes what was typed or pasted.
// Replaces a readline-based prompt that leaked pasted keys (2026-10-20): when a key was pasted, readline redrew the
// line "prompt + text", and the masking let any redraw containing the prompt through in full.
// Handles paste (several characters at once, bracketed-paste markers), Backspace, Enter, Ctrl+C. tests/hidden-input-test.mjs
const ESCAPES = /\x1b\[[0-9;?]*[~A-Za-z]|\x1b[O][A-Za-z]/g;

export function readHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    output.write(question);
    let value = '';
    const raw = !!input.isTTY && typeof input.setRawMode === 'function';
    if (raw) input.setRawMode(true);
    if (typeof input.setEncoding === 'function') input.setEncoding('utf8');
    const finish = (err) => {
      input.removeListener('data', onData);
      if (raw) input.setRawMode(false);
      if (typeof input.pause === 'function') input.pause();
      output.write('\n');
      if (err) reject(err); else resolve(value.trim());
    };
    function onData(chunk) {
      for (const ch of String(chunk).replace(ESCAPES, '')) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003' || ch === '\u0004') return finish(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') { if (value) { value = value.slice(0, -1); output.write('\b \b'); } continue; }
        if (ch < ' ' || ch === '\u001b') continue;
        value += ch;
        output.write('*');
      }
    }
    input.on('data', onData);
    if (typeof input.resume === 'function') input.resume();
  });
}
