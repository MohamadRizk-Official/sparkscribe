// ELECTRIC — the sound wave: a field of glowing particles shaped as a sound wave that runs across the whole page, from
// the left edge to the right, behind everything (owner request 2026-11-14, replacing the book outlines). Dozens of
// strands of points, each a slightly shifted copy of the same waveform, so together they read as one ribbon of light
// (cyan, blue, violet, a touch of magenta; where strands cross, the light adds up). It flows gently to the right forever.
// Click anywhere that isn't a control and a ripple of force runs out from that point: the points it passes are thrown
// outward, scatter a little, and settle back into the wave; the pointer also stirs the points it passes over.
//
// The idea (a particle field moved entirely in a vertex shader: shape, drift, pointer push and expanding click rings
// computed from time and a few uniforms, so the processor does almost nothing per frame) follows the technique of the
// particle hero on javvad.dev; this is our own code and our own shape, in plain WebGL (no library).
//
// Calm by design: it rests (no frames drawn) in a hidden tab, while a recording is being transcribed (the GPU is busy),
// on screens narrower than 900px, and with reduced motion (one still frame, no ripples).

const STRANDS = 30, PER_STRAND = 1100; // 33k points: dense enough along each strand to read as a line of light
const TAPS = 6;

const VERT = `
precision highp float;
attribute float aU; attribute float aS; attribute float aSeed;
uniform float uTime; uniform vec2 uView; uniform float uMid; uniform float uAmp; uniform float uSize; uniform float uDim; uniform float uGlow;
uniform vec2 uPointer; uniform vec4 uTaps[${TAPS}];
varying float vAlpha; varying vec3 vColor;

// one waveform, x 0..1 across the screen, s 0..1 which strand: a few travelling sines under an envelope that tapers
// only at the very ends of the screen and swells in a few places, the swells themselves drifting slowly
float wave(float x, float s, float t) {
  float env = smoothstep(0.0, 0.12, x) * smoothstep(1.0, 0.88, x) * (0.42 + 0.58 * pow(0.5 + 0.5 * sin(x * 9.0 - t * 0.21 + 0.8), 1.5)) * (0.8 + 0.2 * sin(x * 3.1 + t * 0.13));
  float ph = s * 2.4;
  float y = sin(x * 11.0 - t * 0.55 + ph) * 0.55
          + sin(x * 19.0 - t * 0.8 + ph * 1.6 + 1.2) * 0.25
          + sin(x * 5.0 - t * 0.32 - ph * 0.7) * 0.4;
  return y * env * (0.45 + 0.55 * s);
}

void main() {
  float t = uTime;
  float x = fract(aU + t * 0.01);                 // the points themselves drift slowly to the right
  vec2 p = vec2(x * uView.x, uMid - wave(x, aS, t) * uAmp);
  p.y += (aSeed - 0.5) * 0.8 + sin(t * 1.3 + aSeed * 90.0) * 0.5;   // a little grain and breath

  // the pointer stirs the points it passes over
  vec2 d = p - uPointer;
  p += normalize(d + 0.0001) * smoothstep(110.0, 0.0, length(d)) * 22.0;

  // click ripples: a ring of force expanding from the click, fading as it travels; points it crosses are pushed outward
  // and given a small random scatter that dies away, so the wave bursts and then re-forms
  for (int i = 0; i < ${TAPS}; i++) {
    vec4 tap = uTaps[i];
    float age = t - tap.z;
    if (age < 0.0 || age > 4.0) continue;
    vec2 td = p - tap.xy;
    float dist = length(td);
    float ring = exp(-pow((dist - age * 520.0) / 90.0, 2.0)) * exp(-age * 1.5);
    float near = exp(-dist / 220.0) * exp(-age * 2.2) * smoothstep(0.0, 0.08, age);
    float a = aSeed * 6.2832;
    p += normalize(td + 0.0001) * ring * 46.0 * tap.w + vec2(cos(a), sin(a)) * near * 70.0 * tap.w;
  }

  vec2 clip = vec2(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uSize * (0.8 + 0.4 * aSeed) * (1.0 + uGlow * 4.0);

  // colour along the wave: cyan at the ends, blue, violet and a little magenta toward the middle
  float c = 0.5 + 0.5 * sin(x * 6.2832 * 1.2 - 1.6 + aS * 1.2);
  vec3 cyan = vec3(0.22, 0.72, 1.0), blue = vec3(0.24, 0.36, 1.0), violet = vec3(0.54, 0.26, 1.0), pink = vec3(0.84, 0.32, 0.96);
  vColor = c < 0.5 ? mix(cyan, blue, c * 2.0) : mix(violet, pink, (c - 0.5) * 2.0);
  vColor = mix(vColor, blue, 0.15 * (1.0 - aS));
  // quiet at the very edges of the screen, softer behind the reading column in the middle
  float edge = smoothstep(0.0, 0.06, x) * smoothstep(1.0, 0.94, x);
  float col = mix(uDim, 1.0, smoothstep(500.0, 680.0, abs(p.x - uView.x * 0.5)));
  vAlpha = edge * col * (0.35 + 0.65 * aS) * (1.0 - uGlow * 0.93);
}`;

const FRAG = `
precision mediump float;
uniform float uOpacity; uniform float uDeep;
varying float vAlpha; varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(vColor * uDeep, a * vAlpha * uOpacity);
}`;

export function mountSoundWave(bg) {
  if (bg.querySelector('.bg-wave')) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'bg-wave';
  canvas.setAttribute('aria-hidden', 'true');
  bg.appendChild(canvas);
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) { canvas.remove(); return; }

  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
  gl.useProgram(prog);

  // per point: where along the wave (evenly spread, jittered), which strand, a random seed
  const n = STRANDS * PER_STRAND, data = new Float32Array(n * 3);
  for (let s = 0, k = 0; s < STRANDS; s++) {
    for (let i = 0; i < PER_STRAND; i++, k += 3) {
      data[k] = (i + Math.random()) / PER_STRAND;
      data[k + 1] = s / (STRANDS - 1);
      data[k + 2] = Math.random();
    }
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  ['aU', 'aS', 'aSeed'].forEach((name, i) => {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 12, i * 4);
  });
  const U = {};
  for (const name of ['uTime', 'uView', 'uMid', 'uAmp', 'uSize', 'uDim', 'uGlow', 'uPointer', 'uTaps', 'uOpacity', 'uDeep']) U[name] = gl.getUniformLocation(prog, name);
  gl.enable(gl.BLEND);

  const taps = new Float32Array(TAPS * 4).fill(-1e4);
  let tapSlot = 0, t = 0, last = performance.now(), raf = 0, dpr = 1, w = 0, h = 0;
  const pointer = { x: -1e4, y: -1e4 }, eased = { x: -1e4, y: -1e4 };

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const shown = matchMedia('(min-width: 900px)');
  const html = document.documentElement;
  const resting = () => document.hidden || html.classList.contains('bg-working') || !shown.matches;

  function theme() {
    const light = html.dataset.theme === 'light';
    // dark: the light adds up where strands cross (glow); light: ordinary blending, deeper colours, softer
    if (light) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniform1f(U.uOpacity, light ? 0.7 : 1);
    gl.uniform1f(U.uDeep, light ? 0.8 : 1);
    gl.uniform1f(U.uDim, light ? 0.3 : 0.38);
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uView, w, h);
    gl.uniform1f(U.uMid, h * 0.6);
    gl.uniform1f(U.uAmp, Math.min(h * 0.24, 250));
    gl.uniform1f(U.uSize, 2.6 * dpr);
  }
  function draw() {
    eased.x += (pointer.x - eased.x) * 0.25; eased.y += (pointer.y - eased.y) * 0.25;
    gl.uniform1f(U.uTime, t);
    gl.uniform2f(U.uPointer, eased.x, eased.y);
    gl.uniform4fv(U.uTaps, taps);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // two passes over the same points: a wide faint halo (the bloom around the strands), then the strands themselves
    gl.uniform1f(U.uGlow, 1); gl.drawArrays(gl.POINTS, 0, n);
    gl.uniform1f(U.uGlow, 0); gl.drawArrays(gl.POINTS, 0, n);
  }
  function frame(now) {
    raf = 0;
    if (resting()) return;
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    draw();
    if (!calm.matches) raf = requestAnimationFrame(frame);
  }
  // start (or restart) the loop when nothing asks it to rest; a still frame with reduced motion
  function wake() {
    canvas.hidden = !shown.matches;
    if (raf || resting()) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  resize(); theme(); wake();
  new MutationObserver(() => { theme(); wake(); if (calm.matches) draw(); }).observe(html, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  document.addEventListener('visibilitychange', wake);
  shown.addEventListener?.('change', () => { resize(); wake(); });
  calm.addEventListener?.('change', wake);
  window.addEventListener('resize', () => { resize(); if (calm.matches) draw(); wake(); });
  window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') { pointer.x = e.clientX; pointer.y = e.clientY; } }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.x = pointer.y = -1e4; });
  // a click on the page itself (not on a control, a field or a dialog) sends a ripple through the wave
  window.addEventListener('pointerdown', (e) => {
    if (calm.matches || resting() || e.button > 0) return;
    if (e.target.closest?.('a, button, input, textarea, select, label, summary, video, audio, [role="button"], [role="dialog"], [contenteditable], dialog')) return;
    taps.set([e.clientX, e.clientY, t, 1], (tapSlot++ % TAPS) * 4);
  }, { passive: true });
  canvas.addEventListener('webglcontextlost', () => { cancelAnimationFrame(raf); canvas.remove(); });
}
