# AI processing disclosure

What the app already says (in code today):
- Next to every AI result: "Created from this transcript's text by our AI provider (Anthropic). Your audio is never sent."
- On the home page: "AI features send transcript text, never audio, to our AI provider, Anthropic. Only record or upload
  what you have permission to use."
- The first use of an AI feature records the user's agreement in the browser (`sparkscribe.aiConsent`).

## Accurate facts for any disclosure

| Feature | What is sent to Anthropic | Stored afterwards (in the user's account) |
|---|---|---|
| Summary (overview, detailed), Notes, Insights | the transcript's lines (speaker names, timestamps, text); long transcripts are sent in parts | the result |
| Create tools (study guide, flashcards, quiz, recap, action plan, drafts…) | the transcript's lines plus the tool's settings (and, for drafts, the user's instructions) | the result |
| Ask | the question plus the most relevant transcript lines | question, answer and cited lines |
| Quiz short-answer grading | the question, expected answer, a short excerpt and the user's answer (bounded) | the grade, in quiz progress |
| Transcription itself | **nothing**: it runs in the browser | the transcript, only if the user saves it |

- Model: Anthropic Claude Haiku 5.5, through Anthropic's commercial API. Requests go from our server (Vercel) to
  Anthropic; browsers never talk to Anthropic directly, and the API key never reaches the browser.
- Training: we don't train models on user content. **[CONFIRM: Anthropic's current commercial terms say API inputs and
  outputs aren't used for training.]**
- Retention at Anthropic: **[CONFIRM current API retention, e.g. deleted within 30 days unless flagged for policy
  review.]**
- Limits: per-account hourly and monthly limits plus a service-wide daily cap (see `02-ai-cost-controls.md`).
- Accuracy: AI output can be wrong; the app links each point to the transcript lines it's based on, so users can check.

## Suggested short in-app text (Settings → Privacy, and the first AI use)

> **AI features are optional.** When you use one, SparkScribe sends the text of this transcript (never the audio) to
> Anthropic, our AI provider, to create the result. Anthropic doesn't use it to train its models. Results are saved in
> your account until you delete them. [Learn more →Privacy Policy, section 5]

**[LEGAL REVIEW]** Whether, for EU users, AI processing of third parties' speech needs any additional disclosure or
consent step.
