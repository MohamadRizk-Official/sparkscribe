# SparkScribe Privacy Policy

> **Draft for review, not legal advice.** **[CONFIRM]** marks the last details for the owner to confirm before
> publication. Everything else describes how SparkScribe works today (2026-10-17). It has not been reviewed by a lawyer.

**Effective date:** the date of publication **[CONFIRM: filled in when published]**
**Who we are:** SparkScribe is a product operated by HRstudios LLC, a Michigan limited liability company **[CONFIRM: postal address, optional]** ("we", "us").
Contact: contact.hrstudios@gmail.com

## 1. The short version
- **Your audio is never uploaded.** Recordings are converted and transcribed inside your browser. If you allow it, the
  original audio is also kept in that browser so you can play it back later; it never leaves your device.
- If you **save** a transcript, its **text** is stored in your account.
- If you use **AI features** (summaries, notes, insights, Create tools, Ask, quiz grading, Focused Review practice, asking
  across recordings, combined study guides), the relevant **transcript text** (never audio) is sent to our AI provider,
  Anthropic, to produce the result.
- Payments for paid plans (Flash, Bolt, Thunder) are handled by Stripe; we never see your full card number.
- We don't sell your data, show ads, or use analytics or advertising trackers.
- You can delete your account and everything in it yourself, at any time, in Settings.

## 2. What we collect
**Account information:** your email address and password (stored only as a secure hash by our authentication provider),
when you signed up and last signed in, and technical session details our authentication provider records (such as IP
address and browser type). Optionally, a display name. If you sign in with Google: your Google account's email, name and
profile picture.

**Content you save:** transcript titles and text, speaker names you assign, timestamps, recording length, language and
recording type, when you last opened each recording, courses (their names and, if you add them, an exam date and the
topics you expect) and favourites. Flashcard review: when you rate a flashcard ("didn't know", "knew it", "easy"), we save
when that card is next due, so the app can bring it back at the right time. If you use AI features: the summaries, notes, insights, study material, drafts,
quizzes (and your quiz progress, including which concepts you're reviewing), and questions and answers they produce. If
you ask across several recordings or make a combined study guide (Thunder), the question, the answer or guide, which
recordings it used, and links to the passages it cites are saved to your account so you can reopen them on any device;
the recordings' audio and full transcripts are not copied into them.

**Your confirmation:** when you create an account (by email, or the first time you sign in with Google) we record that
you confirmed you're 13 or older and agreed to the Terms, with the time.

**Subscription information (paid plans):** your plan, whether it's billed monthly or yearly, its status and renewal date, whether you've had a paid plan before
and whether you've used the Flash first-month offer (so it's used once), and the identifiers Stripe gives us for
your customer record and subscription. Stripe collects your name, email, card details and billing address directly; we
receive only the card brand and last four digits when Stripe shows them to you in its billing portal, not the card number.

**Usage records:** how many seconds of recordings you've transcribed and saved in each allowance period (a calendar
month on Free, each billing month on paid plans, including on yearly billing; to apply your plan's allowance), and a record of each AI action (which feature, when, how many AI tokens it used and what it cost us).
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
  markers, the Pricing page's monthly or yearly choice, and a transcript (with its audio) waiting for you to sign in, kept for at most one hour;
- the speech-recognition models (downloaded once; not personal).

We use your browser's local storage and IndexedDB for these and for keeping you signed in. We don't set advertising or
analytics cookies.

**What we don't collect:** your audio or video files (they stay on your device), your contacts, or your location.

## 3. How we use it
- To provide the service: transcribe on your device, save and show your library, and run the AI features you ask for.
- To provide subscriptions: apply your plan's allowance, show your usage, and keep your plan in sync with Stripe.
- To keep accounts secure: sign-in, password reset, email confirmation, a security check against automated sign-ups
  and sign-ins (Cloudflare Turnstile), fraud and abuse prevention, usage limits.
- To charge for subscriptions and meet tax and accounting obligations (Stripe uses your billing address to calculate any
  sales tax).
- To keep costs sustainable: fair-use limits on AI features per account and a service-wide daily cap.
- To support you when you contact us, and to fix problems.
- We don't use your transcripts to train AI models, and our AI provider doesn't either (see section 5).

**If the EU or UK GDPR applies to you,** our legal bases are: performance of a contract (providing the service), legitimate interests
(security, abuse prevention, cost limits), legal obligation (accounting and tax), consent (optional AI processing, where
required).

## 4. Who processes it for us (service providers)
| Provider | What for | Data | Location |
|---|---|---|---|
| Vercel | hosting the website and server functions | request data; the transcript text and questions passing through AI requests | United States |
| Supabase | accounts, authentication, database | account and saved content, usage and subscription records | United States (us-east-1) |
| Anthropic | AI features | transcript text and your question for each AI request | United States |
| Stripe | payments and subscriptions | name, email, card details (entered directly with Stripe), billing address | United States |
| Resend | sign-up confirmation and password-reset emails | email address, message content | United States |
| Cloudflare (Turnstile) | the security check on sign-up, sign-in, password reset and account deletion | your IP address and browser and device signals the check needs; no content | global |
| Hugging Face; jsDelivr | delivering the speech-recognition model and runtime files to your browser | your IP address (standard web request); no content | global CDNs |
| Google Fonts | delivering the website's fonts | your IP address (standard web request) | global |

We don't sell personal information, and we don't share it for cross-context behavioral advertising.
**International transfers:** we and our providers are based in the United States, and your information is stored and
processed there. If you use SparkScribe from outside the US, your information is transferred to the US, where data
protection laws may differ from those where you live.

## 5. AI processing
When you use an AI feature, we send the transcript text it needs (lines with speaker names and timestamps; for Ask, your
question and the most relevant lines) to Anthropic's API. We never send audio. Anthropic processes it under its
commercial terms, which don't allow training on API data and keep inputs and outputs only for a limited period, longer
only where needed to enforce its usage policy or required by law. AI
results are stored in your account until you delete them or your account. AI output can be wrong: check important details
against the transcript and the recording.

## 6. How long we keep it
- Saved transcripts and AI results (including answers and guides across recordings), courses, exam dates and topics,
  and flashcard review schedules: until you delete them or your account.
- Account: until you delete it.
- Usage and subscription records: with your account; billing records Stripe keeps are governed by Stripe's own policies.
- Payment and tax records: Stripe keeps them, and we keep invoices and payment records, as long as accounting and tax
  rules require.
- Logs: they expire automatically at our providers, generally within a few days.
- Backups: our database provider may keep backups for up to 7 days; deleted data disappears from them when they expire.
- Audio kept in your browser: until you remove it (Settings → Privacy), delete the recording or your account in that
  browser, or clear the browser's site data.

## 7. Your choices and rights
- **Delete:** Settings → Account → Delete account removes your account and everything in it immediately and permanently.
  If you have a paid subscription, it is canceled at the same moment so you are never charged again. Single
  recordings can be deleted in My Library.
- **Access and export:** you can view everything in the app and export each transcript and AI result (TXT, Markdown,
  Word, PDF, subtitles). For a full copy of your account data, email contact.hrstudios@gmail.com; we reply within
  30 days.
- **Correct:** edit speaker names and recording details in the app, or contact us.
- **AI features are optional:** transcription works without them.
- Depending on where you live, you may have more rights (access, portability, objection, restriction, complaint to a
  supervisory authority). Email us to use them; we may need to verify that the request comes from you.

## 8. Recording other people
Recordings often contain other people's voices and personal information, such as teachers, classmates or colleagues.
You're responsible for having the right to record and transcribe them, including any consent your local law, your school
or your workplace requires. Some places require everyone in a conversation to agree before it is recorded.

## 9. Security
Your audio stays on your device. Data in transit is encrypted (HTTPS), and stored data is protected by per-account access
rules in our database: each account can only read its own records. No system is perfectly secure; if a breach affects
you, we'll notify you as the law requires.

## 10. Children and teens
SparkScribe is for people aged **13 and older**. We don't knowingly allow accounts for, or collect personal information
from, children under 13. If you believe a child under 13 has created an account, contact us and we'll delete it.
If you are 13 to 17, use SparkScribe with your parent's or guardian's permission; a paid plan must be purchased by a
parent, guardian or another adult. We don't share a teen's transcripts with anyone, including whoever pays
for the subscription.

## 11. Changes
If we make material changes, we'll update the date above and tell signed-in users in the app or by email before they
take effect.

## 12. Contact
HRstudios LLC (operator of SparkScribe) · contact.hrstudios@gmail.com
