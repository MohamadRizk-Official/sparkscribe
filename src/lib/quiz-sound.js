// Answer sounds for the Practice Quiz: a short bright chime for a right answer, a soft low two-note tone for a
// wrong one. Made with Web Audio (no files to download), quiet, and off when the person turns them off in
// Settings → Preferences. Kept in this browser only.
export const QUIZ_SOUND_KEY = 'sparkscribe.quizSounds';
export function quizSoundsOn() {
  try { return localStorage.getItem(QUIZ_SOUND_KEY) !== '0'; } catch { return true; }
}
export function setQuizSounds(on) {
  try { localStorage.setItem(QUIZ_SOUND_KEY, on ? '1' : '0'); } catch { /* this page only */ }
}

let ctx = null;
// call inside the click that leads to a sound (browsers only allow audio after a gesture)
export function primeQuizSound() {
  if (!quizSoundsOn()) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
  return ctx;
}

// one note: a sine (or triangle) with a quick attack and an exponential fade
function note(ac, { freq, to = freq, start = 0, dur = 0.5, gain = 0.1, type = 'sine' }) {
  const t = ac.currentTime + start;
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export function playAnswerSound(correct) {
  const ac = primeQuizSound();
  if (!ac) return;
  try {
    if (correct) {
      // "ding": two bright partials, the second a fifth above, starting a moment later
      note(ac, { freq: 1046.5, dur: 0.55, gain: 0.09 });
      note(ac, { freq: 1568, start: 0.07, dur: 0.7, gain: 0.08 });
      note(ac, { freq: 3136, start: 0.07, dur: 0.25, gain: 0.015 });
    } else {
      // a soft, low "nope": two short falling notes
      note(ac, { freq: 233, to: 196, dur: 0.18, gain: 0.09, type: 'triangle' });
      note(ac, { freq: 185, to: 147, start: 0.17, dur: 0.32, gain: 0.09, type: 'triangle' });
    }
  } catch { /* no audio on this device */ }
}
