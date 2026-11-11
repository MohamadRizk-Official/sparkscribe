# Create-tab tool settings and cache keys (`src/lib/tool-settings.js`)

Shared by the browser and the server so both compute the same cache key. A key names one stored result: the same
recording + tool + key is generated once and then reused. Covered by `tests/tool-settings-test.mjs`.

## Tools and choices (`TOOL_SETTINGS`)
| tool | settings (default first) |
|---|---|
| `flashcards` | size: standard, fewer, more; focus: balanced, essentials, deep; explain: helpful, every, brief |
| `quiz` | size: standard, fewer, more; difficulty: standard, harder; types: mixed, multiple_choice, true_false |
| `study_guide` | focus: balanced, exam, concepts, detailed |

`normalizeToolSettings(kind, raw)` returns `{ settings, key }`. Unknown values (including inherited property names)
fall back to the default. Only non-default choices appear in the key, as `name=value` joined with `;`, using the
short names size, diff, types, focus, expl. Default settings give the empty key, so results saved before settings existed keep matching.

## Engine key
`flashcards`, `quiz` and `study_guide` keys start with `g2` (the improved study engines), so making an improved
version never overwrites an earlier one or the quiz scores stored with it. `isEngine2Key(key)` checks the first part;
`legacyKeyOf('g2;size=more')` is `size=more`, the key an earlier result with the same choices used.

## Drafts
`reply_draft` and `followup_email` take free-text instructions (required, at most `MAX_INSTRUCTIONS` = 500 characters,
whitespace collapsed). The key gets `i=<fingerprint>`, a 32-bit FNV-1a hash in 8 hex digits. Changing the hash would
orphan stored drafts, so a test pins it.

## Quiz length (`quizQuestionCount(minutes, size)`)
| recording | fewer | standard | more |
|---|---|---|---|
| under 5 minutes | 3 | 5 | 8 |
| 5 minutes or more | 5 | 10 | 15 |

The model may return fewer when the recording is thin.

## Labels
`describeSettings(kind, settings)` returns the labels of non-default choices joined by ` · `, plus `with your instructions`.
