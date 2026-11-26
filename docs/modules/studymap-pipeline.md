# Study map pipeline (`server/ai/studymap.js`, `server/ai/studyrun.js`)

Study engine 3 builds one **map** of a recording (topics, and the concepts inside them) once, and flashcards, quizzes and
guides are all written from that map. This page lists the steps and what each prompt builder asks for. Tests:
`tests/studymap-test.mjs` (sectioning, map building, checks), `tests/studymap-helpers-test.mjs` and
`tests/studymap-prompts-test.mjs` (prompts, stored map lookup).

## Steps
1. **`sectionize(segments, tokensOf, budget = 6000)`** cuts the transcript into sections of about `SECTION_TOKENS` tokens, preferring a pause of 6 s or more once a section is 75% full. A short last section (under 25% of the budget) is merged into the one before. Each section carries a few lines of context before and after.
2. **`sectionInstructions({ index, total, from, to })`**: the model maps one section: `topics` (with `educational: false` for logistics and small talk) and `concepts` with name, kind, importance (`core`, `supporting`, `minor`), stance (own, attributed, criticized…), `held_by`, summary, reasoning, clarity, evidence and refs. Names are copied as the transcript spells them. A section with nothing to learn returns empty lists.
3. **`consolidateInstructions(entries)`**: the model sees one line per concept (`key | topic | importance | kind | stance (held_by) | name: summary`) and returns the topics (each key in exactly one) and the groups of entries that are the same idea. Two schools' positions on one question stay separate.
4. **`buildMap(sections, consolidation)`** assembles the final map from the grounded sections and that grouping: names, importance and lines come from the sections.
5. **`selectConcepts(map, count, { focus })`** and **`excerptIds`** pick the concepts to write about and the transcript lines that explain them.
6. **`writeInstructions(kind, { concepts, topics, settings, dominant, tfLimit })`** writes exactly one question (`quiz`) or card (anything else) per concept. For quizzes, `tfLimit` limits true/false questions (0 means none in this set), and `settings.difficulty === 'harder'` switches to the challenge level; for cards `settings.focus` and `settings.explain` apply with the same fallbacks as [study-validation.md](study-validation.md).
7. **`verifyInstructions` / `applyChecks`**: a second pass checks the written items against the lines; `applyChecks` applies the verdicts. `unseenNames` and `cautionFor` flag names that the transcript never contains.
8. **`composeInstructions(map, focus)`** (in `studyrun.js`): the study guide from the map only: overview, a summary per topic, and one or two self-check questions per major topic. Minor concepts are left out of the prompt.

## Reusing a stored map
`storedMap(artifacts, basis)` returns the most recently updated artifact that is `ready`, from engine 3 or later, has map concepts, and has the same transcript basis (so a rename of speakers still counts as current). Otherwise `null` and the map is built; `studyMap` waits up to `MAP_WAIT_MS` (90 s) for a map another request is already building.

### What counts as "the same map" (pinned by `tests/studyrun-map-reuse-test.mjs`)
A stored result is reused only when **all** of these hold; if any fails, a new map is built and paid for:
- `status` is `ready` (a map still `generating`, or `failed`, is skipped; a fresh `generating` one is waited for instead).
- `content.engine` is 3 or higher (results from the older engine have a different shape).
- `content.map.concepts` exists (a result without a map, or with an empty `map: {}`, does not count).
- `content.basis` equals the transcript's basis on all three of `n`, `text` and `parts`: the number of lines, the words, and the speaker layout. Changing the words or reassigning speakers makes the old map stale; a plain rename of a speaker does not, because the basis does not include display names. With no basis at all, nothing matches.

The artifact's `kind` does not matter: a flashcard or quiz result that carries the map is as good as a dedicated `study_map` one. When several qualify, the newest `updated_at` wins. A reused map reports `reused: true` and its section count from `content.quality.sections` (or `null` when it was saved without quality notes); no AI call is made at all.

While a map is being prepared, `studyMap` re-reads the artifacts every 1.5 seconds until it is ready or `MAP_WAIT_MS` has passed, then reuses it, so opening the Create tab and asking for a quiz straight away does not build the map twice.
