// peaks() in src/audio.js: the waveform the player draws. Pure function, no browser needed.
import assert from 'node:assert/strict';
import { peaks, SAMPLE_RATE } from '../src/audio.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(SAMPLE_RATE === 16000, 'samples are 16 kHz');

const out = peaks(new Float32Array(1000), 10);
ok(out instanceof Float32Array && out.length === 10, 'asks for n peaks, gets n peaks');
ok(out.every((v) => v === 0), 'silence draws as zeros');

// each peak is the loudest absolute value in its block, whichever sign
const s = new Float32Array(100);
s[3] = -0.5; s[12] = 0.25; s[55] = 0.75; s[99] = -1;
const p = peaks(s, 10);
ok(p[0] === 0.5, 'a negative sample counts by its size');
ok(p[1] === 0.25, 'the next block has its own peak');
ok(p[5] === 0.75 && p[9] === 1, 'later blocks keep theirs');
ok(p[2] === 0 && p[7] === 0, 'quiet blocks stay at zero');

// fewer samples than peaks: block size never drops below one sample, the rest stay zero
const short = peaks(Float32Array.from([0.5, -0.25]), 5);
ok(short.length === 5 && short[0] === 0.5 && short[1] === 0.25 && short[2] === 0, 'a very short clip fills the start and leaves the rest at zero');

// default is 400 peaks
ok(peaks(new Float32Array(8000)).length === 400, 'defaults to 400 peaks');

// samples past the last full block are not drawn (block = floor(length / n))
const tail = new Float32Array(25); tail[24] = 1;
ok(peaks(tail, 10)[9] === 0, 'a spike in the leftover tail is not drawn');

console.log(`\n${pass} checks passed`);
