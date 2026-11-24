// lib/across-refs.js renderAcross / renderAcrossStreaming on unknown tokens, spacing, null input and half-written tokens.
import assert from 'node:assert/strict';
import { renderAcross, renderAcrossStreaming } from '../src/lib/across-refs.js';

let pass = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; console.log('ok -', m); };
const names = { title: (l) => ({ R1: 'Bio 2', R2: 'Bio 5' })[l], speaker: (c) => ({ 'R1.S1': 'Dee' })[c] };

eq(renderAcross('{{R1}} and {{R2}}', names), 'Bio 2 and Bio 5', 'recording tokens become their current titles');
eq(renderAcross('{{ R1 }}', names), 'Bio 2', 'spaces inside the braces are allowed');
eq(renderAcross('{{R1.S1}} said so', names), 'Dee said so', 'a speaker token becomes the speaker\'s current name');
eq(renderAcross('{{R9}} and {{R1.S9}}', names), 'a recording and a speaker', 'unknown tokens show a neutral word, never the raw token');
eq(renderAcross(null, names), '', 'null text renders as an empty string');
eq(renderAcross(undefined, names), '', 'undefined text renders as an empty string');
eq(renderAcross('plain text', names), 'plain text', 'text without tokens is unchanged');
eq(renderAcross('{{R1}} (Bio) ok', names), 'Bio 2 ok', 'a parenthesised word the title already contains is not repeated');
eq(renderAcross('{{R1}} (week 2) ok', names), 'Bio 2 (week 2) ok', 'other parenthesised text is kept');
eq(renderAcross('{{R1.S1}} and {{R1.S1}}', names), 'Dee and Dee', 'every occurrence is replaced');

eq(renderAcrossStreaming('See {{R1}} then {{R1.S', names), 'See Bio 2 then ', 'an unfinished speaker token at the end is hidden while streaming');
eq(renderAcrossStreaming('A {{', names), 'A ', 'a lone opening brace pair is hidden');
eq(renderAcrossStreaming('A {{R', names), 'A ', 'a token started with R is hidden');
eq(renderAcrossStreaming('use {a} here', names), 'use {a} here', 'ordinary braces in the text are left alone');
eq(renderAcrossStreaming('ends with }', names), 'ends with }', 'a stray closing brace is left alone');
eq(renderAcrossStreaming('done {{R2}}', names), 'done Bio 5', 'a completed token is rendered while streaming');
console.log(`${pass} checks passed`);
