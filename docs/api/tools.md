# `POST /api/tools`

Source: `api/tools.js`. The Create tab's endpoint: study guides, flashcards, quizzes, recaps, drafts. Saved outputs are read back with `GET /api/insights` (see [insights.md](insights.md)).

Only `POST` is accepted (`405` with `Allow: POST` otherwise). Every request needs a valid `transcriptionId` UUID, checked before anything else is done.

## Actions
The body's `action` field picks the operation. With no `action`, the request is a normal generation.

| `action` | body fields | does |
|---|---|---|
| *(none)* | `kind`, `settings?`, `force?` | `generateArtifact`: makes the output, or returns the stored one if it is still current for these settings |
| `grade` | `artifactId`, `index`, `answer` | `gradeShortAnswer`: checks one Practice Quiz short answer by meaning. `artifactId` must be a UUID ("Invalid quiz.") |
| `followups` | `artifactId`, `concepts` | `generateFollowups`: Focused Review practice questions for a quiz. `artifactId` must be a UUID |
| `prepare` | none | `prepareStudyMap`: builds the recording's study map ahead of time; the page sends it when the Create tab opens |

## Normalisation of a normal generation
- `kind` is coerced to a string.
- `settings` is used only when it is a plain object (not an array, not `null`); otherwise `{}`.
- `force` only counts when exactly `true`.
- `index` for `grade` goes through `Number(...)`.

Everything runs as the signed-in user, so Row Level Security decides which recordings and outputs exist for them. Errors use `sendError`.
