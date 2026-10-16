// Builds the SparkScribe auth email templates for Supabase (Authentication -> Emails) from one layout.
//   node scripts/build-email-templates.mjs
// Writes docs/auth/email-templates/<name>.html (paste into Supabase), subjects.json, and preview.html (every email with
// sample values, for a look in the browser). How to install them: docs/auth/EMAIL-SETUP.md
//
// Rules the layout follows:
//   * email-client HTML: tables, inline styles, no SVG, no web fonts required, no scripts; a hosted PNG logo
//     (public/email/sparkscribe-mark.png, served by the app) with a text wordmark next to it
//   * links go to our own page, with the token in the URL fragment: APP/auth/callback#token_hash=…&type=…
//     (callback.js waits for a button press, so mail scanners can't use a link up; the fragment never reaches a server)
//   * only Supabase's documented variables; Go templates escape them
//   * no invented expiry times (the period is set in Supabase, not here)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/auth/email-templates');
// The live site. Links and the logo use it directly (not {{ .SiteURL }}), so they don't depend on how the Site URL is
// written in Supabase (a trailing slash would give "//auth/callback").
const APP = 'https://www.spark-scribe.com';
const LOGO = `${APP}/email/sparkscribe-mark.png`;
const link = (type) => `${APP}/auth/callback#token_hash={{ .TokenHash }}&amp;type=${type}`;

const C = {
  page: '#f2f3f8', card: '#ffffff', border: '#e4e6f0', text: '#111427', body: '#3b4060', muted: '#6b7190',
  spark: '#0891b2', scribe: '#9333ea', link: '#0e7490', btnText: '#0b1020', btnSolid: '#93c5fd',
  dPage: '#05060f', dCard: '#0e1124', dBorder: '#232845', dText: '#eef1ff', dBody: '#c3c8e6', dMuted: '#8d93b8', dSpark: '#22d3ee', dScribe: '#c4a5fd',
};
const FONT = "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function layout({ preheader, heading, paragraphs, button, fallback = true, code, footer }) {
  const p = (t) => `<p class="ss-body" style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${C.body};">${t}</p>`;
  const btn = button ? `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr><td align="center" bgcolor="${C.btnSolid}" style="border-radius:12px;background-color:${C.btnSolid};background-image:linear-gradient(90deg,#22d3ee 0%,#60a5fa 50%,#c084fc 100%);">
    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${button.href}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="25%" stroke="f" fillcolor="${C.btnSolid}"><center style="color:${C.btnText};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${button.label}</center></v:roundrect><![endif]-->
    <!--[if !mso]><!--><a href="${button.href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:${C.btnText};text-decoration:none;border-radius:12px;">${button.label}</a><!--<![endif]-->
  </td></tr>
</table>` : '';
  const codeBox = code ? `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">
  <tr><td class="ss-code" style="padding:14px 22px;border:1px solid ${C.border};border-radius:12px;background:#f6f7fb;font-family:'JetBrains Mono',Consolas,'Courier New',monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:${C.text};">${code}</td></tr>
</table>` : '';
  const fb = button && fallback ? `
<p class="ss-muted" style="margin:0 0 6px;font-size:13px;line-height:1.5;color:${C.muted};">Button not working? Copy this link into your browser:</p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${button.href}" target="_blank" class="ss-link" style="color:${C.link};text-decoration:underline;">${button.href}</a></p>` : '';
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${heading}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  a { color:${C.link}; }
  @media (max-width:520px) { .ss-card { padding:28px 22px !important; } .ss-h1 { font-size:24px !important; } }
  @media (prefers-color-scheme: dark) {
    body, .ss-page { background:${C.dPage} !important; }
    .ss-card { background:${C.dCard} !important; border-color:${C.dBorder} !important; }
    .ss-h1 { color:${C.dText} !important; }
    .ss-body { color:${C.dBody} !important; }
    .ss-muted, .ss-foot { color:${C.dMuted} !important; }
    .ss-rule { border-color:${C.dBorder} !important; }
    .ss-spark { color:${C.dSpark} !important; } .ss-scribe { color:${C.dScribe} !important; }
    .ss-link { color:${C.dSpark} !important; }
    .ss-code { background:#151935 !important; border-color:${C.dBorder} !important; color:${C.dText} !important; }
  }
  [data-ogsc] .ss-card { background:${C.dCard} !important; }
</style>
</head>
<body class="ss-page" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ss-page" style="background:${C.page};">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;"><img src="${LOGO}" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px;"></td>
          <td style="vertical-align:middle;padding-left:10px;font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:-.01em;"><span class="ss-spark" style="color:${C.spark};">Spark</span><span class="ss-scribe" style="color:${C.scribe};">Scribe</span></td>
        </tr></table>
      </td></tr>
      <tr><td class="ss-card" style="background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:36px 36px 28px;font-family:${FONT};">
        <h1 class="ss-h1" style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:700;color:${C.text};">${heading}</h1>
        ${paragraphs.map(p).join('\n        ')}
        ${btn}${codeBox}${fb}
        <hr class="ss-rule" style="border:0;border-top:1px solid ${C.border};margin:4px 0 18px;">
        <p class="ss-foot" style="margin:0;font-size:13px;line-height:1.55;color:${C.muted};">${footer}</p>
      </td></tr>
      <tr><td style="padding:18px 4px 0;font-family:${FONT};">
        <p class="ss-foot" style="margin:0;font-size:12px;line-height:1.55;color:${C.muted};">SparkScribe · private transcription · <a href="${APP}" target="_blank" class="ss-link" style="color:${C.muted};text-decoration:underline;">spark-scribe.com</a><br>This is an automated message about your account; replies aren’t monitored.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`;
}

const ONCE = 'For your security, this link works once and expires after a short time.';
// name -> Supabase template, subject, content
export const TEMPLATES = {
  'confirm-signup': {
    supabase: 'Confirm sign up (mailer_templates_confirmation_content)',
    subject: 'Verify your email address — SparkScribe',
    html: layout({
      preheader: 'One step left: verify your email address to activate your SparkScribe account.',
      heading: 'Welcome to SparkScribe!',
      paragraphs: ['Thanks for signing up! You’re one step away from getting started. Please verify your email address to activate your account.'],
      button: { label: 'Verify Email Address', href: link('email') },
      footer: `If you didn’t create a SparkScribe account, you can safely ignore this email. ${ONCE}`,
    }),
  },
  'reset-password': {
    supabase: 'Reset password (mailer_templates_recovery_content)',
    subject: 'Reset your SparkScribe password',
    html: layout({
      preheader: 'Use this link to choose a new password for your SparkScribe account.',
      heading: 'Reset your password',
      paragraphs: ['We received a request to reset your SparkScribe password. Click the button below to create a new one.'],
      button: { label: 'Reset Password', href: link('recovery') },
      footer: `If you didn’t request this, you can safely ignore this email. Your password stays the same. ${ONCE}`,
    }),
  },
  'magic-link': {
    supabase: 'Magic link (mailer_templates_magic_link_content)',
    subject: 'Your SparkScribe sign-in link',
    html: layout({
      preheader: 'Use this link to sign in to SparkScribe.',
      heading: 'Sign in to SparkScribe',
      paragraphs: ['Click the button below to sign in to your account.'],
      button: { label: 'Sign In', href: link('magiclink') },
      footer: `If you didn’t ask to sign in, you can safely ignore this email. ${ONCE}`,
    }),
  },
  'change-email': {
    supabase: 'Change email address (mailer_templates_email_change_content)',
    subject: 'Confirm your new email address — SparkScribe',
    html: layout({
      preheader: 'Confirm the change of the email address on your SparkScribe account.',
      heading: 'Confirm your new email address',
      paragraphs: ['We received a request to change the email address on your SparkScribe account from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>. Click the button below to confirm.'],
      button: { label: 'Confirm Email Change', href: link('email_change') },
      footer: `If you didn’t request this change, don’t click the button, and consider resetting your password. ${ONCE}`,
    }),
  },
  invite: {
    supabase: 'Invite user (mailer_templates_invite_content)',
    subject: 'You’re invited to SparkScribe',
    html: layout({
      preheader: 'You’ve been invited to create a SparkScribe account.',
      heading: 'You’re invited to SparkScribe',
      paragraphs: ['You’ve been invited to create a SparkScribe account with this email address. Click the button below to accept, then choose your password.'],
      button: { label: 'Accept Invitation', href: link('invite') },
      footer: `If you weren’t expecting this invitation, you can safely ignore this email. ${ONCE}`,
    }),
  },
  reauthentication: {
    supabase: 'Reauthentication (mailer_templates_reauthentication_content)',
    subject: 'Your SparkScribe verification code',
    html: layout({
      preheader: 'Your SparkScribe verification code.',
      heading: 'Confirm it’s you',
      paragraphs: ['Enter this code in SparkScribe to confirm it’s you before a sensitive change to your account:'],
      code: '{{ .Token }}',
      footer: 'If you didn’t ask for a code, someone may know your password: reset it from the sign-in page. Never share this code with anyone.',
    }),
  },
  'password-changed': {
    supabase: 'Security notification: Password changed (mailer_templates_password_changed_notification_content)',
    subject: 'Your SparkScribe password was changed',
    html: layout({
      preheader: 'The password for your SparkScribe account was just changed.',
      heading: 'Your password was changed',
      paragraphs: ['The password for your SparkScribe account <strong>{{ .Email }}</strong> was just changed. If you made this change, there’s nothing else to do.'],
      button: { label: 'Reset My Password', href: `${APP}/auth?mode=forgot` },
      fallback: false,
      footer: 'If you didn’t change your password, reset it now with the button above to secure your account.',
    }),
  },
  'email-changed': {
    supabase: 'Security notification: Email address changed (mailer_templates_email_changed_notification_content)',
    subject: 'Your SparkScribe email address was changed',
    html: layout({
      preheader: 'The email address on your SparkScribe account was changed.',
      heading: 'Your email address was changed',
      paragraphs: ['The email address on your SparkScribe account was changed from <strong>{{ .OldEmail }}</strong> to <strong>{{ .Email }}</strong>.'],
      footer: 'If you didn’t make this change, reset your password from the sign-in page right away and contact SparkScribe support.',
    }),
  },
  'identity-linked': {
    supabase: 'Security notification: Sign-in method linked (mailer_templates_identity_linked_notification_content)',
    subject: 'A sign-in method was added to your SparkScribe account',
    html: layout({
      preheader: 'A new way to sign in was added to your SparkScribe account.',
      heading: 'New sign-in method added',
      paragraphs: ['Your <strong>{{ .Provider }}</strong> account can now be used to sign in to SparkScribe as <strong>{{ .Email }}</strong>.'],
      footer: 'If this wasn’t you, reset your password from the sign-in page and contact SparkScribe support.',
    }),
  },
};

// sample values for preview.html only (never in the templates)
const SAMPLE = { '{{ .TokenHash }}': 'pkce_sample0000000000000000000000000000', '{{ .Token }}': '482913', '{{ .Email }}': 'alex@example.com', '{{ .NewEmail }}': 'alex.new@example.com', '{{ .OldEmail }}': 'alex.old@example.com', '{{ .Provider }}': 'Google' };
// the preview shows the logo from this checkout (the live URL only works once the app with public/email/ is deployed)
const sample = (html) => Object.entries(SAMPLE).reduce((h, [k, v]) => h.split(k).join(v), html).split(LOGO).join('/email/sparkscribe-mark.png');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  const subjects = {};
  for (const [name, t] of Object.entries(TEMPLATES)) {
    writeFileSync(resolve(OUT, `${name}.html`), t.html);
    subjects[name] = { subject: t.subject, supabase: t.supabase };
  }
  writeFileSync(resolve(OUT, 'subjects.json'), `${JSON.stringify(subjects, null, 2)}\n`);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  writeFileSync(resolve(OUT, 'preview.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SparkScribe auth emails</title>
<style>body{margin:0;font:14px system-ui,sans-serif;background:#e9eaf0;color:#111}header{padding:16px}section{margin:0 16px 28px}h2{font-size:15px;margin:0 0 8px}h2 small{font-weight:400;color:#555}iframe{width:100%;height:760px;border:1px solid #ccd;border-radius:8px;background:#fff}</style></head><body>
<header><b>SparkScribe auth emails</b> — sample values; generated by scripts/build-email-templates.mjs</header>
${Object.entries(TEMPLATES).map(([n, t]) => `<section id="${n}"><h2>${t.subject} <small>${n}.html → ${t.supabase}</small></h2><iframe title="${esc(t.subject)}" srcdoc="${esc(sample(t.html))}"></iframe></section>`).join('\n')}
</body></html>
`);
  console.log(`wrote ${Object.keys(TEMPLATES).length} templates, subjects.json and preview.html to docs/auth/email-templates`);
}
