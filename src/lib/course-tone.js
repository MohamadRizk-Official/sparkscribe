// A course's accent colour: stable for the course (derived from its id), one of five tones of the Electric palette
// (src/electric/home.css .tone-*). The same course looks the same on Home, in the Library and in its own view.
const COURSE_TONES = ['cyan', 'violet', 'amber', 'blue', 'magenta'];
export const courseTone = (id) => COURSE_TONES[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COURSE_TONES.length];
