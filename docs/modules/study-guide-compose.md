# Study guide composition (`server/ai/studyrun.js`: `studyGuide`)

How a study guide is put together once its study map exists. Test: `tests/studyguide-compose-test.mjs`. The map itself
is described in [studymap-pipeline.md](studymap-pipeline.md).

## One AI call, then plain code
`studyGuide` first gets the map (a stored one is reused, otherwise it is built; see the pipeline guide). It then makes a
single `study_guide:compose` call whose body is empty: the model sees only the map, never the transcript. It is asked for
three things: an `overview`, a `summary` per topic, and `self_check` questions. Everything else in the guide is copied from
the map by code, so the model cannot add facts to it.

## Which ideas are kept
An idea (a map concept) is kept when it is `clarity: 'clear'` and:

| `focus` setting | importance kept |
|---|---|
| `balanced` (default), `exam` | `core`, `supporting` |
| `concepts` | `core` only |
| `detailed` | `core`, `supporting` and `minor` |

`exam` also changes the compose instructions to favour what a student is most likely to be tested on (and tells the model
never to claim something will be on an exam). Unclear ideas are never kept.

## How the sections are filled
- **concepts**: kept ideas that are not definitions; the explanation is the summary plus ` Reason given: …` when the speaker gave a reason.
- **definitions**: kept ideas whose `kind` is `definition`, with their evidence quote.
- **relationships**: kept ideas of kind `distinction` or `cause_effect`.
- **topics**: only topics that still have a kept idea, with the model's summary (empty text when it wrote none).
- **self_check**: only questions with a question, an answer and a concept id that exists in the map; they carry that concept's lines.
- **exam_info**: only ideas that have `exam_words` which really appear in the cited lines *and* pass the exam check (`examBacked`). The model cannot invent an exam note.
- **examples, processes, emphasis, review** are always empty in engine 3.

## Attribution
An idea whose stance is `attributed`, `criticized` or `quotation` and that has a `held_by` is prefixed so a reader knows
whose view it is: `View of …`, `Criticized view of …` or `Saying of …`, unless the text already says so.

## What is reported
`content.coverage` counts major topics (and how many appear) and clear core ideas (and how many were kept).
`content.quality` records the number of sections, whether the stored map was reused (`map_reused: 1`) and the number of
kept ideas. An empty model reply is not an error: it gives an empty overview and no self-check questions.
