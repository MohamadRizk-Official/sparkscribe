// scripts/hidden-input.mjs and how stripe-live-setup.mjs uses it. Regression for 2026-10-20: the readline-based "hidden"
// prompt printed most of a pasted Stripe key, because readline redraws "prompt + text" on paste and the mask let any
// output containing the prompt through. Fake terminal streams; no real key.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { readHidden } from '../scripts/hidden-input.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const KEY = 'rk_live_' + 'AbC123xYz'.repeat(10); // fake

function term() {
  const input = new EventEmitter();
  input.isTTY = true; input.raw = false; input.modes = [];
  input.setRawMode = (v) => { input.raw = v; input.modes.push(v); };
  input.setEncoding = () => {}; input.resume = () => {}; input.pause = () => {};
  const output = { text: '', write(s) { this.text += s; } };
  return { input, output };
}
const Q = 'RUNTIME key for Production (restricted rk_live_…): ';

{ // pasted in one chunk with bracketed-paste markers, the way terminals deliver a paste
  const { input, output } = term();
  const p = readHidden(Q, { input, output });
  input.emit('data', `\x1b[200~${KEY}\x1b[201~`);
  input.emit('data', '\r');
  const v = await p;
  ok(v === KEY, 'the pasted key is read exactly (paste markers removed)');
  ok(output.text === `${Q}${'*'.repeat(KEY.length)}\n`, 'the screen shows only the question and one * per character');
  ok(!output.text.includes('rk_live_AbC') && !output.text.includes('AbC123'), 'no part of the key is ever written to the terminal');
  ok(input.modes.join() === 'true,false', 'raw mode is switched on while reading and off afterwards');
}
{ // typed with a correction, then Enter in the same chunk
  const { input, output } = term();
  const p = readHidden(Q, { input, output });
  for (const ch of 'rk_live_abX') input.emit('data', ch);
  input.emit('data', '\x7f');
  input.emit('data', 'c\r');
  ok(await p === 'rk_live_abc', 'typing and Backspace work');
  ok(!/rk_live_ab/.test(output.text.replace(Q, '')), '…still nothing but * and the erase sequence on screen');
}
{ // Ctrl+C cancels and restores the terminal
  const { input, output } = term();
  const p = readHidden(Q, { input, output });
  input.emit('data', 'rk_li\x03');
  let err = null; try { await p; } catch (e) { err = e; }
  ok(err && /cancelled/.test(err.message) && input.raw === false, 'Ctrl+C cancels (nothing returned) and leaves raw mode');
}
{ // a terminal that redraws: even if the prompt text arrives again in the input, nothing but * is printed
  const { input, output } = term();
  const p = readHidden(Q, { input, output });
  input.emit('data', `${KEY}\n`);
  await p;
  ok((output.text.match(/\*/g) || []).length === KEY.length && output.text.split(Q).length === 2, 'the question is printed once; no redraw of the line');
}

// ---- stripe-live-setup.mjs uses it, checks Vercel before touching Stripe, and keeps the webhook secret until stored
{
  const src = readFileSync(new URL('../scripts/stripe-live-setup.mjs', import.meta.url), 'utf8');
  ok(/import \{ readHidden \} from '\.\/hidden-input\.mjs'/.test(src) && !/from 'node:readline'/.test(src) && !/_writeToOutput/.test(src), 'the setup prompts use readHidden (the readline prompt is gone)');
  const pre = src.indexOf("run(bin, ['env', 'ls', 'production'])"), firstStripe = src.indexOf('await probe(stripe, SETUP)'), del = src.indexOf('webhookEndpoints.del');
  ok(pre > 0 && pre < firstStripe && pre < del, 'Vercel sign-in is checked before any Stripe call and before any webhook could be replaced');
  ok(!/process\.on\('exit'/.test(src) && !/cleanup\(\)/.test(src), 'the webhook secret file is no longer deleted on exit or on failure');
  const stored = src.indexOf("vercel(['env', 'add', name, 'production'"), removed = src.indexOf('rmSync(SECRET_FILE');
  ok(stored > 0 && removed > stored, '…it is removed only after the Vercel writes');
  ok(/existsSync\(SECRET_FILE\) \? readFileSync\(SECRET_FILE/.test(src) && /Reveal\), or press Enter to replace the endpoint/.test(src), 'an existing webhook is kept with a saved or revealed secret; replacing it needs an explicit Enter');
}
console.log(`\n${pass} checks passed`);
