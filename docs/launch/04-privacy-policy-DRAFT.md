# SparkScribe Privacy Policy — DRAFT

> **Draft for review, not legal advice.** **[LEGAL REVIEW]** marks wording a lawyer should check (especially children's and
> teen privacy, US state privacy laws, EU/UK GDPR if offered there, and recording-consent laws). **[CONFIRM]** marks facts
> only the owner can supply. Everything else describes how SparkScribe works today (2026-10-15).

**Effective date:** [DATE] **[CONFIRM]**
**Who we are:** SparkScribe is a product operated by HRstudios LLC, [POSTAL ADDRESS] **[CONFIRM]** ("we", "us").
Contact: contact.hrstudios@gmail.com

## 1. The short version
- **Your audio is never uploaded.** Recordings are converted and transcribed inside your browser. If you allow it, the
  original audio is also kept in that browser so you can play it back later; it never leaves your device.
- If you **save** a transcript, its **text** is stored in your account.
- If you use **AI features** (summaries, notes, insights, Create tools, Ask, quiz grading), the relevant **transcript text**
  (never audio) is sent to our AI provider, Anthropic, to produce the result.
- Payments for Plus and Pro are handled by Stripe; we never see your full card number.
- We don't sell your data, show ads, or use analytics or advertising trackers.
- You can delete your account and everything in it yourself, at any time, in Settings.

## 2. What we collect
**Account information:** your email address and password (stored only as a secure hash by our authentication provider),
when you signed up and last signed in, and technical session details our authentication provider records (such as IP
address and browser type). Optionally, a display name. If you sign in with Google: your Google account's email, name and
profile picture.

**Content you save:** transcript titles and text, speaker names you assign, timestamps, recording length, language and
recording type, folders and favourites. If you use AI features: the summaries, notes, insights, study material, drafts,
quizzes (and your quiz progress), and questions and answers they produce.

**Subscription information (Plus and Pro):** your plan, its status and renewal date, and the identifiers Stripe gives us for
your customer record and subscription. Stripe collects your name, email, card details and billing address directly; we
receive only the card brand and last four digits when Stripe shows them to you in its billing portal, not the card number.

**Usage records:** how many seconds of recordings you've transcribed and saved in each billing period (to apply your
plan's allowance), and a record of each AI action (which feature, when, how many AI tokens it used and what it cost us).
We use these to run the plan allowances and fair-use limits and to understand costs.

**Technical data:** our hosting and database providers keep short-lived logs of requests (IP address, time, page or API
address, browser type). Our own log lines contain your account ID and a recording's ID, never its content.

**Stored on your device (in your browser):**
- the **original audio** of recordings you transcribed or attached, so a saved recording can play back with its
  transcript. It is never uploaded. It is kept only in that browser: it doesn't appear on your other devices, and clearing
  your browser's site data removes it. You can see how much is kept, stop keeping new recordings, and remove all of it in
  Settings → Privacy. Deleting a recording or your account removes it from the browser where you do so; signing out
  does not. On a shared computer, remove it before you leave.
- your preferences (theme, mascot, transcription settings), whether you've agreed to AI processing, small progress
  markers, and a transcript (with its audio) waiting for you to sign in, kept for at most one hour;
- the speech-recognition models (downloaded once; not personal).

We use your browser's local storage and IndexedDB for these and for keeping you signed in. We don't set advertising or
analytics cookies. **[LEGAL REVIEW: cookie/local-storage notice requirements]**

**What we don't collect:** your audio or video files (they stay on your device), your contacts, or your location.

## 3. How we use it
- To provide the service: transcribe on your device, save and show your library, and run the AI features you ask for.
- To provide subscriptions: apply your plan's allowance, show your usage, and keep your plan in sync with Stripe.
- To keep accounts secure: sign-in, password reset, email confirmation, fraud and abuse prevention, usage limits.
- To keep costs sustainable: fair-use limits on AI features per account and a service-wide daily cap.
- To support you when you contact us, and to fix problems.
- We don't use your transcripts to train AI models, and our AI provider doesn't either (see section 5).

**[LEGAL REVIEW]** Legal bases if GDPR applies: performance of a contract (providing the service), legitimate interests
(security, abuse prevention, cost limits), legal obligation (accounting and tax), consent (optional AI processing, where
required).

## 4. Who processes it for us (service providers)
| Provider | What for | Data | Location |
|---|---|---|---|
| Vercel **[CONFIRM: or the hosting provider chosen at launch]** | hosting the website and server functions | request data; the transcript text and questions passing through AI requests | United States |
| Supabase | accounts, authentication, database | account and saved content, usage and subscription records | United States (us-east-1) |
| Anthropic | AI features | transcript text and your question for each AI request | United States |
| Stripe | payments and subscriptions | name, email, card details (entered directly with Stripe), billing address | United States |
| [EMAIL PROVIDER] **[CONFIRM]** | sign-up confirmation and password-reset emails | email address, message content | United States |
| Hugging Face; jsDelivr | delivering the speech-recognition model and runtime files to your browser | your IP address (standard web request); no content | global CDNs |
| Google Fonts | delivering the website's fonts | your IP address (standard web request) | global |

We don't sell or share personal information for cross-context advertising. **[LEGAL REVIEW: US state privacy law wording]**
**International transfers:** **[LEGAL REVIEW: if offered to EU/UK users, describe the safeguards for transfers to the US.]**

## 5. AI processing
When you use an AI feature, we send the transcript text it needs (lines with speaker names and timestamps; for Ask, your
question and the most relevant lines) to Anthropic's API. We never send audio. Anthropic processes it under its
commercial terms, which don't allow training on API data and keep inputs and outputs only for a limited period (up to 30
days, longer only if flagged for a usage-policy review) **[CONFIRM against Anthropic's current commercial terms]**. AI
results are stored in your account until you delete them or your account. AI output can be wrong: check important details
against the transcript and the recording.

## 6. How long we keep it
- Saved transcripts and AI results: until you delete them or your account.
- Account: until you delete it.
- Usage and subscription records: with your account; billing records Stripe keeps are governed by Stripe's own policies.
- Payment and tax records: as long as accounting and tax rules require **[LEGAL REVIEW]**.
- Logs: they expire automatically at our providers within [PERIOD] **[CONFIRM by plan]**.
- Backups: [none / up to 7 days] **[CONFIRM: depends on the Supabase plan]**.
- Audio kept in your browser: until you remove it (Settings → Privacy), delete the recording or your account in that
  browser, or clear the browser's site data.

## 7. Your choices and rights
- **Delete:** Settings → Account → Delete account removes your account and everything in it immediately and permanently.
  If you have a Plus or Pro subscription, it is canceled at the same moment so you are never charged again. Single
  recordings can be deleted in My Library.
- **Access and export:** you can view everything in the app and export each transcript and AI result (TXT, Markdown,
  Word, PDF, subtitles). For a full copy of your account data, email contact.hrstudios@gmail.com; we reply within
  [30] days **[CONFIRM]**.
- **Correct:** edit speaker names and recording details in the app, or contact us.
- **AI features are optional:** transcription works without them.
- Depending on where you live, you may have more rights (access, portability, objection, restriction, complaint to a
  supervisory authority). **[LEGAL REVIEW]**

## 8. Recording other people
Recordings often contain other people's voices and personal information, such as teachers, classmates or colleagues.
You're responsible for having the right to record and transcribe them, including any consent your local law, your school
or your workplace requires. **[LEGAL REVIEW: one- vs all-party consent jurisdictions]**

## 9. Security
Your audio stays on your device. Data in transit is encrypted (HTTPS), and stored data is protected by per-account access
rules in our database: each account can only read its own records. No system is perfectly secure; if a breach affects
you, we'll notify you as the law requires.

## 10. Children and teens
SparkScribe is for people aged **13 and older**. We don't knowingly allow accounts for, or collect personal information
from, children under 13. If you believe a child under 13 has created an account, contact us and we'll delete it.
If you are 13 to 17, use SparkScribe with your parent's or guardian's permission; a Plus or Pro subscription must be
purchased by a parent, guardian or another adult. We don't share a teen's transcripts with anyone, including whoever pays
for the subscription. **[LEGAL REVIEW: COPPA, state teen-privacy laws, and parent/guardian purchasing]**

## 11. Changes
If we make material changes, we'll update the date above and tell signed-in users in the app or by email before they
take effect.

## 12. Contact
HRstudios LLC (operator of SparkScribe), [POSTAL ADDRESS] **[CONFIRM]** · contact.hrstudios@gmail.com
