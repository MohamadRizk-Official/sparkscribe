# SparkScribe Privacy Policy — DRAFT

> **Draft for review, not legal advice.** **[LEGAL REVIEW]** marks wording a lawyer should check for your jurisdiction and
> users (especially EU/UK GDPR, California CCPA/CPRA, and recording-consent laws). **[CONFIRM]** marks product or business
> facts only you can confirm. Everything else describes how SparkScribe works today (release candidate, 2026-10-12).

**Effective date:** [DATE] **[CONFIRM]**
**Who we are:** SparkScribe is operated by [LLC NAME — registration pending], [POSTAL ADDRESS], [COUNTRY/STATE]
("we", "us"). Contact: privacy@sparkscribe.ai **[CONFIRM: entity, address, contact address]**

## 1. The short version
- **Your audio never leaves your device.** Recordings are converted and transcribed inside your browser.
- If you **save** a transcript, its **text** is stored in your account.
- If you use **AI features** (summaries, notes, insights, Create tools, Ask, quiz grading), the relevant **transcript text**
  (never audio) is sent to our AI provider, Anthropic, to produce the result.
- We don't sell your data, show ads, or use analytics or advertising trackers.
- You can delete your account and everything in it yourself, at any time, in Settings.

## 2. What we collect
**Account information:** your email address and password (stored only as a secure hash by our authentication provider),
when you signed up and last signed in, and technical session details our authentication provider records (such as IP
address and browser type). Optionally, a display name.

**Content you save:** transcript titles and text, speaker names you assign, timestamps, recording length, language and
recording type, folders and favourites. If you use AI features: the summaries, notes, insights, study material, drafts,
quizzes (and your quiz progress), and questions and answers they produce.

**Usage records:** how many seconds you've transcribed per saved recording, and a record of each AI action (which feature,
when, how many AI tokens it used and what it cost us). We use these to run fair-use limits and to understand costs.

**Technical data:** our hosting and database providers keep short-lived logs of requests (IP address, time, page or API
address, browser type). Our own AI usage log lines contain your account ID and the recording's ID, never its content.

**Stored on your device:** your preferences (theme, mascot, transcription settings, custom vocabulary), whether you've
agreed to AI processing, small progress markers, a transcript waiting for you to sign in (kept for at most one hour), and
the speech-recognition models (downloaded once; not personal). We use your browser's local storage for these and for
keeping you signed in. We don't set advertising or analytics cookies. **[LEGAL REVIEW: cookie/local-storage notice
requirements, e.g. ePrivacy]**

**What we don't collect:** your audio or video files, your contacts, location, or payment card details (when paid plans
launch, payments will be handled by Stripe and we'll update this policy).

## 3. How we use it
- To provide the service: transcribe on your device, save and show your library, and run the AI features you ask for.
- To keep accounts secure: sign-in, password reset, email confirmation, fraud and abuse prevention, usage limits.
- To keep costs sustainable: hourly and monthly AI limits per account and a service-wide daily cap.
- To support you when you contact us, and to fix problems.
- We don't use your transcripts to train AI models, and our AI provider doesn't either (see section 5).

**[LEGAL REVIEW]** Legal bases if GDPR applies: performance of a contract (providing the service), legitimate interests
(security, abuse prevention, cost limits), legal obligation (accounting), consent (optional AI processing, where
required).

## 4. Who processes it for us (service providers)
| Provider | What for | Data | Location **[CONFIRM regions]** |
|---|---|---|---|
| Vercel | hosting the website and server functions | request data; the transcript text and questions passing through AI requests | United States |
| Supabase | accounts, authentication, database | account and saved content, usage records | United States (us-east-1) |
| Anthropic | AI features | transcript text and your question for each AI request | United States |
| Resend **[CONFIRM provider]** | sign-up confirmation and password-reset emails (sent from auth.sparkscribe.ai) | email address, message content | United States |
| Stripe (when paid plans launch) | payments and subscriptions | name, email, card details (entered directly with Stripe), billing address | United States |
| Hugging Face; jsDelivr | delivering the speech-recognition model and runtime files to your browser | your IP address (standard web request); no content | global CDNs |
| Google Fonts | delivering the website's fonts | your IP address (standard web request) | global **[CONFIRM: self-host fonts instead to avoid this transfer]** |

We don't sell or share personal information for cross-context advertising. **[LEGAL REVIEW: CCPA/CPRA wording]**
**International transfers:** [LEGAL REVIEW: if you serve EU/UK users, describe safeguards (e.g. Standard Contractual
Clauses / Data Privacy Framework) for transfers to the US.]

## 5. AI processing
When you use an AI feature, we send the transcript text it needs (lines with speaker names and timestamps; for Ask, your
question and the most relevant lines) to Anthropic's API. We never send audio. Anthropic processes it under its
commercial terms, which **[CONFIRM current Anthropic terms]** don't allow training on API data and keep inputs and outputs
only for a limited period (for example up to 30 days, longer only if flagged for a usage-policy review). AI results are
stored in your account until you delete them or your account. AI output can be wrong: check important details against
the transcript.

## 6. How long we keep it
- Saved transcripts and AI results: until you delete them or your account.
- Account: until you delete it. **[CONFIRM: will inactive accounts ever be deleted? If so, state the period.]**
- Usage records: with your account.
- Logs: they expire automatically within [1–7 days] at our providers **[CONFIRM by plan]**.
- Payment records (once paid plans exist): as long as tax and accounting rules require **[LEGAL REVIEW]**.
- Backups: [none / up to 7 days] **[CONFIRM: depends on your Supabase plan]**.

## 7. Your choices and rights
- **Delete:** Settings → Account → Delete account removes your account and everything in it immediately and permanently.
  Single recordings can be deleted in My Library.
- **Access and export:** you can view everything in the app and export each transcript and AI result (TXT, Markdown,
  Word, PDF, subtitles). For a full copy of your account data, contact us. **[CONFIRM: response time, e.g. 30 days]**
- **Correct:** edit speaker names and recording details in the app, or contact us.
- **AI features are optional:** transcription works without them.
- Depending on where you live, you may have more rights (access, portability, objection, restriction, complaint to a
  supervisory authority). **[LEGAL REVIEW]**

## 8. Recording other people
Recordings often contain other people's voices and personal information. You're responsible for having the right to
record and transcribe them, including any consent your local law requires. **[LEGAL REVIEW: one- vs two-party consent
jurisdictions]**

## 9. Security
Your audio stays on your device. Data in transit is encrypted (HTTPS), and stored data is protected by per-account access
rules in our database: each account can only read its own records. No system is perfectly secure; if a breach affects
you, we'll notify you as the law requires.

## 10. Children
SparkScribe isn't directed at children under [13/16] and they shouldn't create accounts. **[CONFIRM minimum age;
LEGAL REVIEW: COPPA/GDPR-K]**

## 11. Changes
If we make material changes, we'll update the date above and tell signed-in users in the app or by email before they
take effect.

## 12. Contact
privacy@sparkscribe.ai · [LLC NAME — registration pending], [POSTAL ADDRESS] **[CONFIRM]**
