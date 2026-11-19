# Quiz answer sounds (`src/lib/quiz-sound.js`)

Short sounds for the Practice Quiz. Covered by `tests/quiz-sound-test.mjs`.

- Made with Web Audio, so there are no files to download. Quiet by design.
- **On by default.** The setting is `localStorage['sparkscribe.quizSounds']`: `'0'` is off, any other value or a
  missing key is on, and a storage error counts as on. `setQuizSounds(on)` writes `'1'` or `'0'`.
- Turned off from Settings → Preferences. Kept in this browser only.

## Playing
- `primeQuizSound()` creates (or resumes) the shared `AudioContext`. Call it inside the click that leads to a sound,
  because browsers only allow audio after a gesture. It returns `null` when sounds are off or Web Audio is missing.
- `playAnswerSound(correct)` plays nothing when sounds are off or no context exists, and swallows audio errors.
  - Right answer: a bright "ding", 1046.5 Hz and a fifth above (1568 Hz) 70 ms later, plus a faint 3136 Hz overtone.
  - Wrong answer: a soft low "nope", two short falling triangle notes (233 → 196 Hz, then 185 → 147 Hz at 170 ms).
- Each note has a 12 ms attack and an exponential fade.
